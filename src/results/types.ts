export type EvaluationStatus =
  | "EVALUATED"
  | "PARTIAL"
  | "INFRASTRUCTURE_ERROR"
  | "INVALID_BENCHMARK"
  | "PASS"
  | "FAIL_TESTS"
  | "FAIL_SETUP"
  | "FAIL_AGENT_TIMEOUT"
  | "FAIL_CONTEXT_EXHAUSTED"
  | "FAIL_PROTECTED_PATH"
  | "FAIL_HIDDEN_EVALUATION_APPLY"
  | "INVALID_BASELINE"
  | "INVALID_SNAPSHOT_GIT_METADATA"
  | "INVALID_SNAPSHOT_LFS_POINTERS";

export type EvaluationVerdict =
  | "passed"
  | "needs_review"
  | "failed"
  | "policy_issue"
  | "inconclusive"
  | "invalid_benchmark";

export type EvaluationSignalSeverity = "info" | "warning" | "error";

export interface EvaluationSignalResult {
  readonly id: string;
  readonly severity: EvaluationSignalSeverity;
  readonly message: string;
  readonly weight: number;
  readonly paths?: readonly string[];
}

export type HumanReviewStatus = "pending" | "acceptable" | "needs_changes" | "unacceptable";

export interface ShiptestRunResult {
  readonly schema_version: 1;
  readonly run_id: string;
  readonly benchmark_results: readonly BenchmarkResult[];
}

export interface BenchmarkResult {
  readonly benchmark_id: string;
  readonly benchmark_type: "replay_change" | "implementation";
  readonly attempts: readonly AttemptResult[];
}

export interface AttemptResult {
  readonly attempt: number;
  readonly model: ModelResult;
  readonly snapshot: SnapshotResult;
  readonly shiptest_runner: ShiptestRunnerResult;
  readonly evaluation: EvaluationResult;
  readonly human_review: HumanReviewResult;
  readonly artifacts: Record<string, string>;
}

export interface ModelResult {
  readonly id: string;
  readonly provider: string;
  readonly model: string;
  readonly endpoint_class?: string;
}

export interface SnapshotResult {
  readonly base_commit?: string;
  readonly strategy: string;
  readonly manifest_sha256?: string;
  readonly real_git_metadata_present: boolean;
  readonly lfs_hydrated?: boolean;
}

export interface ShiptestRunnerResult {
  readonly clean_git_repo: {
    readonly enabled: boolean;
  };
  readonly prepared_baseline: {
    readonly enabled: boolean;
    readonly cache: boolean;
    readonly cache_hit?: boolean;
  };
}

export interface EvaluationResult {
  readonly clean_room: boolean;
  readonly status: EvaluationStatus;
  readonly verdict?: EvaluationVerdict;
  readonly score?: number;
  readonly signals?: readonly EvaluationSignalResult[];
  readonly commands: readonly CommandResult[];
}

export interface CommandResult {
  readonly command: string;
  readonly exit_code: number | null;
  readonly duration_ms: number;
  readonly stdout_artifact?: string;
  readonly stderr_artifact?: string;
}

export interface HumanReviewResult {
  readonly status: HumanReviewStatus;
  readonly reviewer?: string;
  readonly notes?: string;
}
