import { mkdir } from "node:fs/promises";
import path from "node:path";

import { createRunId } from "./run-id.js";

export interface RunLayout {
  readonly runId: string;
  readonly runRootPath: string;
  readonly resultsPath: string;
  readonly eventsPath: string;
  readonly reportPath: string;
  readonly doctorOutputPath: string;
  readonly cacheRootPath: string;
}

export interface AttemptLayout {
  readonly attemptRootPath: string;
  readonly attemptJsonPath: string;
  readonly agentWorkspacePath: string;
  readonly evaluationWorkspacePath: string;
  readonly agentArtifactsPath: string;
  readonly evaluationArtifactsPath: string;
  readonly candidatePatchPath: string;
  readonly changedFilesPath: string;
}

export async function createRunLayout(options: {
  readonly projectRootPath: string;
  readonly runRootPath?: string | undefined;
  readonly runId?: string | undefined;
}): Promise<RunLayout> {
  const runId = options.runId ?? createRunId();
  const runRootPath = path.resolve(
    options.runRootPath ?? path.join(options.projectRootPath, ".shiptest", "runs", runId),
  );
  const layout: RunLayout = {
    runId,
    runRootPath,
    resultsPath: path.join(runRootPath, "results.json"),
    eventsPath: path.join(runRootPath, "events.jsonl"),
    reportPath: path.join(runRootPath, "report.html"),
    doctorOutputPath: path.join(runRootPath, "doctor"),
    cacheRootPath: path.join(options.projectRootPath, ".shiptest", "cache"),
  };
  await mkdir(runRootPath, { recursive: true });
  return layout;
}

export async function createAttemptLayout(options: {
  readonly runRootPath: string;
  readonly benchmarkId: string;
  readonly modelId: string;
  readonly attempt: number;
}): Promise<AttemptLayout> {
  const attemptDirectoryName = String(options.attempt).padStart(3, "0");
  const safeModelId = options.modelId.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  const attemptRootPath = path.join(
    options.runRootPath,
    "benchmarks",
    options.benchmarkId,
    "models",
    safeModelId,
    "attempts",
    attemptDirectoryName,
  );
  const layout: AttemptLayout = {
    attemptRootPath,
    attemptJsonPath: path.join(attemptRootPath, "attempt.json"),
    agentWorkspacePath: path.join(attemptRootPath, "agent-workspace"),
    evaluationWorkspacePath: path.join(attemptRootPath, "evaluation-workspace"),
    agentArtifactsPath: path.join(attemptRootPath, "agent"),
    evaluationArtifactsPath: path.join(attemptRootPath, "evaluation"),
    candidatePatchPath: path.join(attemptRootPath, "candidate.patch"),
    changedFilesPath: path.join(attemptRootPath, "changed-files.json"),
  };
  await mkdir(attemptRootPath, { recursive: true });
  return layout;
}

export function toRunRelativePath(runRootPath: string, artifactPath: string): string {
  return path.relative(runRootPath, artifactPath).replaceAll("\\", "/");
}
