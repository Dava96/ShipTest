import { cp, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPiJsonAgentAttempt } from "../agent/pi-json-harness.js";
import { loadShiptestConfigContext } from "../config/load-config.js";
import { resolveConfigRelativePath } from "../config/paths.js";
import { runDoctor } from "../doctor/run-doctor.js";
import { runCleanRoomEvaluation } from "../evaluation/clean-room-evaluator.js";
import { writeHtmlReport } from "../reporting/html-report.js";
import { type AttemptJob, createAttemptJobs, runBenchmarkFairQueue } from "./attempt-scheduler.js";
import { writeRunEvent } from "./events.js";
import { formatDirtyStateError, getGitDirtyState } from "./git-state.js";
import { createRunPlan } from "./plan.js";
import { createAttemptLayout, createRunLayout, toRunRelativePath } from "./run-layout.js";
import type {
  AttemptQualitySignal,
  AttemptReport,
  AttemptStatus,
  BenchmarkBaseCommit,
  RunResults,
  RunStatus,
  ShiptestRunOptions,
} from "./types.js";

export async function runShiptest(options: ShiptestRunOptions): Promise<RunResults> {
  const context = await loadShiptestConfigContext(options.configPath);
  const projectRootPath = resolveConfigRelativePath(context.configDir, context.config.project.repo);
  const runMode = options.draft ? "draft" : "reproducible";
  const snapshotSource = options.draft ? "working_tree" : "git_commit";
  if (!options.draft) {
    const dirtyState = await getGitDirtyState(projectRootPath);
    if (!dirtyState.clean) {
      throw new Error(formatDirtyStateError(dirtyState));
    }
  }

  const layout = await createRunLayout({ projectRootPath, runRootPath: options.runRootPath });
  const plan = createRunPlan({
    config: context.config,
    benchmarkIds: options.benchmarkIds,
    modelIds: options.modelIds,
  });
  const concurrency = options.concurrency ?? context.config.runner.concurrency;
  const modelAttempts = options.modelAttempts ?? context.config.runner.model_attempts;
  const attemptJobs = createAttemptJobs(plan.items, modelAttempts);
  const attemptOrder = new Map(attemptJobs.map((job, index) => [attemptOrderKey(job), index]));
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  await writeRunEvent(layout.eventsPath, {
    type: "run_started",
    run_id: layout.runId,
    agent_runs: attemptJobs.length,
  });

  const attempts: AttemptReport[] = [];
  const writeCurrentArtifacts = async (status: RunStatus): Promise<RunResults> => {
    const results = createRunResults({
      runId: layout.runId,
      createdAt: startedAt,
      projectName: context.config.project.name,
      runMode,
      snapshotSource,
      runRootPath: layout.runRootPath,
      reportPath: layout.reportPath,
      eventsPath: layout.eventsPath,
      attempts: sortedAttempts(attempts, attemptOrder),
      durationMs: Date.now() - startedAtMs,
      statusOverride: status,
    });
    await writeRunArtifacts(layout.resultsPath, layout.reportPath, layout.runRootPath, results);
    return results;
  };

  try {
    const preparedBaselines = new Map<
      string,
      {
        readonly path: string;
        readonly baselineCommit: string | undefined;
        readonly workspaceKey: string;
      }
    >();
    const benchmarkSelections = uniqueBenchmarkBaseCommitSelections(plan.items);
    for (const selection of benchmarkSelections) {
      options.onProgress?.(
        `[${selection.benchmarkId}@${selection.baseCommit.label}] Preparing baseline.`,
      );
    }
    const doctorResult = await runDoctor(context, {
      outputRootPath: layout.doctorOutputPath,
      cacheRootPath: layout.cacheRootPath,
      benchmarkSelections,
      snapshotSource,
      onProgress: (event) => {
        if (event.phase === "cache" && event.benchmark_id) {
          options.onProgress?.(`[${event.benchmark_id}] ${event.message}`);
        }
      },
    });
    for (const selection of benchmarkSelections) {
      const benchmarkDoctorResult = doctorResult.benchmark_results.find(
        (result) =>
          result.benchmark_id === selection.benchmarkId &&
          result.base_commit?.slug === selection.baseCommit.slug,
      );
      if (!benchmarkDoctorResult?.ok) {
        throw new Error(
          `Prepared baseline failed for benchmark '${selection.benchmarkId}' at base commit '${selection.baseCommit.label}'.`,
        );
      }
      if (!benchmarkDoctorResult.prepared_baseline_path) {
        throw new Error(
          `Prepared baseline path is missing for benchmark '${selection.benchmarkId}' at base commit '${selection.baseCommit.label}'.`,
        );
      }
      preparedBaselines.set(preparedBaselineKey(selection.benchmarkId, selection.baseCommit.slug), {
        path: benchmarkDoctorResult.prepared_baseline_path,
        baselineCommit:
          benchmarkDoctorResult.prepared_baseline_metadata?.clean_git_repo.baseline_commit,
        workspaceKey:
          benchmarkDoctorResult.prepared_baseline_metadata?.short_cache_key ??
          sanitizePathSegment(`${selection.benchmarkId}-${selection.baseCommit.slug}`),
      });
    }
    await writeCurrentArtifacts("running");

    let artifactWriteQueue = Promise.resolve();
    const writeCurrentArtifactsQueued = async (status: RunStatus): Promise<RunResults> => {
      const write = artifactWriteQueue.then(() => writeCurrentArtifacts(status));
      artifactWriteQueue = write.then(
        () => undefined,
        () => undefined,
      );
      return await write;
    };

    await runBenchmarkFairQueue({
      items: attemptJobs,
      concurrency,
      worker: async (job) => {
        const attemptReport = await runAttemptJob({
          job,
          runId: layout.runId,
          runRootPath: layout.runRootPath,
          workspaceRootPath: layout.workspaceRootPath,
          configDir: context.configDir,
          repositoryEnvironment: context.config.repository_environment,
          toolUsage: context.config.tool_usage,
          preparedBaseline: preparedBaselines.get(
            preparedBaselineKey(job.planItem.benchmark.id, job.planItem.baseCommit.slug),
          ),
          piExecutable: options.piExecutable ?? "pi",
          piExecutableArgs: options.piExecutableArgs ?? [],
          eventsPath: layout.eventsPath,
          ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
        });
        attempts.push(attemptReport);
        await writeCurrentArtifactsQueued("running");
        return attemptReport;
      },
    });

    const results = await writeCurrentArtifacts(computeFinalRunStatus(attempts));
    await writeRunEvent(layout.eventsPath, {
      type: "run_completed",
      run_id: layout.runId,
      status: results.status,
    });
    return results;
  } catch (error) {
    await writeCurrentArtifacts("crashed").catch(() => undefined);
    await writeRunEvent(layout.eventsPath, {
      type: "run_crashed",
      run_id: layout.runId,
      message: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
}

export async function regenerateReport(runRootPath: string): Promise<string> {
  const reportPath = path.join(path.resolve(runRootPath), "report.html");
  await writeHtmlReport({ runRootPath: path.resolve(runRootPath), reportPath });
  return reportPath;
}

function createResettableWorkspaceLayout(options: {
  readonly workspaceRootPath: string;
  readonly workspaceKey: string;
  readonly benchmarkId: string;
  readonly baseCommitSlug: string;
  readonly modelId: string;
  readonly attempt: number;
}): { readonly agentWorkspacePath: string; readonly evaluationWorkspacePath: string } {
  const rootPath = path.join(
    options.workspaceRootPath,
    sanitizePathSegment(options.workspaceKey),
    sanitizePathSegment(options.benchmarkId),
    sanitizePathSegment(options.baseCommitSlug),
    sanitizePathSegment(options.modelId),
    `attempt-${String(options.attempt).padStart(3, "0")}`,
  );
  return {
    agentWorkspacePath: path.join(rootPath, "agent"),
    evaluationWorkspacePath: path.join(rootPath, "evaluation"),
  };
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function uniqueBenchmarkBaseCommitSelections(items: readonly AttemptJob["planItem"][]) {
  const byKey = new Map<
    string,
    { readonly benchmarkId: string; readonly baseCommit: AttemptJob["planItem"]["baseCommit"] }
  >();
  for (const item of items) {
    const key = preparedBaselineKey(item.benchmark.id, item.baseCommit.slug);
    byKey.set(key, { benchmarkId: item.benchmark.id, baseCommit: item.baseCommit });
  }
  return [...byKey.values()];
}

function preparedBaselineKey(benchmarkId: string, baseCommitSlug: string): string {
  return `${benchmarkId}\0${baseCommitSlug}`;
}

function attemptOrderKey(job: AttemptJob): string {
  return `${job.planItem.benchmark.id}\0${job.planItem.baseCommit.slug}\0${job.planItem.model.id}\0${job.attempt}`;
}

function attemptReportOrderKey(attempt: AttemptReport): string {
  return `${attempt.benchmark_id}\0${attempt.base_commit.slug}\0${attempt.model.id}\0${attempt.attempt}`;
}

function sortedAttempts(
  attempts: readonly AttemptReport[],
  attemptOrder: ReadonlyMap<string, number>,
): AttemptReport[] {
  return [...attempts].sort(
    (left, right) =>
      (attemptOrder.get(attemptReportOrderKey(left)) ?? Number.MAX_SAFE_INTEGER) -
      (attemptOrder.get(attemptReportOrderKey(right)) ?? Number.MAX_SAFE_INTEGER),
  );
}

async function runAttemptJob(options: {
  readonly job: AttemptJob;
  readonly runId: string;
  readonly runRootPath: string;
  readonly workspaceRootPath: string;
  readonly configDir: string;
  readonly repositoryEnvironment: Parameters<
    typeof runCleanRoomEvaluation
  >[0]["repositoryEnvironment"];
  readonly toolUsage?: Parameters<typeof runPiJsonAgentAttempt>[0]["toolUsage"];
  readonly preparedBaseline:
    | {
        readonly path: string;
        readonly baselineCommit: string | undefined;
        readonly workspaceKey: string;
      }
    | undefined;
  readonly piExecutable: string;
  readonly piExecutableArgs: readonly string[];
  readonly eventsPath: string;
  readonly onProgress?: (message: string) => void;
}): Promise<AttemptReport> {
  const { job } = options;
  const item = job.planItem;
  const attemptStartedAtMs = Date.now();
  const attemptLayout = await createAttemptLayout({
    runRootPath: options.runRootPath,
    benchmarkId: item.benchmark.id,
    baseCommitSlug: item.baseCommit.slug,
    modelId: item.model.id,
    attempt: job.attempt,
  });
  if (!options.preparedBaseline) {
    throw new Error(`Prepared baseline is missing for benchmark '${item.benchmark.id}'.`);
  }
  const workspaceLayout = createResettableWorkspaceLayout({
    workspaceRootPath: options.workspaceRootPath,
    workspaceKey: options.preparedBaseline.workspaceKey,
    benchmarkId: item.benchmark.id,
    baseCommitSlug: item.baseCommit.slug,
    modelId: item.model.id,
    attempt: job.attempt,
  });
  const progressPrefix = `[${item.benchmark.id}/${item.model.id}/a${String(job.attempt).padStart(3, "0")}]`;

  await writeRunEvent(options.eventsPath, {
    type: "attempt_started",
    benchmark_id: item.benchmark.id,
    model_id: item.model.id,
    attempt: job.attempt,
  });
  options.onProgress?.(`${progressPrefix} Running agent.`);

  const agentResult = await runPiJsonAgentAttempt({
    preparedBaselinePath: options.preparedBaseline.path,
    ...(options.preparedBaseline.baselineCommit
      ? { preparedBaselineCommit: options.preparedBaseline.baselineCommit }
      : {}),
    agentWorkspacePath: workspaceLayout.agentWorkspacePath,
    configDir: options.configDir,
    benchmark: item.benchmark,
    model: item.model,
    limits: item.benchmark.limits,
    artifactsDir: attemptLayout.agentArtifactsPath,
    overwrite: true,
    piExecutable: options.piExecutable,
    piExecutableArgs: options.piExecutableArgs,
    ...(options.toolUsage === undefined ? {} : { toolUsage: options.toolUsage }),
  });

  if (agentResult.submission) {
    const candidatePatchArtifact = agentResult.artifacts.candidate_patch;
    const changedFilesArtifact = agentResult.artifacts.changed_files;
    if (candidatePatchArtifact) {
      await cp(candidatePatchArtifact, attemptLayout.candidatePatchPath);
    }
    if (changedFilesArtifact) {
      await cp(changedFilesArtifact, attemptLayout.changedFilesPath);
    }
  }

  const qualitySignals = createAttemptQualitySignals({
    benchmarkType: item.benchmark.type,
    agentResult,
  });
  const shouldEvaluate =
    agentResult.ok &&
    agentResult.submission &&
    !qualitySignals.some((signal) => signal.severity === "error");

  let evaluationResult: Awaited<ReturnType<typeof runCleanRoomEvaluation>> | undefined;
  if (shouldEvaluate) {
    options.onProgress?.(`${progressPrefix} Running clean-room evaluation.`);
    evaluationResult = await runCleanRoomEvaluation({
      preparedBaselinePath: options.preparedBaseline.path,
      ...(options.preparedBaseline.baselineCommit
        ? { preparedBaselineCommit: options.preparedBaseline.baselineCommit }
        : {}),
      evaluationWorkspacePath: workspaceLayout.evaluationWorkspacePath,
      configDir: options.configDir,
      benchmark: item.benchmark,
      repositoryEnvironment: options.repositoryEnvironment,
      submission: agentResult.submission,
      artifactsDir: attemptLayout.evaluationArtifactsPath,
      overwrite: true,
    });
  }

  const attemptReport = createAttemptReport({
    runId: options.runId,
    runRootPath: options.runRootPath,
    attemptLayout,
    attempt: job.attempt,
    benchmark: item.benchmark,
    baseCommit: item.baseCommit,
    model: item.model,
    agentResult,
    qualitySignals,
    timingsMs: createAttemptTimings(attemptStartedAtMs, agentResult, evaluationResult),
    ...(evaluationResult ? { evaluationResult } : {}),
  });
  await mkdir(path.dirname(attemptLayout.attemptJsonPath), { recursive: true });
  await writeFile(attemptLayout.attemptJsonPath, `${JSON.stringify(attemptReport, null, 2)}\n`);
  await writeRunEvent(options.eventsPath, {
    type: "attempt_completed",
    benchmark_id: item.benchmark.id,
    model_id: item.model.id,
    attempt: job.attempt,
    status: attemptReport.status,
  });
  options.onProgress?.(`${progressPrefix} Completed: ${attemptReport.status}.`);
  return attemptReport;
}

function createAttemptReport(options: {
  readonly runId: string;
  readonly runRootPath: string;
  readonly attemptLayout: {
    readonly attemptJsonPath: string;
    readonly candidatePatchPath: string;
    readonly changedFilesPath: string;
  };
  readonly attempt: number;
  readonly benchmark: Parameters<typeof runPiJsonAgentAttempt>[0]["benchmark"];
  readonly baseCommit: BenchmarkBaseCommit;
  readonly model: Parameters<typeof runPiJsonAgentAttempt>[0]["model"];
  readonly agentResult: Awaited<ReturnType<typeof runPiJsonAgentAttempt>>;
  readonly qualitySignals: readonly AttemptQualitySignal[];
  readonly evaluationResult?: Awaited<ReturnType<typeof runCleanRoomEvaluation>> | undefined;
  readonly timingsMs: NonNullable<AttemptReport["timings_ms"]>;
}): AttemptReport {
  const qualitySignals = options.qualitySignals;
  const status = classifyAttemptStatus(
    options.agentResult.ok,
    options.evaluationResult?.ok,
    qualitySignals,
  );
  const artifacts: Record<string, string> = {
    attempt_json: toRunRelativePath(options.runRootPath, options.attemptLayout.attemptJsonPath),
    candidate_patch: toRunRelativePath(
      options.runRootPath,
      options.attemptLayout.candidatePatchPath,
    ),
    changed_files: toRunRelativePath(options.runRootPath, options.attemptLayout.changedFilesPath),
  };
  for (const [key, artifactPath] of Object.entries(options.agentResult.artifacts)) {
    artifacts[`agent_${key}`] = toRunRelativePath(options.runRootPath, artifactPath);
  }
  for (const [key, artifactPath] of Object.entries(options.evaluationResult?.artifacts ?? {})) {
    artifacts[`evaluation_${key}`] = toRunRelativePath(options.runRootPath, artifactPath);
  }

  return {
    schema_version: 1,
    run_id: options.runId,
    benchmark_id: options.benchmark.id,
    base_commit: options.baseCommit,
    benchmark_type: options.benchmark.type,
    task: options.benchmark.task,
    attempt: options.attempt,
    status,
    model: {
      id: options.model.id,
      provider: options.model.provider,
      model: options.model.model,
    },
    agent: {
      ok: options.agentResult.ok,
      status: options.agentResult.status,
      signals: options.agentResult.signals,
      telemetry: options.agentResult.telemetry,
    },
    ...(options.agentResult.tool_usage
      ? { tool_usage: relativizeToolUsage(options.agentResult.tool_usage, options.runRootPath) }
      : {}),
    ...(qualitySignals.length > 0 ? { quality_signals: qualitySignals } : {}),
    ...(options.agentResult.submission
      ? {
          submission: {
            changed_files: options.agentResult.submission.changed_files,
            is_empty: options.agentResult.submission.is_empty,
          },
        }
      : {}),
    ...(options.evaluationResult ? { evaluation: options.evaluationResult } : {}),
    human_review: { status: "pending" },
    timings_ms: options.timingsMs,
    artifacts,
  };
}

function relativizeToolUsage(
  toolUsage: NonNullable<AttemptReport["tool_usage"]>,
  runRootPath: string,
): NonNullable<AttemptReport["tool_usage"]> {
  return {
    ...toolUsage,
    artifacts: {
      ...(toolUsage.artifacts.tool_calls_jsonl
        ? { tool_calls_jsonl: toRunRelativePath(runRootPath, toolUsage.artifacts.tool_calls_jsonl) }
        : {}),
    },
  };
}

function createAttemptTimings(
  attemptStartedAtMs: number,
  agentResult: Awaited<ReturnType<typeof runPiJsonAgentAttempt>>,
  evaluationResult: Awaited<ReturnType<typeof runCleanRoomEvaluation>> | undefined,
): NonNullable<AttemptReport["timings_ms"]> {
  return {
    total_ms: Date.now() - attemptStartedAtMs,
    agent_total_ms: agentResult.timings_ms.total_ms,
    agent_workspace_prepare_ms: agentResult.timings_ms.workspace_prepare_ms,
    agent_workspace_prepare_strategy: agentResult.timings_ms.workspace_prepare_strategy,
    agent_workspace_prepare_reused: agentResult.timings_ms.workspace_prepare_reused,
    agent_workspace_prepare_fallback_used: agentResult.timings_ms.workspace_prepare_fallback_used,
    agent_process_ms: agentResult.timings_ms.process_ms,
    agent_submission_extract_ms: agentResult.timings_ms.submission_extract_ms,
    evaluation_total_ms: evaluationResult?.timings_ms.total_ms ?? 0,
    evaluation_workspace_prepare_ms: evaluationResult?.timings_ms.workspace_prepare_ms ?? 0,
    evaluation_workspace_prepare_strategy:
      evaluationResult?.timings_ms.workspace_prepare_strategy ?? "copy",
    evaluation_workspace_prepare_reused:
      evaluationResult?.timings_ms.workspace_prepare_reused ?? false,
    evaluation_workspace_prepare_fallback_used:
      evaluationResult?.timings_ms.workspace_prepare_fallback_used ?? false,
    evaluation_patch_apply_ms: evaluationResult?.timings_ms.patch_apply_ms ?? 0,
    evaluation_hidden_payload_ms: evaluationResult?.timings_ms.hidden_payload_ms ?? 0,
    evaluation_scoring_ms: evaluationResult?.timings_ms.scoring_ms ?? 0,
    evaluation_setup_rerun_ms: evaluationResult?.timings_ms.setup_rerun_ms ?? 0,
  };
}

function createAttemptQualitySignals(options: {
  readonly benchmarkType: AttemptReport["benchmark_type"];
  readonly agentResult: Awaited<ReturnType<typeof runPiJsonAgentAttempt>>;
}): NonNullable<AttemptReport["quality_signals"]> {
  const signals: AttemptQualitySignal[] = [];
  const usage = options.agentResult.telemetry.usage;
  const totalTokens = usage.total_tokens;
  const errorCount = options.agentResult.telemetry.error_messages.length;

  if (totalTokens <= 0) {
    signals.push({
      id: "agent_no_token_usage",
      severity: "error",
      message:
        "Agent attempt reported zero token usage; ShipTest cannot verify that model inference occurred.",
    });
  }

  if (errorCount > 0 && totalTokens <= 0) {
    signals.push({
      id: "agent_reported_errors_without_usage",
      severity: "error",
      message: `Agent reported ${errorCount} error message(s) without any token usage.`,
    });
  } else if (errorCount > 0) {
    signals.push({
      id: "agent_reported_errors",
      severity: "warning",
      message: `Agent reported ${errorCount} error message(s), but also produced token usage. Treat this as recovered unless other checks failed.`,
    });
  }

  if (requiresRepositoryChanges(options.benchmarkType)) {
    const submission = options.agentResult.submission;
    if (!submission || submission.changed_files.length === 0) {
      signals.push({
        id: "required_file_changes_missing",
        severity: "error",
        message:
          "Implementation and replay_change benchmarks require repository changes, but the submission changed no files.",
      });
    }
    if (submission?.is_empty) {
      signals.push({
        id: "empty_submission_patch",
        severity: "error",
        message:
          "Implementation and replay_change benchmarks require a non-empty submission patch.",
      });
    }
  }

  return signals;
}

function requiresRepositoryChanges(benchmarkType: AttemptReport["benchmark_type"]): boolean {
  return benchmarkType === "implementation" || benchmarkType === "replay_change";
}

function classifyAttemptStatus(
  agentOk: boolean,
  evaluationOk: boolean | undefined,
  qualitySignals: readonly { readonly severity: "warning" | "error" }[],
): AttemptStatus {
  if (!agentOk || qualitySignals.some((signal) => signal.severity === "error")) {
    return "agent_failed";
  }
  if (evaluationOk === false) {
    return "evaluation_failed";
  }
  if (evaluationOk === undefined) {
    return "completed_with_issues";
  }
  return "completed";
}

async function writeRunArtifacts(
  resultsPath: string,
  reportPath: string,
  runRootPath: string,
  results: RunResults,
): Promise<void> {
  await atomicWriteFile(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  await writeHtmlReport({ runRootPath, reportPath: `${reportPath}.tmp` });
  await rename(`${reportPath}.tmp`, reportPath);
}

async function atomicWriteFile(pathname: string, contents: string): Promise<void> {
  const tmpPath = `${pathname}.tmp`;
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(tmpPath, contents, "utf8");
  await rename(tmpPath, pathname);
}

function computeFinalRunStatus(attempts: readonly AttemptReport[]): RunStatus {
  return attempts.every((attempt) => attempt.status === "completed")
    ? "completed"
    : "completed_with_issues";
}

function createRunResults(options: {
  readonly runId: string;
  readonly createdAt: string;
  readonly projectName: string;
  readonly runMode: RunResults["run_mode"];
  readonly snapshotSource: RunResults["snapshot_source"];
  readonly runRootPath: string;
  readonly reportPath: string;
  readonly eventsPath: string;
  readonly attempts: readonly AttemptReport[];
  readonly durationMs: number;
  readonly statusOverride?: RunStatus;
}): RunResults {
  const byBenchmark = new Map<string, AttemptReport[]>();
  for (const attempt of options.attempts) {
    const list = byBenchmark.get(attempt.benchmark_id) ?? [];
    list.push(attempt);
    byBenchmark.set(attempt.benchmark_id, list);
  }
  const estimatedCost = sumOptional(
    options.attempts.map((attempt) => attempt.agent.telemetry.usage.estimated_cost_usd?.total),
  );
  const status: RunStatus = options.statusOverride ?? computeFinalRunStatus(options.attempts);
  return {
    schema_version: 1,
    run_id: options.runId,
    created_at: options.createdAt,
    status,
    project: { name: options.projectName },
    run_mode: options.runMode,
    snapshot_source: options.snapshotSource,
    summary: {
      benchmarks: byBenchmark.size,
      agent_runs: options.attempts.length,
      completed: options.attempts.filter((attempt) => attempt.status === "completed").length,
      completed_with_issues: options.attempts.filter(
        (attempt) => attempt.status === "completed_with_issues",
      ).length,
      agent_failed: options.attempts.filter((attempt) => attempt.status === "agent_failed").length,
      evaluation_failed: options.attempts.filter(
        (attempt) => attempt.status === "evaluation_failed",
      ).length,
      passed: options.attempts.filter(
        (attempt) => attempt.status === "completed" && attempt.evaluation?.verdict === "passed",
      ).length,
      needs_review: options.attempts.filter(
        (attempt) =>
          attempt.status === "completed" && attempt.evaluation?.verdict === "needs_review",
      ).length,
      failed: options.attempts.filter(
        (attempt) => attempt.status === "completed" && attempt.evaluation?.verdict === "failed",
      ).length,
      total_tokens: sumUsage(options.attempts, "total_tokens"),
      input_tokens: sumUsage(options.attempts, "input_tokens"),
      output_tokens: sumUsage(options.attempts, "output_tokens"),
      cache_read_tokens: sumUsage(options.attempts, "cache_read_tokens"),
      cache_write_tokens: sumUsage(options.attempts, "cache_write_tokens"),
      uncached_tokens: sumUsage(options.attempts, "uncached_tokens"),
      duration_ms: options.durationMs,
      ...(estimatedCost === undefined ? {} : { estimated_cost_usd: estimatedCost }),
    },
    benchmark_results: [...byBenchmark.entries()].map(([benchmark_id, attempts]) => ({
      benchmark_id,
      base_commits: baseCommitResults(attempts),
      duration_ms: attempts.reduce(
        (total, attempt) => total + (attempt.timings_ms?.total_ms ?? 0),
        0,
      ),
    })),
    artifacts: {
      report_html: toRunRelativePath(options.runRootPath, options.reportPath),
      events_jsonl: toRunRelativePath(options.runRootPath, options.eventsPath),
    },
  };
}

function baseCommitResults(
  attempts: readonly AttemptReport[],
): RunResults["benchmark_results"][number]["base_commits"] {
  const byBaseCommit = new Map<string, AttemptReport[]>();
  for (const attempt of attempts) {
    const list = byBaseCommit.get(attempt.base_commit.slug) ?? [];
    list.push(attempt);
    byBaseCommit.set(attempt.base_commit.slug, list);
  }
  return [...byBaseCommit.values()].map((baseCommitAttempts) => {
    const baseCommit = baseCommitAttempts[0]?.base_commit;
    if (!baseCommit) {
      throw new Error("Cannot create base commit result without attempts.");
    }
    return {
      commit: baseCommit.commit,
      label: baseCommit.label,
      slug: baseCommit.slug,
      index: baseCommit.index,
      attempts: baseCommitAttempts.map((attempt) => attempt.artifacts.attempt_json ?? ""),
      duration_ms: baseCommitAttempts.reduce(
        (total, attempt) => total + (attempt.timings_ms?.total_ms ?? 0),
        0,
      ),
    };
  });
}

function sumUsage(
  attempts: readonly AttemptReport[],
  key: keyof Pick<
    AttemptReport["agent"]["telemetry"]["usage"],
    | "input_tokens"
    | "output_tokens"
    | "cache_read_tokens"
    | "cache_write_tokens"
    | "uncached_tokens"
    | "total_tokens"
  >,
): number {
  return attempts.reduce((total, attempt) => total + attempt.agent.telemetry.usage[key], 0);
}

function sumOptional(values: readonly (number | undefined)[]): number | undefined {
  const present = values.filter((value) => value !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return present.reduce((total, value) => total + value, 0);
}
