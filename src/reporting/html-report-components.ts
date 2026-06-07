import type { AttemptReport, RunResults } from "../run/types.js";
import { artifactLink } from "./shared/artifacts.js";
import { statusBadge } from "./shared/badge.js";
import { type BarDatum, type ChartSeries, sortBars } from "./shared/chart.js";
import {
  formatCompact,
  formatDuration,
  formatInteger,
  formatNumber,
  formatPreciseUsd,
  formatStatus,
  formatUsd,
} from "./shared/format.js";
import { escapeAttribute, escapeHtml } from "./shared/html.js";
import { average, median } from "./shared/math.js";
import { benchmarkDetailReportPath, modelDetailReportPath, slugify } from "./shared/paths.js";

export { renderQualityDetails } from "./benchmark/quality-details.js";
export { statusBadge } from "./shared/badge.js";
export { renderBarChart } from "./shared/chart.js";
export {
  formatDuration,
  formatInteger,
  formatNumber,
  formatRunMode,
  formatStatus,
  formatUsd,
} from "./shared/format.js";
export { escapeAttribute, escapeHtml } from "./shared/html.js";
export {
  benchmarkDetailReportPath,
  modelDetailReportPath,
  modelsOverviewReportPath,
} from "./shared/paths.js";

export function renderMetricCards(
  results: RunResults,
  attempts: readonly AttemptReport[],
  pendingCount: number,
): string {
  const passRate =
    results.summary.agent_runs > 0
      ? Math.round((results.summary.passed / results.summary.agent_runs) * 100)
      : 0;
  const medianSpeed = median(
    attempts
      .map((attempt) => outputTokensPerSecond(attempt))
      .filter((value): value is number => value !== undefined),
  );
  const avgCost = attempts.length > 0 ? (results.summary.estimated_cost_usd ?? 0) : undefined;
  return `<section class="metric-grid">
    <div class="metric-card quality"><div class="metric-head"><span class="metric-title">Quality</span><span class="rank">${results.summary.passed} / ${results.summary.agent_runs}</span></div><div class="metric-value"><span class="metric-number green">${passRate}<span class="metric-unit">%</span></span><span class="metric-label">passed evaluation verdicts</span></div></div>
    <div class="metric-card speed"><div class="metric-head"><span class="metric-title">Speed</span><span class="rank">median</span></div><div class="metric-value"><span class="metric-number blue">${medianSpeed === undefined ? "—" : formatNumber(medianSpeed, 1)}</span><span class="metric-label">output tokens per second</span></div></div>
    <div class="metric-card cost"><div class="metric-head"><span class="metric-title">Total estimated cost</span><span class="rank">total</span></div><div class="metric-value"><span class="metric-number red" title="${escapeAttribute(formatPreciseUsd(avgCost))}">${formatUsd(avgCost)}</span><span class="metric-label">estimated provider cost</span></div></div>
    <div class="metric-card tokens"><div class="metric-head"><span class="metric-title">Tokens</span><span class="rank">uncached</span></div><div class="metric-value"><span class="metric-number purple">${formatCompact(results.summary.uncached_tokens)}</span><span class="metric-label">input ${formatCompact(results.summary.input_tokens)} · output ${formatCompact(results.summary.output_tokens)}<br>cache read ${formatCompact(results.summary.cache_read_tokens)} · cache write ${formatCompact(results.summary.cache_write_tokens)} · total ${formatCompact(results.summary.total_tokens)}${cacheReadDominates(results.summary) ? "<br>cache reads dominate total tokens" : ""}</span></div></div>
    <div class="metric-card pending${pendingCount > 0 ? " pending-active" : ""}"><div class="metric-head"><span class="metric-title">Run completeness</span><span class="rank">${formatStatus(results.status)}</span></div>${pendingCount > 0 ? renderPendingFleet(pendingCount) : '<div class="icon-row">✓ ✓ ✓</div>'}<div class="metric-value"><span class="metric-number">${results.benchmark_results.length - pendingCount}/${results.benchmark_results.length}</span><span class="metric-label">benchmarks with attempts · ${pendingCount} pending</span></div></div>
  </section>`;
}

function renderPendingFleet(pendingCount: number): string {
  const maxVisibleShips = 5;
  const visibleShips = Math.min(pendingCount, maxVisibleShips);
  const hiddenShips = pendingCount - visibleShips;
  const ships = Array.from(
    { length: visibleShips },
    () => `<span class="pending-boat">⛵</span>`,
  ).join("");
  const more = hiddenShips > 0 ? `<span class="pending-more">+${hiddenShips}</span>` : "";
  return `<div class="pending-boat-scene"><div class="pending-fleet" title="${pendingCount} pending benchmark${pendingCount === 1 ? "" : "s"}">${ships}${more}</div></div>`;
}

interface RunInsightCard {
  readonly tone: "quality" | "speed" | "cost" | "tokens" | "pending" | "risk";
  readonly title: string;
  readonly rank: string;
  readonly value: string;
  readonly label: string;
  readonly href?: string;
}

export function renderRunInsightCards(
  results: RunResults,
  attempts: readonly AttemptReport[],
): string {
  const scored = attempts.filter((attempt) => attempt.evaluation?.score !== undefined);
  const averageScore = average(scored.map((attempt) => attempt.evaluation?.score ?? 0));
  const failedTools = attempts.reduce(
    (sum, attempt) => sum + (attempt.tool_usage?.summary.failed_tool_calls ?? 0),
    0,
  );
  const totalFiles = attempts.reduce(
    (sum, attempt) => sum + (attempt.submission?.changed_files.length ?? 0),
    0,
  );
  const evaluated = attempts.filter((attempt) => attempt.evaluation !== undefined).length;
  const model = bestModelAggregate(attempts);
  const risk = riskiestBenchmark(results, attempts);
  const cards: RunInsightCard[] = [
    {
      tone: "quality",
      title: "Average score",
      rank: `${scored.length} scored`,
      value: averageScore === undefined ? "—" : String(Math.round(averageScore)),
      label: "mean evaluator score across completed attempts",
    },
    {
      tone: "speed",
      title: "Most reliable model",
      rank: model === undefined ? "no attempts" : `${model.passed}/${model.attempts} passed`,
      value: model?.modelId ?? "—",
      label:
        model === undefined
          ? "no model attempts yet"
          : `${formatNumber(model.averageQuality, 1)} average quality · open model profile`,
      ...(model === undefined ? {} : { href: modelDetailReportPath(model.modelId) }),
    },
    {
      tone: "risk",
      title: "Highest risk benchmark",
      rank: risk === undefined ? "clear" : `${risk.failedAttempts} failed`,
      value: risk?.benchmarkId ?? "—",
      label:
        risk === undefined
          ? "no failing benchmark attempts detected"
          : `${risk.failedTools} failed tools · ${risk.signalCount} signals · open benchmark`,
      ...(risk === undefined ? {} : { href: benchmarkDetailReportPath(risk.benchmarkId) }),
    },
    {
      tone: "cost",
      title: "Tool reliability",
      rank: "failed calls",
      value: String(failedTools),
      label: "tool calls marked failed across attempts",
    },
    {
      tone: "tokens",
      title: "Change footprint",
      rank: "files",
      value: formatCompact(totalFiles),
      label: `${attempts.length === 0 ? "0" : formatNumber(totalFiles / attempts.length, 1)} files changed per attempt`,
    },
    {
      tone: "pending",
      title: "Evaluation health",
      rank: "scored",
      value: `${evaluated}/${attempts.length}`,
      label: `${results.summary.failed} failed or incomplete attempts`,
    },
  ];
  return `<section class="insight-grid">${cards.map(renderRunInsightCard).join("")}</section>`;
}

function renderRunInsightCard(card: RunInsightCard): string {
  const content = `<div class="metric-head"><span class="metric-title">${escapeHtml(card.title)}</span><span class="rank">${escapeHtml(card.rank)}</span></div><div class="metric-value"><span class="insight-value">${escapeHtml(card.value)}</span><span class="metric-label">${escapeHtml(card.label)}</span></div>`;
  if (card.href !== undefined) {
    return `<a class="metric-card insight-card insight-card-link ${card.tone}" href="${escapeAttribute(card.href)}">${content}</a>`;
  }
  return `<div class="metric-card insight-card ${card.tone}">${content}</div>`;
}

export function renderSelfVerificationOverview(attempts: readonly AttemptReport[]): string {
  const total = attempts.length;
  const withVerification = attempts.filter((attempt) => attempt.self_verification !== undefined);
  const ranTests = withVerification.filter(
    (attempt) => attempt.self_verification?.ran_tests,
  ).length;
  const ranStatic = withVerification.filter(
    (attempt) =>
      attempt.self_verification?.ran_typecheck ||
      attempt.self_verification?.ran_build ||
      attempt.self_verification?.ran_lint,
  ).length;
  const baselineValidated = withVerification.filter((attempt) =>
    attempt.self_verification?.checks.some((check) =>
      ["baseline_validated_exact", "baseline_validated_family"].includes(check.evidence_tier),
    ),
  ).length;
  const unsupportedClaims = withVerification.filter((attempt) =>
    ["unsupported", "contradicted"].includes(
      attempt.self_verification?.final_response_claim.support ?? "no_claim",
    ),
  ).length;
  const testFilesTouched = withVerification.filter(
    (attempt) => attempt.self_verification?.modified_tests,
  ).length;
  const topFailureMode = topFailureModeAggregate(attempts);
  const cards: RunInsightCard[] = [
    {
      tone: "quality",
      title: "Agent ran tests",
      rank: total === 0 ? "no attempts" : `${ranTests}/${total}`,
      value: percentLabel(ranTests, total),
      label: "attempts with observed agent-side test commands",
    },
    {
      tone: "speed",
      title: "Static checks observed",
      rank: total === 0 ? "no attempts" : `${ranStatic}/${total}`,
      value: percentLabel(ranStatic, total),
      label: "attempts with typecheck, build, or lint commands observed",
    },
    {
      tone: "pending",
      title: "Baseline-backed evidence",
      rank: total === 0 ? "no attempts" : `${baselineValidated}/${total}`,
      value: percentLabel(baselineValidated, total),
      label: "attempts with observed checks tied to a passing doctor command",
    },
    {
      tone: unsupportedClaims > 0 ? "risk" : "quality",
      title: "Unsupported verification claims",
      rank: "claim hygiene",
      value: String(unsupportedClaims),
      label: "attempts where final claims lacked matching observed tool evidence",
    },
    {
      tone: "tokens",
      title: "Likely test files touched",
      rank: "neutral flag",
      value: String(testFilesTouched),
      label: "attempts touching paths that look like tests; review evidence only",
    },
    {
      tone: topFailureMode ? "risk" : "quality",
      title: "Top reviewer insight",
      rank: topFailureMode
        ? `${topFailureMode.count} attempt${topFailureMode.count === 1 ? "" : "s"}`
        : "clear",
      value: topFailureMode?.label ?? "—",
      label: topFailureMode
        ? "most common deterministic insight flag"
        : "no reviewer insight flags emitted",
    },
  ];
  return `<section class="insight-grid">${cards.map(renderRunInsightCard).join("")}</section>`;
}

function topFailureModeAggregate(
  attempts: readonly AttemptReport[],
): { readonly id: string; readonly label: string; readonly count: number } | undefined {
  const counts = new Map<string, { label: string; count: number }>();
  for (const attempt of attempts) {
    for (const mode of attempt.failure_modes ?? []) {
      const existing = counts.get(mode.id) ?? { label: mode.label, count: 0 };
      counts.set(mode.id, { label: existing.label, count: existing.count + 1 });
    }
  }
  return [...counts.entries()]
    .map(([id, value]) => ({ id, label: value.label, count: value.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0];
}

function percentLabel(count: number, total: number): string {
  if (total <= 0) return "—";
  return `${Math.round((count / total) * 100)}%`;
}

function bestModelAggregate(attempts: readonly AttemptReport[]): ModelAggregate | undefined {
  return modelAggregates(attempts).sort(
    (a, b) => b.averageQuality - a.averageQuality || b.passed - a.passed,
  )[0];
}

function riskiestBenchmark(
  results: RunResults,
  attempts: readonly AttemptReport[],
):
  | {
      readonly benchmarkId: string;
      readonly failedAttempts: number;
      readonly failedTools: number;
      readonly signalCount: number;
    }
  | undefined {
  const byBenchmark = new Map<string, AttemptReport[]>();
  for (const attempt of attempts) {
    const existing = byBenchmark.get(attempt.benchmark_id) ?? [];
    existing.push(attempt);
    byBenchmark.set(attempt.benchmark_id, existing);
  }
  const risks = [...byBenchmark.entries()]
    .map(([benchmarkId, benchmarkAttempts]) => ({
      benchmarkId,
      failedAttempts: benchmarkAttempts.filter(
        (attempt) => attempt.status !== "completed" || attempt.evaluation?.verdict !== "passed",
      ).length,
      failedTools: benchmarkAttempts.reduce(
        (sum, attempt) => sum + (attempt.tool_usage?.summary.failed_tool_calls ?? 0),
        0,
      ),
      signalCount: benchmarkAttempts.reduce(
        (sum, attempt) =>
          sum +
          attempt.agent.signals.length +
          (attempt.evaluation?.signals.length ?? 0) +
          (attempt.quality_signals?.length ?? 0),
        0,
      ),
    }))
    .filter((risk) => risk.failedAttempts > 0 || risk.failedTools > 0 || risk.signalCount > 0);
  const pendingRisks = results.benchmark_results
    .filter((benchmark) => benchmark.attempts.length === 0)
    .map((benchmark) => ({
      benchmarkId: benchmark.benchmark_id,
      failedAttempts: 0,
      failedTools: 0,
      signalCount: 1,
    }));
  return [...risks, ...pendingRisks].sort(
    (a, b) =>
      b.failedAttempts - a.failedAttempts ||
      b.failedTools - a.failedTools ||
      b.signalCount - a.signalCount,
  )[0];
}

interface ModelBarOptions {
  readonly hrefForModel?: (modelId: string) => string;
}

function modelBarHref(modelId: string, options: ModelBarOptions | undefined): string {
  return options?.hrefForModel?.(modelId) ?? `#model-${slugify(modelId)}`;
}

export function qualityBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
  options?: ModelBarOptions,
): BarDatum[] {
  void pendingBenchmarks;
  const aggregates = modelAggregates(attempts);
  return sortBars(
    aggregates.map((aggregate) => ({
      label: aggregate.modelId,
      value: aggregate.averageQuality,
      display: String(Math.round(aggregate.averageQuality)),
      color: "var(--green)",
      higherIsBetter: true,
      scaleMode: "relative",
      href: modelBarHref(aggregate.modelId, options),
      detail: `${aggregate.modelId}\nAverage quality: ${formatNumber(aggregate.averageQuality, 1)}\nPasses: ${aggregate.passed}/${aggregate.attempts}\nFailures counted as 0`,
    })),
    true,
  ).slice(0, 8);
}

export function speedBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
  options?: ModelBarOptions,
): BarDatum[] {
  void pendingBenchmarks;
  const aggregates = modelAggregates(attempts).filter(
    (aggregate) => aggregate.medianSpeed !== undefined,
  );
  return sortBars(
    aggregates.map((aggregate) => ({
      label: aggregate.modelId,
      ...(aggregate.medianSpeed === undefined ? {} : { value: aggregate.medianSpeed }),
      display: aggregate.medianSpeed === undefined ? "—" : formatNumber(aggregate.medianSpeed, 0),
      color: "var(--blue)",
      higherIsBetter: true,
      scaleMode: "relative",
      href: modelBarHref(aggregate.modelId, options),
      detail: `${aggregate.modelId}\nMedian speed: ${aggregate.medianSpeed === undefined ? "not available" : `${formatNumber(aggregate.medianSpeed, 1)} output tok/sec`}\nAttempts: ${aggregate.attempts}`,
    })),
    true,
  ).slice(0, 8);
}

export function costBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
  options?: ModelBarOptions,
): BarDatum[] {
  void pendingBenchmarks;
  const aggregates = modelAggregates(attempts).filter(
    (aggregate) => aggregate.averageCost !== undefined,
  );
  return sortBars(
    aggregates.map((aggregate) => ({
      label: aggregate.modelId,
      ...(aggregate.averageCost === undefined ? {} : { value: aggregate.averageCost }),
      display: aggregate.averageCost === undefined ? "—" : formatUsd(aggregate.averageCost),
      color: "var(--orange)",
      higherIsBetter: false,
      scaleMode: "relative",
      href: modelBarHref(aggregate.modelId, options),
      detail: `${aggregate.modelId}\nAverage cost: ${aggregate.averageCost === undefined ? "not available" : formatUsd(aggregate.averageCost)}\nAttempts: ${aggregate.attempts}`,
    })),
    false,
  ).slice(0, 8);
}

interface ModelAggregate {
  readonly modelId: string;
  readonly attempts: number;
  readonly passed: number;
  readonly averageQuality: number;
  readonly medianSpeed?: number;
  readonly averageCost?: number;
}

function modelAggregates(attempts: readonly AttemptReport[]): ModelAggregate[] {
  const byModel = new Map<string, AttemptReport[]>();
  for (const attempt of attempts) {
    const existing = byModel.get(attempt.model.id) ?? [];
    existing.push(attempt);
    byModel.set(attempt.model.id, existing);
  }
  return [...byModel.entries()].map(([modelId, modelAttempts]) => {
    const qualityScores = modelAttempts.map(qualityScoreForAttempt);
    const speeds = modelAttempts
      .map((attempt) => outputTokensPerSecond(attempt))
      .filter((value): value is number => value !== undefined);
    const costs = modelAttempts
      .map((attempt) => attempt.agent.telemetry.usage.estimated_cost_usd?.total)
      .filter((value): value is number => value !== undefined);
    const medianSpeed = median(speeds);
    const averageCost = average(costs);
    return {
      modelId,
      attempts: modelAttempts.length,
      passed: modelAttempts.filter(
        (attempt) => attempt.status === "completed" && attempt.evaluation?.verdict === "passed",
      ).length,
      averageQuality: average(qualityScores) ?? 0,
      ...(medianSpeed === undefined ? {} : { medianSpeed }),
      ...(averageCost === undefined ? {} : { averageCost }),
    };
  });
}

export function qualityAttemptPanelHref(
  attempt: AttemptReport,
  panel: "overview" | "candidate-diff" = "overview",
): string {
  return `#quality-${slugify(`${attempt.benchmark_id}-${attempt.model.id}-${attempt.attempt}`)}-${panel}`;
}

export function preferredQualityAttemptHref(attempt: AttemptReport): string {
  return qualityAttemptPanelHref(
    attempt,
    attempt.artifacts.candidate_patch ? "candidate-diff" : "overview",
  );
}

function qualityScoreForAttempt(attempt: AttemptReport): number {
  if (attempt.status === "agent_failed" || !attempt.evaluation) {
    return 0;
  }
  if (attempt.evaluation.score !== undefined) {
    return attempt.evaluation.score;
  }
  return attempt.evaluation.verdict === "passed" ? 100 : 0;
}

interface AttemptBarOptions {
  readonly hrefForAttempt?: (attempt: AttemptReport) => string;
}

export function benchmarkQualitySeries(
  attempts: readonly AttemptReport[],
  options?: AttemptBarOptions,
): readonly ChartSeries[] {
  return [
    chartSeries(
      "score",
      "Score",
      "Quality by Model",
      "Score for this benchmark · Higher is better",
      "var(--primary)",
      attempts,
      (attempt) => qualityScoreForAttempt(attempt),
      true,
      (value) => String(Math.round(value)),
      options,
    ),
    chartSeries(
      "changed-files",
      "Changed files",
      "Changed Files by Model",
      "Changed files in candidate patch · Lower can be simpler",
      "var(--blue)",
      attempts,
      (attempt) => attempt.submission?.changed_files.length ?? 0,
      false,
      (value) => String(Math.round(value)),
      options,
    ),
    chartSeries(
      "failed-tools",
      "Failed tools",
      "Failed Tool Calls by Model",
      "Failed tool calls during the attempt · Lower is better",
      "var(--orange)",
      attempts,
      (attempt) => attempt.tool_usage?.summary.failed_tool_calls ?? 0,
      false,
      (value) => String(Math.round(value)),
      options,
    ),
    chartSeries(
      "signals",
      "Signals",
      "Signals by Model",
      "Quality, agent, and evaluation signals emitted · Lower usually means cleaner",
      "var(--yellow)",
      attempts,
      (attempt) =>
        attempt.agent.signals.length +
        (attempt.evaluation?.signals.length ?? 0) +
        (attempt.quality_signals?.length ?? 0),
      false,
      (value) => String(Math.round(value)),
      options,
    ),
  ];
}

export function benchmarkSpeedSeries(
  attempts: readonly AttemptReport[],
  options?: AttemptBarOptions,
): readonly ChartSeries[] {
  return [
    chartSeries(
      "output-tps",
      "Output tok/sec",
      "Speed by Model",
      "Output tokens per second for this benchmark",
      "var(--blue)",
      attempts,
      outputTokensPerSecond,
      true,
      (value) => formatNumber(value, 1),
      options,
    ),
    chartSeries(
      "agent-time",
      "Agent time",
      "Agent Time by Model",
      "Agent process duration · Lower is better",
      "var(--yellow)",
      attempts,
      (attempt) => attempt.timings_ms?.agent_process_ms,
      false,
      formatDuration,
      options,
    ),
    chartSeries(
      "total-time",
      "Total time",
      "Total Attempt Time by Model",
      "End-to-end attempt duration · Lower is better",
      "var(--orange)",
      attempts,
      (attempt) => attempt.timings_ms?.total_ms,
      false,
      formatDuration,
      options,
    ),
    chartSeries(
      "scoring-time",
      "Scoring time",
      "Scoring Time by Model",
      "Evaluation scoring duration · Lower is better",
      "var(--green)",
      attempts,
      (attempt) => attempt.timings_ms?.evaluation_scoring_ms,
      false,
      formatDuration,
      options,
    ),
  ];
}

export function benchmarkCostSeries(
  attempts: readonly AttemptReport[],
  options?: AttemptBarOptions,
): readonly ChartSeries[] {
  return [
    chartSeries(
      "cost",
      "Cost",
      "Cost by Model",
      "Estimated USD for this benchmark · Lower is better",
      "var(--orange)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.estimated_cost_usd?.total,
      false,
      formatUsd,
      options,
    ),
    chartSeries(
      "input",
      "Input tokens",
      "Input Tokens by Model",
      "Fresh model input tokens · Lower can mean better context efficiency",
      "var(--primary)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.input_tokens,
      false,
      formatInteger,
      options,
    ),
    chartSeries(
      "output",
      "Output tokens",
      "Output Tokens by Model",
      "Generated output tokens · Lower can be cheaper/faster",
      "var(--blue)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.output_tokens,
      false,
      formatInteger,
      options,
    ),
    chartSeries(
      "cache-read",
      "Cache read",
      "Cache Read Tokens by Model",
      "Provider cache-read tokens · Pricing varies by provider",
      "var(--green)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.cache_read_tokens,
      false,
      formatInteger,
      options,
    ),
    chartSeries(
      "cache-write",
      "Cache write",
      "Cache Write Tokens by Model",
      "Tokens written to provider cache · Usually part of uncached usage",
      "var(--yellow)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.cache_write_tokens,
      false,
      formatInteger,
      options,
    ),
    chartSeries(
      "uncached",
      "Uncached tokens",
      "Uncached Tokens by Model",
      "Input + output + cache write tokens · Lower is better",
      "var(--purple)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.uncached_tokens,
      false,
      formatInteger,
      options,
    ),
    chartSeries(
      "total",
      "Total tokens",
      "Total Tokens by Model",
      "Input + output + cache read + cache write tokens",
      "var(--red)",
      attempts,
      (attempt) => attempt.agent.telemetry.usage.total_tokens,
      false,
      formatInteger,
      options,
    ),
  ];
}

function chartSeries(
  id: string,
  label: string,
  title: string,
  subtitle: string,
  color: string,
  attempts: readonly AttemptReport[],
  getValue: (attempt: AttemptReport) => number | undefined,
  higherIsBetter: boolean,
  formatValue: (value: number) => string,
  options?: AttemptBarOptions,
): ChartSeries {
  const bars = attempts.map((attempt) => {
    const value = getValue(attempt);
    return {
      label: attempt.model.id,
      ...(value === undefined ? {} : { value }),
      display: value === undefined ? "—" : formatValue(value),
      color,
      higherIsBetter,
      scaleMode: "relative",
      href: options?.hrefForAttempt?.(attempt) ?? `#model-${slugify(attempt.model.id)}`,
      detail: `${attempt.model.id}\n${title}: ${value === undefined ? "not available" : formatValue(value)}\nBenchmark: ${attempt.benchmark_id}`,
    } satisfies BarDatum;
  });
  return { id, label, title, subtitle, color, bars: sortBars(bars, higherIsBetter) };
}

export function renderQualityBreakdownTable(attempts: readonly AttemptReport[]): string {
  return renderBreakdownTable(
    "Quality details by model",
    [
      "Model",
      "Score",
      "Verdict",
      "Attempt",
      "Changed files",
      "Failed tools",
      "Signals",
      "Artifacts",
    ],
    attempts.map((attempt) => {
      const failedToolCalls = attempt.tool_usage?.summary.failed_tool_calls ?? 0;
      const signalCount =
        attempt.agent.signals.length +
        (attempt.evaluation?.signals.length ?? 0) +
        (attempt.quality_signals?.length ?? 0);
      return {
        modelId: attempt.model.id,
        cells: [
          escapeHtml(attempt.model.id),
          String(attempt.status === "completed" ? (attempt.evaluation?.score ?? "—") : "—"),
          statusBadge(
            attempt.status === "completed" && attempt.evaluation
              ? attempt.evaluation.verdict
              : "not_run",
          ),
          statusBadge(attempt.status),
          String(attempt.submission?.changed_files.length ?? 0),
          String(failedToolCalls),
          String(signalCount),
          `${artifactLink(attempt.artifacts.candidate_patch, "patch")} ${artifactLink(attempt.artifacts.attempt_json, "json")}`,
        ],
      };
    }),
  );
}

export function renderSpeedBreakdownTable(attempts: readonly AttemptReport[]): string {
  return renderBreakdownTable(
    "Speed and timing details by model",
    ["Model", "Output tok/sec", "Agent", "Total", "Scoring", "Workspace", "Extract"],
    attempts.map((attempt) => {
      const speed = outputTokensPerSecond(attempt);
      const workspaceMs =
        (attempt.timings_ms?.agent_workspace_prepare_ms ?? 0) +
        (attempt.timings_ms?.evaluation_workspace_prepare_ms ?? 0);
      return {
        modelId: attempt.model.id,
        cells: [
          escapeHtml(attempt.model.id),
          speed === undefined ? "—" : formatNumber(speed, 1),
          formatDuration(attempt.timings_ms?.agent_process_ms),
          formatDuration(attempt.timings_ms?.total_ms),
          formatDuration(attempt.timings_ms?.evaluation_scoring_ms),
          formatDuration(workspaceMs),
          formatDuration(attempt.timings_ms?.agent_submission_extract_ms),
        ],
      };
    }),
  );
}

export function renderCostBreakdownTable(attempts: readonly AttemptReport[]): string {
  return renderBreakdownTable(
    "Cost and token details by model",
    ["Model", "Cost", "Input", "Output", "Cache read", "Cache write", "Uncached", "Total tokens"],
    attempts.map((attempt) => {
      const usage = attempt.agent.telemetry.usage;
      return {
        modelId: attempt.model.id,
        cells: [
          escapeHtml(attempt.model.id),
          formatUsd(usage.estimated_cost_usd?.total),
          formatInteger(usage.input_tokens),
          formatInteger(usage.output_tokens),
          formatInteger(usage.cache_read_tokens),
          formatInteger(usage.cache_write_tokens),
          formatInteger(usage.uncached_tokens),
          formatInteger(usage.total_tokens),
        ],
      };
    }),
  );
}

function renderBreakdownTable(
  caption: string,
  headers: readonly string[],
  rows: readonly { readonly modelId: string; readonly cells: readonly string[] }[],
): string {
  if (rows.length === 0) {
    return `<div class="breakdown-table"><table><caption>${escapeHtml(caption)}</caption><tbody><tr><td>No attempts yet.</td></tr></tbody></table></div>`;
  }
  return `<div class="breakdown-table"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr data-model-row="${escapeAttribute(slugify(row.modelId))}">${row.cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

interface OutcomeMatrixCell {
  readonly status: string;
  readonly label: string;
  readonly meta: string;
  readonly title: string;
  readonly href?: string;
  readonly attempts: readonly AttemptReport[];
}

export function renderOutcomeMatrix(
  results: RunResults,
  attempts: readonly AttemptReport[],
): string {
  const modelIds = [...new Set(attempts.map((attempt) => attempt.model.id))];
  if (modelIds.length === 0) {
    return `<div class="outcome-matrix-panel"><div class="quality-empty">No model attempts have been written yet.</div></div>`;
  }
  const rows = results.benchmark_results.map((benchmark) => {
    const benchmarkAttemptPaths = new Set(benchmark.attempts);
    const benchmarkAttempts = attempts.filter(
      (attempt) =>
        attempt.benchmark_id === benchmark.benchmark_id ||
        (attempt.artifacts.attempt_json !== undefined &&
          benchmarkAttemptPaths.has(attempt.artifacts.attempt_json)),
    );
    const cells = modelIds.map((modelId) =>
      outcomeMatrixCell(
        benchmark.benchmark_id,
        modelId,
        benchmarkAttempts.filter((attempt) => attempt.model.id === modelId),
      ),
    );
    const statuses = cells.map((cell) => cell.status);
    const attemptedCells = cells.filter((cell) => cell.status !== "not_run");
    const uniqueStatuses = new Set(statuses);
    const passCount = cells.filter((cell) => cell.status === "passed").length;
    const reviewCount = cells.filter((cell) => cell.status === "needs_review").length;
    const failureCount = cells.filter((cell) => isProblemMatrixStatus(cell.status)).length;
    const disagreement = uniqueStatuses.size > 1;
    const allPassed = attemptedCells.length > 0 && passCount === attemptedCells.length;
    const rowSearch = [benchmark.benchmark_id, ...modelIds, ...statuses].join(" ").toLowerCase();
    return {
      benchmarkId: benchmark.benchmark_id,
      cells,
      passCount,
      reviewCount,
      failureCount,
      attemptedCount: attemptedCells.length,
      disagreement,
      allPassed,
      rowSearch,
    };
  });
  const disagreementCount = rows.filter((row) => row.disagreement).length;
  const reviewCount = rows.filter((row) => row.reviewCount > 0).length;
  const failureCount = rows.filter((row) => row.failureCount > 0).length;
  const allPassedCount = rows.filter((row) => row.allPassed).length;

  return `<div class="outcome-matrix-panel" data-outcome-matrix>
    <div class="matrix-toolbar">
      <label class="matrix-search"><span>Search</span><input type="search" data-matrix-search placeholder="Search benchmarks or models…"></label>
      <div class="matrix-filter-group" role="group" aria-label="Outcome matrix filters">
        ${matrixFilterButton("all", "All", rows.length, true)}
        ${matrixFilterButton("disagreements", "Disagreements", disagreementCount)}
        ${matrixFilterButton("review", "Evaluator review", reviewCount)}
        ${matrixFilterButton("failures", "Failures", failureCount)}
        ${matrixFilterButton("passed", "All passed", allPassedCount)}
      </div>
      <span class="matrix-result-count" data-matrix-count>${rows.length} benchmark${rows.length === 1 ? "" : "s"}</span>
    </div>
    <div class="outcome-matrix-scroll">
      <table class="outcome-matrix-table${modelIds.length <= 4 ? " outcome-matrix-table-compact" : ""}">
        <thead><tr><th class="matrix-benchmark-col">Benchmark</th>${modelIds.map((modelId) => `<th class="matrix-model-col"><a href="${escapeAttribute(modelDetailReportPath(modelId))}">${escapeHtml(modelId)}</a></th>`).join("")}<th class="matrix-summary-col">Evaluator signal</th></tr></thead>
        <tbody>${rows
          .map(
            (row) =>
              `<tr data-matrix-row data-disagreement="${row.disagreement ? "true" : "false"}" data-has-review="${row.reviewCount > 0 ? "true" : "false"}" data-has-failure="${row.failureCount > 0 ? "true" : "false"}" data-all-passed="${row.allPassed ? "true" : "false"}" data-search="${escapeAttribute(row.rowSearch)}"><td class="matrix-benchmark-name"><a href="${escapeAttribute(benchmarkDetailReportPath(row.benchmarkId))}">${escapeHtml(row.benchmarkId)}</a></td>${row.cells.map(renderOutcomeMatrixCell).join("")}<td class="matrix-row-summary">${renderMatrixRowSummary(row.passCount, row.attemptedCount, row.reviewCount, row.failureCount)}</td></tr>`,
          )
          .join("\n")}</tbody>
      </table>
    </div>
  </div>`;
}

function matrixFilterButton(filter: string, label: string, count: number, active = false): string {
  return `<button type="button" class="tab matrix-filter${active ? " active" : ""}" data-matrix-filter="${escapeAttribute(filter)}">${escapeHtml(label)} <span>${count}</span></button>`;
}

function outcomeMatrixCell(
  benchmarkId: string,
  modelId: string,
  attempts: readonly AttemptReport[],
): OutcomeMatrixCell {
  if (attempts.length === 0) {
    return {
      status: "not_run",
      label: "—",
      meta: "not run",
      title: `${modelId} did not run ${benchmarkId}.`,
      attempts,
    };
  }
  const status = aggregateMatrixStatus(attempts);
  const selectedAttempt = bestMatrixAttempt(attempts);
  const passCount = attempts.filter((attempt) => attempt.evaluation?.verdict === "passed").length;
  const reviewCount = attempts.filter(
    (attempt) => attempt.evaluation?.verdict === "needs_review",
  ).length;
  const label =
    attempts.length === 1
      ? formatStatus(status)
      : passCount > 0
        ? `${passCount}/${attempts.length} pass`
        : reviewCount > 0
          ? `${reviewCount}/${attempts.length} eval review`
          : formatStatus(status);
  const score = selectedAttempt.evaluation?.score;
  const cost = selectedAttempt.agent.telemetry.usage.estimated_cost_usd?.total;
  const metaParts = [
    score === undefined ? undefined : String(score),
    cost === undefined ? undefined : formatUsd(cost),
  ].filter((part): part is string => part !== undefined && part !== "");
  return {
    status,
    label,
    meta: metaParts.join(" · "),
    title: attempts.map(matrixAttemptTitle).join("\n"),
    href: `${benchmarkDetailReportPath(benchmarkId)}${preferredQualityAttemptHref(selectedAttempt)}`,
    attempts,
  };
}

function aggregateMatrixStatus(attempts: readonly AttemptReport[]): string {
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "passed")) return "passed";
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "needs_review")) {
    return "needs_review";
  }
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "policy_issue")) {
    return "policy_issue";
  }
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "failed")) return "failed";
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "invalid_benchmark")) {
    return "invalid_benchmark";
  }
  if (attempts.some((attempt) => attempt.evaluation?.verdict === "inconclusive")) {
    return "inconclusive";
  }
  if (attempts.some((attempt) => attempt.status === "evaluation_failed"))
    return "evaluation_failed";
  if (attempts.some((attempt) => attempt.status === "agent_failed")) return "agent_failed";
  return attempts[0]?.status ?? "not_run";
}

function bestMatrixAttempt(attempts: readonly AttemptReport[]): AttemptReport {
  const first = attempts[0];
  if (first === undefined) {
    throw new Error("Cannot choose a matrix attempt from an empty attempt list.");
  }
  return [...attempts].sort((a, b) => matrixAttemptRank(b) - matrixAttemptRank(a))[0] ?? first;
}

function matrixAttemptRank(attempt: AttemptReport): number {
  const status = attempt.evaluation?.verdict ?? attempt.status;
  if (status === "passed") return 100;
  if (status === "needs_review") return 80;
  if (status === "policy_issue") return 60;
  if (status === "failed") return 50;
  if (attempt.status === "completed") return 40;
  if (status === "inconclusive") return 30;
  if (status === "evaluation_failed") return 20;
  if (status === "agent_failed") return 10;
  return 0;
}

function matrixAttemptTitle(attempt: AttemptReport): string {
  const status = attempt.evaluation?.verdict ?? attempt.status;
  const signalCount =
    attempt.agent.signals.length +
    (attempt.evaluation?.signals.length ?? 0) +
    (attempt.quality_signals?.length ?? 0);
  return [
    `${attempt.model.id} attempt ${attempt.attempt}: ${formatStatus(status)}`,
    attempt.evaluation?.score === undefined ? undefined : `score ${attempt.evaluation.score}`,
    attempt.agent.telemetry.usage.estimated_cost_usd?.total === undefined
      ? undefined
      : formatUsd(attempt.agent.telemetry.usage.estimated_cost_usd.total),
    `${formatCompactInteger(attempt.agent.telemetry.usage.total_tokens)} tokens`,
    `${attempt.submission?.changed_files.length ?? 0} files`,
    `${signalCount} signals`,
    `${attempt.tool_usage?.summary.tool_calls ?? 0} tool calls`,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");
}

function renderOutcomeMatrixCell(cell: OutcomeMatrixCell): string {
  const body = `<span class="matrix-cell-label">${escapeHtml(cell.label)}</span>${cell.meta ? `<span class="matrix-cell-meta">${escapeHtml(cell.meta)}</span>` : ""}`;
  const className = `matrix-cell matrix-cell-${escapeAttribute(statusClassName(cell.status))}`;
  return `<td>${cell.href === undefined ? `<span class="${className}" title="${escapeAttribute(cell.title)}">${body}</span>` : `<a class="${className}" href="${escapeAttribute(cell.href)}" title="${escapeAttribute(cell.title)}">${body}</a>`}</td>`;
}

function renderMatrixRowSummary(
  passCount: number,
  attemptedCount: number,
  reviewCount: number,
  failureCount: number,
): string {
  if (attemptedCount === 0) return statusBadge("not_run");
  if (passCount === attemptedCount)
    return `<span class="matrix-summary-pass">${passCount}/${attemptedCount} passed</span>`;
  if (reviewCount > 0 && failureCount === 0) {
    return `<span class="matrix-summary-review">${reviewCount} eval review · ${passCount}/${attemptedCount} passed</span>`;
  }
  if (failureCount > 0) {
    return `<span class="matrix-summary-fail">${failureCount} problem · ${passCount}/${attemptedCount} passed</span>`;
  }
  return `<span>${passCount}/${attemptedCount} passed</span>`;
}

function isProblemMatrixStatus(status: string): boolean {
  return [
    "failed",
    "policy_issue",
    "agent_failed",
    "evaluation_failed",
    "invalid_benchmark",
    "inconclusive",
  ].includes(status);
}

function statusClassName(status: string): string {
  return status.replace(/[^a-z0-9_-]/gi, "_");
}

export function renderAttemptRows(attempts: readonly AttemptReport[]): string {
  return attempts
    .map(
      (attempt) => `<tr id="${escapeAttribute(attemptDomId(attempt))}">
<td><span class="artifact-table-id" title="${escapeAttribute(attempt.benchmark_id)}">${escapeHtml(attempt.benchmark_id)}</span></td>
<td><span class="model-name-truncated" title="${escapeAttribute(attempt.model.id)}">${escapeHtml(attempt.model.id)}</span></td>
<td>${statusBadge(attempt.status)}</td>
<td>${statusBadge(attempt.agent.status)}</td>
<td>${statusBadge(attempt.evaluation?.verdict ?? "not_run")}</td>
<td>${attempt.evaluation?.score ?? ""}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.input_tokens)}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.output_tokens)}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.cache_read_tokens)}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.cache_write_tokens)}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.uncached_tokens)}</td>
<td>${formatCompactInteger(attempt.agent.telemetry.usage.total_tokens)}</td>
<td>${formatUsd(attempt.agent.telemetry.usage.estimated_cost_usd?.total)}</td>
<td>${formatDuration(attempt.timings_ms?.total_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.agent_workspace_prepare_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.evaluation_workspace_prepare_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.evaluation_scoring_ms)}</td>
<td><span class="artifact-table-tool-usage" title="${escapeAttribute(renderToolUsageCell(attempt))}">${renderToolUsageSummary(attempt)}</span></td>
<td>${artifactLink(attempt.artifacts.candidate_patch, "patch")}</td>
<td>${artifactLink(attempt.artifacts.attempt_json, "json")}</td>
</tr>`,
    )
    .join("\n");
}

function attemptDomId(attempt: AttemptReport): string {
  return `attempt-${slugify(`${attempt.benchmark_id}-${attempt.model.id}-${attempt.attempt}`)}`;
}

export function renderBenchmarkRows(results: RunResults): string {
  return results.benchmark_results
    .map((benchmark) => {
      const pending = benchmark.attempts.length === 0;
      return `<tr${pending ? ` class="pending-row"` : ""}>
<td><a href="${escapeAttribute(benchmarkDetailReportPath(benchmark.benchmark_id))}">${escapeHtml(benchmark.benchmark_id)}</a></td>
<td>${pending ? statusBadge(results.status === "running" ? "pending" : "not_run") : statusBadge("completed")}</td>
<td>${pending ? `<span class="skeleton"></span>` : benchmark.attempts.length}</td>
<td>${pending && results.status === "running" ? `<span class="skeleton"></span>` : formatDuration(benchmark.duration_ms)}</td>
</tr>`;
    })
    .join("\n");
}

function renderToolUsageCell(attempt: AttemptReport): string {
  const usage = attempt.tool_usage;
  if (!usage) {
    return "";
  }
  const categoryText =
    usage.categories.length > 0
      ? usage.categories.map((category) => `${category.label}: ${category.status}`).join("; ")
      : "No highlighted categories configured";
  return `Tool calls: ${usage.summary.tool_calls}; Failed: ${usage.summary.failed_tool_calls}; ${categoryText}`;
}

function renderToolUsageSummary(attempt: AttemptReport): string {
  const usage = attempt.tool_usage;
  if (!usage) return "";
  return escapeHtml(
    `${usage.summary.tool_calls} calls / ${usage.summary.failed_tool_calls} failed`,
  );
}

function formatCompactInteger(value: number): string {
  return value >= 1000 ? formatCompact(value) : formatInteger(value);
}

function cacheReadDominates(
  summary: Pick<RunResults["summary"], "cache_read_tokens" | "total_tokens">,
): boolean {
  return summary.total_tokens > 0 && summary.cache_read_tokens / summary.total_tokens >= 0.5;
}

function outputTokensPerSecond(attempt: AttemptReport): number | undefined {
  const durationMs = attempt.timings_ms?.agent_process_ms ?? attempt.timings_ms?.agent_total_ms;
  if (!durationMs || durationMs <= 0) {
    return undefined;
  }
  return attempt.agent.telemetry.usage.output_tokens / (durationMs / 1000);
}
