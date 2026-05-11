import type { AgentRunResult } from "../agent/types.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { CleanRoomEvaluationResult } from "../evaluation/types.js";

export type RunStatus = "completed" | "completed_with_issues" | "failed_to_start";
export type AttemptStatus =
  | "completed"
  | "completed_with_issues"
  | "agent_failed"
  | "evaluation_failed";

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
  readonly onProgress?: (message: string) => void;
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
  readonly submission?: {
    readonly changed_files: readonly string[];
    readonly is_empty: boolean;
  };
  readonly evaluation?: CleanRoomEvaluationResult;
  readonly human_review: {
    readonly status: "pending" | "acceptable" | "needs_changes" | "unacceptable";
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
    readonly estimated_cost_usd?: number;
  };
  readonly benchmark_results: readonly {
    readonly benchmark_id: string;
    readonly attempts: readonly string[];
  }[];
  readonly artifacts: {
    readonly report_html: string;
    readonly events_jsonl: string;
  };
}
