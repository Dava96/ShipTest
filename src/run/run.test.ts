import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import {
  benchmark,
  createShiptestConfigFixture,
  model,
} from "../test-support/shiptest-config-fixture.js";
import { regenerateReport, runShiptest } from "./run.js";

describe("runShiptest", () => {
  it("runs one configured benchmark/model, writes compact results, events, and report", async () => {
    const fixture = await createFixture();
    const progress: string[] = [];

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
      onProgress: (message) => progress.push(message),
    });

    expect(result.status).toBe("completed");
    expect(result.summary).toMatchObject({
      benchmarks: 1,
      agent_runs: 1,
      completed: 1,
      passed: 1,
      total_tokens: 7,
    });
    expect(progress.some((message) => message.includes("Preparing baseline"))).toBe(true);
    expect(progress.some((message) => message.includes("Running agent"))).toBe(true);

    const resultsJson = JSON.parse(
      await readFile(path.join(fixture.runRootPath, "results.json"), "utf8"),
    ) as typeof result;
    expect(resultsJson.artifacts).toEqual({
      report_html: "report.html",
      events_jsonl: "events.jsonl",
    });

    const attemptPath = path.join(
      fixture.runRootPath,
      result.benchmark_results[0]?.base_commits[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly submission: { readonly changed_files: readonly string[] };
      readonly artifacts: Record<string, string>;
    };
    expect(attempt.submission.changed_files).toEqual(["src/generated.txt"]);
    expect(attempt.artifacts.candidate_patch).toBe(
      "benchmarks/bench/base-commits/head/models/fake/attempts/001/candidate.patch",
    );
    expect(await readFile(path.join(fixture.runRootPath, "events.jsonl"), "utf8")).toContain(
      "run_completed",
    );
    expect(await readFile(path.join(fixture.runRootPath, "report.html"), "utf8")).toContain(
      "ShipTest report",
    );

    await expect(regenerateReport(fixture.runRootPath)).resolves.toBe(
      path.join(fixture.runRootPath, "report.html"),
    );
  });

  it("writes one aggregate doctor index with per-benchmark doctor details", async () => {
    const fixture = await createFixture({ secondBenchmark: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      draft: true,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.benchmark_results.map((benchmark) => benchmark.benchmark_id)).toEqual([
      "bench",
      "bench-two",
    ]);
    const doctorIndex = JSON.parse(
      await readFile(path.join(fixture.runRootPath, "doctor", "doctor-result.json"), "utf8"),
    ) as {
      readonly benchmark_results: readonly {
        readonly benchmark_id: string;
        readonly doctor_result: string;
      }[];
    };
    expect(doctorIndex.benchmark_results).toEqual([
      expect.objectContaining({
        benchmark_id: "bench",
        doctor_result: "benchmarks/bench/base-commits/head/doctor-result.json",
      }),
      expect.objectContaining({
        benchmark_id: "bench-two",
        doctor_result: "benchmarks/bench-two/base-commits/head/doctor-result.json",
      }),
    ]);
    await expect(
      readFile(
        path.join(
          fixture.runRootPath,
          "doctor",
          "benchmarks",
          "bench",
          "base-commits",
          "head",
          "doctor-result.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("bench");
    await expect(
      readFile(
        path.join(
          fixture.runRootPath,
          "doctor",
          "benchmarks",
          "bench-two",
          "base-commits",
          "head",
          "doctor-result.json",
        ),
        "utf8",
      ),
    ).resolves.toContain("bench-two");
  });

  it("writes running results and report before an attempt finishes", async () => {
    const fixture = await createFixture({ observePartialArtifacts: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      draft: true,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.status).toBe("completed");
    const observed = JSON.parse(await readFile(fixture.partialObservationPath, "utf8")) as {
      readonly status: string;
      readonly reportExists: boolean;
    };
    expect(observed).toEqual({ status: "running", reportExists: true });
  });

  it("runs repeated model attempts from runner.model_attempts", async () => {
    const fixture = await createFixture({ modelAttempts: 2 });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.summary.agent_runs).toBe(2);
    expect(result.benchmark_results[0]?.base_commits[0]?.attempts).toEqual([
      "benchmarks/bench/base-commits/head/models/fake/attempts/001/attempt.json",
      "benchmarks/bench/base-commits/head/models/fake/attempts/002/attempt.json",
    ]);
  });

  it("fails implementation attempts that report no token usage", async () => {
    const fixture = await createFixture({ zeroTokenUsage: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.status).toBe("completed_with_issues");
    const attemptPath = path.join(
      fixture.runRootPath,
      result.benchmark_results[0]?.base_commits[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly status: string;
      readonly quality_signals: readonly { readonly id: string; readonly severity: string }[];
    };
    expect(attempt.status).toBe("agent_failed");
    expect(attempt.quality_signals).toContainEqual(
      expect.objectContaining({ id: "agent_no_token_usage", severity: "error" }),
    );
  });

  it("fails implementation attempts that do not change files", async () => {
    const fixture = await createFixture({ noFileChanges: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    const attemptPath = path.join(
      fixture.runRootPath,
      result.benchmark_results[0]?.base_commits[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly status: string;
      readonly quality_signals: readonly { readonly id: string; readonly severity: string }[];
    };
    expect(attempt.status).toBe("agent_failed");
    expect(attempt.quality_signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "required_file_changes_missing", severity: "error" }),
        expect.objectContaining({ id: "empty_submission_patch", severity: "error" }),
      ]),
    );
  });

  it("keeps recovered agent errors as warning-only quality signals", async () => {
    const fixture = await createFixture({ recoveredAgentError: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.status).toBe("completed");
    const attemptPath = path.join(
      fixture.runRootPath,
      result.benchmark_results[0]?.base_commits[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly status: string;
      readonly quality_signals: readonly { readonly id: string; readonly severity: string }[];
    };
    expect(attempt.status).toBe("completed");
    expect(attempt.quality_signals).toContainEqual(
      expect.objectContaining({ id: "agent_reported_errors", severity: "warning" }),
    );
  });

  it("continues after an agent failure and records completed_with_issues", async () => {
    const fixture = await createFixture({ failingPi: true });

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: fixture.runRootPath,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.status).toBe("completed_with_issues");
    expect(result.summary.agent_failed).toBe(1);
    const attemptPath = path.join(
      fixture.runRootPath,
      result.benchmark_results[0]?.base_commits[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly status: string;
      readonly agent: { readonly status: string };
    };
    expect(attempt.status).toBe("agent_failed");
    expect(attempt.agent.status).toBe("process_failed");
  });
});

async function createFixture(
  options: {
    readonly failingPi?: boolean;
    readonly secondBenchmark?: boolean;
    readonly observePartialArtifacts?: boolean;
    readonly modelAttempts?: number;
    readonly noFileChanges?: boolean;
    readonly recoveredAgentError?: boolean;
    readonly zeroTokenUsage?: boolean;
  } = {},
): Promise<{
  readonly configPath: string;
  readonly fakePiPath: string;
  readonly runRootPath: string;
  readonly partialObservationPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-"));
  const repoPath = path.join(root, "repo");
  const runRootPath = path.join(root, "run");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "index.txt"), "baseline\n", "utf8");
  await initializeCleanGitRepo(repoPath);

  const partialObservationPath = path.join(root, "partial-observation.json");
  const fakePiPath = path.join(root, "fake-pi.cjs");
  await writeFile(
    fakePiPath,
    options.failingPi
      ? `if (process.argv.includes("--list-models")) { console.log("provider      model"); console.log("openai-codex  fake"); process.exit(0); }
process.stderr.write("boom\\n"); process.exit(3);\n`
      : `if (process.argv.includes("--list-models")) { console.log("provider      model"); console.log("openai-codex  fake"); process.exit(0); }
const fs = require("node:fs");
${
  options.observePartialArtifacts
    ? `const resultsPath = ${JSON.stringify(path.join(runRootPath, "results.json"))};
const reportPath = ${JSON.stringify(path.join(runRootPath, "report.html"))};
const observationPath = ${JSON.stringify(partialObservationPath)};
fs.writeFileSync(observationPath, JSON.stringify({ status: JSON.parse(fs.readFileSync(resultsPath, "utf8")).status, reportExists: fs.existsSync(reportPath) }));`
    : ""
}
fs.mkdirSync("src", { recursive: true });
${options.noFileChanges ? "" : 'fs.writeFileSync("src/generated.txt", "generated\\\\n");'}
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "write" }));
console.log(JSON.stringify({ type: "tool_execution_end", toolName: "write", isError: false }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], ${options.recoveredAgentError ? 'errorMessage: "temporary provider error", ' : ""}usage: ${options.zeroTokenUsage ? "{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } }" : "{ input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { total: 0.01 } }"} } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    "utf8",
  );

  const configFixture = await createShiptestConfigFixture({
    root,
    configSubdir: "config",
    projectRepo: repoPath,
    repositoryEnvironment: { validation_commands: { required: ["node --version"] } },
    ...(options.modelAttempts === undefined
      ? {}
      : { runner: { model_attempts: options.modelAttempts } }),
    models: [model("fake")],
    defaultModels: ["fake"],
    scoringCommand: `node -e "process.exit(0)"`,
    benchmarks: [
      benchmark("bench", { task: "tasks/task.md" }),
      ...(options.secondBenchmark ? [benchmark("bench-two", { task: "tasks/task-two.md" })] : []),
    ],
    files: {
      "tasks/task.md": "Create generated file.\n",
      ...(options.secondBenchmark ? { "tasks/task-two.md": "Create generated file again.\n" } : {}),
    },
  });

  return { configPath: configFixture.configPath, fakePiPath, runRootPath, partialObservationPath };
}
