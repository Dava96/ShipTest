import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { Submission } from "../submission/types.js";

export type AgentAttemptStatus =
  | "completed"
  | "process_failed"
  | "timeout"
  | "budget_exceeded"
  | "context_exhausted"
  | "extraction_failed";

export type AgentSignalId =
  | "agent_completed"
  | "agent_process_failed"
  | "context_exhausted"
  | "max_attempt_mins_exceeded"
  | "max_tool_calls_exceeded"
  | "max_total_tokens_exceeded"
  | "max_turns_exceeded"
  | "submission_extraction_failed"
  | "submission_extracted";

export type AgentSignalSeverity = "info" | "warning" | "error";

export interface AgentSignal {
  readonly id: AgentSignalId;
  readonly severity: AgentSignalSeverity;
  readonly message: string;
}

export interface AgentTelemetry {
  readonly session?: {
    readonly id?: string;
    readonly version?: number;
    readonly cwd?: string;
    readonly timestamp?: string;
  };
  readonly lifecycle: {
    readonly agent_started: boolean;
    readonly agent_ended: boolean;
    readonly process_exit_code: number | null;
  };
  readonly counts: {
    readonly events: number;
    readonly turns: number;
    readonly messages_started: number;
    readonly messages_completed: number;
    readonly tool_calls: number;
    readonly failed_tool_calls: number;
    readonly compactions: number;
    readonly auto_retries: number;
    readonly malformed_events: number;
  };
  readonly tools: Record<string, { readonly calls: number; readonly failures: number }>;
  readonly usage: {
    readonly input: number;
    readonly output: number;
    readonly cache_read: number;
    readonly cache_write: number;
    readonly total_tokens: number;
    readonly cost_total?: number;
  };
  readonly final_response?: string;
  readonly error_messages: readonly string[];
  readonly compactions: readonly {
    readonly reason?: string;
    readonly aborted?: boolean;
    readonly will_retry?: boolean;
    readonly error_message?: string;
  }[];
  readonly auto_retries: readonly {
    readonly attempt?: number;
    readonly max_attempts?: number;
    readonly delay_ms?: number;
    readonly error_message?: string;
    readonly success?: boolean;
  }[];
}

export interface AgentRunOptions {
  readonly preparedBaselinePath: string;
  readonly preparedBaselineCommit?: string;
  readonly agentWorkspacePath: string;
  readonly configDir: string;
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly model: ResolvedShiptestConfig["models"][number];
  readonly limits: ResolvedShiptestConfig["benchmarks"][number]["limits"];
  readonly artifactsDir: string;
  readonly overwrite?: boolean;
  readonly piExecutable?: string;
  readonly piExecutableArgs?: readonly string[];
}

export interface AgentRunResult {
  readonly ok: boolean;
  readonly status: AgentAttemptStatus;
  readonly signals: readonly AgentSignal[];
  readonly telemetry: AgentTelemetry;
  readonly submission?: Submission;
  readonly agent_workspace_path: string;
  readonly timings_ms: {
    readonly total_ms: number;
    readonly workspace_prepare_ms: number;
    readonly workspace_prepare_strategy: "copy" | "resettable_git";
    readonly workspace_prepare_reused: boolean;
    readonly workspace_prepare_fallback_used: boolean;
    readonly process_ms: number;
    readonly submission_extract_ms: number;
  };
  readonly artifacts: Record<string, string>;
}

export interface AgentHarness {
  readonly id: string;
  runAttempt(options: AgentRunOptions): Promise<AgentRunResult>;
}
