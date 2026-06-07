import type { AgentRunResult } from "../agent/types.js";
import type { FailureModeInsight, SelfVerificationSummary } from "../analysis/types.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { CleanRoomEvaluationResult } from "../evaluation/types.js";

export type RunStatus =
  | "running"
  | "completed"
  | "completed_with_issues"
  | "failed_to_start"
  | "crashed";
export type RunMode = "reproducible" | "draft";
export type SnapshotSource = "git_commit" | "working_tree";
export type AttemptStatus =
  | "completed"
  | "completed_with_issues"
  | "agent_failed"
  | "evaluation_failed";

export type AttemptQualitySignalId =
  | "agent_no_token_usage"
  | "agent_reported_errors"
  | "agent_reported_errors_without_usage"
  | "empty_submission_patch"
  | "excluded_path_modified"
  | "required_file_changes_missing";

export type AttemptQualitySignalSeverity = "warning" | "error";

export interface AttemptQualitySignal {
  readonly id: AttemptQualitySignalId;
  readonly severity: AttemptQualitySignalSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}

export interface RunPlanItem {
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly model: ResolvedShiptestConfig["models"][number];
}

export interface RunPlan {
  readonly default_model_ids: readonly string[];
  readonly items: readonly RunPlanItem[];
  readonly warnings: readonly string[];
}

export interface ShiptestRunOptions {
  readonly configPath?: string | undefined;
  readonly benchmarkIds?: readonly string[] | undefined;
  readonly modelIds?: readonly string[] | undefined;
  readonly runRootPath?: string | undefined;
  readonly piExecutable?: string | undefined;
  readonly piExecutableArgs?: readonly string[];
  readonly concurrency?: number;
  readonly modelAttempts?: number;
  readonly draft?: boolean;
  readonly onProgress?: (message: string) => void;
}

export type HumanReviewStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "needs_changes"
  | "acceptable"
  | "unacceptable";

export interface AttemptArtifactTextPreview {
  readonly text: string;
  readonly truncated: boolean;
  readonly size_bytes: number;
  readonly max_bytes: number;
}

export interface AttemptReport {
  readonly schema_version: 1;
  readonly run_id: string;
  readonly benchmark_id: string;
  readonly benchmark_type: ResolvedShiptestConfig["benchmarks"][number]["type"];
  readonly task: string;
  readonly attempt: number;
  readonly status: AttemptStatus;
  readonly model: {
    readonly id: string;
    readonly provider: string;
    readonly model: string;
  };
  readonly agent: Pick<AgentRunResult, "ok" | "status" | "signals" | "telemetry">;
  readonly tool_usage?: AgentRunResult["tool_usage"];
  readonly quality_signals?: readonly AttemptQualitySignal[];
  readonly self_verification?: SelfVerificationSummary;
  readonly failure_modes?: readonly FailureModeInsight[];
  readonly submission?: {
    readonly changed_files: readonly string[];
    readonly is_empty: boolean;
  };
  readonly evaluation?: CleanRoomEvaluationResult;
  readonly human_review: {
    readonly status: HumanReviewStatus;
    readonly reviewer?: string | null;
    readonly reviewed_at?: string | null;
    readonly verdict?: string | null;
    readonly reason?: string | null;
    readonly notes?: string | null;
  };
  readonly artifact_previews?: {
    readonly candidate_patch?: AttemptArtifactTextPreview;
    readonly task?: AttemptArtifactTextPreview;
  };
  readonly timings_ms?: {
    readonly total_ms: number;
    readonly agent_total_ms: number;
    readonly agent_workspace_prepare_ms: number;
    readonly agent_workspace_prepare_strategy: "copy" | "resettable_git";
    readonly agent_workspace_prepare_reused: boolean;
    readonly agent_workspace_prepare_fallback_used: boolean;
    readonly agent_process_ms: number;
    readonly agent_submission_extract_ms: number;
    readonly evaluation_total_ms: number;
    readonly evaluation_workspace_prepare_ms: number;
    readonly evaluation_workspace_prepare_strategy: "copy" | "resettable_git";
    readonly evaluation_workspace_prepare_reused: boolean;
    readonly evaluation_workspace_prepare_fallback_used: boolean;
    readonly evaluation_patch_apply_ms: number;
    readonly evaluation_hidden_payload_ms: number;
    readonly evaluation_scoring_ms: number;
    readonly evaluation_setup_rerun_ms: number;
  };
  readonly artifacts: Record<string, string>;
}

export interface RunResults {
  readonly schema_version: 1;
  readonly run_id: string;
  readonly created_at: string;
  readonly status: RunStatus;
  readonly project: {
    readonly name: string;
  };
  readonly run_mode: RunMode;
  readonly snapshot_source: SnapshotSource;
  readonly summary: {
    readonly benchmarks: number;
    readonly agent_runs: number;
    readonly completed: number;
    readonly completed_with_issues: number;
    readonly agent_failed: number;
    readonly evaluation_failed: number;
    readonly passed: number;
    readonly needs_review: number;
    readonly failed: number;
    readonly total_tokens: number;
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_tokens: number;
    readonly cache_write_tokens: number;
    readonly uncached_tokens: number;
    readonly duration_ms?: number;
    readonly estimated_cost_usd?: number;
  };
  readonly benchmark_results: readonly {
    readonly benchmark_id: string;
    readonly attempts: readonly string[];
    readonly duration_ms?: number;
  }[];
  readonly artifacts: {
    readonly report_html: string;
    readonly events_jsonl: string;
  };
}
