import { CheckSeverity } from "../checks/severity.js";
import { createSnapshotManifest } from "../snapshot/manifest.js";
import type { SnapshotManifest } from "../snapshot/types.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { SubmissionCheckCode } from "./check-codes.js";
import { createWorkspaceManifestDiff } from "./manifest-diff.js";
import type { SubmissionCheck, SubmissionExtractionResult } from "./types.js";

export interface ExtractSubmissionOptions {
  readonly workspacePath: string;
  readonly baselineManifest: SnapshotManifest;
  readonly gitOperations?: GitOperations;
}

export async function extractSubmission(
  options: ExtractSubmissionOptions,
): Promise<SubmissionExtractionResult> {
  const gitOperations = options.gitOperations ?? defaultGitOperations;
  const workspaceManifest = await createSnapshotManifest({
    snapshotPath: options.workspacePath,
    sourceCommit: options.baselineManifest.source_commit,
    sourceTree: options.baselineManifest.source_tree,
  });
  const workspaceDiff = createWorkspaceManifestDiff(options.baselineManifest, workspaceManifest);
  const workspaceDiffCheck: SubmissionCheck = {
    code: SubmissionCheckCode.WorkspaceDiffCreated,
    severity: CheckSeverity.Pass,
    message: "Created workspace diff evidence for the submission.",
  };

  try {
    await gitOperations.git(["add", "-A"], options.workspacePath);
    const diff = (
      await gitOperations.git(["diff", "--cached", "--binary", "HEAD"], options.workspacePath)
    ).stdout;
    const changedFilesOutput = (
      await gitOperations.git(
        ["diff", "--cached", "--name-only", "-z", "HEAD"],
        options.workspacePath,
      )
    ).stdout;
    const changedFiles = parseNullSeparatedPaths(changedFilesOutput);
    const isEmpty = diff.length === 0;

    return {
      ok: true,
      submission: {
        diff,
        changed_files: changedFiles,
        is_empty: isEmpty,
        baseline_manifest: options.baselineManifest,
        workspace_manifest: workspaceManifest,
        workspace_diff: workspaceDiff,
      },
      checks: [
        workspaceDiffCheck,
        {
          code: isEmpty
            ? SubmissionCheckCode.SubmissionDiffEmpty
            : SubmissionCheckCode.SubmissionExtracted,
          severity: CheckSeverity.Pass,
          message: isEmpty
            ? "Submission diff is empty."
            : `Extracted submission diff with ${changedFiles.length} changed file(s).`,
          paths: changedFiles,
        },
      ],
    };
  } catch (error) {
    return {
      ok: false,
      workspace_manifest: workspaceManifest,
      workspace_diff: workspaceDiff,
      checks: [
        workspaceDiffCheck,
        {
          code: SubmissionCheckCode.SubmissionExtractionFailed,
          severity: CheckSeverity.Error,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

function parseNullSeparatedPaths(output: string): string[] {
  return output.split("\0").filter(Boolean).sort();
}
