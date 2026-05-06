import type { CheckSeverity } from "../checks/severity.js";

export const PreparedBaselineCheckCode = {
  CacheDisabled: "PREPARED_BASELINE_CACHE_DISABLED",
  CacheEntryInvalid: "PREPARED_BASELINE_CACHE_ENTRY_INVALID",
  CacheHit: "PREPARED_BASELINE_CACHE_HIT",
  CacheMiss: "PREPARED_BASELINE_CACHE_MISS",
  CacheRestoreFailed: "PREPARED_BASELINE_CACHE_RESTORE_FAILED",
  CacheRestored: "PREPARED_BASELINE_CACHE_RESTORED",
  CacheSaveFailed: "PREPARED_BASELINE_CACHE_SAVE_FAILED",
  CacheSaved: "PREPARED_BASELINE_CACHE_SAVED",
  CacheUpdated: "PREPARED_BASELINE_CACHE_UPDATED",
  CleanGitRepoInitFailed: "PREPARED_BASELINE_CLEAN_GIT_REPO_INIT_FAILED",
  CleanGitRepoInitialized: "PREPARED_BASELINE_CLEAN_GIT_REPO_INITIALIZED",
  CleanGitRepoVerificationFailed: "PREPARED_BASELINE_CLEAN_GIT_REPO_VERIFICATION_FAILED",
  CleanGitRepoVerified: "PREPARED_BASELINE_CLEAN_GIT_REPO_VERIFIED",
  Created: "PREPARED_BASELINE_CREATED",
  DestinationExists: "PREPARED_BASELINE_DESTINATION_EXISTS",
  InvalidPaths: "PREPARED_BASELINE_INVALID_PATHS",
  SourceMissing: "PREPARED_BASELINE_SOURCE_MISSING",
} as const;

export type PreparedBaselineCheckCode =
  (typeof PreparedBaselineCheckCode)[keyof typeof PreparedBaselineCheckCode];

export interface PreparedBaselineCheck {
  readonly code: PreparedBaselineCheckCode;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}
