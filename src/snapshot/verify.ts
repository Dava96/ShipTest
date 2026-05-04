import path from "node:path";

import {
  HiddenEvaluationDirectoryWriteMode,
  HiddenEvaluationFileWriteMode,
} from "../config/schema-values.js";
import { pathExists } from "../utils/filesystem.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import { findRealGitMetadata } from "./sanitizer.js";
import type { BuildSnapshotOptions, SnapshotCheck } from "./types.js";

export async function verifyNoRealGitMetadata(agentSnapshotPath: string): Promise<SnapshotCheck> {
  const gitMetadata = await findRealGitMetadata(agentSnapshotPath);
  if (gitMetadata.length === 0) {
    return {
      code: SnapshotCheckCode.RealGitMetadataAbsent,
      severity: SnapshotCheckSeverity.Pass,
      message: "No real Git metadata found in the agent snapshot.",
      paths: [],
    };
  }

  return {
    code: SnapshotCheckCode.InvalidGitMetadata,
    severity: SnapshotCheckSeverity.Error,
    message: "Real Git metadata remains in the agent snapshot.",
    paths: gitMetadata.map((metadataPath) => path.relative(agentSnapshotPath, metadataPath)),
  };
}

export async function verifyHiddenEvaluationPaths(
  agentSnapshotPath: string,
  evaluation: BuildSnapshotOptions["evaluation"],
): Promise<SnapshotCheck[]> {
  const checks: SnapshotCheck[] = [];

  for (const hiddenFile of evaluation.hidden_evaluation_files) {
    const exists = await pathExists(path.join(agentSnapshotPath, hiddenFile.repository_path));
    checks.push(createWriteModeCheck(hiddenFile.repository_path, hiddenFile.write_mode, exists));
  }

  for (const hiddenDirectory of evaluation.hidden_evaluation_directories) {
    const exists = await pathExists(path.join(agentSnapshotPath, hiddenDirectory.repository_path));
    checks.push(
      createDirectoryWriteModeCheck(
        hiddenDirectory.repository_path,
        hiddenDirectory.write_mode,
        exists,
      ),
    );
  }

  return checks;
}

function createWriteModeCheck(
  repositoryPath: string,
  writeMode: HiddenEvaluationFileWriteMode,
  exists: boolean,
): SnapshotCheck {
  if (writeMode === HiddenEvaluationFileWriteMode.CreateNew && exists) {
    return {
      code: SnapshotCheckCode.HiddenEvaluationPathAlreadyExists,
      severity: SnapshotCheckSeverity.Error,
      message: `Hidden evaluation file uses ${HiddenEvaluationFileWriteMode.CreateNew} but repository_path already exists.`,
      paths: [repositoryPath],
    };
  }
  if (writeMode === HiddenEvaluationFileWriteMode.ReplaceExisting && !exists) {
    return {
      code: SnapshotCheckCode.HiddenEvaluationPathMissingForReplace,
      severity: SnapshotCheckSeverity.Error,
      message: `Hidden evaluation file uses ${HiddenEvaluationFileWriteMode.ReplaceExisting} but repository_path does not exist.`,
      paths: [repositoryPath],
    };
  }
  return {
    code: SnapshotCheckCode.HiddenEvaluationFileWriteModeValid,
    severity:
      writeMode === HiddenEvaluationFileWriteMode.CreateOrReplace
        ? SnapshotCheckSeverity.Warning
        : SnapshotCheckSeverity.Pass,
    message: `Hidden evaluation file write_mode '${writeMode}' is valid for repository_path.`,
    paths: [repositoryPath],
  };
}

function createDirectoryWriteModeCheck(
  repositoryPath: string,
  writeMode: HiddenEvaluationDirectoryWriteMode,
  exists: boolean,
): SnapshotCheck {
  if (writeMode === HiddenEvaluationDirectoryWriteMode.CreateNew && exists) {
    return {
      code: SnapshotCheckCode.HiddenEvaluationDirectoryAlreadyExists,
      severity: SnapshotCheckSeverity.Error,
      message: `Hidden evaluation directory uses ${HiddenEvaluationDirectoryWriteMode.CreateNew} but repository_path already exists.`,
      paths: [repositoryPath],
    };
  }
  if (writeMode === HiddenEvaluationDirectoryWriteMode.ReplaceExisting && !exists) {
    return {
      code: SnapshotCheckCode.HiddenEvaluationDirectoryMissingForReplace,
      severity: SnapshotCheckSeverity.Error,
      message: `Hidden evaluation directory uses ${HiddenEvaluationDirectoryWriteMode.ReplaceExisting} but repository_path does not exist.`,
      paths: [repositoryPath],
    };
  }
  return {
    code: SnapshotCheckCode.HiddenEvaluationDirectoryWriteModeValid,
    severity:
      writeMode === HiddenEvaluationDirectoryWriteMode.MergeAndReplace
        ? SnapshotCheckSeverity.Warning
        : SnapshotCheckSeverity.Pass,
    message: `Hidden evaluation directory write_mode '${writeMode}' is valid for repository_path.`,
    paths: [repositoryPath],
  };
}
