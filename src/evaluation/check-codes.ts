export const EvaluationCheckCode = {
  CandidatePatchApplied: "EVALUATION_CANDIDATE_PATCH_APPLIED",
  CandidatePatchApplyFailed: "EVALUATION_CANDIDATE_PATCH_APPLY_FAILED",
  CleanRoomWorkspaceCreated: "EVALUATION_CLEAN_ROOM_WORKSPACE_CREATED",
  CleanRoomWorkspaceCreateFailed: "EVALUATION_CLEAN_ROOM_WORKSPACE_CREATE_FAILED",
  DependencyManifestModified: "EVALUATION_DEPENDENCY_MANIFEST_MODIFIED",
  DependencyChangePolicyFailed: "EVALUATION_DEPENDENCY_CHANGE_POLICY_FAILED",
  HiddenEvaluationFileApplied: "EVALUATION_HIDDEN_FILE_APPLIED",
  HiddenEvaluationDirectoryApplied: "EVALUATION_HIDDEN_DIRECTORY_APPLIED",
  HiddenEvaluationPatchApplied: "EVALUATION_HIDDEN_PATCH_APPLIED",
  HiddenEvaluationApplyFailed: "EVALUATION_HIDDEN_APPLY_FAILED",
  ProtectedPathModified: "EVALUATION_PROTECTED_PATH_MODIFIED",
  ScoringCommandPassed: "EVALUATION_SCORING_COMMAND_PASSED",
  ScoringCommandFailed: "EVALUATION_SCORING_COMMAND_FAILED",
  SetupCommandFailed: "EVALUATION_SETUP_COMMAND_FAILED",
  SetupCommandPassed: "EVALUATION_SETUP_COMMAND_PASSED",
} as const;

export type EvaluationCheckCode = (typeof EvaluationCheckCode)[keyof typeof EvaluationCheckCode];
