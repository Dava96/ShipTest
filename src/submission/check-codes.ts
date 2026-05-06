export const SubmissionCheckCode = {
  SubmissionApplyFailed: "SUBMISSION_APPLY_FAILED",
  SubmissionApplied: "SUBMISSION_APPLIED",
  SubmissionDiffEmpty: "SUBMISSION_DIFF_EMPTY",
  SubmissionExtracted: "SUBMISSION_EXTRACTED",
  SubmissionExtractionFailed: "SUBMISSION_EXTRACTION_FAILED",
  WorkspaceDiffCreated: "SUBMISSION_WORKSPACE_DIFF_CREATED",
} as const;

export type SubmissionCheckCode = (typeof SubmissionCheckCode)[keyof typeof SubmissionCheckCode];
