import path from "node:path";

import { findRealGitMetadata, pathExists } from "./sanitizer.js";
import type { BuildSnapshotOptions, SnapshotCheck } from "./types.js";

export async function verifyNoRealGitMetadata(agentSnapshotPath: string): Promise<SnapshotCheck> {
  const gitMetadata = await findRealGitMetadata(agentSnapshotPath);
  if (gitMetadata.length === 0) {
    return {
      code: "SNAPSHOT_REAL_GIT_METADATA_ABSENT",
      severity: "pass",
      message: "No real Git metadata found in the agent snapshot.",
      paths: [],
    };
  }

  return {
    code: "INVALID_SNAPSHOT_GIT_METADATA",
    severity: "error",
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
  writeMode: string,
  exists: boolean,
): SnapshotCheck {
  if (writeMode === "create_new" && exists) {
    return {
      code: "HIDDEN_EVALUATION_PATH_ALREADY_EXISTS",
      severity: "error",
      message: "Hidden evaluation file uses create_new but repository_path already exists.",
      paths: [repositoryPath],
    };
  }
  if (writeMode === "replace_existing" && !exists) {
    return {
      code: "HIDDEN_EVALUATION_PATH_MISSING_FOR_REPLACE",
      severity: "error",
      message: "Hidden evaluation file uses replace_existing but repository_path does not exist.",
      paths: [repositoryPath],
    };
  }
  return {
    code: "HIDDEN_EVALUATION_FILE_WRITE_MODE_VALID",
    severity: writeMode === "create_or_replace" ? "warning" : "pass",
    message: `Hidden evaluation file write_mode '${writeMode}' is valid for repository_path.`,
    paths: [repositoryPath],
  };
}

function createDirectoryWriteModeCheck(
  repositoryPath: string,
  writeMode: string,
  exists: boolean,
): SnapshotCheck {
  if (writeMode === "create_new" && exists) {
    return {
      code: "HIDDEN_EVALUATION_DIRECTORY_ALREADY_EXISTS",
      severity: "error",
      message: "Hidden evaluation directory uses create_new but repository_path already exists.",
      paths: [repositoryPath],
    };
  }
  if (writeMode === "replace_existing" && !exists) {
    return {
      code: "HIDDEN_EVALUATION_DIRECTORY_MISSING_FOR_REPLACE",
      severity: "error",
      message:
        "Hidden evaluation directory uses replace_existing but repository_path does not exist.",
      paths: [repositoryPath],
    };
  }
  return {
    code: "HIDDEN_EVALUATION_DIRECTORY_WRITE_MODE_VALID",
    severity: writeMode === "merge_and_replace" ? "warning" : "pass",
    message: `Hidden evaluation directory write_mode '${writeMode}' is valid for repository_path.`,
    paths: [repositoryPath],
  };
}
