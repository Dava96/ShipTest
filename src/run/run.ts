import { cp, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { runPiJsonAgentAttempt } from "../agent/pi-json-harness.js";
import { loadShiptestConfigContext } from "../config/load-config.js";
import { resolveConfigRelativePath } from "../config/paths.js";
import { runDoctor } from "../doctor/run-doctor.js";
import { runCleanRoomEvaluation } from "../evaluation/clean-room-evaluator.js";
import { writeHtmlReport } from "../reporting/html-report.js";
import { writeRunEvent } from "./events.js";
import { formatDirtyStateError, getGitDirtyState } from "./git-state.js";
import { createRunPlan } from "./plan.js";
import { createAttemptLayout, createRunLayout, toRunRelativePath } from "./run-layout.js";
import type {
  AttemptReport,
  AttemptStatus,
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
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  await writeRunEvent(layout.eventsPath, {
    type: "run_started",
    run_id: layout.runId,
    agent_runs: plan.items.length,
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
      attempts,
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
    const benchmarkIds = [...new Set(plan.items.map((item) => item.benchmark.id))];
    for (const benchmarkId of benchmarkIds) {
      options.onProgress?.(`[${benchmarkId}] Preparing baseline.`);
    }
    const doctorResult = await runDoctor(context, {
      outputRootPath: layout.doctorOutputPath,
      cacheRootPath: layout.cacheRootPath,
      benchmarkIds,
      snapshotSource,
      onProgress: (event) => {
        if (event.phase === "cache" && event.benchmark_id) {
          options.onProgress?.(`[${event.benchmark_id}] ${event.message}`);
        }
      },
    });
    for (const benchmarkId of benchmarkIds) {
      const benchmarkDoctorResult = doctorResult.benchmark_results.find(
        (result) => result.benchmark_id === benchmarkId,
      );
      if (!benchmarkDoctorResult?.ok) {
        throw new Error(`Prepared baseline failed for benchmark '${benchmarkId}'.`);
      }
      if (!benchmarkDoctorResult.prepared_baseline_path) {
        throw new Error(`Prepared baseline path is missing for benchmark '${benchmarkId}'.`);
      }
      preparedBaselines.set(benchmarkId, {
        path: benchmarkDoctorResult.prepared_baseline_path,
        baselineCommit:
          benchmarkDoctorResult.prepared_baseline_metadata?.clean_git_repo.baseline_commit,
        workspaceKey:
          benchmarkDoctorResult.prepared_baseline_metadata?.short_cache_key ??
          sanitizePathSegment(benchmarkId),
      });
    }
    await writeCurrentArtifacts("running");

    for (const item of plan.items) {
      const attemptStartedAtMs = Date.now();
      const attemptLayout = await createAttemptLayout({
        runRootPath: layout.runRootPath,
        benchmarkId: item.benchmark.id,
        modelId: item.model.id,
        attempt: 1,
      });
      const preparedBaseline = preparedBaselines.get(item.benchmark.id);
      if (!preparedBaseline) {
        throw new Error(`Prepared baseline is missing for benchmark '${item.benchmark.id}'.`);
      }
      const workspaceLayout = createResettableWorkspaceLayout({
        workspaceRootPath: layout.workspaceRootPath,
        workspaceKey: preparedBaseline.workspaceKey,
        modelId: item.model.id,
      });

      await writeRunEvent(layout.eventsPath, {
        type: "attempt_started",
        benchmark_id: item.benchmark.id,
        model_id: item.model.id,
        attempt: 1,
      });
      options.onProgress?.(`[${item.benchmark.id}/${item.model.id}] Running agent.`);

      const agentResult = await runPiJsonAgentAttempt({
        preparedBaselinePath: preparedBaseline.path,
        ...(preparedBaseline.baselineCommit
          ? { preparedBaselineCommit: preparedBaseline.baselineCommit }
          : {}),
        agentWorkspacePath: workspaceLayout.agentWorkspacePath,
        configDir: context.configDir,
        benchmark: item.benchmark,
        model: item.model,
        limits: item.benchmark.limits,
        artifactsDir: attemptLayout.agentArtifactsPath,
        overwrite: true,
        piExecutable: options.piExecutable ?? "pi",
        piExecutableArgs: options.piExecutableArgs ?? [],
        toolUsage: context.config.tool_usage,
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

      let evaluationResult: Awaited<ReturnType<typeof runCleanRoomEvaluation>> | undefined;
      if (agentResult.submission) {
        options.onProgress?.(
          `[${item.benchmark.id}/${item.model.id}] Running clean-room evaluation.`,
        );
        evaluationResult = await runCleanRoomEvaluation({
          preparedBaselinePath: preparedBaseline.path,
          ...(preparedBaseline.baselineCommit
            ? { preparedBaselineCommit: preparedBaseline.baselineCommit }
            : {}),
          evaluationWorkspacePath: workspaceLayout.evaluationWorkspacePath,
          configDir: context.configDir,
          benchmark: item.benchmark,
          repositoryEnvironment: context.config.repository_environment,
          submission: agentResult.submission,
          artifactsDir: attemptLayout.evaluationArtifactsPath,
          overwrite: true,
        });
      }

      const attemptReport = createAttemptReport({
        runId: layout.runId,
        runRootPath: layout.runRootPath,
        attemptLayout,
        benchmark: item.benchmark,
        model: item.model,
        agentResult,
        timingsMs: createAttemptTimings(attemptStartedAtMs, agentResult, evaluationResult),
        ...(evaluationResult ? { evaluationResult } : {}),
      });
      await mkdir(path.dirname(attemptLayout.attemptJsonPath), { recursive: true });
      await writeFile(attemptLayout.attemptJsonPath, `${JSON.stringify(attemptReport, null, 2)}\n`);
      attempts.push(attemptReport);
      await writeRunEvent(layout.eventsPath, {
        type: "attempt_completed",
        benchmark_id: item.benchmark.id,
        model_id: item.model.id,
        attempt: 1,
        status: attemptReport.status,
      });
      await writeCurrentArtifacts("running");
    }

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
  readonly modelId: string;
}): { readonly agentWorkspacePath: string; readonly evaluationWorkspacePath: string } {
  const rootPath = path.join(
    options.workspaceRootPath,
    sanitizePathSegment(options.workspaceKey),
    sanitizePathSegment(options.modelId),
  );
  return {
    agentWorkspacePath: path.join(rootPath, "agent"),
    evaluationWorkspacePath: path.join(rootPath, "evaluation"),
  };
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function createAttemptReport(options: {
  readonly runId: string;
  readonly runRootPath: string;
  readonly attemptLayout: {
    readonly attemptJsonPath: string;
    readonly candidatePatchPath: string;
    readonly changedFilesPath: string;
  };
  readonly benchmark: Parameters<typeof runPiJsonAgentAttempt>[0]["benchmark"];
  readonly model: Parameters<typeof runPiJsonAgentAttempt>[0]["model"];
  readonly agentResult: Awaited<ReturnType<typeof runPiJsonAgentAttempt>>;
  readonly evaluationResult?: Awaited<ReturnType<typeof runCleanRoomEvaluation>> | undefined;
  readonly timingsMs: NonNullable<AttemptReport["timings_ms"]>;
}): AttemptReport {
  const status = classifyAttemptStatus(options.agentResult.ok, options.evaluationResult?.ok);
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
    benchmark_type: options.benchmark.type,
    task: options.benchmark.task,
    attempt: 1,
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

function classifyAttemptStatus(agentOk: boolean, evaluationOk: boolean | undefined): AttemptStatus {
  if (!agentOk) {
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
  const byBenchmark = new Map<string, string[]>();
  for (const attempt of options.attempts) {
    const list = byBenchmark.get(attempt.benchmark_id) ?? [];
    list.push(attempt.artifacts.attempt_json ?? "");
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
      passed: options.attempts.filter((attempt) => attempt.evaluation?.verdict === "passed").length,
      needs_review: options.attempts.filter(
        (attempt) => attempt.evaluation?.verdict === "needs_review",
      ).length,
      failed: options.attempts.filter((attempt) => attempt.evaluation?.verdict === "failed").length,
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
      attempts,
      duration_ms: options.attempts
        .filter((attempt) => attempt.benchmark_id === benchmark_id)
        .reduce((total, attempt) => total + (attempt.timings_ms?.total_ms ?? 0), 0),
    })),
    artifacts: {
      report_html: toRunRelativePath(options.runRootPath, options.reportPath),
      events_jsonl: toRunRelativePath(options.runRootPath, options.eventsPath),
    },
  };
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
