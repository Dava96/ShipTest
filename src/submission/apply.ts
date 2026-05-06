import { CheckSeverity } from "../checks/severity.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { SubmissionCheckCode } from "./check-codes.js";
import type { SubmissionApplyResult } from "./types.js";

export async function applySubmissionDiff(
  workspacePath: string,
  diff: string,
  gitOperations: GitOperations = defaultGitOperations,
): Promise<SubmissionApplyResult> {
  if (diff.length === 0) {
    return {
      ok: true,
      checks: [
        {
          code: SubmissionCheckCode.SubmissionDiffEmpty,
          severity: CheckSeverity.Pass,
          message: "Submission diff is empty; nothing was applied.",
        },
      ],
    };
  }

  try {
    await gitOperations.git(["apply", "--binary", "--whitespace=nowarn", "-"], workspacePath, diff);
    return {
      ok: true,
      checks: [
        {
          code: SubmissionCheckCode.SubmissionApplied,
          severity: CheckSeverity.Pass,
          message: "Applied submission diff to workspace.",
        },
      ],
    };
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          code: SubmissionCheckCode.SubmissionApplyFailed,
          severity: CheckSeverity.Error,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}
