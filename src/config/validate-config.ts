import path from "node:path";

import { isDirectory, isFile, pathExists } from "../utils/filesystem.js";
import type { ValidationIssue } from "./errors.js";
import { ConfigIssueCode } from "./issue-codes.js";
import type { ShiptestConfigContext } from "./load-config.js";
import { isSafeWorkspacePath, resolveConfigRelativePath } from "./paths.js";

export async function validateConfigReferences(
  context: ShiptestConfigContext,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const repoDir = resolveConfigRelativePath(context.configDir, context.config.project.repo);

  await addPathExistsIssue(issues, "project.repo", repoDir, ConfigIssueCode.ProjectRepoNotFound);

  for (const [benchmarkIndex, benchmark] of context.config.benchmarks.entries()) {
    const benchmarkPath = `benchmarks[${benchmarkIndex}]`;
    await addPathExistsIssue(
      issues,
      `${benchmarkPath}.task`,
      resolveConfigRelativePath(context.configDir, benchmark.task),
      ConfigIssueCode.ReferencedFileNotFound,
    );

    for (const [excludeIndex, excludePath] of benchmark.agent_context.exclude_paths.entries()) {
      if (!isSafeWorkspacePath(excludePath)) {
        issues.push({
          code: ConfigIssueCode.UnsafeWorkspacePath,
          path: `${benchmarkPath}.agent_view.exclude_paths[${excludeIndex}]`,
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
        `${benchmarkPath}.agent_view.instruction_files[${fileIndex}]`,
        resolveConfigRelativePath(context.configDir, instructionFile),
        ConfigIssueCode.ReferencedFileNotFound,
      );
    }

    for (const [fileIndex, hiddenFile] of benchmark.evaluation.hidden_evaluation_files.entries()) {
      await addFileExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_files[${fileIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, hiddenFile.shiptest_path),
      );

      if (!isSafeWorkspacePath(hiddenFile.repository_path)) {
        issues.push({
          code: ConfigIssueCode.UnsafeWorkspacePath,
          path: `${benchmarkPath}.evaluation.hidden_files[${fileIndex}].repository_path`,
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
        `${benchmarkPath}.evaluation.hidden_directories[${directoryIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, hiddenDirectory.shiptest_path),
      );

      if (!isSafeWorkspacePath(hiddenDirectory.repository_path)) {
        issues.push({
          code: ConfigIssueCode.UnsafeWorkspacePath,
          path: `${benchmarkPath}.evaluation.hidden_directories[${directoryIndex}].repository_path`,
          message: `Hidden evaluation repository path must be relative and stay inside the workspace: ${hiddenDirectory.repository_path}`,
        });
      }
    }

    for (const [patchIndex, patch] of benchmark.evaluation.hidden_evaluation_patches.entries()) {
      await addFileExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_patches[${patchIndex}].shiptest_path`,
        resolveConfigRelativePath(context.configDir, patch.shiptest_path),
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

async function addFileExistsIssue(
  issues: ValidationIssue[],
  configPath: string,
  filePath: string,
): Promise<void> {
  if (await isFile(filePath)) {
    return;
  }

  issues.push({
    code: ConfigIssueCode.ReferencedFileNotFound,
    path: configPath,
    message: (await pathExists(filePath))
      ? `Path is not a file: ${path.normalize(filePath)}`
      : `File does not exist: ${path.normalize(filePath)}`,
  });
}

async function addDirectoryExistsIssue(
  issues: ValidationIssue[],
  configPath: string,
  directoryPath: string,
): Promise<void> {
  if (await isDirectory(directoryPath)) {
    return;
  }

  issues.push({
    code: ConfigIssueCode.ReferencedDirectoryNotFound,
    path: configPath,
    message: (await pathExists(directoryPath))
      ? `Path is not a directory: ${path.normalize(directoryPath)}`
      : `Directory does not exist: ${path.normalize(directoryPath)}`,
  });
}
