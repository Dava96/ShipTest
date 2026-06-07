export {
  createEmptyAgentTelemetry,
  parsePiJsonLineIntoTelemetry,
  parsePiJsonLines,
  telemetryHasContextExhaustion,
} from "./agent/pi-events.js";
export { PiJsonHarness, runPiJsonAgentAttempt } from "./agent/pi-json-harness.js";
export type {
  AgentAttemptStatus,
  AgentHarness,
  AgentRunOptions,
  AgentRunResult,
  AgentSignal,
  AgentSignalId,
  AgentSignalSeverity,
  AgentTelemetry,
  AgentTokenUsage,
} from "./agent/types.js";
export type {
  FailureModeInsight,
  SelfVerificationSummary,
} from "./analysis/types.js";
export type { PreparedBaselineCheck } from "./baseline/check-codes.js";
export { PreparedBaselineCheckCode } from "./baseline/check-codes.js";
export type { CleanGitRepoOptions, CleanGitRepoResult } from "./baseline/clean-git-repo.js";
export { CleanGitRepoDefaults, initializeCleanGitRepo } from "./baseline/clean-git-repo.js";
export type {
  PrepareBaselineFromWorkspaceOptions,
  PreparedBaselineCacheKeyInput,
  PreparedBaselineFailure,
  PreparedBaselineMetadata,
  PreparedBaselineResult,
  PreparedBaselineSuccess,
  PreparedBaselineTimings,
  RestorePreparedBaselineFromCacheOptions,
  RestorePreparedBaselineFromCacheResult,
} from "./baseline/prepared-baseline.js";
export {
  createPreparedBaselineCacheKey,
  getPreparedBaselineCacheEntryPath,
  prepareBaselineFromWorkspace,
  restorePreparedBaselineFromCache,
} from "./baseline/prepared-baseline.js";
export type { CheckSeverity as CheckSeverityValue } from "./checks/severity.js";
export { CheckSeverity } from "./checks/severity.js";
export type { ShiptestConfigContext } from "./config/load-config.js";
export { loadShiptestConfig, loadShiptestConfigContext } from "./config/load-config.js";
export type { ResolvedShiptestConfig, ShiptestConfig } from "./config/schema.js";
export { ShiptestConfigSchema } from "./config/schema.js";
export type {
  BenchmarkType as BenchmarkTypeValue,
  CommandsRunIn as CommandsRunInValue,
  DependencyChangePolicy as DependencyChangePolicyValue,
  EvaluationPolicyPreset as EvaluationPolicyPresetValue,
  GitLfsHandling as GitLfsHandlingValue,
  HiddenEvaluationDirectoryWriteMode as HiddenEvaluationDirectoryWriteModeValue,
  HiddenEvaluationFileWriteMode as HiddenEvaluationFileWriteModeValue,
  HiddenEvaluationPatchPolicy as HiddenEvaluationPatchPolicyValue,
  ModelProvider as ModelProviderValue,
  RepositoryEnvironmentSource as RepositoryEnvironmentSourceValue,
  SnapshotStrategy as SnapshotStrategyValue,
  SubmoduleHandling as SubmoduleHandlingValue,
  VerificationCheckKind as VerificationCheckKindValue,
} from "./config/schema-values.js";
export {
  BenchmarkType,
  CommandsRunIn,
  DependencyChangePolicy,
  EvaluationPolicyPreset,
  GitLfsHandling,
  HiddenEvaluationDirectoryWriteMode,
  HiddenEvaluationFileWriteMode,
  HiddenEvaluationPatchPolicy,
  ModelProvider,
  RepositoryEnvironmentSource,
  SchemaLimits,
  SnapshotStrategy,
  SubmoduleHandling,
  VerificationCheckKind,
} from "./config/schema-values.js";
export type { DoctorCheck } from "./doctor/check-codes.js";
export { DoctorCheckCode } from "./doctor/check-codes.js";
export { runDoctor } from "./doctor/run-doctor.js";
export type {
  BenchmarkValidityBaseHiddenResult,
  BenchmarkValidityReferenceHiddenResult,
  BenchmarkValidityResult,
  BenchmarkValidityStatus,
  BenchmarkValidityTrialResult,
  DoctorBenchmarkResult,
  DoctorCommandResult,
  DoctorOptions,
  DoctorProgressEvent,
  DoctorProgressPhase,
  DoctorResult,
} from "./doctor/types.js";
export { EvaluationCheckCode } from "./evaluation/check-codes.js";
export { runCleanRoomEvaluation } from "./evaluation/clean-room-evaluator.js";
export { applyHiddenEvaluationPayload } from "./evaluation/hidden-payload.js";
export type {
  CleanRoomEvaluationOptions,
  CleanRoomEvaluationResult,
  CleanRoomEvaluationStatus,
  CleanRoomEvaluationVerdict,
  CommandResult,
  EvaluationCheck,
  EvaluationSignal,
  EvaluationSignalId,
  EvaluationSignalSeverity,
} from "./evaluation/types.js";
export type { RunShellCommandOptions, ShellCommandResult } from "./execution/run-command.js";
export { runShellCommand } from "./execution/run-command.js";
export { createRunPlan, formatRunPlan } from "./run/plan.js";
export { regenerateReport, runShiptest } from "./run/run.js";
export type {
  AttemptReport,
  RunPlan,
  RunPlanItem,
  RunResults,
  ShiptestRunOptions,
} from "./run/types.js";
export { buildSnapshot } from "./snapshot/build-snapshot.js";
export { SnapshotCheckCode, SnapshotCheckSeverity } from "./snapshot/check-codes.js";
export { createBuildSnapshotOptions } from "./snapshot/options.js";
export type {
  BuildSnapshotOptions,
  SnapshotBuildResult,
  SnapshotCheck,
  SnapshotManifest,
  SnapshotManifestFile,
} from "./snapshot/types.js";
export { applySubmissionDiff } from "./submission/apply.js";
export { SubmissionCheckCode } from "./submission/check-codes.js";
export { extractSubmission } from "./submission/extract.js";
export { createWorkspaceManifestDiff } from "./submission/manifest-diff.js";
export type {
  Submission,
  SubmissionApplyResult,
  SubmissionCheck,
  SubmissionExtractionResult,
  WorkspaceManifestDiff,
  WorkspaceManifestFileChange,
} from "./submission/types.js";
export { VerifierLintCheckCode } from "./verifier-lint/check-codes.js";
export { formatVerifierLintResult, lintVerifier } from "./verifier-lint/lint-verifier.js";
export type {
  VerifierLintBenchmarkResult,
  VerifierLintCheck,
  VerifierLintChecklistItem,
  VerifierLintCheckSeverity,
  VerifierLintResult,
  VerifierLintStatus,
} from "./verifier-lint/types.js";

export const SHIPTEST_PROJECT_NAME = "ShipTest" as const;
