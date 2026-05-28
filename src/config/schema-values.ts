export const SchemaLimits = {
  ConfigSchemaVersion: 1,
  MaxAttemptMinsDefault: 30,
  MaxAttemptMinsMax: 24 * 60,
  MaxToolCallsDefault: 200,
  MaxToolCallsMax: 100_000,
  MaxTotalTokensDefault: 350_000,
  MaxTotalTokensMax: 100_000_000,
  MaxTurnsDefault: 40,
  MaxTurnsMax: 10_000,
} as const;

export const BenchmarkType = {
  Implementation: "implementation",
  ReplayChange: "replay_change",
} as const;
export type BenchmarkType = (typeof BenchmarkType)[keyof typeof BenchmarkType];

export const CommandsRunIn = {
  RepositoryEnvironment: "repository_environment",
  ShiptestEnvironment: "shiptest_environment",
} as const;
export type CommandsRunIn = (typeof CommandsRunIn)[keyof typeof CommandsRunIn];

export const DependencyChangePolicy = {
  Allow: "allow",
  Fail: "fail",
  Warn: "warn",
} as const;
export type DependencyChangePolicy =
  (typeof DependencyChangePolicy)[keyof typeof DependencyChangePolicy];

export const GitLfsHandling = {
  AllowPointerFiles: "allow_pointer_files",
  DownloadLfsFiles: "download_lfs_files",
  FailOnPointers: "fail_on_pointers",
} as const;
export type GitLfsHandling = (typeof GitLfsHandling)[keyof typeof GitLfsHandling];

export const HiddenEvaluationDirectoryWriteMode = {
  CreateNew: "create_new",
  MergeAndReplace: "merge_and_replace",
  MergeWithoutOverwrite: "merge_without_overwrite",
  ReplaceExisting: "replace_existing",
} as const;
export type HiddenEvaluationDirectoryWriteMode =
  (typeof HiddenEvaluationDirectoryWriteMode)[keyof typeof HiddenEvaluationDirectoryWriteMode];

export const HiddenEvaluationFileWriteMode = {
  CreateNew: "create_new",
  CreateOrReplace: "create_or_replace",
  ReplaceExisting: "replace_existing",
} as const;
export type HiddenEvaluationFileWriteMode =
  (typeof HiddenEvaluationFileWriteMode)[keyof typeof HiddenEvaluationFileWriteMode];

export const HiddenEvaluationPatchPolicy = {
  AdvancedAllowCollisionRisk: "advanced_allow_collision_risk",
} as const;
export type HiddenEvaluationPatchPolicy =
  (typeof HiddenEvaluationPatchPolicy)[keyof typeof HiddenEvaluationPatchPolicy];

export const EvaluationPolicyPreset = {
  ReviewFirst: "review_first",
  RiskAverse: "risk_averse",
  TestGate: "test_gate",
} as const;
export type EvaluationPolicyPreset =
  (typeof EvaluationPolicyPreset)[keyof typeof EvaluationPolicyPreset];

export const ModelProvider = {
  Anthropic: "anthropic",
  OpenAi: "openai",
  OpenAiCompatible: "openai_compatible",
} as const;
export type ModelProvider = (typeof ModelProvider)[keyof typeof ModelProvider];

export const RepositoryEnvironmentSource = {
  Compose: "compose",
  Devcontainer: "devcontainer",
  DockerImage: "docker_image",
  DockerfileTarget: "dockerfile_target",
  Local: "local",
  Scripts: "scripts",
} as const;
export type RepositoryEnvironmentSource =
  (typeof RepositoryEnvironmentSource)[keyof typeof RepositoryEnvironmentSource];

export const SnapshotStrategy = {
  GitArchive: "git_archive",
  SanitizedCopy: "sanitized_copy",
} as const;
export type SnapshotStrategy = (typeof SnapshotStrategy)[keyof typeof SnapshotStrategy];

export const SubmoduleHandling = {
  CheckoutRecursive: "checkout_recursive",
  FailIfDetected: "fail_if_detected",
  LeaveUncheckedOut: "leave_unchecked_out",
} as const;
export type SubmoduleHandling = (typeof SubmoduleHandling)[keyof typeof SubmoduleHandling];
