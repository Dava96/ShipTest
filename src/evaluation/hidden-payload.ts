import { cp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { CheckSeverity } from "../checks/severity.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import {
  HiddenEvaluationDirectoryWriteMode,
  HiddenEvaluationFileWriteMode,
} from "../config/schema-values.js";
import {
  isDirectory,
  isFile,
  isPathInside,
  pathExists,
  safeRemoveDescendant,
} from "../utils/filesystem.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { EvaluationCheckCode } from "./check-codes.js";
import type { EvaluationCheck } from "./types.js";

export interface ApplyHiddenEvaluationPayloadOptions {
  readonly workspacePath: string;
  readonly configDir: string;
  readonly evaluation: ResolvedShiptestConfig["benchmarks"][number]["evaluation"];
  readonly gitOperations?: GitOperations;
}

export interface ApplyHiddenEvaluationPayloadResult {
  readonly ok: boolean;
  readonly checks: readonly EvaluationCheck[];
}

export async function applyHiddenEvaluationPayload(
  options: ApplyHiddenEvaluationPayloadOptions,
): Promise<ApplyHiddenEvaluationPayloadResult> {
  const checks: EvaluationCheck[] = [];
  const gitOperations = options.gitOperations ?? defaultGitOperations;

  for (const hiddenFile of options.evaluation.hidden_evaluation_files) {
    const sourcePath = path.resolve(options.configDir, hiddenFile.shiptest_path);
    const targetPath = path.join(options.workspacePath, hiddenFile.repository_path);
    const result = await applyHiddenFile(
      sourcePath,
      targetPath,
      hiddenFile.repository_path,
      hiddenFile.write_mode,
    );
    checks.push(result);
    if (result.severity === CheckSeverity.Error) {
      return { ok: false, checks };
    }
  }

  for (const hiddenDirectory of options.evaluation.hidden_evaluation_directories) {
    const sourcePath = path.resolve(options.configDir, hiddenDirectory.shiptest_path);
    const targetPath = path.join(options.workspacePath, hiddenDirectory.repository_path);
    const result = await applyHiddenDirectory(
      sourcePath,
      targetPath,
      options.workspacePath,
      hiddenDirectory.repository_path,
      hiddenDirectory.write_mode,
    );
    checks.push(result);
    if (result.severity === CheckSeverity.Error) {
      return { ok: false, checks };
    }
  }

  for (const hiddenPatch of options.evaluation.hidden_evaluation_patches) {
    const patchPath = path.resolve(options.configDir, hiddenPatch.shiptest_path);
    if (hiddenPatch.reset_touched_paths_before_apply) {
      const resetResult = await resetPatchTouchedPaths({
        workspacePath: options.workspacePath,
        patchPath,
        gitOperations,
      });
      checks.push(resetResult.check);
      if (!resetResult.ok) {
        return { ok: false, checks };
      }
    }

    try {
      await gitOperations.git(
        ["apply", "--binary", "--whitespace=nowarn", patchPath],
        options.workspacePath,
      );
      checks.push({
        code: EvaluationCheckCode.HiddenEvaluationPatchApplied,
        severity: CheckSeverity.Pass,
        message: "Applied hidden evaluation patch.",
        paths: [hiddenPatch.shiptest_path],
      });
    } catch (error) {
      checks.push({
        code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
        severity: CheckSeverity.Error,
        message: `Failed to apply hidden evaluation patch. ${formatError(error)}`,
        paths: [hiddenPatch.shiptest_path],
      });
      return { ok: false, checks };
    }
  }

  return { ok: true, checks };
}

async function applyHiddenFile(
  sourcePath: string,
  targetPath: string,
  repositoryPath: string,
  writeMode: HiddenEvaluationFileWriteMode,
): Promise<EvaluationCheck> {
  try {
    if (!(await isFile(sourcePath))) {
      return hiddenPayloadFailure(
        `Hidden evaluation source file does not exist: ${sourcePath}`,
        repositoryPath,
      );
    }

    const targetExists = await pathExists(targetPath);
    if (writeMode === HiddenEvaluationFileWriteMode.CreateNew && targetExists) {
      return hiddenPayloadFailure(
        `Hidden evaluation file uses ${HiddenEvaluationFileWriteMode.CreateNew} but target already exists.`,
        repositoryPath,
      );
    }
    if (writeMode === HiddenEvaluationFileWriteMode.ReplaceExisting && !targetExists) {
      return hiddenPayloadFailure(
        `Hidden evaluation file uses ${HiddenEvaluationFileWriteMode.ReplaceExisting} but target does not exist.`,
        repositoryPath,
      );
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, { force: true });
    return {
      code: EvaluationCheckCode.HiddenEvaluationFileApplied,
      severity: CheckSeverity.Pass,
      message: "Applied hidden evaluation file.",
      paths: [repositoryPath],
    };
  } catch (error) {
    return hiddenPayloadFailure(
      `Failed to apply hidden evaluation file. ${formatError(error)}`,
      repositoryPath,
    );
  }
}

async function applyHiddenDirectory(
  sourcePath: string,
  targetPath: string,
  workspacePath: string,
  repositoryPath: string,
  writeMode: HiddenEvaluationDirectoryWriteMode,
): Promise<EvaluationCheck> {
  try {
    if (!(await isDirectory(sourcePath))) {
      return hiddenPayloadFailure(
        `Hidden evaluation source directory does not exist: ${sourcePath}`,
        repositoryPath,
      );
    }

    const targetExists = await pathExists(targetPath);
    if (writeMode === HiddenEvaluationDirectoryWriteMode.CreateNew && targetExists) {
      return hiddenPayloadFailure(
        `Hidden evaluation directory uses ${HiddenEvaluationDirectoryWriteMode.CreateNew} but target already exists.`,
        repositoryPath,
      );
    }
    if (writeMode === HiddenEvaluationDirectoryWriteMode.ReplaceExisting && !targetExists) {
      return hiddenPayloadFailure(
        `Hidden evaluation directory uses ${HiddenEvaluationDirectoryWriteMode.ReplaceExisting} but target does not exist.`,
        repositoryPath,
      );
    }
    if (writeMode === HiddenEvaluationDirectoryWriteMode.MergeWithoutOverwrite && targetExists) {
      const collision = await findDirectoryCollision(sourcePath, targetPath);
      if (collision) {
        return hiddenPayloadFailure(
          `Hidden evaluation directory uses ${HiddenEvaluationDirectoryWriteMode.MergeWithoutOverwrite} but target file already exists.`,
          path.posix.join(repositoryPath.replaceAll("\\", "/"), collision.replaceAll("\\", "/")),
        );
      }
    }
    if (writeMode === HiddenEvaluationDirectoryWriteMode.ReplaceExisting && targetExists) {
      await safeRemoveDescendant(workspacePath, targetPath);
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath, {
      force: writeMode === HiddenEvaluationDirectoryWriteMode.MergeAndReplace,
      recursive: true,
      verbatimSymlinks: true,
    });
    return {
      code: EvaluationCheckCode.HiddenEvaluationDirectoryApplied,
      severity: CheckSeverity.Pass,
      message: "Applied hidden evaluation directory.",
      paths: [repositoryPath],
    };
  } catch (error) {
    return hiddenPayloadFailure(
      `Failed to apply hidden evaluation directory. ${formatError(error)}`,
      repositoryPath,
    );
  }
}

async function resetPatchTouchedPaths(options: {
  readonly workspacePath: string;
  readonly patchPath: string;
  readonly gitOperations: GitOperations;
}): Promise<{ readonly ok: boolean; readonly check: EvaluationCheck }> {
  try {
    const patch = await readFile(options.patchPath, "utf8");
    const touchedPaths = parsePatchTouchedRepositoryPaths(patch);
    for (const repositoryPath of touchedPaths) {
      await resetRepositoryPathToHead({
        workspacePath: options.workspacePath,
        repositoryPath,
        gitOperations: options.gitOperations,
      });
    }
    return {
      ok: true,
      check: {
        code: EvaluationCheckCode.HiddenEvaluationPatchResetTouchedPaths,
        severity: CheckSeverity.Pass,
        message:
          touchedPaths.length === 0
            ? "Hidden evaluation patch reset was requested, but no touched paths were detected."
            : "Reset hidden evaluation patch touched path(s) to the prepared-baseline state before applying the patch.",
        paths: touchedPaths,
      },
    };
  } catch (error) {
    return {
      ok: false,
      check: {
        code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
        severity: CheckSeverity.Error,
        message: `Failed to reset hidden evaluation patch touched paths. ${formatError(error)}`,
        paths: [options.patchPath],
      },
    };
  }
}

async function resetRepositoryPathToHead(options: {
  readonly workspacePath: string;
  readonly repositoryPath: string;
  readonly gitOperations: GitOperations;
}): Promise<void> {
  const targetPath = resolveWorkspaceRepositoryPath(options.workspacePath, options.repositoryPath);
  const existsInHead = await repositoryPathExistsInHead(options);
  if (await pathExists(targetPath)) {
    await safeRemoveDescendant(options.workspacePath, targetPath);
  }
  if (existsInHead) {
    await options.gitOperations.git(
      ["checkout", "--", options.repositoryPath],
      options.workspacePath,
    );
  }
}

async function repositoryPathExistsInHead(options: {
  readonly workspacePath: string;
  readonly repositoryPath: string;
  readonly gitOperations: GitOperations;
}): Promise<boolean> {
  try {
    await options.gitOperations.git(
      ["cat-file", "-e", `HEAD:${options.repositoryPath}`],
      options.workspacePath,
    );
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspaceRepositoryPath(workspacePath: string, repositoryPath: string): string {
  if (
    path.isAbsolute(repositoryPath) ||
    repositoryPath === "." ||
    repositoryPath === ".git" ||
    repositoryPath.startsWith(".git/")
  ) {
    throw new Error(`Hidden evaluation patch touched unsafe repository path: ${repositoryPath}`);
  }
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedPath = path.resolve(resolvedWorkspacePath, repositoryPath);
  if (!isPathInside(resolvedPath, resolvedWorkspacePath)) {
    throw new Error(`Hidden evaluation patch touched unsafe repository path: ${repositoryPath}`);
  }
  return resolvedPath;
}

function parsePatchTouchedRepositoryPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch) {
      addPatchPath(paths, diffMatch[1]);
      addPatchPath(paths, diffMatch[2]);
      continue;
    }

    const fileMatch = /^(?:---|\+\+\+) [ab]\/(.+)$/.exec(line);
    if (fileMatch) {
      addPatchPath(paths, fileMatch[1]);
    }
  }
  return [...paths].sort();
}

function addPatchPath(paths: Set<string>, repositoryPath: string | undefined): void {
  if (!repositoryPath || repositoryPath === "/dev/null") {
    return;
  }
  paths.add(repositoryPath.replaceAll("\\", "/"));
}

async function findDirectoryCollision(
  sourcePath: string,
  targetPath: string,
): Promise<string | undefined> {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(sourcePath, { withFileTypes: true });
  for (const entry of entries) {
    const sourceEntryPath = path.join(sourcePath, entry.name);
    const targetEntryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await findDirectoryCollision(sourceEntryPath, targetEntryPath);
      if (nested) {
        return path.join(entry.name, nested);
      }
    } else if (entry.isFile() && (await pathExists(targetEntryPath))) {
      return entry.name;
    }
  }
  return undefined;
}

function hiddenPayloadFailure(message: string, repositoryPath: string): EvaluationCheck {
  return {
    code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
    severity: CheckSeverity.Error,
    message,
    paths: [repositoryPath],
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
