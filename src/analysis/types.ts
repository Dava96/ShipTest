import type { ToolCallStatus } from "../agent/tool-usage.js";
import type { VerificationCheckKind } from "../config/schema-values.js";

export type SelfVerificationEvidenceSource = "configured_matcher" | "built_in_pattern";

export type SelfVerificationBaselineStatus = "passed" | "failed" | "not_run" | "not_configured";

export type SelfVerificationEvidenceTier =
  | "baseline_validated_exact"
  | "baseline_validated_family"
  | "baseline_failed"
  | "observed_unvalidated"
  | "not_observed";

export type VerificationClaimSupport =
  | "no_claim"
  | "supported"
  | "unsupported"
  | "contradicted"
  | "unknown_no_tool_logs";

export interface SelfVerificationEvidence {
  readonly kind: VerificationCheckKind;
  readonly source: SelfVerificationEvidenceSource;
  readonly check_id: string;
  readonly check_label: string;
  readonly tool_call_id: string;
  readonly tool: string;
  readonly command?: string;
  readonly status: ToolCallStatus;
}

export interface SelfVerificationCheckSummary {
  readonly id: string;
  readonly kind: VerificationCheckKind;
  readonly label: string;
  readonly observed: boolean;
  readonly observed_status: ToolCallStatus | "mixed" | "not_observed";
  readonly baseline_status: SelfVerificationBaselineStatus;
  readonly evidence_tier: SelfVerificationEvidenceTier;
  readonly evidence: readonly SelfVerificationEvidence[];
}

export interface VerificationClaimSummary {
  readonly claims_verification: boolean;
  readonly claimed_kinds: readonly VerificationCheckKind[];
  readonly support: VerificationClaimSupport;
  readonly unsupported_claims: readonly VerificationCheckKind[];
}

export interface SelfVerificationSummary {
  readonly evidence_available: boolean;
  readonly ran_tests: boolean;
  readonly ran_typecheck: boolean;
  readonly ran_build: boolean;
  readonly ran_lint: boolean;
  readonly ran_repro: boolean;
  readonly modified_tests: boolean;
  readonly test_change_paths: readonly string[];
  readonly checks: readonly SelfVerificationCheckSummary[];
  readonly final_response_claim: VerificationClaimSummary;
}

export type FailureModeSeverity = "info" | "warning" | "error";
export type FailureModeCategory =
  | "agent"
  | "benchmark"
  | "evaluation"
  | "policy"
  | "submission"
  | "workflow";

export interface FailureModeInsight {
  readonly id: string;
  readonly category: FailureModeCategory;
  readonly severity: FailureModeSeverity;
  readonly label: string;
  readonly message: string;
  readonly evidence: readonly string[];
  readonly paths?: readonly string[];
}
