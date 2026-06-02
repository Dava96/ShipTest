import type { AttemptReport, RunResults } from "../../run/types.js";
import {
  escapeAttribute,
  escapeHtml,
  formatDuration,
  formatRunMode,
  formatStatus,
  formatUsd,
  modelDetailReportPath,
  renderAttemptRows,
  statusBadge,
} from "../html-report-components.js";
import { reportScripts } from "../html-report-scripts.js";
import { reportStyles } from "../html-report-styles.js";
import { average, median, round } from "../shared/math.js";
import { renderReportFooter, renderTopbar } from "../shared/page-shell.js";

interface CapabilityScore {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly detail: string;
}

interface ModelCapabilitySummary {
  readonly attempts: number;
  readonly passed: number;
  readonly averageScore?: number;
  readonly medianSpeed?: number;
  readonly averageCost?: number;
  readonly failedTools: number;
  readonly totalTools: number;
  readonly averageFilesChanged: number;
  readonly capabilities: readonly CapabilityScore[];
}

export function renderModelReport(options: {
  readonly results: RunResults;
  readonly modelId: string;
  readonly attempts: readonly AttemptReport[];
  readonly allAttempts: readonly AttemptReport[];
}): string {
  const { results, modelId, attempts, allAttempts } = options;
  const summary = modelCapabilitySummary(modelId, attempts, allAttempts);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ShipTest model ${escapeHtml(modelId)}</title>
<style>
${reportStyles}
</style>
</head>
<body data-theme="shiptest">
<div class="page">
  ${renderTopbar({
    ariaLabel: "Model report navigation",
    nav: [
      { label: "← Suite report", href: "report.html" },
      { label: "Capabilities", href: "#capabilities", active: true },
      { label: "Benchmarks", href: "#benchmarks" },
      { label: "Artifacts", href: "#artifacts" },
    ],
  })}

  <section class="hero">
    <div>
      <div class="kicker">${escapeHtml(results.project.name)} • ${summary.attempts} attempt${summary.attempts === 1 ? "" : "s"}</div>
      <h1>${escapeHtml(modelId)}</h1>
      <div class="run-meta">
        <span class="meta-chip">Run <code>${escapeHtml(results.run_id)}</code></span>
        <span class="meta-chip status-chip ${escapeAttribute(results.status)}">${escapeHtml(formatStatus(results.status))}</span>
        <span class="meta-chip">${formatRunMode(results)}</span>
      </div>
    </div>
    <a class="primary-action" href="report.html">Back to suite ↗</a>
  </section>

  <section id="capabilities">
    <div class="section-head"><div class="section-title">Model capability profile</div><div class="muted small">Normalized from this run only; useful for relative strengths and weaknesses.</div></div>
    <div class="model-profile-grid">
      <div class="radar-card">
        <h2>Strengths radar</h2>
        ${renderRadarChart(summary.capabilities)}
      </div>
      <div class="model-score-grid">
        ${summary.capabilities.map(renderCapabilityCard).join("")}
      </div>
    </div>
  </section>

  <section id="benchmarks">
    <div class="section-head"><div class="section-title">Benchmark performance</div><div class="muted small">Every benchmark attempt for this model.</div></div>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>Benchmark</th><th>Verdict</th><th>Score</th><th>Changed files</th><th>Failed tools</th><th>Signals</th><th>Elapsed</th><th>Benchmark page</th></tr></thead>
        <tbody>${attempts.map(renderModelBenchmarkRow).join("\n")}</tbody>
      </table>
    </div>
  </section>

  <section id="artifacts">
    <div class="section-head"><div class="section-title">Attempts & artifacts</div><div class="muted small">Raw evidence for this model.</div></div>
    <div class="panel table-wrap paginated-table" data-paginated-table data-page-size="5">
      <table>
        <thead><tr><th>Benchmark</th><th>Model</th><th>Status</th><th>Agent</th><th>Verdict</th><th>Score</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Uncached</th><th>Total tokens</th><th>Cost</th><th>Elapsed</th><th>Agent copy</th><th>Eval copy</th><th>Scoring</th><th>Tool usage</th><th>Patch</th><th>Attempt</th></tr></thead>
        <tbody>${renderAttemptRows(attempts)}</tbody>
      </table>
    </div>
  </section>
  ${renderReportFooter("Model profile inspected.")}
</div>
<script>
${reportScripts}
</script>
</body>
</html>`;
}

function modelCapabilitySummary(
  _modelId: string,
  attempts: readonly AttemptReport[],
  allAttempts: readonly AttemptReport[],
): ModelCapabilitySummary {
  const modelStats = aggregateModelStats(attempts);
  const allStats = [...new Set(allAttempts.map((attempt) => attempt.model.id))].map((id) =>
    aggregateModelStats(allAttempts.filter((attempt) => attempt.model.id === id)),
  );
  const maxSpeed = Math.max(...allStats.map((stats) => stats.medianSpeed ?? 0), 0);
  const costs = allStats
    .map((stats) => stats.averageCost)
    .filter((cost): cost is number => cost !== undefined && cost > 0);
  const minCost = costs.length > 0 ? Math.min(...costs) : undefined;
  const maxFilesChanged = Math.max(...allStats.map((stats) => stats.averageFilesChanged), 0);
  return {
    ...modelStats,
    capabilities: [
      {
        id: "quality",
        label: "Quality",
        value: clampScore(modelStats.averageScore ?? 0),
        detail:
          modelStats.averageScore === undefined
            ? "no evaluator scores"
            : `${Math.round(modelStats.averageScore)} average score`,
      },
      {
        id: "reliability",
        label: "Reliability",
        value: modelStats.attempts === 0 ? 0 : (modelStats.passed / modelStats.attempts) * 100,
        detail: `${modelStats.passed}/${modelStats.attempts} passed`,
      },
      {
        id: "speed",
        label: "Speed",
        value:
          maxSpeed <= 0 || modelStats.medianSpeed === undefined
            ? 0
            : (modelStats.medianSpeed / maxSpeed) * 100,
        detail:
          modelStats.medianSpeed === undefined
            ? "speed unavailable"
            : `${formatNumber(modelStats.medianSpeed, 1)} output tok/sec median`,
      },
      {
        id: "cost",
        label: "Cost efficiency",
        value:
          minCost === undefined ||
          modelStats.averageCost === undefined ||
          modelStats.averageCost <= 0
            ? 0
            : (minCost / modelStats.averageCost) * 100,
        detail:
          modelStats.averageCost === undefined
            ? "cost unavailable"
            : `${formatUsd(modelStats.averageCost)} average cost`,
      },
      {
        id: "tools",
        label: "Tool reliability",
        value: modelStats.totalTools <= 0 ? 0 : toolReliabilityPercent(modelStats),
        detail:
          modelStats.totalTools <= 0
            ? "no tool calls observed"
            : `${modelStats.totalTools - modelStats.failedTools}/${modelStats.totalTools} tool calls succeeded`,
      },
      {
        id: "focus",
        label: "Patch focus",
        value: patchFocusScore(modelStats.averageFilesChanged, maxFilesChanged),
        detail: `${formatNumber(modelStats.averageFilesChanged, 1)} files changed per attempt`,
      },
    ].map((score) => ({ ...score, value: clampScore(score.value) })),
  };
}

function aggregateModelStats(
  attempts: readonly AttemptReport[],
): Omit<ModelCapabilitySummary, "capabilities"> {
  const completedAttempts = attempts.filter((attempt) => attempt.status === "completed");
  const scores = completedAttempts
    .map((attempt) => attempt.evaluation?.score)
    .filter((score): score is number => score !== undefined);
  const speeds = completedAttempts
    .map(outputTokensPerSecond)
    .filter((speed): speed is number => speed !== undefined);
  const costs = attempts
    .map((attempt) => attempt.agent.telemetry.usage.estimated_cost_usd?.total)
    .filter((cost): cost is number => cost !== undefined);
  const averageScore = average(scores);
  const medianSpeed = median(speeds);
  const averageCost = average(costs);
  return {
    attempts: attempts.length,
    passed: completedAttempts.filter((attempt) => attempt.evaluation?.verdict === "passed").length,
    ...(averageScore === undefined ? {} : { averageScore }),
    ...(medianSpeed === undefined ? {} : { medianSpeed }),
    ...(averageCost === undefined ? {} : { averageCost }),
    failedTools: completedAttempts.reduce(
      (sum, attempt) => sum + (attempt.tool_usage?.summary.failed_tool_calls ?? 0),
      0,
    ),
    totalTools: completedAttempts.reduce(
      (sum, attempt) => sum + (attempt.tool_usage?.summary.tool_calls ?? 0),
      0,
    ),
    averageFilesChanged:
      average(completedAttempts.map((attempt) => attempt.submission?.changed_files.length ?? 0)) ??
      0,
  };
}

function toolReliabilityPercent(
  modelStats: Pick<ModelCapabilitySummary, "failedTools" | "totalTools">,
): number {
  if (modelStats.totalTools <= 0) return 0;
  return ((modelStats.totalTools - modelStats.failedTools) / modelStats.totalTools) * 100;
}

function patchFocusScore(averageFilesChanged: number, maxFilesChanged: number): number {
  if (averageFilesChanged <= 0 || maxFilesChanged <= 0) return 0;
  if (maxFilesChanged <= 1) return 100;
  return 100 - ((averageFilesChanged - 1) / (maxFilesChanged - 1)) * 100;
}

function renderRadarChart(capabilities: readonly CapabilityScore[]): string {
  const size = 360;
  const center = size / 2;
  const radius = 130;
  const rings = [25, 50, 75, 100];
  const points = capabilities.map((capability, index) =>
    radarPoint(index, capabilities.length, center, radius * (capability.value / 100)),
  );
  const polygon = points.map((point) => `${point.x},${point.y}`).join(" ");
  return `<svg class="radar-chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Model strengths radar chart">
    ${rings.map((ring) => `<polygon class="radar-ring" points="${regularPolygonPoints(capabilities.length, center, radius * (ring / 100))}"></polygon>`).join("")}
    ${capabilities
      .map((_, index) => {
        const point = radarPoint(index, capabilities.length, center, radius);
        return `<line class="radar-axis" x1="${center}" y1="${center}" x2="${point.x}" y2="${point.y}"></line>`;
      })
      .join("")}
    <polygon class="radar-area" points="${polygon}"></polygon>
    ${points.map((point) => `<circle class="radar-dot" cx="${point.x}" cy="${point.y}" r="4"></circle>`).join("")}
    ${capabilities
      .map((capability, index) => {
        const point = radarPoint(index, capabilities.length, center, radius + 30);
        return `<text class="radar-label" x="${point.x}" y="${point.y}">${escapeHtml(capability.label)}</text>`;
      })
      .join("")}
  </svg>`;
}

function renderCapabilityCard(score: CapabilityScore): string {
  return `<div class="capability-card"><div class="metric-head"><span class="metric-title">${escapeHtml(score.label)}</span><span class="rank">${Math.round(score.value)}/100</span></div><div class="capability-meter"><span style="width:${score.value}%"></span></div><div class="metric-label">${escapeHtml(score.detail)}</div></div>`;
}

function renderModelBenchmarkRow(attempt: AttemptReport): string {
  const failedTools = attempt.tool_usage?.summary.failed_tool_calls ?? 0;
  const signals =
    attempt.agent.signals.length +
    (attempt.evaluation?.signals.length ?? 0) +
    (attempt.quality_signals?.length ?? 0);
  const status =
    attempt.status === "completed" && attempt.evaluation
      ? attempt.evaluation.verdict
      : attempt.status;
  return `<tr><td>${escapeHtml(attempt.benchmark_id)}</td><td>${statusBadge(status)}</td><td>${attempt.status === "completed" ? (attempt.evaluation?.score ?? "") : ""}</td><td>${attempt.submission?.changed_files.length ?? 0}</td><td>${failedTools}</td><td>${signals}</td><td>${formatDuration(attempt.timings_ms?.total_ms)}</td><td><a class="artifact-row-link" href="benchmark-${escapeAttribute(slugify(attempt.benchmark_id))}.html">details</a></td></tr>`;
}

function radarPoint(
  index: number,
  count: number,
  center: number,
  radius: number,
): { readonly x: number; readonly y: number } {
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: round(center + Math.cos(angle) * radius),
    y: round(center + Math.sin(angle) * radius),
  };
}

function regularPolygonPoints(count: number, center: number, radius: number): string {
  return Array.from({ length: count }, (_, index) => {
    const point = radarPoint(index, count, center, radius);
    return `${point.x},${point.y}`;
  }).join(" ");
}

function outputTokensPerSecond(attempt: AttemptReport): number | undefined {
  const outputTokens = attempt.agent.telemetry.usage.output_tokens;
  const processMs = attempt.timings_ms?.agent_process_ms;
  if (!outputTokens || !processMs || processMs <= 0) return undefined;
  return outputTokens / (processMs / 1000);
}

function formatNumber(value: number, digits: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(value);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export { modelDetailReportPath };
