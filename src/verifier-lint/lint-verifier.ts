import { readFile } from "node:fs/promises";
import path from "node:path";

import { getBenchmarkPolicy, hasHiddenVerifier } from "../benchmark/policy.js";
import type { ShiptestConfigContext } from "../config/load-config.js";
import { resolveConfigRelativePath } from "../config/paths.js";
import { BenchmarkType } from "../config/schema-values.js";
import { walkFiles } from "../utils/filesystem.js";
import { VerifierLintCheckCode } from "./check-codes.js";
import type {
  VerifierLintBenchmarkResult,
  VerifierLintCheck,
  VerifierLintChecklistItem,
  VerifierLintResult,
} from "./types.js";

interface VerifierLintOptions {
  readonly benchmarkIds?: readonly string[];
}

type Benchmark = ShiptestConfigContext["config"]["benchmarks"][number];

interface HiddenSource {
  readonly shiptestPath: string;
  readonly text: string;
}

interface HiddenVerifierMaterial {
  readonly sources: readonly HiddenSource[];
  readonly repositoryPaths: readonly string[];
  readonly checks: readonly VerifierLintCheck[];
  readonly resetPatchTouchedPaths: readonly string[];
}

const ManualVerifierChecklist: readonly VerifierLintChecklistItem[] = [
  {
    id: "prompt_alignment",
    prompt: "Does the hidden verifier test the requirement stated in the task?",
  },
  {
    id: "accepts_reasonable_alternatives",
    prompt:
      "Would it accept another reasonable solution to the task, not only the reference patch?",
  },
  {
    id: "specific_interface_intentional",
    prompt:
      "If it checks a specific function, schema, or internal module, is that interface part of the task contract?",
  },
  {
    id: "positive_and_negative_cases",
    prompt: "Does it include success and failure/regression cases where applicable?",
  },
  {
    id: "regression_coverage",
    prompt: "Does scoring also run enough existing regression, typecheck, lint, or build coverage?",
  },
] as const;

export async function lintVerifier(
  context: ShiptestConfigContext,
  options: VerifierLintOptions = {},
): Promise<VerifierLintResult> {
  const benchmarks = selectedBenchmarks(context.config.benchmarks, options.benchmarkIds);
  const benchmarkResults = await Promise.all(
    benchmarks.map((benchmark) => lintBenchmarkVerifier(context, benchmark)),
  );
  const allChecks = benchmarkResults.flatMap((result) => result.checks);
  const warnings = allChecks.filter((check) => check.severity === "warning").length;
  return {
    schema_version: 1,
    status: warnings > 0 ? "warnings" : "passed",
    summary: {
      benchmarks: benchmarkResults.length,
      warnings,
      passes: allChecks.filter((check) => check.severity === "pass").length,
      info: allChecks.filter((check) => check.severity === "info").length,
    },
    benchmark_results: benchmarkResults,
  };
}

export function formatVerifierLintResult(result: VerifierLintResult): string {
  const lines = ["ShipTest verifier QA: advisory warnings only", ""];
  if (result.benchmark_results.length === 0) {
    lines.push("No benchmarks matched.");
    return lines.join("\n");
  }

  for (const benchmarkResult of result.benchmark_results) {
    lines.push(benchmarkResult.benchmark_id);
    for (const check of benchmarkResult.checks) {
      lines.push(`  ${severityMarker(check.severity)} ${check.message}`);
      if (check.paths && check.paths.length > 0) {
        lines.push(`    paths: ${check.paths.join(", ")}`);
      }
    }
    if (benchmarkResult.checklist.length > 0) {
      lines.push("", "  Manual checklist:");
      for (const item of benchmarkResult.checklist) {
        lines.push(`  [ ] ${item.prompt}`);
      }
    }
    lines.push("");
  }

  lines.push(
    `Summary: ${result.summary.benchmarks} benchmark${result.summary.benchmarks === 1 ? "" : "s"}, ${result.summary.warnings} warning${result.summary.warnings === 1 ? "" : "s"}.`,
  );
  return lines.join("\n");
}

async function lintBenchmarkVerifier(
  context: ShiptestConfigContext,
  benchmark: Benchmark,
): Promise<VerifierLintBenchmarkResult> {
  const material = await collectHiddenVerifierMaterial(context, benchmark);
  const checks: VerifierLintCheck[] = [
    ...createHiddenVerifierPresenceChecks(benchmark),
    ...material.checks,
    ...createReplayFlakinessRunChecks(benchmark),
    ...createNetworkChecks(benchmark, material.sources),
    ...createFlakinessPatternChecks(benchmark, material.sources),
    ...createPatchResetChecks(material.resetPatchTouchedPaths),
    ...createScoringCommandChecks(benchmark, material.repositoryPaths),
    ...createCoverageHintChecks(material.sources),
  ];
  const warnings = checks.filter((check) => check.severity === "warning").length;
  return {
    benchmark_id: benchmark.id,
    benchmark_type: benchmark.type,
    status: warnings > 0 ? "warnings" : "passed",
    checks,
    checklist: hasHiddenVerifier(benchmark.evaluation) ? ManualVerifierChecklist : [],
  };
}

function selectedBenchmarks(
  benchmarks: readonly Benchmark[],
  benchmarkIds: readonly string[] | undefined,
): readonly Benchmark[] {
  if (!benchmarkIds || benchmarkIds.length === 0) {
    return benchmarks;
  }
  const benchmarkIdSet = new Set(benchmarkIds);
  for (const benchmarkId of benchmarkIds) {
    if (!benchmarks.some((benchmark) => benchmark.id === benchmarkId)) {
      throw new Error(`Unknown benchmark id: ${benchmarkId}`);
    }
  }
  return benchmarks.filter((benchmark) => benchmarkIdSet.has(benchmark.id));
}

async function collectHiddenVerifierMaterial(
  context: ShiptestConfigContext,
  benchmark: Benchmark,
): Promise<HiddenVerifierMaterial> {
  const sources: HiddenSource[] = [];
  const repositoryPaths = new Set<string>();
  const checks: VerifierLintCheck[] = [];
  const resetPatchTouchedPaths = new Set<string>();

  for (const hiddenFile of benchmark.evaluation.hidden_evaluation_files) {
    repositoryPaths.add(normalizeRepositoryPath(hiddenFile.repository_path));
    const text = await readHiddenText(context.configDir, hiddenFile.shiptest_path);
    sources.push({ shiptestPath: normalizeConfigPath(hiddenFile.shiptest_path), text });
    if (text.trim().length === 0) {
      checks.push({
        code: VerifierLintCheckCode.HiddenAssetEmpty,
        severity: "warning",
        message: "Hidden verifier file is empty.",
        paths: [hiddenFile.shiptest_path],
      });
    }
  }

  for (const hiddenDirectory of benchmark.evaluation.hidden_evaluation_directories) {
    repositoryPaths.add(normalizeRepositoryPath(hiddenDirectory.repository_path));
    const directorySources = await readHiddenDirectorySources(
      context.configDir,
      hiddenDirectory.shiptest_path,
    );
    sources.push(...directorySources);
    if (directorySources.length === 0) {
      checks.push({
        code: VerifierLintCheckCode.HiddenDirectoryEmpty,
        severity: "warning",
        message: "Hidden verifier directory contains no regular files.",
        paths: [hiddenDirectory.shiptest_path],
      });
    }
    for (const source of directorySources) {
      if (source.text.trim().length === 0) {
        checks.push({
          code: VerifierLintCheckCode.HiddenAssetEmpty,
          severity: "warning",
          message: "Hidden verifier directory contains an empty file.",
          paths: [source.shiptestPath],
        });
      }
    }
  }

  for (const hiddenPatch of benchmark.evaluation.hidden_evaluation_patches) {
    const text = await readHiddenText(context.configDir, hiddenPatch.shiptest_path);
    sources.push({ shiptestPath: normalizeConfigPath(hiddenPatch.shiptest_path), text });
    const touchedPaths = parsePatchTouchedRepositoryPaths(text);
    for (const touchedPath of touchedPaths) {
      repositoryPaths.add(touchedPath);
      if (hiddenPatch.reset_touched_paths_before_apply) {
        resetPatchTouchedPaths.add(touchedPath);
      }
    }
    if (text.trim().length === 0) {
      checks.push({
        code: VerifierLintCheckCode.HiddenAssetEmpty,
        severity: "warning",
        message: "Hidden verifier patch is empty.",
        paths: [hiddenPatch.shiptest_path],
      });
    }
  }

  return {
    sources,
    repositoryPaths: [...repositoryPaths].sort(),
    checks,
    resetPatchTouchedPaths: [...resetPatchTouchedPaths].sort(),
  };
}

async function readHiddenText(configDir: string, shiptestPath: string): Promise<string> {
  return readFile(resolveConfigRelativePath(configDir, shiptestPath), "utf8");
}

async function readHiddenDirectorySources(
  configDir: string,
  shiptestPath: string,
): Promise<HiddenSource[]> {
  const rootPath = resolveConfigRelativePath(configDir, shiptestPath);
  const sources: HiddenSource[] = [];
  await walkFiles(rootPath, async (filePath) => {
    const relativePath = path.relative(rootPath, filePath).replaceAll(path.sep, "/");
    sources.push({
      shiptestPath: normalizeConfigPath(
        path.posix.join(shiptestPath.replaceAll("\\", "/"), relativePath),
      ),
      text: await readFile(filePath, "utf8"),
    });
  });
  return sources.sort((left, right) => left.shiptestPath.localeCompare(right.shiptestPath));
}

function createHiddenVerifierPresenceChecks(benchmark: Benchmark): VerifierLintCheck[] {
  const hiddenConfigured = hasHiddenVerifier(benchmark.evaluation);
  if (hiddenConfigured) {
    return [
      {
        code: VerifierLintCheckCode.HiddenVerifierConfigured,
        severity: "pass",
        message: "Hidden verifier payload is configured.",
      },
    ];
  }

  const policy = getBenchmarkPolicy(benchmark.type);
  return [
    {
      code: VerifierLintCheckCode.HiddenVerifierMissing,
      severity: policy.requiresBenchmarkLocalHiddenVerifier ? "warning" : "info",
      message: policy.requiresBenchmarkLocalHiddenVerifier
        ? "This benchmark type expects a hidden verifier, but no hidden payload is configured."
        : "No hidden verifier payload is configured for this benchmark.",
    },
  ];
}

function createReplayFlakinessRunChecks(benchmark: Benchmark): VerifierLintCheck[] {
  if (benchmark.type !== BenchmarkType.ReplayChange) {
    return [];
  }
  if (benchmark.replay_validation.flakiness_runs <= 1) {
    return [
      {
        code: VerifierLintCheckCode.FlakinessRunsLow,
        severity: "warning",
        message:
          "replay_validation.flakiness_runs is 1; repeated validation cannot detect flaky verifier behavior. Consider 3+ for important replay benchmarks.",
      },
    ];
  }
  return [
    {
      code: VerifierLintCheckCode.FlakinessRunsConfigured,
      severity: "pass",
      message: `Replay verifier flakiness validation is configured for ${benchmark.replay_validation.flakiness_runs} runs.`,
    },
  ];
}

function createNetworkChecks(
  benchmark: Benchmark,
  sources: readonly HiddenSource[],
): VerifierLintCheck[] {
  const checks: VerifierLintCheck[] = [];
  const externalNetworkPaths = sourcePathsMatching(sources, externalNetworkPattern());
  if (
    externalNetworkPaths.length > 0 ||
    externalNetworkPattern().test(benchmark.evaluation.scoring_command)
  ) {
    checks.push({
      code: VerifierLintCheckCode.ExternalNetworkReference,
      severity: "warning",
      message:
        "Hidden verifier or scoring command contains an external HTTP(S) reference. If intentional, make sure it is deterministic and configured by setup/doctor.",
      ...(externalNetworkPaths.length > 0 ? { paths: externalNetworkPaths } : {}),
    });
  }

  const localServicePaths = sourcePathsMatching(sources, localServicePattern());
  if (
    localServicePaths.length > 0 ||
    localServicePattern().test(benchmark.evaluation.scoring_command)
  ) {
    checks.push({
      code: VerifierLintCheckCode.LocalServiceReference,
      severity: "warning",
      message:
        "Hidden verifier or scoring command references a local service. Make sure setup/doctor starts it deterministically before evaluation.",
      ...(localServicePaths.length > 0 ? { paths: localServicePaths } : {}),
    });
  }
  return checks;
}

function createFlakinessPatternChecks(
  benchmark: Benchmark,
  sources: readonly HiddenSource[],
): VerifierLintCheck[] {
  const pattern = flakinessPattern();
  const sourcePaths = sourcePathsMatching(sources, pattern);
  if (sourcePaths.length === 0 && !pattern.test(benchmark.evaluation.scoring_command)) {
    return [];
  }
  return [
    {
      code: VerifierLintCheckCode.FlakinessPatternDetected,
      severity: "warning",
      message:
        "Hidden verifier or scoring command contains timing, randomness, or shared-temp-state patterns. Prefer controlled clocks/seeds and validate observed stability with flakiness_runs.",
      ...(sourcePaths.length > 0 ? { paths: sourcePaths } : {}),
    },
  ];
}

function createPatchResetChecks(resetPatchTouchedPaths: readonly string[]): VerifierLintCheck[] {
  const suspiciousTouchedPaths = resetPatchTouchedPaths.filter(
    (repositoryPath) => !looksVerifierOwnedRepositoryPath(repositoryPath),
  );
  if (suspiciousTouchedPaths.length === 0) {
    return [];
  }
  return [
    {
      code: VerifierLintCheckCode.PatchResetTouchesImplementationPaths,
      severity: "warning",
      message:
        "A hidden patch resets touched paths that do not look verifier-owned. This can erase legitimate candidate changes; only enable reset for tests, fixtures, harnesses, or verifier-owned config.",
      paths: suspiciousTouchedPaths,
    },
  ];
}

function createScoringCommandChecks(
  benchmark: Benchmark,
  hiddenRepositoryPaths: readonly string[],
): VerifierLintCheck[] {
  if (!hasHiddenVerifier(benchmark.evaluation)) {
    return [];
  }

  const command = benchmark.evaluation.scoring_command;
  const mentionsHiddenPath = commandMentionsHiddenPath(command, hiddenRepositoryPaths);
  const looksLikeValidation = validationCommandPattern().test(command);
  const checks: VerifierLintCheck[] = [];

  if (!mentionsHiddenPath && !looksLikeValidation) {
    checks.push({
      code: VerifierLintCheckCode.ScoringCommandDisconnected,
      severity: "warning",
      message:
        "Scoring command does not look like a test/build/typecheck command and does not mention hidden verifier paths. Confirm the hidden verifier actually runs.",
    });
  }

  if (mentionsHiddenPath && !commandAppearsToIncludeRegressionCoverage(command)) {
    checks.push({
      code: VerifierLintCheckCode.HiddenOnlyScoringCommand,
      severity: "warning",
      message:
        "Scoring command appears focused on hidden verifier paths only. Consider also running existing regression, typecheck, lint, or build coverage when practical.",
    });
  }

  return checks;
}

function createCoverageHintChecks(sources: readonly HiddenSource[]): VerifierLintCheck[] {
  if (sources.length === 0) {
    return [];
  }

  const sourceText = sources.map((source) => source.text).join("\n");
  const checks: VerifierLintCheck[] = [];
  if (!assertionPattern().test(sourceText)) {
    checks.push({
      code: VerifierLintCheckCode.WeakAssertionCoverage,
      severity: "warning",
      message:
        "Could not find obvious assertion or explicit pass/fail markers in hidden verifier assets. If this is a custom harness, ignore; otherwise confirm the verifier asserts behavior.",
      paths: sources.map((source) => source.shiptestPath),
    });
  }
  if (!negativeCasePattern().test(sourceText)) {
    checks.push({
      code: VerifierLintCheckCode.WeakNegativeCoverage,
      severity: "warning",
      message:
        "Could not find obvious negative/failure/regression-case markers in hidden verifier assets. If the task needs them, consider adding a case that would fail on the old behavior.",
      paths: sources.map((source) => source.shiptestPath),
    });
  }
  return checks;
}

function sourcePathsMatching(sources: readonly HiddenSource[], pattern: RegExp): string[] {
  return sources
    .filter((source) => {
      pattern.lastIndex = 0;
      return pattern.test(source.text);
    })
    .map((source) => source.shiptestPath);
}

function commandMentionsHiddenPath(
  command: string,
  hiddenRepositoryPaths: readonly string[],
): boolean {
  const normalizedCommand = command.replaceAll("\\", "/");
  return hiddenRepositoryPaths.some((repositoryPath) => {
    const normalizedPath = normalizeRepositoryPath(repositoryPath);
    return normalizedPath.length > 0 && normalizedCommand.includes(normalizedPath);
  });
}

function commandAppearsToIncludeRegressionCoverage(command: string): boolean {
  const normalized = command.toLowerCase();
  if (/\b(typecheck|tsc|build|lint|biome|eslint|ruff|clippy|check)\b/.test(normalized)) {
    return true;
  }
  return /(?:&&|\|\||;)/.test(command) && validationCommandPattern().test(command);
}

function validationCommandPattern(): RegExp {
  return /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|build|lint|check)\b|\b(?:test|pytest|vitest|jest|mocha|go\s+test|cargo\s+test|mvn\s+test|gradle\s+test|tsc|biome|eslint|ruff|clippy|rspec|phpunit)\b/i;
}

function externalNetworkPattern(): RegExp {
  return /\bhttps?:\/\/(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?:[:/]|$))[^\s"'`<>)]*/i;
}

function localServicePattern(): RegExp {
  return /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?:[:/]|$)/i;
}

function flakinessPattern(): RegExp {
  return /\b(?:Date\.now|performance\.now|setTimeout|setInterval|sleep|usleep|time\.sleep|Thread\.sleep|tokio::time::sleep|Math\.random|randomUUID|crypto\.randomUUID|random\.random|uuid\.uuid|nanoid|tmpdir|mkdtemp|tempfile|NamedTemporaryFile)\b|\/tmp\//i;
}

function assertionPattern(): RegExp {
  return /\b(?:expect|assert|should|toBe|toEqual|assert_eq!|assert_ne!|process\.exit|exit\s+[01]|t\.Equal|require\.Equal)\b/i;
}

function negativeCasePattern(): RegExp {
  return /(?:\b(?:false|invalid|error|fail|reject|denied|missing|empty|bad|negative|toThrow|throws|raises|assert_ne|notEqual|not_to)\b|\.not\b|process\.exit\([^)]*1[^)]*\)|exit\s+1)/i;
}

function looksVerifierOwnedRepositoryPath(repositoryPath: string): boolean {
  const normalizedPath = normalizeRepositoryPath(repositoryPath).toLowerCase();
  return (
    normalizedPath.startsWith("test/") ||
    normalizedPath.startsWith("tests/") ||
    normalizedPath.startsWith("spec/") ||
    normalizedPath.startsWith("__tests__/") ||
    normalizedPath.includes("/test/") ||
    normalizedPath.includes("/tests/") ||
    normalizedPath.includes("/spec/") ||
    normalizedPath.includes("/__tests__/") ||
    normalizedPath.includes("/fixtures/") ||
    normalizedPath.startsWith("fixtures/") ||
    /(?:^|\/).+\.(?:test|spec)\.[a-z0-9]+$/.test(normalizedPath) ||
    /(?:^|\/).+_test\.(?:go|py|rs)$/.test(normalizedPath) ||
    normalizedPath.startsWith("cypress/") ||
    normalizedPath.startsWith("playwright/")
  );
}

function parsePatchTouchedRepositoryPaths(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch) {
      addPatchPath(paths, diffMatch[1]);
      addPatchPath(paths, diffMatch[2]);
      continue;
    }

    const fileMatch = /^(?:---|\+\+\+) [ab]\/(.+)$/.exec(line);
    if (fileMatch) {
      addPatchPath(paths, fileMatch[1]);
    }
  }
  return [...paths].sort();
}

function addPatchPath(paths: Set<string>, repositoryPath: string | undefined): void {
  if (!repositoryPath || repositoryPath === "/dev/null") {
    return;
  }
  paths.add(normalizeRepositoryPath(repositoryPath));
}

function normalizeRepositoryPath(repositoryPath: string): string {
  return repositoryPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

function normalizeConfigPath(configPath: string): string {
  return configPath.replaceAll("\\", "/");
}

function severityMarker(severity: VerifierLintCheck["severity"]): string {
  if (severity === "pass") return "✓";
  if (severity === "warning") return "⚠";
  return "•";
}
