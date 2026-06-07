import { minimatch } from "minimatch";

import type { ToolCallEvidence } from "../agent/tool-usage.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import { VerificationCheckKind } from "../config/schema-values.js";
import type { DoctorCommandResult } from "../doctor/types.js";
import type {
  SelfVerificationBaselineStatus,
  SelfVerificationCheckSummary,
  SelfVerificationEvidence,
  SelfVerificationEvidenceSource,
  SelfVerificationEvidenceTier,
  SelfVerificationSummary,
  VerificationClaimSummary,
} from "./types.js";

interface VerificationCheckDefinition {
  readonly id: string;
  readonly kind: VerificationCheckKind;
  readonly label: string;
  readonly source: SelfVerificationEvidenceSource;
  readonly match?: ResolvedShiptestConfig["verification"]["checks"][number]["match"];
  readonly baselineCommand?: string;
  readonly builtInMatcher?: (command: string) => boolean;
}

const TestPathPatterns = [
  "test/**",
  "tests/**",
  "__tests__/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.py",
  "**/*.snap",
] as const;

const BuiltInChecks: readonly VerificationCheckDefinition[] = [
  {
    id: "builtin-tests",
    kind: VerificationCheckKind.Tests,
    label: "Tests",
    source: "built_in_pattern",
    builtInMatcher: isTestCommand,
  },
  {
    id: "builtin-typecheck",
    kind: VerificationCheckKind.Typecheck,
    label: "Typecheck",
    source: "built_in_pattern",
    builtInMatcher: isTypecheckCommand,
  },
  {
    id: "builtin-build",
    kind: VerificationCheckKind.Build,
    label: "Build",
    source: "built_in_pattern",
    builtInMatcher: isBuildCommand,
  },
  {
    id: "builtin-lint",
    kind: VerificationCheckKind.Lint,
    label: "Lint/static checks",
    source: "built_in_pattern",
    builtInMatcher: isLintCommand,
  },
  {
    id: "builtin-repro",
    kind: VerificationCheckKind.Repro,
    label: "Repro/regression script",
    source: "built_in_pattern",
    builtInMatcher: isReproCommand,
  },
];

export function createSelfVerificationSummary(options: {
  readonly verification: ResolvedShiptestConfig["verification"];
  readonly toolCalls: readonly ToolCallEvidence[] | undefined;
  readonly finalResponse: string | undefined;
  readonly changedFiles: readonly string[];
  readonly baselineCommands: readonly DoctorCommandResult[];
}): SelfVerificationSummary {
  const toolCalls = options.toolCalls ?? [];
  const evidenceAvailable = options.toolCalls !== undefined;
  const checks = createCheckDefinitions(options.verification).map((check) =>
    summarizeCheck(check, toolCalls, options.baselineCommands),
  );
  const testChangePaths = findTestChangePaths(options.changedFiles);
  const finalResponseClaim = summarizeVerificationClaim({
    finalResponse: options.finalResponse,
    evidenceAvailable,
    checks,
  });

  return {
    evidence_available: evidenceAvailable,
    ran_tests: checks.some((check) => check.kind === VerificationCheckKind.Tests && check.observed),
    ran_typecheck: checks.some(
      (check) => check.kind === VerificationCheckKind.Typecheck && check.observed,
    ),
    ran_build: checks.some((check) => check.kind === VerificationCheckKind.Build && check.observed),
    ran_lint: checks.some((check) => check.kind === VerificationCheckKind.Lint && check.observed),
    ran_repro: checks.some((check) => check.kind === VerificationCheckKind.Repro && check.observed),
    modified_tests: testChangePaths.length > 0,
    test_change_paths: testChangePaths,
    checks,
    final_response_claim: finalResponseClaim,
  };
}

function createCheckDefinitions(
  verification: ResolvedShiptestConfig["verification"],
): readonly VerificationCheckDefinition[] {
  const configuredChecks = verification.checks.map((check): VerificationCheckDefinition => {
    const baselineCommand =
      check.baseline_command ?? check.match.command_equals ?? check.match.command_contains;
    return {
      id: check.id,
      kind: check.kind,
      label: check.label ?? defaultLabelForKind(check.kind),
      source: "configured_matcher",
      match: check.match,
      ...(baselineCommand ? { baselineCommand } : {}),
    };
  });
  const configuredKinds = new Set(configuredChecks.map((check) => check.kind));
  return [
    ...configuredChecks,
    ...BuiltInChecks.filter((check) => !configuredKinds.has(check.kind)),
  ];
}

function summarizeCheck(
  check: VerificationCheckDefinition,
  toolCalls: readonly ToolCallEvidence[],
  baselineCommands: readonly DoctorCommandResult[],
): SelfVerificationCheckSummary {
  const evidence = toolCalls
    .filter((toolCall) => matchesCheck(toolCall, check))
    .map(
      (toolCall): SelfVerificationEvidence => ({
        kind: check.kind,
        source: check.source,
        check_id: check.id,
        check_label: check.label,
        tool_call_id: toolCall.id,
        tool: toolCall.tool,
        ...(toolCall.command ? { command: toolCall.command } : {}),
        status: toolCall.status,
      }),
    );
  const baseline = baselineStatusForCheck(check, baselineCommands);
  return {
    id: check.id,
    kind: check.kind,
    label: check.label,
    observed: evidence.length > 0,
    observed_status: observedStatus(evidence),
    baseline_status: baseline.status,
    evidence_tier: evidenceTier({
      observed: evidence.length > 0,
      baselineStatus: baseline.status,
      exactObservedBaselineMatch: baseline.exactObservedBaselineMatch(evidence),
    }),
    evidence,
  };
}

function matchesCheck(toolCall: ToolCallEvidence, check: VerificationCheckDefinition): boolean {
  if (toolCall.tool !== "bash") {
    return false;
  }
  const command = toolCall.command ?? "";
  if (!command.trim()) {
    return false;
  }
  if (check.match) {
    return matchesConfiguredMatch(toolCall, check.match);
  }
  return check.builtInMatcher?.(command) ?? false;
}

function matchesConfiguredMatch(
  toolCall: ToolCallEvidence,
  match: ResolvedShiptestConfig["verification"]["checks"][number]["match"],
): boolean {
  if (match.tool && toolCall.tool !== match.tool) {
    return false;
  }
  const command = toolCall.command ?? "";
  if (match.command_equals && command.trim() !== match.command_equals.trim()) {
    return false;
  }
  if (match.command_contains && !command.includes(match.command_contains)) {
    return false;
  }
  return Boolean(match.tool || match.command_equals || match.command_contains);
}

function baselineStatusForCheck(
  check: VerificationCheckDefinition,
  baselineCommands: readonly DoctorCommandResult[],
): {
  readonly status: SelfVerificationBaselineStatus;
  readonly exactObservedBaselineMatch: (evidence: readonly SelfVerificationEvidence[]) => boolean;
} {
  const validationCommands = baselineCommands.filter(isBaselineVerificationPhase);
  if (check.baselineCommand) {
    const matchingBaselineCommands = validationCommands.filter((command) =>
      commandMatchesBaselineCommand(command.command, check.baselineCommand ?? ""),
    );
    return {
      status: baselineStatusFromCommands(matchingBaselineCommands),
      exactObservedBaselineMatch: (evidence) =>
        evidence.some((item) => item.command?.trim() === check.baselineCommand?.trim()),
    };
  }

  if (check.builtInMatcher) {
    const matchingBaselineCommands = validationCommands.filter((command) =>
      check.builtInMatcher?.(command.command),
    );
    return {
      status: baselineStatusFromCommands(matchingBaselineCommands),
      exactObservedBaselineMatch: () => false,
    };
  }

  return { status: "not_configured", exactObservedBaselineMatch: () => false };
}

function isBaselineVerificationPhase(command: DoctorCommandResult): boolean {
  return ["required_validation", "advisory_validation"].includes(command.phase);
}

function commandMatchesBaselineCommand(command: string, baselineCommand: string): boolean {
  const normalizedCommand = command.trim();
  const normalizedBaseline = baselineCommand.trim();
  return (
    normalizedCommand === normalizedBaseline ||
    normalizedCommand.includes(normalizedBaseline) ||
    normalizedBaseline.includes(normalizedCommand)
  );
}

function baselineStatusFromCommands(
  commands: readonly DoctorCommandResult[],
): SelfVerificationBaselineStatus {
  if (commands.length === 0) {
    return "not_run";
  }
  if (commands.some((command) => command.exit_code === 0)) {
    return "passed";
  }
  return "failed";
}

function evidenceTier(options: {
  readonly observed: boolean;
  readonly baselineStatus: SelfVerificationBaselineStatus;
  readonly exactObservedBaselineMatch: boolean;
}): SelfVerificationEvidenceTier {
  if (!options.observed) {
    return "not_observed";
  }
  if (options.baselineStatus === "failed") {
    return "baseline_failed";
  }
  if (options.baselineStatus === "passed") {
    return options.exactObservedBaselineMatch
      ? "baseline_validated_exact"
      : "baseline_validated_family";
  }
  return "observed_unvalidated";
}

function observedStatus(
  evidence: readonly SelfVerificationEvidence[],
): SelfVerificationCheckSummary["observed_status"] {
  if (evidence.length === 0) {
    return "not_observed";
  }
  const statuses = new Set(evidence.map((item) => item.status));
  return statuses.size === 1 ? (evidence[0]?.status ?? "unknown") : "mixed";
}

function summarizeVerificationClaim(options: {
  readonly finalResponse: string | undefined;
  readonly evidenceAvailable: boolean;
  readonly checks: readonly SelfVerificationCheckSummary[];
}): VerificationClaimSummary {
  const claim = detectVerificationClaim(options.finalResponse ?? "");
  if (!claim.claimsVerification) {
    return {
      claims_verification: false,
      claimed_kinds: [],
      support: "no_claim",
      unsupported_claims: [],
    };
  }

  if (!options.evidenceAvailable) {
    return {
      claims_verification: true,
      claimed_kinds: claim.kinds,
      support: "unknown_no_tool_logs",
      unsupported_claims: claim.kinds,
    };
  }

  const claimedKinds = claim.kinds;
  const relevantChecks =
    claimedKinds.length > 0
      ? options.checks.filter((check) => claimedKinds.includes(check.kind))
      : options.checks.filter((check) => check.observed);
  const contradicted = relevantChecks.some((check) => check.observed_status === "failed");
  const supported =
    claimedKinds.length > 0
      ? claimedKinds.every((kind) =>
          options.checks.some(
            (check) =>
              check.kind === kind &&
              check.observed &&
              ["passed", "mixed"].includes(check.observed_status),
          ),
        )
      : options.checks.some(
          (check) => check.observed && ["passed", "mixed"].includes(check.observed_status),
        );
  const unsupportedClaims = claimedKinds.filter(
    (kind) => !options.checks.some((check) => check.kind === kind && check.observed),
  );

  return {
    claims_verification: true,
    claimed_kinds: claimedKinds,
    support: contradicted ? "contradicted" : supported ? "supported" : "unsupported",
    unsupported_claims: unsupportedClaims,
  };
}

function detectVerificationClaim(text: string): {
  readonly claimsVerification: boolean;
  readonly kinds: readonly VerificationCheckKind[];
} {
  const normalized = text.toLowerCase();
  if (!normalized.trim() || deniesRunningVerification(normalized)) {
    return { claimsVerification: false, kinds: [] };
  }

  const kinds = new Set<VerificationCheckKind>();
  if (claimsKind(normalized, ["test", "tests", "test suite", "pytest", "vitest", "jest"])) {
    kinds.add(VerificationCheckKind.Tests);
  }
  if (claimsKind(normalized, ["typecheck", "type check", "tsc", "mypy", "pyright"])) {
    kinds.add(VerificationCheckKind.Typecheck);
  }
  if (claimsKind(normalized, ["build", "built"])) {
    kinds.add(VerificationCheckKind.Build);
  }
  if (claimsKind(normalized, ["lint", "linter", "eslint", "biome", "ruff", "clippy"])) {
    kinds.add(VerificationCheckKind.Lint);
  }

  const genericClaim =
    /\b(verified|validated|checked)\b/.test(normalized) &&
    !/\b(should|would|expected to)\s+(pass|work|be green)\b/.test(normalized);
  return { claimsVerification: kinds.size > 0 || genericClaim, kinds: [...kinds] };
}

function deniesRunningVerification(text: string): boolean {
  return /\b(did not|didn't|could not|couldn't|was not able to|unable to)\s+(run|execute)\s+(the\s+)?(tests?|typechecks?|build|lint)\b/.test(
    text,
  );
}

function claimsKind(text: string, terms: readonly string[]): boolean {
  return terms.some((term) => {
    const escaped = escapeRegExp(term);
    const ranPattern = new RegExp(
      `\\b(i|we)\\s+(ran|run|executed|verified|checked)\\b[^.\\n]*\\b${escaped}\\b`,
    );
    const passedPattern = new RegExp(
      `\\b${escaped}\\b[^.\\n]*\\b(pass|passed|passes|green|succeed|succeeded|successful)\\b`,
    );
    return ranPattern.test(text) || passedPattern.test(text);
  });
}

function findTestChangePaths(changedFiles: readonly string[]): string[] {
  return changedFiles
    .filter((file) => {
      const normalized = file.replaceAll("\\", "/");
      return TestPathPatterns.some((pattern) => minimatch(normalized, pattern, { dot: true }));
    })
    .sort();
}

function defaultLabelForKind(kind: VerificationCheckKind): string {
  if (kind === VerificationCheckKind.Tests) return "Tests";
  if (kind === VerificationCheckKind.Typecheck) return "Typecheck";
  if (kind === VerificationCheckKind.Build) return "Build";
  if (kind === VerificationCheckKind.Lint) return "Lint/static checks";
  if (kind === VerificationCheckKind.Repro) return "Repro/regression script";
  return "Custom verification";
}

function isTestCommand(command: string): boolean {
  const text = normalizeCommand(command);
  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(test|test:run|vitest|jest)\b/.test(text) ||
    /\b(vitest|jest|pytest)\b/.test(text) ||
    /\bgo\s+test\b/.test(text) ||
    /\bcargo\s+test\b/.test(text) ||
    /\b(mvn|gradle|dotnet)\s+test\b/.test(text)
  );
}

function isTypecheckCommand(command: string): boolean {
  const text = normalizeCommand(command);
  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?typecheck\b/.test(text) ||
    /\btsc\b/.test(text) ||
    /\b(mypy|pyright|pyre)\b/.test(text) ||
    /\bcargo\s+check\b/.test(text)
  );
}

function isBuildCommand(command: string): boolean {
  const text = normalizeCommand(command);
  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b/.test(text) ||
    /\bgo\s+build\b/.test(text) ||
    /\bcargo\s+build\b/.test(text) ||
    /\b(mvn|gradle|dotnet)\s+(package|build)\b/.test(text)
  );
}

function isLintCommand(command: string): boolean {
  const text = normalizeCommand(command);
  return (
    /\b(npm|pnpm|yarn|bun)\s+(run\s+)?(lint|check)\b/.test(text) ||
    /\b(eslint|biome\s+check|ruff|flake8|golangci-lint)\b/.test(text) ||
    /\bcargo\s+clippy\b/.test(text) ||
    /\bprettier\s+--check\b/.test(text)
  );
}

function isReproCommand(command: string): boolean {
  const text = normalizeCommand(command);
  return /\b(repro|reproduction|regression)\b/.test(text);
}

function normalizeCommand(command: string): string {
  return command.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
