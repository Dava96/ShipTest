import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    await expect(
      readFile(path.join(outputRootPath, "doctor-result.json"), "utf8"),
    ).resolves.toContain("doctor-smoke");
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
