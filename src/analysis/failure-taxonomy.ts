import type { AgentAttemptStatus, AgentSignal } from "../agent/types.js";
import type { CleanRoomEvaluationResult } from "../evaluation/types.js";
import type { FailureModeInsight, SelfVerificationSummary } from "./types.js";

interface QualitySignalLike {
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly paths?: readonly string[];
}

export function createFailureModeInsights(options: {
  readonly agentStatus: AgentAttemptStatus;
  readonly agentSignals: readonly AgentSignal[];
  readonly qualitySignals: readonly QualitySignalLike[];
  readonly evaluation: CleanRoomEvaluationResult | undefined;
  readonly selfVerification: SelfVerificationSummary;
}): readonly FailureModeInsight[] {
  const insights: FailureModeInsight[] = [];
  const add = (insight: FailureModeInsight): void => {
    if (insights.some((item) => sameInsight(item, insight))) {
      return;
    }
    insights.push(insight);
  };

  for (const signal of options.qualitySignals) {
    const mapped = qualitySignalFailureMode(signal);
    if (mapped) add(mapped);
  }

  const agentStatusMode = agentStatusFailureMode(options.agentStatus);
  if (agentStatusMode) add(agentStatusMode);

  for (const signal of options.agentSignals) {
    const mapped = agentSignalFailureMode(signal);
    if (mapped) add(mapped);
  }

  if (options.evaluation) {
    const evaluationStatusMode = evaluationStatusFailureMode(options.evaluation);
    if (evaluationStatusMode) add(evaluationStatusMode);
    for (const signal of options.evaluation.signals) {
      const mapped = evaluationSignalFailureMode(signal, options.evaluation);
      if (mapped) add(mapped);
    }
  }

  if (options.selfVerification.final_response_claim.support === "unsupported") {
    add({
      id: "verification_claim_without_evidence",
      category: "workflow",
      severity: "warning",
      label: "Claimed verification without observed evidence",
      message:
        "The final response claimed verification, but ShipTest did not observe matching agent-side tool evidence.",
      evidence: ["self_verification.final_response_claim"],
    });
  }
  if (options.selfVerification.final_response_claim.support === "contradicted") {
    add({
      id: "verification_claim_contradicted",
      category: "workflow",
      severity: "warning",
      label: "Verification claim contradicted by tool evidence",
      message:
        "The final response claimed verification, but at least one matching agent-side command failed.",
      evidence: ["self_verification.final_response_claim", "self_verification.checks"],
    });
  }

  return insights;
}

function qualitySignalFailureMode(signal: QualitySignalLike): FailureModeInsight | undefined {
  const base = {
    severity: signal.severity,
    evidence: [`quality_signals.${signal.id}`],
    ...(signal.paths ? { paths: signal.paths } : {}),
  } as const;
  if (signal.id === "required_file_changes_missing") {
    return {
      ...base,
      id: "no_repository_changes",
      category: "submission",
      label: "No repository changes",
      message:
        "This code benchmark required repository changes, but the submission changed no files.",
    };
  }
  if (signal.id === "empty_submission_patch") {
    return {
      ...base,
      id: "empty_patch",
      category: "submission",
      label: "Empty candidate patch",
      message: "The extracted candidate patch was empty.",
    };
  }
  if (signal.id === "excluded_path_modified") {
    return {
      ...base,
      id: "excluded_path_modified",
      category: "policy",
      label: "Excluded path modified",
      message: "The submission modified path(s) excluded from the agent workspace.",
    };
  }
  if (signal.id === "agent_no_token_usage") {
    return {
      ...base,
      id: "agent_no_token_usage",
      category: "agent",
      label: "No token usage observed",
      message:
        "The attempt reported zero token usage, so ShipTest cannot verify that model inference occurred.",
    };
  }
  if (signal.id === "agent_reported_errors_without_usage") {
    return {
      ...base,
      id: "agent_error_without_inference",
      category: "agent",
      label: "Agent error without inference evidence",
      message: "The agent reported errors without token usage evidence.",
    };
  }
  if (signal.id === "agent_reported_errors") {
    return {
      ...base,
      id: "agent_reported_recovered_errors",
      category: "agent",
      label: "Recovered agent errors",
      message: "The agent reported errors but also produced token usage and a submission.",
    };
  }
  return undefined;
}

function agentStatusFailureMode(status: AgentAttemptStatus): FailureModeInsight | undefined {
  if (status === "timeout") {
    return {
      id: "agent_timeout",
      category: "agent",
      severity: "error",
      label: "Agent timed out",
      message: "The agent exceeded its wall-clock attempt limit.",
      evidence: ["agent.status"],
    };
  }
  if (status === "budget_exceeded") {
    return {
      id: "budget_exceeded",
      category: "agent",
      severity: "error",
      label: "Agent budget exceeded",
      message: "The agent exceeded a configured turn, tool, token, or cost budget.",
      evidence: ["agent.status"],
    };
  }
  if (status === "context_exhausted") {
    return {
      id: "context_exhausted",
      category: "agent",
      severity: "error",
      label: "Context exhausted",
      message: "The agent or provider reported context-window exhaustion.",
      evidence: ["agent.status"],
    };
  }
  if (status === "process_failed") {
    return {
      id: "agent_process_failed",
      category: "agent",
      severity: "error",
      label: "Agent process failed",
      message: "The agent process failed before completing a valid attempt.",
      evidence: ["agent.status"],
    };
  }
  if (status === "extraction_failed") {
    return {
      id: "submission_extraction_failed",
      category: "submission",
      severity: "error",
      label: "Submission extraction failed",
      message: "ShipTest could not extract a candidate patch from the agent workspace.",
      evidence: ["agent.status"],
    };
  }
  return undefined;
}

function agentSignalFailureMode(signal: AgentSignal): FailureModeInsight | undefined {
  if (signal.id === "context_exhausted") {
    return {
      id: "context_exhausted",
      category: "agent",
      severity: "error",
      label: "Context exhausted",
      message: signal.message,
      evidence: ["agent.signals.context_exhausted"],
    };
  }
  if (signal.id === "max_attempt_mins_exceeded") {
    return {
      id: "agent_timeout",
      category: "agent",
      severity: "error",
      label: "Agent timed out",
      message: signal.message,
      evidence: ["agent.signals.max_attempt_mins_exceeded"],
    };
  }
  if (signal.id.startsWith("max_") && signal.id.endsWith("_exceeded")) {
    return {
      id: "budget_exceeded",
      category: "agent",
      severity: "error",
      label: "Agent budget exceeded",
      message: signal.message,
      evidence: [`agent.signals.${signal.id}`],
    };
  }
  if (signal.id === "agent_process_failed") {
    return {
      id: "agent_process_failed",
      category: "agent",
      severity: "error",
      label: "Agent process failed",
      message: signal.message,
      evidence: ["agent.signals.agent_process_failed"],
    };
  }
  return undefined;
}

function evaluationStatusFailureMode(
  evaluation: CleanRoomEvaluationResult,
): FailureModeInsight | undefined {
  if (evaluation.status === "INVALID_BENCHMARK") {
    return {
      id: "invalid_benchmark",
      category: "benchmark",
      severity: "error",
      label: "Invalid benchmark",
      message: "The hidden evaluation payload or benchmark evaluator failed before scoring.",
      evidence: ["evaluation.status"],
    };
  }
  if (evaluation.status === "INFRASTRUCTURE_ERROR") {
    return {
      id: "environment_failure",
      category: "benchmark",
      severity: "error",
      label: "Evaluation environment failure",
      message: "ShipTest could not create or run the clean-room evaluation environment.",
      evidence: ["evaluation.status"],
    };
  }
  if (evaluation.status === "PARTIAL") {
    return {
      id: "partial_evaluation",
      category: "evaluation",
      severity: "warning",
      label: "Partial evaluation",
      message: "Evaluation started but could not complete all scoring steps.",
      evidence: ["evaluation.status"],
    };
  }
  return undefined;
}

function evaluationSignalFailureMode(
  signal: CleanRoomEvaluationResult["signals"][number],
  evaluation: CleanRoomEvaluationResult,
): FailureModeInsight | undefined {
  const base = {
    evidence: [`evaluation.signals.${signal.id}`],
    ...(signal.paths ? { paths: signal.paths } : {}),
  } as const;
  if (signal.id === "candidate_patch_apply_failed") {
    return {
      ...base,
      id: "candidate_patch_apply_failed",
      category: "submission",
      severity: "error",
      label: "Candidate patch did not apply",
      message: "The candidate patch could not be applied to a fresh prepared baseline.",
    };
  }
  if (signal.id === "protected_path_modified") {
    return {
      ...base,
      id: "protected_path_modified",
      category: "policy",
      severity: "error",
      label: "Protected path modified",
      message: "The candidate modified protected path(s).",
    };
  }
  if (signal.id === "dependency_manifest_modified") {
    return {
      ...base,
      id: "dependency_manifest_changed",
      category: "policy",
      severity: "warning",
      label: "Dependency manifest changed",
      message: "The candidate modified dependency manifest or lockfile path(s).",
    };
  }
  if (signal.id === "dependency_change_policy_failed") {
    return {
      ...base,
      id: "dependency_change_policy_failed",
      category: "policy",
      severity: "error",
      label: "Dependency change policy failed",
      message: "Dependency changes are disallowed by evaluation policy.",
    };
  }
  if (signal.id === "hidden_evaluation_apply_failed") {
    return {
      ...base,
      id: "hidden_payload_apply_failed",
      category: "benchmark",
      severity: "error",
      label: "Hidden evaluator failed to apply",
      message: "Hidden evaluation assets could not be applied to the clean-room workspace.",
    };
  }
  if (signal.id === "setup_rerun_failed") {
    return {
      ...base,
      id: "environment_failure",
      category: "benchmark",
      severity: "error",
      label: "Setup rerun failed",
      message: "Setup rerun failed after candidate dependency changes.",
    };
  }
  if (signal.id === "scoring_command_failed") {
    return {
      ...base,
      id: "verifier_failed",
      category: "evaluation",
      severity: evaluation.verdict === "failed" ? "error" : "warning",
      label: "Verifier command failed",
      message:
        "The scoring command failed. Treat this as evaluator evidence for review, not a final proof of code quality.",
    };
  }
  return undefined;
}

function sameInsight(left: FailureModeInsight, right: FailureModeInsight): boolean {
  return left.id === right.id && (left.paths ?? []).join("\0") === (right.paths ?? []).join("\0");
}
