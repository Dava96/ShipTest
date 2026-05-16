import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { writeRunEvent } from "./events.js";
import { createAttemptLayout, createRunLayout, toRunRelativePath } from "./run-layout.js";

describe("run layout", () => {
  it("creates date-grouped sequential run directories by default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-layout-"));
    const date = new Date("2026-05-12T14:29:28.000Z");

    const firstRun = await createRunLayout({ projectRootPath: root, date });
    const secondRun = await createRunLayout({ projectRootPath: root, date });

    expect(firstRun.runId).toBe("20260512/run-001");
    expect(firstRun.runRootPath).toBe(path.join(root, ".shiptest", "runs", "20260512", "run-001"));
    expect(secondRun.runId).toBe("20260512/run-002");
    expect(secondRun.runRootPath).toBe(path.join(root, ".shiptest", "runs", "20260512", "run-002"));
    expect(firstRun.resultsPath).toBe(path.join(firstRun.runRootPath, "results.json"));
    expect(firstRun.cacheRootPath).toBe(path.join(root, ".shiptest", "cache"));
  });

  it("skips existing run directories when allocating the next daily run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-run-layout-"));
    await mkdir(path.join(root, ".shiptest", "runs", "20260512", "run-001"), {
      recursive: true,
    });

    const run = await createRunLayout({
      projectRootPath: root,
      date: new Date("2026-05-12T14:29:28.000Z"),
    });

    expect(run.runId).toBe("20260512/run-002");
    expect(run.runRootPath).toBe(path.join(root, ".shiptest", "runs", "20260512", "run-002"));
  });

  it("creates deterministic run and attempt paths for explicit run ids", async () => {
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
