import { describe, expect, it } from "vitest";

import { createSelfVerificationSummary } from "./self-verification.js";

const baseVerification = {
  checks: [
    {
      id: "tests",
      kind: "tests" as const,
      label: "Tests",
      match: { tool: "bash", command_contains: "npm run test:run" },
      baseline_command: "npm run test:run",
    },
    {
      id: "lint",
      kind: "lint" as const,
      label: "Lint",
      match: { tool: "bash", command_contains: "npm run lint" },
      baseline_command: "npm run lint",
    },
  ],
};

describe("self-verification analysis", () => {
  it("uses configured matchers and baseline commands to classify evidence tiers", () => {
    const summary = createSelfVerificationSummary({
      verification: baseVerification,
      toolCalls: [
        {
          id: "tool-1",
          tool: "bash",
          command: "npm run test:run -- src/run/run.test.ts",
          status: "passed",
        },
        { id: "tool-2", tool: "bash", command: "npm run lint", status: "passed" },
      ],
      finalResponse: "I ran the tests and lint; both passed.",
      changedFiles: ["src/run/run.ts", "src/run/run.test.ts"],
      baselineCommands: [doctorCommand("npm run test:run", 0), doctorCommand("npm run lint", 1)],
    });

    expect(summary.ran_tests).toBe(true);
    expect(summary.ran_lint).toBe(true);
    expect(summary.modified_tests).toBe(true);
    expect(summary.test_change_paths).toEqual(["src/run/run.test.ts"]);
    expect(summary.checks.find((check) => check.id === "tests")).toMatchObject({
      observed: true,
      observed_status: "passed",
      baseline_status: "passed",
      evidence_tier: "baseline_validated_family",
    });
    expect(summary.checks.find((check) => check.id === "lint")).toMatchObject({
      observed: true,
      baseline_status: "failed",
      evidence_tier: "baseline_failed",
    });
    expect(summary.final_response_claim).toMatchObject({
      claims_verification: true,
      support: "supported",
    });
  });

  it("flags unsupported final-response verification claims", () => {
    const summary = createSelfVerificationSummary({
      verification: baseVerification,
      toolCalls: [],
      finalResponse: "All tests pass.",
      changedFiles: ["src/run/run.ts"],
      baselineCommands: [doctorCommand("npm run test:run", 0)],
    });

    expect(summary.ran_tests).toBe(false);
    expect(summary.final_response_claim).toMatchObject({
      claims_verification: true,
      claimed_kinds: ["tests"],
      support: "unsupported",
      unsupported_claims: ["tests"],
    });
  });

  it("does not treat setup commands as baseline-validated verification", () => {
    const summary = createSelfVerificationSummary({
      verification: {
        checks: [
          {
            id: "lint",
            kind: "lint",
            label: "Lint",
            match: { tool: "bash", command_contains: "npm run check" },
            baseline_command: "npm run check",
          },
        ],
      },
      toolCalls: [{ id: "tool-1", tool: "bash", command: "npm run check", status: "passed" }],
      finalResponse: "",
      changedFiles: [],
      baselineCommands: [{ ...doctorCommand("npm run check", 0), phase: "setup" }],
    });

    expect(summary.checks.find((check) => check.id === "lint")).toMatchObject({
      baseline_status: "not_run",
      evidence_tier: "observed_unvalidated",
    });
  });

  it("uses built-in patterns as observed-only fallback when no dedicated check is configured", () => {
    const summary = createSelfVerificationSummary({
      verification: { checks: [] },
      toolCalls: [
        { id: "tool-1", tool: "bash", command: "pytest tests/test_api.py", status: "passed" },
      ],
      finalResponse: "Tests passed.",
      changedFiles: [],
      baselineCommands: [],
    });

    expect(summary.ran_tests).toBe(true);
    expect(summary.checks.find((check) => check.kind === "tests")).toMatchObject({
      id: "builtin-tests",
      observed: true,
      baseline_status: "not_run",
      evidence_tier: "observed_unvalidated",
    });
    expect(summary.final_response_claim.support).toBe("supported");
  });

  it("does not treat explicit non-verification statements as claims", () => {
    const summary = createSelfVerificationSummary({
      verification: baseVerification,
      toolCalls: [],
      finalResponse: "I did not run tests.",
      changedFiles: [],
      baselineCommands: [],
    });

    expect(summary.final_response_claim.support).toBe("no_claim");
  });
});

function doctorCommand(command: string, exitCode: number | null) {
  return {
    command,
    phase: "required_validation" as const,
    exit_code: exitCode,
    duration_ms: 1,
    stdout: "",
    stderr: "",
    stdout_truncated: false,
    stderr_truncated: false,
  };
}
