export const VerifierLintCheckCode = {
  ExternalNetworkReference: "VERIFIER_LINT_EXTERNAL_NETWORK_REFERENCE",
  FlakinessPatternDetected: "VERIFIER_LINT_FLAKINESS_PATTERN_DETECTED",
  FlakinessRunsConfigured: "VERIFIER_LINT_FLAKINESS_RUNS_CONFIGURED",
  FlakinessRunsLow: "VERIFIER_LINT_FLAKINESS_RUNS_LOW",
  HiddenAssetEmpty: "VERIFIER_LINT_HIDDEN_ASSET_EMPTY",
  HiddenDirectoryEmpty: "VERIFIER_LINT_HIDDEN_DIRECTORY_EMPTY",
  HiddenOnlyScoringCommand: "VERIFIER_LINT_HIDDEN_ONLY_SCORING_COMMAND",
  HiddenVerifierConfigured: "VERIFIER_LINT_HIDDEN_VERIFIER_CONFIGURED",
  HiddenVerifierMissing: "VERIFIER_LINT_HIDDEN_VERIFIER_MISSING",
  LocalServiceReference: "VERIFIER_LINT_LOCAL_SERVICE_REFERENCE",
  PatchResetTouchesImplementationPaths: "VERIFIER_LINT_PATCH_RESET_TOUCHES_IMPLEMENTATION_PATHS",
  ScoringCommandDisconnected: "VERIFIER_LINT_SCORING_COMMAND_DISCONNECTED",
  WeakAssertionCoverage: "VERIFIER_LINT_WEAK_ASSERTION_COVERAGE",
  WeakNegativeCoverage: "VERIFIER_LINT_WEAK_NEGATIVE_COVERAGE",
} as const;

export type VerifierLintCheckCode =
  (typeof VerifierLintCheckCode)[keyof typeof VerifierLintCheckCode];
