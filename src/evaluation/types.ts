import type { CheckSeverity } from "../checks/severity.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { CommandResult } from "../results/types.js";
import type { Submission } from "../submission/types.js";
import type { EvaluationCheckCode } from "./check-codes.js";

export type CleanRoomEvaluationStatus =
  | "EVALUATED"
  | "PARTIAL"
  | "INFRASTRUCTURE_ERROR"
  | "INVALID_BENCHMARK";

export type CleanRoomEvaluationVerdict =
  | "passed"
  | "needs_review"
  | "failed"
  | "policy_issue"
  | "inconclusive"
  | "invalid_benchmark";

export type EvaluationSignalId =
  | "candidate_patch_applied"
  | "candidate_patch_apply_failed"
  | "dependency_change_policy_failed"
  | "dependency_manifest_modified"
  | "hidden_evaluation_apply_failed"
  | "protected_path_modified"
  | "scoring_command_failed"
  | "scoring_command_passed"
  | "setup_rerun_failed";

export type EvaluationSignalSeverity = "info" | "warning" | "error";

export interface EvaluationCheck {
  readonly code: EvaluationCheckCode;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}

export interface EvaluationSignal {
  readonly id: EvaluationSignalId;
  readonly severity: EvaluationSignalSeverity;
  readonly message: string;
  readonly weight: number;
  readonly paths?: readonly string[];
}

export interface CleanRoomEvaluationOptions {
  readonly preparedBaselinePath: string;
  readonly preparedBaselineCommit?: string;
  readonly evaluationWorkspacePath: string;
  readonly configDir: string;
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly repositoryEnvironment: ResolvedShiptestConfig["repository_environment"];
  readonly submission: Submission;
  readonly artifactsDir?: string;
  readonly commandOutputMaxBytes?: number;
  readonly overwrite?: boolean;
}

export interface CleanRoomEvaluationResult {
  readonly ok: boolean;
  readonly status: CleanRoomEvaluationStatus;
  readonly verdict: CleanRoomEvaluationVerdict;
  readonly score?: number;
  readonly evaluation_workspace_path: string;
  readonly checks: readonly EvaluationCheck[];
  readonly signals: readonly EvaluationSignal[];
  readonly commands: readonly CommandResult[];
  readonly timings_ms: {
    readonly total_ms: number;
    readonly workspace_prepare_ms: number;
    readonly workspace_prepare_strategy: "copy" | "resettable_git";
    readonly workspace_prepare_reused: boolean;
    readonly workspace_prepare_fallback_used: boolean;
    readonly patch_apply_ms: number;
    readonly hidden_payload_ms: number;
    readonly scoring_ms: number;
    readonly setup_rerun_ms: number;
  };
  readonly artifacts: Record<string, string>;
}
