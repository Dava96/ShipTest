import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isFilesystemRoot, pathExists, safeRemoveDescendant } from "../utils/filesystem.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";

export type WorkspacePrepareStrategy = "copy" | "resettable_git";

export interface WorkspacePrepareResult {
  readonly workspace_path: string;
  readonly strategy: WorkspacePrepareStrategy;
  readonly reused: boolean;
  readonly fallback_used: boolean;
}

export async function prepareResettableGitWorkspace(options: {
  readonly preparedBaselinePath: string;
  readonly workspacePath: string;
  readonly baselineCommit: string;
  readonly gitOperations?: GitOperations;
}): Promise<WorkspacePrepareResult> {
  const gitOperations = options.gitOperations ?? defaultGitOperations;

  if (!(await pathExists(options.workspacePath))) {
    await copyWorkspace(options.preparedBaselinePath, options.workspacePath);
    await resetWorkspace(options.workspacePath, options.baselineCommit, gitOperations);
    return {
      workspace_path: options.workspacePath,
      strategy: "resettable_git",
      reused: false,
      fallback_used: false,
    };
  }

  try {
    await resetWorkspace(options.workspacePath, options.baselineCommit, gitOperations);
    return {
      workspace_path: options.workspacePath,
      strategy: "resettable_git",
      reused: true,
      fallback_used: false,
    };
  } catch {
    await removeWorkspacePath(options.workspacePath);
    await copyWorkspace(options.preparedBaselinePath, options.workspacePath);
    await resetWorkspace(options.workspacePath, options.baselineCommit, gitOperations);
    return {
      workspace_path: options.workspacePath,
      strategy: "resettable_git",
      reused: false,
      fallback_used: true,
    };
  }
}

export async function prepareCopiedWorkspace(options: {
  readonly preparedBaselinePath: string;
  readonly workspacePath: string;
  readonly overwrite: boolean;
}): Promise<WorkspacePrepareResult> {
  if (await pathExists(options.workspacePath)) {
    if (!options.overwrite) {
      throw new Error(`Workspace already exists: ${options.workspacePath}`);
    }
    await removeWorkspacePath(options.workspacePath);
  }
  await copyWorkspace(options.preparedBaselinePath, options.workspacePath);
  return {
    workspace_path: options.workspacePath,
    strategy: "copy",
    reused: false,
    fallback_used: false,
  };
}

async function copyWorkspace(preparedBaselinePath: string, workspacePath: string): Promise<void> {
  await mkdir(path.dirname(path.resolve(workspacePath)), { recursive: true });
  await copyWorkspaceWithRetry(preparedBaselinePath, workspacePath);
}

async function copyWorkspaceWithRetry(
  preparedBaselinePath: string,
  workspacePath: string,
): Promise<void> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await cp(preparedBaselinePath, workspacePath, { recursive: true, verbatimSymlinks: true });
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isTransientCopyError(error)) {
        throw error;
      }
      await safeRemoveDescendant(path.dirname(path.resolve(workspacePath)), workspacePath).catch(
        () => undefined,
      );
      await delay(100 * attempt);
    }
  }
}

function isTransientCopyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["EBUSY", "ENOENT", "EPERM"].includes(String(error.code))
  );
}

async function resetWorkspace(
  workspacePath: string,
  baselineCommit: string,
  gitOperations: GitOperations,
): Promise<void> {
  await gitOperations.git(
    ["-c", "core.longpaths=true", "reset", "--hard", baselineCommit],
    workspacePath,
  );
  await gitOperations.git(["-c", "core.longpaths=true", "clean", "-ffdx"], workspacePath);
  const status = (
    await gitOperations.git(["-c", "core.longpaths=true", "status", "--porcelain"], workspacePath)
  ).stdout.trim();
  if (status.length > 0) {
    throw new Error("Resettable workspace did not reset to a clean working tree.");
  }
}

async function removeWorkspacePath(workspacePath: string): Promise<void> {
  const resolvedPath = path.resolve(workspacePath);
  if (isFilesystemRoot(resolvedPath)) {
    throw new Error(`Refusing to remove filesystem root: ${workspacePath}`);
  }
  await safeRemoveDescendant(path.dirname(resolvedPath), resolvedPath);
}
