import type { CheckSeverity as CheckSeverityValue } from "../checks/severity.js";
import { CheckSeverity } from "../checks/severity.js";

export const SnapshotCheckSeverity = CheckSeverity;
export type SnapshotCheckSeverity = CheckSeverityValue;

export const SnapshotCheckCode = {
  AgentContextExclusionsApplied: "SNAPSHOT_AGENT_CONTEXT_EXCLUSIONS_APPLIED",
  GitLfsDownloaded: "SNAPSHOT_GIT_LFS_DOWNLOADED",
  GitLfsDownloadFailed: "SNAPSHOT_GIT_LFS_DOWNLOAD_FAILED",
  GitLfsPointersAbsent: "SNAPSHOT_GIT_LFS_POINTERS_ABSENT",
  GitLfsUnavailable: "SNAPSHOT_GIT_LFS_UNAVAILABLE",
  HiddenEvaluationDirectoryAlreadyExists: "HIDDEN_EVALUATION_DIRECTORY_ALREADY_EXISTS",
  HiddenEvaluationDirectoryMissingForReplace: "HIDDEN_EVALUATION_DIRECTORY_MISSING_FOR_REPLACE",
  HiddenEvaluationDirectoryWriteModeValid: "HIDDEN_EVALUATION_DIRECTORY_WRITE_MODE_VALID",
  HiddenEvaluationFileWriteModeValid: "HIDDEN_EVALUATION_FILE_WRITE_MODE_VALID",
  HiddenEvaluationPathAlreadyExists: "HIDDEN_EVALUATION_PATH_ALREADY_EXISTS",
  HiddenEvaluationPathMissingForReplace: "HIDDEN_EVALUATION_PATH_MISSING_FOR_REPLACE",
  HiddenEvaluationShiptestPathVisible: "HIDDEN_EVALUATION_SHIPTEST_PATH_VISIBLE",
  HiddenShiptestAssetsAbsent: "SNAPSHOT_HIDDEN_SHIPTEST_ASSETS_ABSENT",
  InvalidGitMetadata: "INVALID_SNAPSHOT_GIT_METADATA",
  InvalidLfsPointers: "INVALID_SNAPSHOT_LFS_POINTERS",
  RealGitMetadataAbsent: "SNAPSHOT_REAL_GIT_METADATA_ABSENT",
  RealGitMetadataStripped: "SNAPSHOT_REAL_GIT_METADATA_STRIPPED",
  StrategyNotImplemented: "SNAPSHOT_STRATEGY_NOT_IMPLEMENTED",
  SubmoduleCheckoutFailed: "SNAPSHOT_SUBMODULE_CHECKOUT_FAILED",
  SubmodulesAbsent: "SNAPSHOT_SUBMODULES_ABSENT",
  SubmodulesCheckedOut: "SNAPSHOT_SUBMODULES_CHECKED_OUT",
  SubmodulesDetected: "SNAPSHOT_SUBMODULES_DETECTED",
  SubmodulesLeftUncheckedOut: "SNAPSHOT_SUBMODULES_LEFT_UNCHECKED_OUT",
  UnsafeOutputPath: "SNAPSHOT_UNSAFE_OUTPUT_PATH",
} as const;

export type SnapshotCheckCode = (typeof SnapshotCheckCode)[keyof typeof SnapshotCheckCode];
