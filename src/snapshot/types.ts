import type { ResolvedShiptestConfig } from "../config/schema.js";
import type {
  SnapshotCheckCode,
  SnapshotCheckSeverity as SnapshotCheckSeverityValue,
} from "./check-codes.js";

export type { SnapshotCheckSeverity } from "./check-codes.js";

export interface SnapshotCheck {
  readonly code: SnapshotCheckCode;
  readonly severity: SnapshotCheckSeverityValue;
  readonly message: string;
  readonly paths?: readonly string[];
}

export interface SnapshotManifestFile {
  readonly repository_path: string;
  readonly size_bytes: number;
  readonly sha256: string;
  readonly executable: boolean;
}

export interface SnapshotManifest {
  readonly schema_version: 1;
  readonly created_at: string;
  readonly source_commit: string;
  readonly source_tree: string;
  readonly files: readonly SnapshotManifestFile[];
  readonly manifest_sha256: string;
}

export interface BuildSnapshotOptions {
  readonly source_repo_path: string;
  readonly base_commit?: string;
  readonly output_root_path: string;
  readonly shiptest_config_dir: string;
  readonly snapshot: ResolvedShiptestConfig["snapshot"];
  readonly agent_context: ResolvedShiptestConfig["benchmarks"][number]["agent_context"];
  readonly evaluation: ResolvedShiptestConfig["benchmarks"][number]["evaluation"];
}

export type SnapshotBuildResult = SnapshotBuildSuccess | SnapshotBuildFailure;

export interface SnapshotBuildSuccess {
  readonly ok: true;
  readonly staging_checkout_path: string;
  readonly agent_snapshot_path: string;
  readonly manifest: SnapshotManifest;
  readonly checks: readonly SnapshotCheck[];
}

export interface SnapshotBuildFailure {
  readonly ok: false;
  readonly staging_checkout_path?: string;
  readonly agent_snapshot_path?: string;
  readonly checks: readonly SnapshotCheck[];
}
