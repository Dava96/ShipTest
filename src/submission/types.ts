import type { CheckSeverity } from "../checks/severity.js";
import type { SnapshotManifest, SnapshotManifestFile } from "../snapshot/types.js";
import type { SubmissionCheckCode } from "./check-codes.js";

export interface SubmissionCheck {
  readonly code: SubmissionCheckCode;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}

export interface WorkspaceManifestFileChange {
  readonly before: SnapshotManifestFile;
  readonly after: SnapshotManifestFile;
}

export interface WorkspaceManifestDiff {
  readonly added: readonly SnapshotManifestFile[];
  readonly modified: readonly WorkspaceManifestFileChange[];
  readonly deleted: readonly SnapshotManifestFile[];
  readonly unchanged_count: number;
}

export interface Submission {
  readonly diff: string;
  readonly changed_files: readonly string[];
  readonly is_empty: boolean;
  readonly baseline_manifest: SnapshotManifest;
  readonly workspace_manifest: SnapshotManifest;
  readonly workspace_diff: WorkspaceManifestDiff;
}

export type SubmissionExtractionResult = SubmissionExtractionSuccess | SubmissionExtractionFailure;

export interface SubmissionExtractionSuccess {
  readonly ok: true;
  readonly submission: Submission;
  readonly checks: readonly SubmissionCheck[];
}

export interface SubmissionExtractionFailure {
  readonly ok: false;
  readonly workspace_manifest?: SnapshotManifest;
  readonly workspace_diff?: WorkspaceManifestDiff;
  readonly checks: readonly SubmissionCheck[];
}

export type SubmissionApplyResult = SubmissionApplySuccess | SubmissionApplyFailure;

export interface SubmissionApplySuccess {
  readonly ok: true;
  readonly checks: readonly SubmissionCheck[];
}

export interface SubmissionApplyFailure {
  readonly ok: false;
  readonly checks: readonly SubmissionCheck[];
}
