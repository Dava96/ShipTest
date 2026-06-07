import { describe, expect, it } from "vitest";

import { createFailureModeInsights } from "./failure-taxonomy.js";
import type { SelfVerificationSummary } from "./types.js";

describe("failure taxonomy", () => {
  it("maps technical signals to reviewer-friendly failure modes", () => {
    const modes = createFailureModeInsights({
      agentStatus: "completed",
      agentSignals: [],
      qualitySignals: [
        {
          id: "empty_submission_patch",
          severity: "error",
          message: "empty",
        },
      ],
      evaluation: {
        ok: true,
        status: "EVALUATED",
        verdict: "needs_review",
        score: 60,
        evaluation_workspace_path: "workspace",
        checks: [],
        signals: [
          {
            id: "scoring_command_failed",
            severity: "warning",
            message: "failed",
            weight: 40,
          },
        ],
        commands: [],
        timings_ms: {
          total_ms: 1,
          workspace_prepare_ms: 0,
          workspace_prepare_strategy: "copy",
          workspace_prepare_reused: false,
          workspace_prepare_fallback_used: false,
          patch_apply_ms: 0,
          hidden_payload_ms: 0,
          scoring_ms: 1,
          setup_rerun_ms: 0,
        },
        artifacts: {},
      },
      selfVerification: selfVerification({ support: "unsupported" }),
    });

    expect(modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "empty_patch", label: "Empty candidate patch" }),
        expect.objectContaining({ id: "verifier_failed", label: "Verifier command failed" }),
        expect.objectContaining({ id: "verification_claim_without_evidence" }),
      ]),
    );
  });

  it("keeps test-file modification out of failure modes", () => {
    const modes = createFailureModeInsights({
      agentStatus: "completed",
      agentSignals: [],
      qualitySignals: [],
      evaluation: undefined,
      selfVerification: selfVerification({ modifiedTests: true }),
    });

    expect(modes).toEqual([]);
  });
});

function selfVerification(
  options: {
    readonly support?: SelfVerificationSummary["final_response_claim"]["support"];
    readonly modifiedTests?: boolean;
  } = {},
): SelfVerificationSummary {
  return {
    evidence_available: true,
    ran_tests: false,
    ran_typecheck: false,
    ran_build: false,
    ran_lint: false,
    ran_repro: false,
    modified_tests: options.modifiedTests ?? false,
    test_change_paths: options.modifiedTests ? ["src/example.test.ts"] : [],
    checks: [],
    final_response_claim: {
      claims_verification: options.support !== undefined,
      claimed_kinds: options.support ? ["tests"] : [],
      support: options.support ?? "no_claim",
      unsupported_claims: options.support === "unsupported" ? ["tests"] : [],
    },
  };
}
