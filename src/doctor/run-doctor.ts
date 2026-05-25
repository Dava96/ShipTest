import { randomUUID } from "node:crypto";
import { cp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { PreparedBaselineCheck } from "../baseline/check-codes.js";
import {
  prepareBaselineFromWorkspace,
  restorePreparedBaselineFromCache,
} from "../baseline/prepared-baseline.js";
import { CheckSeverity } from "../checks/severity.js";
import type { ShiptestConfigContext } from "../config/load-config.js";
import { resolveConfigRelativePath } from "../config/paths.js";
import { CommandsRunIn } from "../config/schema-values.js";
import { runShellCommand } from "../execution/run-command.js";
import { buildSnapshot } from "../snapshot/build-snapshot.js";
import type { BuildSnapshotOptions, SnapshotCheck } from "../snapshot/types.js";
import {
  isFilesystemRoot,
  pathExists,
  safeRemoveDescendant,
  samePath,
} from "../utils/filesystem.js";
import { sha256Json } from "../utils/hash.js";
import { type DoctorCheck, DoctorCheckCode } from "./check-codes.js";
import {
  type DoctorBaselineResult,
  type DoctorBenchmarkResult,
  type DoctorCommandResult,
  DoctorDefaults,
  type DoctorOptions,
  type DoctorProgressEvent,
  type DoctorResult,
  type DoctorTimings,
} from "./types.js";

const DefaultShiptestVersion = "0.1.0";
const BaselineIdentityHashLength = 12;

type MutableDoctorTimings = {
  -readonly [Key in keyof DoctorTimings]: DoctorTimings[Key];
};

interface DoctorBaselineGroup {
  readonly baseline_id: string;
  readonly identity_hash: string;
  readonly base_ref: string;
  readonly representative_benchmark_id: string;
  readonly benchmark_ids: readonly string[];
  readonly identity: unknown;
}

export async function runDoctor(
  context: ShiptestConfigContext,
  options: DoctorOptions,
): Promise<DoctorResult> {
  options.onProgress?.({ phase: "started", message: "ShipTest doctor starting." });
  const outputRootPath = path.resolve(options.outputRootPath);
  const repoPath = resolveConfigRelativePath(context.configDir, context.config.project.repo);
  validateDoctorOutputPath(outputRootPath, repoPath);

  const selectedBenchmarkIds =
    options.benchmarkIds ?? (options.benchmarkId ? [options.benchmarkId] : undefined);
  const selectedBenchmarkIdSet = selectedBenchmarkIds ? new Set(selectedBenchmarkIds) : undefined;
  const benchmarks = selectedBenchmarkIdSet
    ? context.config.benchmarks.filter((benchmark) => selectedBenchmarkIdSet.has(benchmark.id))
    : context.config.benchmarks;
  for (const benchmarkId of selectedBenchmarkIds ?? []) {
    if (!context.config.benchmarks.some((benchmark) => benchmark.id === benchmarkId)) {
      throw new Error(`Unknown benchmark id: ${benchmarkId}`);
    }
  }

  await mkdir(outputRootPath, { recursive: true });
  const workspaceRootPath = path.join(os.tmpdir(), "shiptest-doctor-work", randomUUID());
  const baselineGroups = createDoctorBaselineGroups(context, benchmarks, options);
  const baselineResults = await runOrderedConcurrent(
    baselineGroups,
    options.concurrency ?? 1,
    async (baselineGroup) => {
      const baselineResult = await runBaselineDoctor(context, baselineGroup, {
        ...options,
        outputRootPath,
        workspaceRootPath,
      });
      await writeBaselineDoctorResult(outputRootPath, baselineResult);
      return baselineResult;
    },
  );
  const baselineResultsById = new Map(
    baselineResults.map((baselineResult) => [baselineResult.baseline_id, baselineResult]),
  );
  const baselineGroupByBenchmarkId = new Map<string, DoctorBaselineGroup>();
  for (const baselineGroup of baselineGroups) {
    for (const benchmarkId of baselineGroup.benchmark_ids) {
      baselineGroupByBenchmarkId.set(benchmarkId, baselineGroup);
    }
  }
  const benchmarkResults = benchmarks.map((benchmark) => {
    const baselineGroup = baselineGroupByBenchmarkId.get(benchmark.id);
    if (!baselineGroup) {
      throw new Error(`Baseline group missing for benchmark '${benchmark.id}'.`);
    }
    const baselineResult = baselineResultsById.get(baselineGroup.baseline_id);
    if (!baselineResult) {
      throw new Error(`Baseline result missing for benchmark '${benchmark.id}'.`);
    }
    return createBenchmarkDoctorResultFromBaseline(benchmark.id, baselineResult);
  });
  for (const benchmarkResult of benchmarkResults) {
    await writeBenchmarkDoctorResult(outputRootPath, benchmarkResult);
  }

  const result: DoctorResult = {
    ok:
      baselineResults.every((baselineResult) => baselineResult.ok) &&
      benchmarkResults.every((benchmarkResult) => benchmarkResult.ok),
    baseline_results: baselineResults,
    benchmark_results: benchmarkResults,
  };
  await writeFile(
    path.join(outputRootPath, "doctor-result.json"),
    `${JSON.stringify(createDoctorResultIndex(result), null, 2)}\n`,
  );
  return result;
}

async function runBaselineDoctor(
  context: ShiptestConfigContext,
  baselineGroup: DoctorBaselineGroup,
  options: DoctorOptions & { readonly workspaceRootPath: string },
): Promise<DoctorBaselineResult> {
  const benchmarkId = baselineGroup.representative_benchmark_id;
  const benchmark = context.config.benchmarks.find((candidate) => candidate.id === benchmarkId);
  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  const startedAt = Date.now();
  const timings = createEmptyTimings();
  const baselineOutputPath = baselineDoctorOutputPath(
    options.outputRootPath,
    baselineGroup.baseline_id,
  );
  if (await pathExists(baselineOutputPath)) {
    await safeRemoveDescendant(options.outputRootPath, baselineOutputPath);
  }
  await mkdir(baselineOutputPath, { recursive: true });

  const checks: Array<DoctorCheck | SnapshotCheck | PreparedBaselineCheck> = [
    {
      code: DoctorCheckCode.BenchmarkStarted,
      severity: CheckSeverity.Pass,
      message: `Started doctor checks for baseline '${baselineGroup.baseline_id}'.`,
    },
  ];
  const commands: DoctorCommandResult[] = [];
  const benchmarkWorkspacePath = path.join(
    options.workspaceRootPath,
    "baselines",
    baselineGroup.baseline_id,
  );
  const snapshotOutputPath = path.join(benchmarkWorkspacePath, "snapshot");
  const setupWorkspacePath = path.join(benchmarkWorkspacePath, "setup-workspace");
  const preparedWorkspacePath = path.join(benchmarkWorkspacePath, "prepared-baseline");
  const cacheRootPath =
    options.cacheRootPath ??
    path.join(path.dirname(options.outputRootPath), DoctorDefaults.DefaultCacheDirectoryName);

  emitProgress(options, benchmarkId, "snapshot", "Building sanitized snapshot.");
  const snapshotResult = await measureTiming(timings, "snapshot_ms", () =>
    buildSnapshotSafely(
      createBuildSnapshotOptions(context, benchmarkId, snapshotOutputPath, options.snapshotSource),
    ),
  );
  checks.push(...snapshotResult.checks);
  if (!snapshotResult.ok) {
    checks.push({
      code: DoctorCheckCode.SnapshotFailed,
      severity: CheckSeverity.Error,
      message: "Snapshot gate failed during doctor checks.",
    });
    emitProgress(options, benchmarkId, "failed", "Snapshot gate failed.");
    return {
      baseline_id: baselineGroup.baseline_id,
      benchmark_ids: baselineGroup.benchmark_ids,
      ok: false,
      timings_ms: finishTimings(timings, startedAt),
      commands,
      checks,
    };
  }

  checks.push({
    code: DoctorCheckCode.SnapshotBuilt,
    severity: CheckSeverity.Pass,
    message: "Snapshot gate passed during doctor checks.",
    paths: [snapshotResult.agent_snapshot_path],
  });

  const cacheKeyInput = {
    snapshot_manifest_sha256: snapshotResult.manifest.manifest_sha256,
    repository_environment: context.config.repository_environment,
    prepared_baseline: context.config.shiptest_runner.prepared_baseline,
    shiptest_version: options.shiptestVersion ?? DefaultShiptestVersion,
  };

  const cacheEnabled = context.config.shiptest_runner.prepared_baseline.cache && !options.noCache;
  if (cacheEnabled) {
    emitProgress(options, benchmarkId, "cache", "Checking prepared baseline cache.");
    const cacheRestoreResult = await measureTiming(timings, "cache_restore_ms", () =>
      restorePreparedBaselineFromCache({
        preparedWorkspacePath,
        cacheRootPath,
        cacheKeyInput,
        cacheLabel: baselineGroup.baseline_id,
      }),
    );
    checks.push(...cacheRestoreResult.checks);
    if (cacheRestoreResult.ok) {
      emitProgress(options, benchmarkId, "cache", "Cache hit; skipping setup and validation.");
      checks.push({
        code: DoctorCheckCode.CacheUsed,
        severity: CheckSeverity.Pass,
        message: "Prepared baseline cache was used; setup and validation were skipped.",
        paths: [cacheRestoreResult.cache_entry_path],
      });
      return {
        baseline_id: baselineGroup.baseline_id,
        benchmark_ids: baselineGroup.benchmark_ids,
        ok: true,
        timings_ms: finishTimings(timings, startedAt),
        snapshot_manifest: snapshotResult.manifest,
        prepared_baseline_path: preparedWorkspacePath,
        prepared_baseline_metadata: cacheRestoreResult.metadata,
        commands,
        checks,
      };
    }
  }

  if (!cacheEnabled) {
    emitProgress(
      options,
      benchmarkId,
      "cache",
      "Prepared baseline cache disabled for this doctor run.",
    );
  }

  if (context.config.repository_environment.commands_run_in !== CommandsRunIn.ShiptestEnvironment) {
    checks.push({
      code: DoctorCheckCode.EnvironmentUnsupported,
      severity: CheckSeverity.Error,
      message:
        "Doctor currently supports repository_environment.commands_run_in: shiptest_environment only.",
    });
    emitProgress(options, benchmarkId, "failed", "Repository environment is not supported yet.");
    return {
      baseline_id: baselineGroup.baseline_id,

      benchmark_ids: baselineGroup.benchmark_ids,
      ok: false,
      timings_ms: finishTimings(timings, startedAt),
      snapshot_manifest: snapshotResult.manifest,
      commands,
      checks,
    };
  }

  await cp(snapshotResult.agent_snapshot_path, setupWorkspacePath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  for (const command of context.config.repository_environment.setup_commands) {
    emitProgress(options, benchmarkId, "setup", `Running setup command: ${command}`);
    const commandResult = await measureTiming(timings, "setup_ms", () =>
      runShellCommand({
        command,
        cwd: setupWorkspacePath,
        maxOutputBytes: options.commandOutputMaxBytes ?? DoctorDefaults.CommandOutputMaxBytes,
      }),
    );
    const doctorCommandResult = { ...commandResult, phase: "setup" as const };
    commands.push(doctorCommandResult);
    checks.push(
      commandCheck(doctorCommandResult, DoctorCheckCode.SetupPassed, DoctorCheckCode.SetupFailed),
    );
    if (doctorCommandResult.exit_code !== 0) {
      emitProgress(options, benchmarkId, "failed", `Setup command failed: ${command}`);
      return {
        baseline_id: baselineGroup.baseline_id,

        benchmark_ids: baselineGroup.benchmark_ids,
        ok: false,
        timings_ms: finishTimings(timings, startedAt),
        snapshot_manifest: snapshotResult.manifest,
        commands,
        checks,
      };
    }
  }

  for (const command of context.config.repository_environment.validation_commands.required) {
    emitProgress(
      options,
      benchmarkId,
      "required_validation",
      `Running required validation command: ${command}`,
    );
    const commandResult = await measureTiming(timings, "required_validation_ms", () =>
      runShellCommand({
        command,
        cwd: setupWorkspacePath,
        maxOutputBytes: options.commandOutputMaxBytes ?? DoctorDefaults.CommandOutputMaxBytes,
      }),
    );
    const doctorCommandResult = { ...commandResult, phase: "required_validation" as const };
    commands.push(doctorCommandResult);
    checks.push(
      commandCheck(
        doctorCommandResult,
        DoctorCheckCode.RequiredValidationPassed,
        DoctorCheckCode.RequiredValidationFailed,
      ),
    );
    if (doctorCommandResult.exit_code !== 0) {
      emitProgress(
        options,
        benchmarkId,
        "failed",
        `Required validation command failed: ${command}`,
      );
      return {
        baseline_id: baselineGroup.baseline_id,

        benchmark_ids: baselineGroup.benchmark_ids,
        ok: false,
        timings_ms: finishTimings(timings, startedAt),
        snapshot_manifest: snapshotResult.manifest,
        commands,
        checks,
      };
    }
  }

  for (const command of context.config.repository_environment.validation_commands.advisory) {
    emitProgress(
      options,
      benchmarkId,
      "advisory_validation",
      `Running advisory validation command: ${command}`,
    );
    const commandResult = await measureTiming(timings, "advisory_validation_ms", () =>
      runShellCommand({
        command,
        cwd: setupWorkspacePath,
        maxOutputBytes: options.commandOutputMaxBytes ?? DoctorDefaults.CommandOutputMaxBytes,
      }),
    );
    const doctorCommandResult = { ...commandResult, phase: "advisory_validation" as const };
    commands.push(doctorCommandResult);
    checks.push(
      commandCheck(
        doctorCommandResult,
        DoctorCheckCode.AdvisoryValidationPassed,
        DoctorCheckCode.AdvisoryValidationFailed,
        true,
      ),
    );
  }

  emitProgress(options, benchmarkId, "prepare_baseline", "Preparing baseline workspace.");
  const preparedBaselineResult = await measureTiming(timings, "prepare_baseline_ms", () =>
    prepareBaselineFromWorkspace({
      sourceWorkspacePath: setupWorkspacePath,
      preparedWorkspacePath,
      snapshotManifest: snapshotResult.manifest,
      cacheEnabled,
      ...(cacheEnabled ? { cacheRootPath } : {}),
      cacheLabel: baselineGroup.baseline_id,
      cacheKeyInput,
    }),
  );
  checks.push(...preparedBaselineResult.checks);
  if (!preparedBaselineResult.ok) {
    emitProgress(options, benchmarkId, "failed", "Prepared baseline gate failed.");
    return {
      baseline_id: baselineGroup.baseline_id,

      benchmark_ids: baselineGroup.benchmark_ids,
      ok: false,
      timings_ms: finishTimings(timings, startedAt),
      snapshot_manifest: snapshotResult.manifest,
      commands,
      checks,
    };
  }

  checks.push({
    code: DoctorCheckCode.BaselinePrepared,
    severity: CheckSeverity.Pass,
    message: "Prepared baseline gate passed during doctor checks.",
    paths: [preparedWorkspacePath],
  });

  emitProgress(options, benchmarkId, "passed", "Doctor checks passed.");
  return {
    baseline_id: baselineGroup.baseline_id,

    benchmark_ids: baselineGroup.benchmark_ids,
    ok: true,
    timings_ms: finishTimings(timings, startedAt),
    snapshot_manifest: snapshotResult.manifest,
    prepared_baseline_path: preparedWorkspacePath,
    prepared_baseline_metadata: preparedBaselineResult.metadata,
    prepared_baseline_timings_ms: preparedBaselineResult.timings_ms,
    commands,
    checks,
  };
}

async function buildSnapshotSafely(options: BuildSnapshotOptions) {
  try {
    return await buildSnapshot(options);
  } catch (error) {
    return {
      ok: false as const,
      checks: [
        {
          code: DoctorCheckCode.SnapshotFailed,
          severity: CheckSeverity.Error,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function writeBaselineDoctorResult(
  outputRootPath: string,
  baselineResult: DoctorBaselineResult,
): Promise<void> {
  const outputPath = baselineDoctorOutputPath(outputRootPath, baselineResult.baseline_id);
  await mkdir(outputPath, { recursive: true });
  await writeFile(
    path.join(outputPath, "baseline-result.json"),
    `${JSON.stringify(baselineResult, null, 2)}\n`,
    "utf8",
  );
}

async function writeBenchmarkDoctorResult(
  outputRootPath: string,
  benchmarkResult: DoctorBenchmarkResult,
): Promise<void> {
  const outputPath = benchmarkDoctorOutputPath(outputRootPath, benchmarkResult.benchmark_id);
  await mkdir(outputPath, { recursive: true });
  await writeFile(
    path.join(outputPath, "doctor-result.json"),
    `${JSON.stringify(benchmarkResult, null, 2)}\n`,
    "utf8",
  );
}

function createDoctorResultIndex(result: DoctorResult): object {
  return {
    ok: result.ok,
    baseline_results: result.baseline_results.map((baselineResult) => ({
      baseline_id: baselineResult.baseline_id,
      benchmark_ids: baselineResult.benchmark_ids,
      ok: baselineResult.ok,
      timings_ms: baselineResult.timings_ms,
      baseline_result: baselineResultRelativePath(baselineResult.baseline_id),
    })),
    benchmark_results: result.benchmark_results.map((benchmarkResult) => ({
      benchmark_id: benchmarkResult.benchmark_id,
      ok: benchmarkResult.ok,
      baseline_id: benchmarkResult.baseline_id,
      baseline_result: benchmarkResult.baseline_result,
      timings_ms: benchmarkResult.timings_ms,
      doctor_result: path
        .join("benchmarks", sanitizePathSegment(benchmarkResult.benchmark_id), "doctor-result.json")
        .replaceAll(path.sep, "/"),
    })),
  };
}

function createBenchmarkDoctorResultFromBaseline(
  benchmarkId: string,
  baselineResult: DoctorBaselineResult,
): DoctorBenchmarkResult {
  return {
    benchmark_id: benchmarkId,
    ok: baselineResult.ok,
    baseline_id: baselineResult.baseline_id,
    baseline_result: baselineResultRelativePath(baselineResult.baseline_id),
    timings_ms: baselineResult.timings_ms,
    ...(baselineResult.snapshot_manifest
      ? { snapshot_manifest: baselineResult.snapshot_manifest }
      : {}),
    ...(baselineResult.prepared_baseline_path
      ? { prepared_baseline_path: baselineResult.prepared_baseline_path }
      : {}),
    ...(baselineResult.prepared_baseline_metadata
      ? { prepared_baseline_metadata: baselineResult.prepared_baseline_metadata }
      : {}),
    ...(baselineResult.prepared_baseline_timings_ms
      ? { prepared_baseline_timings_ms: baselineResult.prepared_baseline_timings_ms }
      : {}),
    commands: baselineResult.commands,
    checks: baselineResult.checks,
  };
}

function benchmarkDoctorOutputPath(outputRootPath: string, benchmarkId: string): string {
  return path.join(outputRootPath, "benchmarks", sanitizePathSegment(benchmarkId));
}

function baselineDoctorOutputPath(outputRootPath: string, baselineId: string): string {
  return path.join(outputRootPath, "baselines", sanitizePathSegment(baselineId));
}

function baselineResultRelativePath(baselineId: string): string {
  return path
    .join("baselines", sanitizePathSegment(baselineId), "baseline-result.json")
    .replaceAll(path.sep, "/");
}

function sanitizePathSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

function createBuildSnapshotOptions(
  context: ShiptestConfigContext,
  benchmarkId: string,
  outputRootPath: string,
  snapshotSource: BuildSnapshotOptions["source"] = "git_commit",
): BuildSnapshotOptions {
  const benchmark = context.config.benchmarks.find((candidate) => candidate.id === benchmarkId);
  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  return createBaselineBuildSnapshotOptions(
    context,
    benchmark.base_commit,
    outputRootPath,
    snapshotSource,
  );
}

function createBaselineBuildSnapshotOptions(
  context: ShiptestConfigContext,
  baseCommit: string | undefined,
  outputRootPath: string,
  snapshotSource: BuildSnapshotOptions["source"] = "git_commit",
): BuildSnapshotOptions {
  const baselineAgentContext = {
    exclude_paths: [],
    instruction_files: [],
    load_context_files: false,
  };
  const baselineEvaluation = {
    ...context.config.defaults.evaluation,
    clean_room: true as const,
    hidden_evaluation_files: [],
    hidden_evaluation_directories: [],
    hidden_evaluation_patches: [],
    protected_paths: [],
  };
  return {
    source_repo_path: resolveConfigRelativePath(context.configDir, context.config.project.repo),
    ...(snapshotSource === "git_commit" && baseCommit ? { base_commit: baseCommit } : {}),
    output_root_path: path.resolve(outputRootPath),
    shiptest_config_dir: context.configDir,
    snapshot: context.config.snapshot,
    agent_context: baselineAgentContext,
    evaluation: baselineEvaluation,
    source: snapshotSource,
  };
}

function createDoctorBaselineGroups(
  context: ShiptestConfigContext,
  benchmarks: readonly ShiptestConfigContext["config"]["benchmarks"][number][],
  options: Pick<DoctorOptions, "shiptestVersion" | "snapshotSource">,
): DoctorBaselineGroup[] {
  const groups = new Map<string, DoctorBaselineGroup>();
  for (const benchmark of benchmarks) {
    const baseRef =
      options.snapshotSource === "working_tree"
        ? "working-tree"
        : (benchmark.base_commit ?? "head");
    const identity = {
      source: options.snapshotSource ?? "git_commit",
      base_commit:
        options.snapshotSource === "working_tree" ? undefined : (benchmark.base_commit ?? "HEAD"),
      snapshot: context.config.snapshot,
      repository_environment: context.config.repository_environment,
      prepared_baseline: context.config.shiptest_runner.prepared_baseline,
      shiptest_version: options.shiptestVersion ?? DefaultShiptestVersion,
    };
    const identityHash = sha256Json(identity).slice(0, BaselineIdentityHashLength);
    const baselineId = `${formatBaselineBaseRef(baseRef)}--${identityHash}`;
    const existing = groups.get(identityHash);
    if (existing) {
      groups.set(identityHash, {
        ...existing,
        benchmark_ids: [...existing.benchmark_ids, benchmark.id],
      });
      continue;
    }
    groups.set(identityHash, {
      baseline_id: baselineId,
      identity_hash: identityHash,
      base_ref: baseRef,
      representative_benchmark_id: benchmark.id,
      benchmark_ids: [benchmark.id],
      identity,
    });
  }
  return [...groups.values()];
}

function formatBaselineBaseRef(baseRef: string): string {
  const sanitized = sanitizePathSegment(baseRef);
  return /^[a-f0-9]{12,40}$/i.test(sanitized) ? sanitized.slice(0, 7) : sanitized.slice(0, 40);
}

function createEmptyTimings(): MutableDoctorTimings {
  return {
    total_ms: 0,
    snapshot_ms: 0,
    cache_restore_ms: 0,
    setup_ms: 0,
    required_validation_ms: 0,
    advisory_validation_ms: 0,
    prepare_baseline_ms: 0,
  };
}

async function measureTiming<T>(
  timings: MutableDoctorTimings,
  key: Exclude<keyof DoctorTimings, "total_ms">,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[key] += Date.now() - startedAt;
  }
}

function finishTimings(timings: MutableDoctorTimings, startedAt: number): DoctorTimings {
  return {
    ...timings,
    total_ms: Date.now() - startedAt,
  };
}

async function runOrderedConcurrent<T, Result>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(items[index] as T);
      }
    }),
  );

  return results;
}

function commandCheck(
  commandResult: DoctorCommandResult,
  passedCode: DoctorCheckCode,
  failedCode: DoctorCheckCode,
  advisory = false,
) {
  const passed = commandResult.exit_code === 0;
  return {
    code: passed ? passedCode : failedCode,
    severity: passed ? CheckSeverity.Pass : advisory ? CheckSeverity.Warning : CheckSeverity.Error,
    message: `${commandResult.phase} command ${passed ? "passed" : "failed"}: ${commandResult.command}`,
  };
}

function emitProgress(
  options: Pick<DoctorOptions, "onProgress">,
  benchmarkId: string,
  phase: DoctorProgressEvent["phase"],
  message: string,
): void {
  options.onProgress?.({ benchmark_id: benchmarkId, phase, message });
}

function validateDoctorOutputPath(outputRootPath: string, repoPath: string): void {
  if (isFilesystemRoot(outputRootPath)) {
    throw new Error("Doctor output path must not be a filesystem root.");
  }
  if (samePath(outputRootPath, repoPath)) {
    throw new Error("Doctor output path must not be the source repository.");
  }
  if (samePath(outputRootPath, process.cwd())) {
    throw new Error("Doctor output path must not be the current working directory.");
  }
}
