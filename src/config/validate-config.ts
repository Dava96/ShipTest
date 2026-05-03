import { access } from "node:fs/promises";
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

  await addFileExistsIssue(issues, "project.repo", repoDir, "PROJECT_REPO_NOT_FOUND");

  if (context.config.environment.dockerfile) {
    await addFileExistsIssue(
      issues,
      "environment.dockerfile",
      resolveRepoRelativePath(repoDir, context.config.environment.dockerfile),
      "REFERENCED_FILE_NOT_FOUND",
    );
  }

  if (context.config.environment.compose_file) {
    await addFileExistsIssue(
      issues,
      "environment.compose_file",
      resolveRepoRelativePath(repoDir, context.config.environment.compose_file),
      "REFERENCED_FILE_NOT_FOUND",
    );
  }

  for (const [benchmarkIndex, benchmark] of context.config.benchmarks.entries()) {
    const benchmarkPath = `benchmarks[${benchmarkIndex}]`;
    await addFileExistsIssue(
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
      await addFileExistsIssue(
        issues,
        `${benchmarkPath}.agent_context.instruction_files[${fileIndex}]`,
        resolveConfigRelativePath(context.configDir, instructionFile),
        "REFERENCED_FILE_NOT_FOUND",
      );
    }

    for (const [fileIndex, hiddenFile] of benchmark.evaluation.hidden_evaluation_files.entries()) {
      await addFileExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_evaluation_files[${fileIndex}].from`,
        resolveConfigRelativePath(context.configDir, hiddenFile.from),
        "REFERENCED_FILE_NOT_FOUND",
      );

      if (!isSafeWorkspacePath(hiddenFile.to)) {
        issues.push({
          code: "UNSAFE_WORKSPACE_PATH",
          path: `${benchmarkPath}.evaluation.hidden_evaluation_files[${fileIndex}].to`,
          message: `Hidden evaluation destination must be relative and stay inside the workspace: ${hiddenFile.to}`,
        });
      }
    }

    for (const [
      patchIndex,
      patchPath,
    ] of benchmark.evaluation.hidden_evaluation_patches.entries()) {
      await addFileExistsIssue(
        issues,
        `${benchmarkPath}.evaluation.hidden_evaluation_patches[${patchIndex}]`,
        resolveConfigRelativePath(context.configDir, patchPath),
        "REFERENCED_FILE_NOT_FOUND",
      );
    }
  }

  return issues;
}

async function addFileExistsIssue(
  issues: ValidationIssue[],
  configPath: string,
  filePath: string,
  code: ValidationIssue["code"],
): Promise<void> {
  if (!(await pathExists(filePath))) {
    issues.push({
      code,
      path: configPath,
      message: `File does not exist: ${path.normalize(filePath)}`,
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
