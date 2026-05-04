import { access, stat } from "node:fs/promises";
import path from "node:path";

import type { ValidationIssue } from "./errors.js";
import type { ShiptestConfigContext } from "./load-config.js";
import {
  isSafeWorkspacePath,
  resolveConfigRelativePath,
  resolveRepoRelativePath,
} from "./paths.js";

export async function validateResolvedConfig(
  context: ShiptestConfigContext,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const repoDir = resolveConfigRelativePath(context.configDir, context.config.project.repo);

  await addPathExistsIssue(issues, "project.repo", repoDir, "PROJECT_REPO_NOT_FOUND");

  if (context.config.repository_environment.dockerfile_path) {
    await addPathExistsIssue(
      issues,
      "repository_environment.dockerfile_path",
      resolveRepoRelativePath(repoDir, context.config.repository_environment.dockerfile_path),
      "REFERENCED_FILE_NOT_FOUND",
    );
  }

  if (context.config.repository_environment.compose_file) {
    await addPathExistsIssue(
      issues,
      "repository_environment.compose_file",
      resolveRepoRelativePath(repoDir, context.config.repository_environment.compose_file),
      "REFERENCED_FILE_NOT_FOUND",
    );
  }

  for (const [benchmarkIndex, benchmark] of context.config.benchmarks.entries()) {
    const benchmarkPath = `benchmarks[${benchmarkIndex}]`;
    await addPathExistsIssue(
      issues,
      `${benchmarkPath}.task`,
      resolveConfigRelativePath(context.configDir, benchmark.task),
      "REFERENCED_FILE_NOT_FOUND",
    );

    for (const [excludeIndex, excludePath] of benchmark.agent_context.exclude_paths.entries()) {
      if (!isSafeWorkspacePath(excludePath)) {
        issues.push({
          code: "UNSAFE_WORKSPACE_PATH",
          path: `${benchmarkPath}.agent_context.exclude_paths[${excludeIndex}]`,
          message: `Agent context exclude path must be relative and stay inside the workspace: ${excludePath}`,
        });
      }
    }

    for (const [
      fileIndex,
      instructionFile,
    ] of benchmark.agent_context.instruction_files.entries()) {
      await addPathExistsIssue(
        issues,
        `${benchmarkPath}.agent_context.instruction_files[${fileIndex}]`,
        resolveConfigRelativePath(context.configDir, instructionFile),
        "REFERENCED_FILE_NOT_FOUND",
      );
    }

    for (const [fileIndex, hiddenFile] of benchmark.evaluation.hidden_evaluation_files.entries()) {
      await addPathExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_evaluation_files[${fileIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, hiddenFile.shiptest_path),
        "REFERENCED_FILE_NOT_FOUND",
      );

      if (!isSafeWorkspacePath(hiddenFile.repository_path)) {
        issues.push({
          code: "UNSAFE_WORKSPACE_PATH",
          path: `${benchmarkPath}.evaluation.hidden_evaluation_files[${fileIndex}].repository_path`,
          message: `Hidden evaluation repository path must be relative and stay inside the workspace: ${hiddenFile.repository_path}`,
        });
      }
    }

    for (const [
      directoryIndex,
      hiddenDirectory,
    ] of benchmark.evaluation.hidden_evaluation_directories.entries()) {
      await addDirectoryExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_evaluation_directories[${directoryIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, hiddenDirectory.shiptest_path),
      );

      if (!isSafeWorkspacePath(hiddenDirectory.repository_path)) {
        issues.push({
          code: "UNSAFE_WORKSPACE_PATH",
          path: `${benchmarkPath}.evaluation.hidden_evaluation_directories[${directoryIndex}].repository_path`,
          message: `Hidden evaluation repository path must be relative and stay inside the workspace: ${hiddenDirectory.repository_path}`,
        });
      }
    }

    for (const [patchIndex, patch] of benchmark.evaluation.hidden_evaluation_patches.entries()) {
      await addPathExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_evaluation_patches[${patchIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, patch.shiptest_path),
        "REFERENCED_FILE_NOT_FOUND",
      );
    }
  }

  return issues;
}

async function addPathExistsIssue(
  issues: ValidationIssue[],
  configPath: string,
  filePath: string,
  code: ValidationIssue["code"],
): Promise<void> {
  if (!(await pathExists(filePath))) {
    issues.push({
      code,
      path: configPath,
      message: `Path does not exist: ${path.normalize(filePath)}`,
    });
  }
}

async function addDirectoryExistsIssue(
  issues: ValidationIssue[],
  configPath: string,
  directoryPath: string,
): Promise<void> {
  try {
    const directoryStat = await stat(directoryPath);
    if (!directoryStat.isDirectory()) {
      issues.push({
        code: "REFERENCED_DIRECTORY_NOT_FOUND",
        path: configPath,
        message: `Path is not a directory: ${path.normalize(directoryPath)}`,
      });
    }
  } catch {
    issues.push({
      code: "REFERENCED_DIRECTORY_NOT_FOUND",
      path: configPath,
      message: `Directory does not exist: ${path.normalize(directoryPath)}`,
    });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
