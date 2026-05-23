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
import { type DoctorCheck, DoctorCheckCode } from "./check-codes.js";
import {
  type DoctorBenchmarkResult,
  type DoctorCommandResult,
  DoctorDefaults,
  type DoctorOptions,
  type DoctorProgressEvent,
  type DoctorResult,
  type DoctorTimings,
} from "./types.js";

const DefaultShiptestVersion = "0.1.0";

type MutableDoctorTimings = {
  -readonly [Key in keyof DoctorTimings]: DoctorTimings[Key];
};

export async function runDoctor(
  context: ShiptestConfigContext,
  options: DoctorOptions,
): Promise<DoctorResult> {
  options.onProgress?.({ phase: "started", message: "ShipTest doctor starting." });
  const outputRootPath = path.resolve(options.outputRootPath);
  const repoPath = resolveConfigRelativePath(context.configDir, context.config.project.repo);
  validateDoctorOutputPath(outputRootPath, repoPath);

  const selectedBenchmarkIds =
    options.benchmarkSelections?.map((selection) => selection.benchmarkId) ??
    options.benchmarkIds ??
    (options.benchmarkId ? [options.benchmarkId] : undefined);
  const selectedBenchmarkIdSet = selectedBenchmarkIds ? new Set(selectedBenchmarkIds) : undefined;
  const benchmarks = selectedBenchmarkIdSet
    ? context.config.benchmarks.filter((benchmark) => selectedBenchmarkIdSet.has(benchmark.id))
    : context.config.benchmarks;
  for (const benchmarkId of selectedBenchmarkIds ?? []) {
    if (!context.config.benchmarks.some((benchmark) => benchmark.id === benchmarkId)) {
      throw new Error(`Unknown benchmark id: ${benchmarkId}`);
    }
  }
  const doctorSelections =
    options.benchmarkSelections ??
    benchmarks.flatMap((benchmark) =>
      benchmark.base_commits.map((baseCommit) => ({ benchmarkId: benchmark.id, baseCommit })),
    );

  await mkdir(outputRootPath, { recursive: true });
  const workspaceRootPath = path.join(os.tmpdir(), "shiptest-doctor-work", randomUUID());
  const benchmarkResults: DoctorBenchmarkResult[] = [];
  for (const selection of doctorSelections) {
    const benchmarkResult = await runBenchmarkDoctor(context, selection.benchmarkId, {
      ...options,
      baseCommit: selection.baseCommit,
      outputRootPath,
      workspaceRootPath,
    });
    benchmarkResults.push(benchmarkResult);
    await writeBenchmarkDoctorResult(outputRootPath, benchmarkResult);
  }

  const result: DoctorResult = {
    ok: benchmarkResults.every((benchmarkResult) => benchmarkResult.ok),
    benchmark_results: benchmarkResults,
  };
  await writeFile(
    path.join(outputRootPath, "doctor-result.json"),
    `${JSON.stringify(createDoctorResultIndex(result), null, 2)}\n`,
  );
  return result;
}

async function runBenchmarkDoctor(
  context: ShiptestConfigContext,
  benchmarkId: string,
  options: DoctorOptions & {
    readonly workspaceRootPath: string;
    readonly baseCommit?: NonNullable<DoctorBenchmarkResult["base_commit"]>;
  },
): Promise<DoctorBenchmarkResult> {
  const benchmark = context.config.benchmarks.find((candidate) => candidate.id === benchmarkId);
  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  const startedAt = Date.now();
  const timings = createEmptyTimings();
  const benchmarkOutputPath = benchmarkDoctorOutputPath(options.outputRootPath, benchmarkId);
  if (await pathExists(benchmarkOutputPath)) {
    await safeRemoveDescendant(options.outputRootPath, benchmarkOutputPath);
  }
  await mkdir(benchmarkOutputPath, { recursive: true });

  const checks: Array<DoctorCheck | SnapshotCheck | PreparedBaselineCheck> = [
    {
      code: DoctorCheckCode.BenchmarkStarted,
      severity: CheckSeverity.Pass,
      message: `Started doctor checks for benchmark '${benchmarkId}'.`,
    },
  ];
  const commands: DoctorCommandResult[] = [];
  const benchmarkWorkspacePath = path.join(
    options.workspaceRootPath,
    benchmarkId,
    options.baseCommit?.slug ?? "default",
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
      createBuildSnapshotOptions(
        context,
        benchmarkId,
        snapshotOutputPath,
        options.snapshotSource,
        options.baseCommit?.commit,
      ),
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
      benchmark_id: benchmarkId,
      ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
        cacheLabel: benchmarkId,
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
        benchmark_id: benchmarkId,
        ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
      benchmark_id: benchmarkId,
      ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
        benchmark_id: benchmarkId,
        ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
        benchmark_id: benchmarkId,
        ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
      cacheLabel: benchmarkId,
      cacheKeyInput,
    }),
  );
  checks.push(...preparedBaselineResult.checks);
  if (!preparedBaselineResult.ok) {
    emitProgress(options, benchmarkId, "failed", "Prepared baseline gate failed.");
    return {
      benchmark_id: benchmarkId,
      ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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
    benchmark_id: benchmarkId,
    ...(options.baseCommit ? { base_commit: options.baseCommit } : {}),
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

async function writeBenchmarkDoctorResult(
  outputRootPath: string,
  benchmarkResult: DoctorBenchmarkResult,
): Promise<void> {
  const outputPath = benchmarkDoctorOutputPath(
    outputRootPath,
    benchmarkResult.benchmark_id,
    benchmarkResult.base_commit?.slug,
  );
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
    benchmark_results: result.benchmark_results.map((benchmarkResult) => ({
      benchmark_id: benchmarkResult.benchmark_id,
      ok: benchmarkResult.ok,
      timings_ms: benchmarkResult.timings_ms,
      ...(benchmarkResult.base_commit ? { base_commit: benchmarkResult.base_commit } : {}),
      doctor_result: doctorResultRelativePath(benchmarkResult),
    })),
  };
}

function benchmarkDoctorOutputPath(
  outputRootPath: string,
  benchmarkId: string,
  baseCommitSlug?: string,
): string {
  return path.join(
    outputRootPath,
    "benchmarks",
    sanitizePathSegment(benchmarkId),
    ...(baseCommitSlug ? ["base-commits", sanitizePathSegment(baseCommitSlug)] : []),
  );
}

function doctorResultRelativePath(benchmarkResult: DoctorBenchmarkResult): string {
  return path
    .join(
      "benchmarks",
      sanitizePathSegment(benchmarkResult.benchmark_id),
      ...(benchmarkResult.base_commit
        ? ["base-commits", sanitizePathSegment(benchmarkResult.base_commit.slug)]
        : []),
      "doctor-result.json",
    )
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
  baseCommit?: string,
): BuildSnapshotOptions {
  const benchmark = context.config.benchmarks.find((candidate) => candidate.id === benchmarkId);
  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${benchmarkId}`);
  }

  const resolvedBaseCommit = baseCommit ?? benchmark.base_commit;
  return {
    source_repo_path: resolveConfigRelativePath(context.configDir, context.config.project.repo),
    ...(snapshotSource === "git_commit" && resolvedBaseCommit
      ? { base_commit: resolvedBaseCommit }
      : {}),
    output_root_path: path.resolve(outputRootPath),
    shiptest_config_dir: context.configDir,
    snapshot: context.config.snapshot,
    agent_context: benchmark.agent_context,
    evaluation: benchmark.evaluation,
    source: snapshotSource,
  };
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
