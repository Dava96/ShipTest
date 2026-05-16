import { mkdir } from "node:fs/promises";
import path from "node:path";

export interface RunLayout {
  readonly runId: string;
  readonly runRootPath: string;
  readonly resultsPath: string;
  readonly eventsPath: string;
  readonly reportPath: string;
  readonly doctorOutputPath: string;
  readonly cacheRootPath: string;
  readonly workspaceRootPath: string;
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

const MaxDailyRunDirectories = 9999;

export async function createRunLayout(options: {
  readonly projectRootPath: string;
  readonly runRootPath?: string | undefined;
  readonly runId?: string | undefined;
  readonly date?: Date | undefined;
}): Promise<RunLayout> {
  const runsRootPath = path.join(options.projectRootPath, ".shiptest", "runs");
  const allocatedRun = options.runRootPath
    ? {
        runId: options.runId ?? path.basename(options.runRootPath),
        runRootPath: path.resolve(options.runRootPath),
      }
    : options.runId
      ? {
          runId: options.runId,
          runRootPath: path.resolve(runsRootPath, options.runId),
        }
      : await allocateDailyRunDirectory(runsRootPath, options.date ?? new Date());

  const layout: RunLayout = {
    runId: allocatedRun.runId,
    runRootPath: allocatedRun.runRootPath,
    resultsPath: path.join(allocatedRun.runRootPath, "results.json"),
    eventsPath: path.join(allocatedRun.runRootPath, "events.jsonl"),
    reportPath: path.join(allocatedRun.runRootPath, "report.html"),
    doctorOutputPath: path.join(allocatedRun.runRootPath, "doctor"),
    cacheRootPath: path.join(options.projectRootPath, ".shiptest", "cache"),
    workspaceRootPath: path.join(options.projectRootPath, ".shiptest", "workspaces", "resettable"),
  };
  if (options.runRootPath || options.runId) {
    await mkdir(allocatedRun.runRootPath, { recursive: true });
  }
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

async function allocateDailyRunDirectory(
  runsRootPath: string,
  date: Date,
): Promise<{ readonly runId: string; readonly runRootPath: string }> {
  const dateDirectoryName = formatRunDate(date);
  const dateRootPath = path.join(runsRootPath, dateDirectoryName);
  await mkdir(dateRootPath, { recursive: true });

  for (let runNumber = 1; runNumber <= MaxDailyRunDirectories; runNumber += 1) {
    const runDirectoryName = `run-${String(runNumber).padStart(3, "0")}`;
    const runRootPath = path.join(dateRootPath, runDirectoryName);
    try {
      await mkdir(runRootPath, { recursive: false });
      return {
        runId: `${dateDirectoryName}/${runDirectoryName}`,
        runRootPath,
      };
    } catch (error) {
      if (isDirectoryAlreadyExistsError(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Could not allocate a ShipTest run directory under ${dateRootPath}; exhausted ${MaxDailyRunDirectories} run slots.`,
  );
}

function formatRunDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function isDirectoryAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
