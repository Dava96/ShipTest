import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { writeRunEvent } from "./events.js";
import { createAttemptLayout, createRunLayout, toRunRelativePath } from "./run-layout.js";

describe("run layout", () => {
  it("creates deterministic run and attempt paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-layout-"));
    const run = await createRunLayout({ projectRootPath: root, runId: "run-1" });

    expect(run.runId).toBe("run-1");
    expect(run.runRootPath).toBe(path.join(root, ".shiptest", "runs", "run-1"));
    expect(run.resultsPath).toBe(path.join(run.runRootPath, "results.json"));
    expect(run.cacheRootPath).toBe(path.join(root, ".shiptest", "cache"));

    const attempt = await createAttemptLayout({
      runRootPath: run.runRootPath,
      benchmarkId: "invoice",
      modelId: "openai/gpt-5.5:high",
      attempt: 7,
    });

    expect(attempt.attemptRootPath.replaceAll("\\", "/")).toContain(
      "benchmarks/invoice/models/openai_gpt-5.5_high/attempts/007",
    );
    expect(toRunRelativePath(run.runRootPath, attempt.candidatePatchPath)).toBe(
      "benchmarks/invoice/models/openai_gpt-5.5_high/attempts/007/candidate.patch",
    );
  });

  it("uses explicit output directories and appends JSONL run events", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-layout-"));
    const runRoot = path.join(root, "custom-run");
    const run = await createRunLayout({ projectRootPath: root, runRootPath: runRoot });

    expect(run.runRootPath).toBe(runRoot);
    await writeRunEvent(run.eventsPath, { type: "run_started", run_id: run.runId });
    await writeRunEvent(run.eventsPath, { type: "run_completed", status: "completed" });

    const lines = (await readFile(run.eventsPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ type: "run_started" });
    expect(JSON.parse(lines[1] ?? "{}")).toMatchObject({
      type: "run_completed",
      status: "completed",
    });
  });
});
