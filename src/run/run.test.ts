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
      result.benchmark_results[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly submission: { readonly changed_files: readonly string[] };
      readonly artifacts: Record<string, string>;
    };
    expect(attempt.submission.changed_files).toEqual(["src/generated.txt"]);
    expect(attempt.artifacts.candidate_patch).toBe(
      "benchmarks/bench/models/fake/attempts/001/candidate.patch",
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
      result.benchmark_results[0]?.attempts[0] ?? "missing",
    );
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as {
      readonly status: string;
      readonly agent: { readonly status: string };
    };
    expect(attempt.status).toBe("agent_failed");
    expect(attempt.agent.status).toBe("process_failed");
  });
});

async function createFixture(options: { readonly failingPi?: boolean } = {}): Promise<{
  readonly configPath: string;
  readonly fakePiPath: string;
  readonly runRootPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-"));
  const repoPath = path.join(root, "repo");
  const runRootPath = path.join(root, "run");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "index.txt"), "baseline\n", "utf8");
  await initializeCleanGitRepo(repoPath);

  const fakePiPath = path.join(root, "fake-pi.cjs");
  await writeFile(
    fakePiPath,
    options.failingPi
      ? `process.stderr.write("boom\\n"); process.exit(3);\n`
      : `const fs = require("node:fs");
fs.mkdirSync("src", { recursive: true });
fs.writeFileSync("src/generated.txt", "generated\\n");
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "write" }));
console.log(JSON.stringify({ type: "tool_execution_end", toolName: "write", isError: false }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 3, output: 4, cacheRead: 0, cacheWrite: 0, totalTokens: 7, cost: { total: 0.01 } } } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    "utf8",
  );

  const configFixture = await createShiptestConfigFixture({
    root,
    configSubdir: "config",
    projectRepo: repoPath,
    repositoryEnvironment: { validation_commands: { required: ["node --version"] } },
    models: [model("fake")],
    defaultModels: ["fake"],
    scoringCommand: `node -e "process.exit(0)"`,
    benchmarks: [benchmark("bench", { task: "tasks/task.md" })],
    files: { "tasks/task.md": "Create generated file.\n" },
  });

  return { configPath: configFixture.configPath, fakePiPath, runRootPath };
}
