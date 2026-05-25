import type { PreparedBaselineCheck } from "../baseline/check-codes.js";
import type {
  PreparedBaselineMetadata,
  PreparedBaselineTimings,
} from "../baseline/prepared-baseline.js";
import type { SnapshotCheck, SnapshotManifest, SnapshotSource } from "../snapshot/types.js";
import type { DoctorCheck } from "./check-codes.js";

export const DoctorDefaults = {
  CommandOutputMaxBytes: 1_000_000,
  DefaultCacheDirectoryName: "cache",
  DefaultOutputDirectoryName: "doctor",
} as const;

export type DoctorProgressPhase =
  | "started"
  | "snapshot"
  | "cache"
  | "setup"
  | "required_validation"
  | "advisory_validation"
  | "prepare_baseline"
  | "passed"
  | "failed";

export interface DoctorProgressEvent {
  readonly benchmark_id?: string;
  readonly phase: DoctorProgressPhase;
  readonly message: string;
}

export interface DoctorOptions {
  readonly outputRootPath: string;
  readonly cacheRootPath?: string;
  readonly benchmarkId?: string;
  readonly benchmarkIds?: readonly string[];
  readonly noCache?: boolean;
  readonly shiptestVersion?: string;
  readonly commandOutputMaxBytes?: number;
  readonly snapshotSource?: SnapshotSource;
  readonly concurrency?: number;
  readonly onProgress?: (event: DoctorProgressEvent) => void;
}

export interface DoctorCommandResult {
  readonly command: string;
  readonly phase: "setup" | "required_validation" | "advisory_validation";
  readonly exit_code: number | null;
  readonly duration_ms: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdout_truncated: boolean;
  readonly stderr_truncated: boolean;
}

export interface DoctorTimings {
  readonly total_ms: number;
  readonly snapshot_ms: number;
  readonly cache_restore_ms: number;
  readonly setup_ms: number;
  readonly required_validation_ms: number;
  readonly advisory_validation_ms: number;
  readonly prepare_baseline_ms: number;
}

export interface DoctorBaselineResult {
  readonly baseline_id: string;
  readonly benchmark_ids: readonly string[];
  readonly ok: boolean;
  readonly timings_ms: DoctorTimings;
  readonly snapshot_manifest?: SnapshotManifest;
  readonly prepared_baseline_path?: string;
  readonly prepared_baseline_metadata?: PreparedBaselineMetadata;
  readonly prepared_baseline_timings_ms?: PreparedBaselineTimings;
  readonly commands: readonly DoctorCommandResult[];
  readonly checks: readonly (DoctorCheck | SnapshotCheck | PreparedBaselineCheck)[];
}

export interface DoctorBenchmarkResult {
  readonly benchmark_id: string;
  readonly ok: boolean;
  readonly baseline_id: string;
  readonly baseline_result: string;
  readonly timings_ms: DoctorTimings;
  readonly snapshot_manifest?: SnapshotManifest;
  readonly prepared_baseline_path?: string;
  readonly prepared_baseline_metadata?: PreparedBaselineMetadata;
  readonly prepared_baseline_timings_ms?: PreparedBaselineTimings;
  readonly commands: readonly DoctorCommandResult[];
  readonly checks: readonly (DoctorCheck | SnapshotCheck | PreparedBaselineCheck)[];
}

export interface DoctorResult {
  readonly ok: boolean;
  readonly baseline_results: readonly DoctorBaselineResult[];
  readonly benchmark_results: readonly DoctorBenchmarkResult[];
}
