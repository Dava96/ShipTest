import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadShiptestConfigContext } from "../config/load-config.js";
import { benchmark, createShiptestConfigFixture } from "../test-support/shiptest-config-fixture.js";
import { git } from "../utils/git.js";
import { DoctorCheckCode } from "./check-codes.js";
import { runDoctor } from "./run-doctor.js";

async function createRepo(): Promise<string> {
  const repoPath = await mkdtemp(path.join(os.tmpdir(), "shiptest-doctor-repo-"));
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "index.js"), "export const value = 1;\n");
  await git(["init", "--initial-branch", "main"], repoPath);
  await git(["config", "user.email", "test@shiptest.local"], repoPath);
  await git(["config", "user.name", "ShipTest Test"], repoPath);
  await git(["add", "-A"], repoPath);
  await git(["commit", "-m", "initial"], repoPath);
  return repoPath;
}

describe("runDoctor", () => {
  it("builds a snapshot, runs required/advisory validation, and prepares a cached baseline", async () => {
    const repoPath = await createRepo();
    const fixturePath = await createConfig(repoPath, {
      required: ['node -e "process.exit(0)"'],
      advisory: ['node -e "process.exit(1)"'],
    });
    const context = await loadShiptestConfigContext(path.join(fixturePath, "shiptest.yaml"));
    const outputRootPath = path.join(fixturePath, ".shiptest", "doctor");
    const cacheRootPath = path.join(fixturePath, ".shiptest", "cache");

    const result = await runDoctor(context, { outputRootPath, cacheRootPath });

    expect(result.ok).toBe(true);
    expect(result.benchmark_results).toHaveLength(1);
    const [benchmarkResult] = result.benchmark_results;
    expect(benchmarkResult?.timings_ms).toMatchObject({
      total_ms: expect.any(Number),
      snapshot_ms: expect.any(Number),
      required_validation_ms: expect.any(Number),
      advisory_validation_ms: expect.any(Number),
      prepare_baseline_ms: expect.any(Number),
    });
    expect(benchmarkResult?.commands.map((command) => command.phase)).toEqual([
      "required_validation",
      "advisory_validation",
    ]);
    expect(benchmarkResult?.checks).toContainEqual(
      expect.objectContaining({
        code: DoctorCheckCode.AdvisoryValidationFailed,
        severity: "warning",
      }),
    );
    expect(benchmarkResult?.prepared_baseline_metadata?.clean_git_repo.baseline_commit).toEqual(
      expect.any(String),
    );
    expect(benchmarkResult?.prepared_baseline_timings_ms).toMatchObject({
      total_ms: expect.any(Number),
      copy_source_ms: expect.any(Number),
      clean_git_ms: expect.any(Number),
      size_scan_ms: expect.any(Number),
      cache_save_ms: expect.any(Number),
    });
    const aggregate = JSON.parse(
      await readFile(path.join(outputRootPath, "doctor-result.json"), "utf8"),
    ) as { readonly benchmark_results: readonly { readonly doctor_result: string }[] };
    expect(aggregate.benchmark_results[0]?.doctor_result).toBe(
      "benchmarks/doctor-smoke/doctor-result.json",
    );
    await expect(
      readFile(
        path.join(outputRootPath, "benchmarks", "doctor-smoke", "doctor-result.json"),
        "utf8",
      ),
    ).resolves.toContain("DOCTOR_ADVISORY_VALIDATION_FAILED");
  });

  it("uses a valid prepared-baseline cache and skips validation unless noCache is set", async () => {
    const repoPath = await createRepo();
    const fixturePath = await createConfig(repoPath, {
      required: ['node -e "process.exit(0)"'],
      advisory: [],
    });
    const context = await loadShiptestConfigContext(path.join(fixturePath, "shiptest.yaml"));
    const outputRootPath = path.join(fixturePath, ".shiptest", "doctor");
    const cacheRootPath = path.join(fixturePath, ".shiptest", "cache");

    await expect(runDoctor(context, { outputRootPath, cacheRootPath })).resolves.toMatchObject({
      ok: true,
    });
    const cached = await runDoctor(context, { outputRootPath, cacheRootPath });

    expect(cached.ok).toBe(true);
    expect(cached.benchmark_results[0]?.commands).toEqual([]);
    expect(cached.benchmark_results[0]?.timings_ms.cache_restore_ms).toEqual(expect.any(Number));
    expect(cached.benchmark_results[0]?.checks).toContainEqual(
      expect.objectContaining({ code: DoctorCheckCode.CacheUsed }),
    );

    const uncached = await runDoctor(context, { outputRootPath, cacheRootPath, noCache: true });
    expect(uncached.benchmark_results[0]?.commands).toHaveLength(1);
  });

  it("prepares a shared baseline once for benchmarks with the same baseline identity", async () => {
    const repoPath = await createRepo();
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-doctor-shared-"));
    const setupCountPath = path.join(root, "setup-count.txt");
    const setupScriptPath = path.join(root, "increment-setup-count.cjs");
    await writeFile(
      setupScriptPath,
      `const fs = require("node:fs");\nconst p = ${JSON.stringify(setupCountPath)};\nfs.writeFileSync(p, String((Number((fs.existsSync(p) && fs.readFileSync(p, "utf8")) || 0) + 1)));\n`,
      "utf8",
    );
    const fixture = await createShiptestConfigFixture({
      root,
      configSubdir: "config",
      projectRepo: repoPath,
      repositoryEnvironment: {
        commands_run_in: "shiptest_environment",
        source: "local",
        setup_commands: [`node ${JSON.stringify(setupScriptPath)}`],
        validation_commands: { required: ['node -e "process.exit(0)"'], advisory: [] },
      },
      benchmarks: [
        benchmark("doctor-smoke", {
          agent_context: { exclude_paths: ["docs/**"] },
        }),
        benchmark("doctor-smoke-two", {
          task: "tasks/doctor-smoke-two.md",
          agent_context: { exclude_paths: ["generated/**"] },
        }),
      ],
      files: {
        "tasks/doctor-smoke.md": "Do the thing.\n",
        "tasks/doctor-smoke-two.md": "Do the other thing.\n",
      },
    });
    const context = await loadShiptestConfigContext(fixture.configPath);
    const outputRootPath = path.join(root, ".shiptest", "doctor");

    const result = await runDoctor(context, {
      outputRootPath,
      cacheRootPath: path.join(root, ".shiptest", "cache"),
      concurrency: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.baseline_results).toHaveLength(1);
    expect(result.baseline_results[0]?.benchmark_ids).toEqual(["doctor-smoke", "doctor-smoke-two"]);
    expect(await readFile(setupCountPath, "utf8")).toBe("1");
    expect(result.benchmark_results.map((item) => item.baseline_id)).toEqual([
      result.baseline_results[0]?.baseline_id,
      result.baseline_results[0]?.baseline_id,
    ]);
    const aggregate = JSON.parse(
      await readFile(path.join(outputRootPath, "doctor-result.json"), "utf8"),
    ) as {
      readonly baseline_results: readonly { readonly baseline_result: string }[];
      readonly benchmark_results: readonly { readonly baseline_result: string }[];
    };
    expect(aggregate.baseline_results[0]?.baseline_result).toMatch(
      /^baselines\/.+\/baseline-result\.json$/,
    );
    expect(aggregate.benchmark_results[0]?.baseline_result).toBe(
      aggregate.baseline_results[0]?.baseline_result,
    );
  });

  it("prepares distinct baseline groups concurrently", async () => {
    const repoPath = await createRepo();
    const firstCommit = (await git(["rev-parse", "HEAD"], repoPath)).stdout.trim();
    await writeFile(path.join(repoPath, "src", "second.js"), "export const second = 2;\n");
    await git(["add", "-A"], repoPath);
    await git(["commit", "-m", "second"], repoPath);
    const secondCommit = (await git(["rev-parse", "HEAD"], repoPath)).stdout.trim();
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-doctor-concurrent-"));
    const activeDir = path.join(root, "active");
    const maxPath = path.join(root, "max-active.txt");
    await mkdir(activeDir, { recursive: true });
    const setupScriptPath = path.join(root, "track-active-setup.cjs");
    await writeFile(
      setupScriptPath,
      `const fs = require("node:fs");\nconst path = require("node:path");\nconst active = ${JSON.stringify(activeDir)};\nconst max = ${JSON.stringify(maxPath)};\nfs.mkdirSync(active, { recursive: true });\nconst marker = path.join(active, process.pid + ".txt");\nfs.writeFileSync(marker, "1");\nconst count = fs.readdirSync(active).length;\nconst prev = fs.existsSync(max) ? Number(fs.readFileSync(max, "utf8")) : 0;\nfs.writeFileSync(max, String(Math.max(prev, count)));\nsetTimeout(() => { fs.rmSync(marker, { force: true }); }, 500);\nsetTimeout(() => process.exit(0), 550);\n`,
      "utf8",
    );
    const setupCommand = `node ${JSON.stringify(setupScriptPath)}`;
    const fixture = await createShiptestConfigFixture({
      root,
      configSubdir: "config",
      projectRepo: repoPath,
      repositoryEnvironment: {
        commands_run_in: "shiptest_environment",
        source: "local",
        setup_commands: [setupCommand],
        validation_commands: { required: ['node -e "process.exit(0)"'], advisory: [] },
      },
      benchmarks: [
        benchmark("doctor-first", { base_commit: firstCommit, task: "tasks/doctor-first.md" }),
        benchmark("doctor-second", { base_commit: secondCommit, task: "tasks/doctor-second.md" }),
      ],
      files: {
        "tasks/doctor-first.md": "Do the first thing.\n",
        "tasks/doctor-second.md": "Do the second thing.\n",
      },
    });
    const context = await loadShiptestConfigContext(fixture.configPath);

    const result = await runDoctor(context, {
      outputRootPath: path.join(root, ".shiptest", "doctor"),
      cacheRootPath: path.join(root, ".shiptest", "cache"),
      concurrency: 2,
    });

    expect(result.ok).toBe(true);
    expect(result.baseline_results).toHaveLength(2);
    expect(await readFile(maxPath, "utf8")).toBe("2");
    await rm(activeDir, { force: true, recursive: true });
  });

  it("fails fast on required validation failure and does not prepare a baseline", async () => {
    const repoPath = await createRepo();
    const fixturePath = await createConfig(repoPath, {
      required: ['node -e "process.exit(1)"', 'node -e "process.exit(0)"'],
      advisory: ['node -e "process.exit(0)"'],
    });
    const context = await loadShiptestConfigContext(path.join(fixturePath, "shiptest.yaml"));

    const result = await runDoctor(context, {
      outputRootPath: path.join(fixturePath, ".shiptest", "doctor"),
      cacheRootPath: path.join(fixturePath, ".shiptest", "cache"),
    });

    expect(result.ok).toBe(false);
    expect(result.benchmark_results[0]?.commands).toHaveLength(1);
    expect(result.benchmark_results[0]?.prepared_baseline_metadata).toBeUndefined();
    expect(result.benchmark_results[0]?.checks).toContainEqual(
      expect.objectContaining({ code: DoctorCheckCode.RequiredValidationFailed }),
    );
  });

  it("caps command output in doctor results", async () => {
    const repoPath = await createRepo();
    const fixturePath = await createConfig(repoPath, {
      required: ["node -e \"process.stdout.write('x'.repeat(100))\""],
      advisory: [],
    });
    const context = await loadShiptestConfigContext(path.join(fixturePath, "shiptest.yaml"));

    const result = await runDoctor(context, {
      outputRootPath: path.join(fixturePath, ".shiptest", "doctor"),
      cacheRootPath: path.join(fixturePath, ".shiptest", "cache"),
      commandOutputMaxBytes: 10,
      noCache: true,
    });

    expect(result.ok).toBe(true);
    expect(result.benchmark_results[0]?.commands[0]).toMatchObject({
      stdout: "x".repeat(10),
      stdout_truncated: true,
    });
  });

  it("continues reporting other benchmarks after one benchmark fails", async () => {
    const repoPath = await createRepo();
    const fixturePath = await createConfig(repoPath, {
      required: ['node -e "process.exit(0)"'],
      advisory: [],
      secondInvalidBase: true,
    });
    const context = await loadShiptestConfigContext(path.join(fixturePath, "shiptest.yaml"));

    const result = await runDoctor(context, {
      outputRootPath: path.join(fixturePath, ".shiptest", "doctor"),
      cacheRootPath: path.join(fixturePath, ".shiptest", "cache"),
    });

    expect(result.ok).toBe(false);
    expect(
      result.benchmark_results.map((benchmark) => [benchmark.benchmark_id, benchmark.ok]),
    ).toEqual([
      ["doctor-smoke", true],
      ["doctor-failing", false],
    ]);
    const aggregate = JSON.parse(
      await readFile(path.join(fixturePath, ".shiptest", "doctor", "doctor-result.json"), "utf8"),
    ) as {
      readonly benchmark_results: readonly {
        readonly benchmark_id: string;
        readonly doctor_result: string;
      }[];
    };
    expect(aggregate.benchmark_results).toEqual([
      expect.objectContaining({
        benchmark_id: "doctor-smoke",
        doctor_result: "benchmarks/doctor-smoke/doctor-result.json",
      }),
      expect.objectContaining({
        benchmark_id: "doctor-failing",
        doctor_result: "benchmarks/doctor-failing/doctor-result.json",
      }),
    ]);
    await expect(
      readFile(
        path.join(
          fixturePath,
          ".shiptest",
          "doctor",
          "benchmarks",
          "doctor-failing",
          "doctor-result.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("DOCTOR_SNAPSHOT_FAILED");
  });
});

async function createConfig(
  repoPath: string,
  options: {
    readonly required: readonly string[];
    readonly advisory: readonly string[];
    readonly secondInvalidBase?: boolean;
  },
): Promise<string> {
  const fixture = await createShiptestConfigFixture({
    projectRepo: repoPath,
    repositoryEnvironment: {
      commands_run_in: "shiptest_environment",
      source: "local",
      setup_commands: [],
      validation_commands: {
        required: [...options.required],
        advisory: [...options.advisory],
      },
    },
    benchmarks: [
      benchmark("doctor-smoke"),
      ...(options.secondInvalidBase
        ? [benchmark("doctor-failing", { base_commit: "missing-commit" })]
        : []),
    ],
    files: {
      "tasks/doctor-smoke.md": "Do the thing.\n",
      ...(options.secondInvalidBase ? { "tasks/doctor-failing.md": "Do the thing.\n" } : {}),
    },
  });

  return fixture.configDir;
}
