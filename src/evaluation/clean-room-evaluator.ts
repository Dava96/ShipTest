import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";

import { CheckSeverity } from "../checks/severity.js";
import { DependencyChangePolicy, EvaluationPolicyPreset } from "../config/schema-values.js";
import { runShellCommand } from "../execution/run-command.js";
import { applySubmissionDiff } from "../submission/apply.js";
import {
  prepareCopiedWorkspace,
  prepareResettableGitWorkspace,
} from "../workspace/resettable-workspace.js";
import { EvaluationCheckCode } from "./check-codes.js";
import { applyHiddenEvaluationPayload } from "./hidden-payload.js";
import type {
  CleanRoomEvaluationOptions,
  CleanRoomEvaluationResult,
  CleanRoomEvaluationStatus,
  CleanRoomEvaluationVerdict,
  CommandResult,
  EvaluationCheck,
  EvaluationSignal,
} from "./types.js";

const DefaultCommandOutputMaxBytes = 1_000_000;

const BuiltInProtectedPathPatterns = [
  ".env*",
  "**/.env*",
  "**/.ssh/**",
  "**/.aws/**",
  "**/id_rsa",
  "**/credentials*",
  "infra/prod/**",
  "k8s/prod/**",
  ".github/workflows/*deploy*",
] as const;

const DependencyPathPatterns = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "pyproject.toml",
  "poetry.lock",
  "requirements*.txt",
  "Pipfile",
  "Pipfile.lock",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "pom.xml",
  "build.gradle",
  "gradle.lockfile",
  "composer.json",
  "composer.lock",
  "Gemfile",
  "Gemfile.lock",
] as const;

export async function runCleanRoomEvaluation(
  options: CleanRoomEvaluationOptions,
): Promise<CleanRoomEvaluationResult> {
  const startedAt = Date.now();
  const timings = createEmptyEvaluationTimings();
  const checks: EvaluationCheck[] = [];
  const signals: EvaluationSignal[] = [];
  const commands: CommandResult[] = [];
  const artifacts: Record<string, string> = {};
  const commandOutputMaxBytes = options.commandOutputMaxBytes ?? DefaultCommandOutputMaxBytes;

  const artifactRoot =
    options.artifactsDir ??
    path.join(
      path.dirname(options.evaluationWorkspacePath),
      `${path.basename(options.evaluationWorkspacePath)}-artifacts`,
    );
  const makeResult = (
    resultOptions: Omit<Parameters<typeof result>[0], "timings_ms">,
  ): CleanRoomEvaluationResult =>
    result({
      ...resultOptions,
      timings_ms: finishEvaluationTimings(timings, startedAt),
    });

  try {
    const workspacePrepareResult = await measureEvaluationTiming(
      timings,
      "workspace_prepare_ms",
      () =>
        createEvaluationWorkspace(
          options.preparedBaselinePath,
          options.evaluationWorkspacePath,
          options.overwrite ?? false,
          options.preparedBaselineCommit,
        ),
    );
    timings.workspace_prepare_strategy = workspacePrepareResult.strategy;
    timings.workspace_prepare_reused = workspacePrepareResult.reused;
    timings.workspace_prepare_fallback_used = workspacePrepareResult.fallback_used;
    checks.push({
      code: EvaluationCheckCode.CleanRoomWorkspaceCreated,
      severity: CheckSeverity.Pass,
      message: "Created clean-room evaluation workspace from prepared baseline.",
      paths: [options.evaluationWorkspacePath],
    });
    await mkdir(artifactRoot, { recursive: true });
  } catch (error) {
    checks.push({
      code: EvaluationCheckCode.CleanRoomWorkspaceCreateFailed,
      severity: CheckSeverity.Error,
      message: `Failed to create clean-room evaluation workspace. ${formatError(error)}`,
      paths: [options.evaluationWorkspacePath],
    });
    return makeResult({
      ok: false,
      status: "INFRASTRUCTURE_ERROR",
      verdict: "inconclusive",
      evaluationWorkspacePath: options.evaluationWorkspacePath,
      checks,
      signals,
      commands,
      artifacts,
    });
  }

  await writeTextArtifact(
    artifactRoot,
    artifacts,
    "candidate_patch",
    "candidate.patch",
    options.submission.diff,
  );

  const applyResult = await measureEvaluationTiming(timings, "patch_apply_ms", () =>
    applySubmissionDiff(options.evaluationWorkspacePath, options.submission.diff),
  );
  checks.push(...applyResult.checks.map(submissionCheckToEvaluationCheck));
  if (!applyResult.ok) {
    signals.push({
      id: "candidate_patch_apply_failed",
      severity: "error",
      message: "Candidate patch could not be applied to a fresh prepared baseline.",
      weight: 100,
    });
    return makeResult({
      ok: false,
      status: "PARTIAL",
      verdict: "inconclusive",
      score: 0,
      evaluationWorkspacePath: options.evaluationWorkspacePath,
      checks,
      signals,
      commands,
      artifacts,
    });
  }

  signals.push({
    id: "candidate_patch_applied",
    severity: "info",
    message: "Candidate patch applied to a fresh prepared baseline.",
    weight: 0,
  });

  const protectedPaths = protectedPathMatches(
    options.submission.changed_files,
    options.benchmark.evaluation.protected_paths,
  );
  if (protectedPaths.length > 0) {
    checks.push({
      code: EvaluationCheckCode.ProtectedPathModified,
      severity: CheckSeverity.Error,
      message: "Candidate modified protected path(s).",
      paths: protectedPaths,
    });
    signals.push({
      id: "protected_path_modified",
      severity: "error",
      message: "Candidate modified protected path(s).",
      weight: 100,
      paths: protectedPaths,
    });
  }

  const dependencyChanges = dependencyPathMatches(options.submission.changed_files);
  if (dependencyChanges.length > 0) {
    checks.push({
      code: EvaluationCheckCode.DependencyManifestModified,
      severity: CheckSeverity.Warning,
      message: "Candidate modified dependency manifest or lockfile path(s).",
      paths: dependencyChanges,
    });
    signals.push({
      id: "dependency_manifest_modified",
      severity: "warning",
      message: "Candidate modified dependency manifest or lockfile path(s).",
      weight: 10,
      paths: dependencyChanges,
    });
  }

  if (
    dependencyChanges.length > 0 &&
    options.benchmark.evaluation.dependency_changes === DependencyChangePolicy.Fail
  ) {
    checks.push({
      code: EvaluationCheckCode.DependencyChangePolicyFailed,
      severity: CheckSeverity.Error,
      message: "Dependency changes are disallowed by evaluation policy.",
      paths: dependencyChanges,
    });
    signals.push({
      id: "dependency_change_policy_failed",
      severity: "error",
      message: "Dependency changes are disallowed by evaluation policy.",
      weight: 100,
      paths: dependencyChanges,
    });
    return makeResult({
      ok: false,
      status: "EVALUATED",
      verdict: "policy_issue",
      score: 0,
      evaluationWorkspacePath: options.evaluationWorkspacePath,
      checks,
      signals,
      commands,
      artifacts,
    });
  }

  if (
    dependencyChanges.length > 0 &&
    options.benchmark.evaluation.rerun_setup_on_dependency_change
  ) {
    const setupResult = await measureEvaluationTiming(timings, "setup_rerun_ms", () =>
      runSetupCommands({
        artifactRoot,
        artifacts,
        commands,
        commandOutputMaxBytes,
        cwd: options.evaluationWorkspacePath,
        setupCommands: options.repositoryEnvironment.setup_commands,
      }),
    );
    checks.push(...setupResult.checks);
    if (!setupResult.ok) {
      signals.push({
        id: "setup_rerun_failed",
        severity: "error",
        message: "Setup rerun failed after dependency changes.",
        weight: 80,
      });
      return makeResult({
        ok: false,
        status: "PARTIAL",
        verdict: "inconclusive",
        score: 0,
        evaluationWorkspacePath: options.evaluationWorkspacePath,
        checks,
        signals,
        commands,
        artifacts,
      });
    }
  }

  const hiddenPayloadResult = await measureEvaluationTiming(timings, "hidden_payload_ms", () =>
    applyHiddenEvaluationPayload({
      workspacePath: options.evaluationWorkspacePath,
      configDir: options.configDir,
      evaluation: options.benchmark.evaluation,
    }),
  );
  checks.push(...hiddenPayloadResult.checks);
  if (!hiddenPayloadResult.ok) {
    signals.push({
      id: "hidden_evaluation_apply_failed",
      severity: "error",
      message: "Hidden evaluation assets could not be applied to the clean-room workspace.",
      weight: 100,
    });
    return makeResult({
      ok: false,
      status: "INVALID_BENCHMARK",
      verdict: "invalid_benchmark",
      evaluationWorkspacePath: options.evaluationWorkspacePath,
      checks,
      signals,
      commands,
      artifacts,
    });
  }

  const scoringCommand = await measureEvaluationTiming(timings, "scoring_ms", () =>
    runShellCommand({
      command: options.benchmark.evaluation.scoring_command,
      cwd: options.evaluationWorkspacePath,
      maxOutputBytes: commandOutputMaxBytes,
    }),
  );
  const scoringCommandResult = await recordCommandArtifact({
    artifactRoot,
    artifacts,
    keyPrefix: "scoring",
    filePrefix: "scoring",
    command: scoringCommand,
  });
  commands.push(scoringCommandResult);

  if (scoringCommand.exit_code === 0) {
    checks.push({
      code: EvaluationCheckCode.ScoringCommandPassed,
      severity: CheckSeverity.Pass,
      message: "Scoring command passed.",
    });
    signals.push({
      id: "scoring_command_passed",
      severity: "info",
      message: "Scoring command passed.",
      weight: 0,
    });
  } else {
    checks.push({
      code: EvaluationCheckCode.ScoringCommandFailed,
      severity: CheckSeverity.Warning,
      message: `Scoring command failed with exit code ${scoringCommand.exit_code ?? "null"}.`,
    });
    signals.push({
      id: "scoring_command_failed",
      severity: "warning",
      message: `Scoring command failed with exit code ${scoringCommand.exit_code ?? "null"}.`,
      weight: 40,
    });
  }

  const finalVerdict = verdictForSignals(signals, options.benchmark.evaluation.policy_preset);
  return makeResult({
    ok: true,
    status: "EVALUATED",
    verdict: finalVerdict,
    score: scoreForSignals(signals),
    evaluationWorkspacePath: options.evaluationWorkspacePath,
    checks,
    signals,
    commands,
    artifacts,
  });
}

async function createEvaluationWorkspace(
  preparedBaselinePath: string,
  evaluationWorkspacePath: string,
  overwrite: boolean,
  preparedBaselineCommit: string | undefined,
) {
  if (preparedBaselineCommit) {
    return prepareResettableGitWorkspace({
      preparedBaselinePath,
      workspacePath: evaluationWorkspacePath,
      baselineCommit: preparedBaselineCommit,
    });
  }
  return prepareCopiedWorkspace({
    preparedBaselinePath,
    workspacePath: evaluationWorkspacePath,
    overwrite,
  });
}

async function runSetupCommands(options: {
  readonly artifactRoot: string;
  readonly artifacts: Record<string, string>;
  readonly commands: CommandResult[];
  readonly commandOutputMaxBytes: number;
  readonly cwd: string;
  readonly setupCommands: readonly string[];
}): Promise<{ readonly ok: boolean; readonly checks: readonly EvaluationCheck[] }> {
  const checks: EvaluationCheck[] = [];
  for (const [index, command] of options.setupCommands.entries()) {
    const shellResult = await runShellCommand({
      command,
      cwd: options.cwd,
      maxOutputBytes: options.commandOutputMaxBytes,
    });
    const commandResult = await recordCommandArtifact({
      artifactRoot: options.artifactRoot,
      artifacts: options.artifacts,
      keyPrefix: `setup_${index + 1}`,
      filePrefix: `setup-${String(index + 1).padStart(3, "0")}`,
      command: shellResult,
    });
    options.commands.push(commandResult);
    if (shellResult.exit_code === 0) {
      checks.push({
        code: EvaluationCheckCode.SetupCommandPassed,
        severity: CheckSeverity.Pass,
        message: "Setup command passed during clean-room evaluation.",
      });
    } else {
      checks.push({
        code: EvaluationCheckCode.SetupCommandFailed,
        severity: CheckSeverity.Error,
        message: `Setup command failed during clean-room evaluation with exit code ${shellResult.exit_code ?? "null"}.`,
      });
      return { ok: false, checks };
    }
  }
  return { ok: true, checks };
}

async function recordCommandArtifact(options: {
  readonly artifactRoot: string;
  readonly artifacts: Record<string, string>;
  readonly keyPrefix: string;
  readonly filePrefix: string;
  readonly command: {
    readonly command: string;
    readonly duration_ms: number;
    readonly exit_code: number | null;
    readonly stdout: string;
    readonly stderr: string;
  };
}): Promise<CommandResult> {
  const stdoutPath = path.join(options.artifactRoot, `${options.filePrefix}.stdout.txt`);
  const stderrPath = path.join(options.artifactRoot, `${options.filePrefix}.stderr.txt`);
  await writeFile(stdoutPath, options.command.stdout, "utf8");
  await writeFile(stderrPath, options.command.stderr, "utf8");
  options.artifacts[`${options.keyPrefix}_stdout`] = stdoutPath;
  options.artifacts[`${options.keyPrefix}_stderr`] = stderrPath;
  return {
    command: options.command.command,
    duration_ms: options.command.duration_ms,
    exit_code: options.command.exit_code,
    stdout_artifact: stdoutPath,
    stderr_artifact: stderrPath,
  };
}

async function writeTextArtifact(
  artifactRoot: string,
  artifacts: Record<string, string>,
  key: string,
  fileName: string,
  text: string,
): Promise<void> {
  const artifactPath = path.join(artifactRoot, fileName);
  await writeFile(artifactPath, text, "utf8");
  artifacts[key] = artifactPath;
}

function protectedPathMatches(
  changedFiles: readonly string[],
  configuredPatterns: readonly string[],
): string[] {
  const patterns = [...BuiltInProtectedPathPatterns, ...configuredPatterns];
  return matchAnyPattern(changedFiles, patterns);
}

function dependencyPathMatches(changedFiles: readonly string[]): string[] {
  return matchAnyPattern(changedFiles, DependencyPathPatterns);
}

function matchAnyPattern(changedFiles: readonly string[], patterns: readonly string[]): string[] {
  return changedFiles
    .filter((changedFile) => {
      const normalized = changedFile.replaceAll("\\", "/");
      return patterns.some((pattern) => minimatch(normalized, pattern, { dot: true }));
    })
    .sort();
}

function submissionCheckToEvaluationCheck(check: {
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}): EvaluationCheck {
  const isFailure = check.severity === CheckSeverity.Error;
  return {
    code: isFailure
      ? EvaluationCheckCode.CandidatePatchApplyFailed
      : EvaluationCheckCode.CandidatePatchApplied,
    severity: check.severity,
    message: check.message,
    ...(check.paths ? { paths: check.paths } : {}),
  };
}

function verdictForSignals(
  signals: readonly EvaluationSignal[],
  policyPreset: EvaluationPolicyPreset,
): CleanRoomEvaluationVerdict {
  if (
    signals.some(
      (signal) =>
        signal.id === "protected_path_modified" ||
        signal.id === "dependency_change_policy_failed" ||
        (policyPreset === EvaluationPolicyPreset.RiskAverse &&
          signal.id === "dependency_manifest_modified"),
    )
  ) {
    return "policy_issue";
  }
  if (signals.some((signal) => signal.id === "scoring_command_failed")) {
    return policyPreset === EvaluationPolicyPreset.ReviewFirst ? "needs_review" : "failed";
  }
  return "passed";
}

function scoreForSignals(signals: readonly EvaluationSignal[]): number {
  const penalty = signals.reduce((total, signal) => total + signal.weight, 0);
  return Math.max(0, 100 - penalty);
}

function result(options: {
  readonly ok: boolean;
  readonly status: CleanRoomEvaluationStatus;
  readonly verdict: CleanRoomEvaluationVerdict;
  readonly score?: number;
  readonly evaluationWorkspacePath: string;
  readonly checks: readonly EvaluationCheck[];
  readonly signals: readonly EvaluationSignal[];
  readonly commands: readonly CommandResult[];
  readonly timings_ms: CleanRoomEvaluationResult["timings_ms"];
  readonly artifacts: Record<string, string>;
}): CleanRoomEvaluationResult {
  return {
    ok: options.ok,
    status: options.status,
    verdict: options.verdict,
    ...(options.score === undefined ? {} : { score: options.score }),
    evaluation_workspace_path: options.evaluationWorkspacePath,
    checks: options.checks,
    signals: options.signals,
    commands: options.commands,
    timings_ms: options.timings_ms,
    artifacts: options.artifacts,
  };
}

type MutableEvaluationTimings = {
  -readonly [Key in keyof CleanRoomEvaluationResult["timings_ms"]]: CleanRoomEvaluationResult["timings_ms"][Key];
};

function createEmptyEvaluationTimings(): MutableEvaluationTimings {
  return {
    total_ms: 0,
    workspace_prepare_ms: 0,
    workspace_prepare_strategy: "copy",
    workspace_prepare_reused: false,
    workspace_prepare_fallback_used: false,
    patch_apply_ms: 0,
    hidden_payload_ms: 0,
    scoring_ms: 0,
    setup_rerun_ms: 0,
  };
}

type EvaluationTimingNumberKey = {
  [Key in keyof CleanRoomEvaluationResult["timings_ms"]]: CleanRoomEvaluationResult["timings_ms"][Key] extends number
    ? Key
    : never;
}[keyof CleanRoomEvaluationResult["timings_ms"]];

async function measureEvaluationTiming<T>(
  timings: MutableEvaluationTimings,
  key: Exclude<EvaluationTimingNumberKey, "total_ms">,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[key] += Date.now() - startedAt;
  }
}

function finishEvaluationTimings(
  timings: MutableEvaluationTimings,
  startedAt: number,
): CleanRoomEvaluationResult["timings_ms"] {
  return {
    ...timings,
    total_ms: Date.now() - startedAt,
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
