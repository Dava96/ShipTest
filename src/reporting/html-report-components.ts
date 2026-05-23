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
    <div class="metric-card pending${pendingCount > 0 ? " pending-active" : ""}"><div class="metric-head"><span class="metric-title">Pending</span><span class="rank">${formatStatus(results.status)}</span></div>${pendingCount > 0 ? renderPendingFleet(pendingCount) : '<div class="icon-row">✓ ✓ ✓</div>'}<div class="metric-value"><span class="metric-number">${pendingCount}</span><span class="metric-label">benchmarks awaiting attempts</span></div></div>
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

export function qualityBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
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
      href: `#model-${slugify(aggregate.modelId)}`,
      detail: `${aggregate.modelId}\nAverage quality: ${formatNumber(aggregate.averageQuality, 1)}\nPasses: ${aggregate.passed}/${aggregate.attempts}\nFailures counted as 0`,
    })),
    true,
  ).slice(0, 8);
}

export function speedBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
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
      href: `#model-${slugify(aggregate.modelId)}`,
      detail: `${aggregate.modelId}\nMedian speed: ${aggregate.medianSpeed === undefined ? "not available" : `${formatNumber(aggregate.medianSpeed, 1)} output tok/sec`}\nAttempts: ${aggregate.attempts}`,
    })),
    true,
  ).slice(0, 8);
}

export function costBars(
  attempts: readonly AttemptReport[],
  pendingBenchmarks: readonly RunResults["benchmark_results"][number][],
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
      href: `#model-${slugify(aggregate.modelId)}`,
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

function qualityScoreForAttempt(attempt: AttemptReport): number {
  if (attempt.status === "agent_failed" || !attempt.evaluation) {
    return 0;
  }
  if (attempt.evaluation.score !== undefined) {
    return attempt.evaluation.score;
  }
  return attempt.evaluation.verdict === "passed" ? 100 : 0;
}

export function benchmarkQualitySeries(attempts: readonly AttemptReport[]): readonly ChartSeries[] {
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
    ),
  ];
}

export function benchmarkSpeedSeries(attempts: readonly AttemptReport[]): readonly ChartSeries[] {
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
    ),
  ];
}

export function benchmarkCostSeries(attempts: readonly AttemptReport[]): readonly ChartSeries[] {
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
      href: `#model-${slugify(attempt.model.id)}`,
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
  return `<div class="breakdown-table"><table><caption>${escapeHtml(caption)}</caption><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr id="model-${escapeAttribute(slugify(row.modelId))}" data-model-row="${escapeAttribute(slugify(row.modelId))}">${row.cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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
