import type { AttemptReport, RunResults } from "../../run/types.js";
import {
  escapeAttribute,
  escapeHtml,
  formatInteger,
  formatNumber,
  formatRunMode,
  formatStatus,
  formatUsd,
  modelDetailReportPath,
} from "../html-report-components.js";
import { reportScripts } from "../html-report-scripts.js";
import { reportStyles } from "../html-report-styles.js";
import { average, clamp, median, round } from "../shared/math.js";
import { renderReportFooter, renderTopbar } from "../shared/page-shell.js";

interface ModelOverview {
  readonly modelId: string;
  readonly attempts: number;
  readonly passed: number;
  readonly passRate: number;
  readonly averageScore?: number;
  readonly medianSpeed?: number;
  readonly averageCost?: number;
  readonly failedTools: number;
  readonly averageFilesChanged: number;
  readonly capabilities: readonly number[];
}

const capabilityLabels = ["Quality", "Reliability", "Speed", "Cost", "Tools", "Focus"] as const;
const radarColors = ["#18b7c2", "#16c784", "#4d8dff", "#f5a524", "#ff5a5f", "#7c3aed"];

export function renderModelsReport(options: {
  readonly results: RunResults;
  readonly attempts: readonly AttemptReport[];
}): string {
  const models = modelOverviews(options.attempts);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ShipTest models</title>
<style>
${reportStyles}
</style>
</head>
<body data-theme="shiptest">
<div class="page">
  ${renderTopbar({
    ariaLabel: "Models report navigation",
    nav: [
      { label: "← Suite report", href: "report.html", active: true },
      { label: "Radar", href: "#model-radar" },
      { label: "Table", href: "#model-table" },
    ],
  })}

  <section class="hero">
    <div>
      <div class="kicker">${escapeHtml(options.results.project.name)} • ${models.length} model${models.length === 1 ? "" : "s"}</div>
      <h1>Model capability comparison</h1>
      <div class="run-meta">
        <span class="meta-chip">Run <code>${escapeHtml(options.results.run_id)}</code></span>
        <span class="meta-chip status-chip ${escapeAttribute(options.results.status)}">${escapeHtml(formatStatus(options.results.status))}</span>
        <span class="meta-chip">${formatRunMode(options.results)}</span>
      </div>
    </div>
    <a class="primary-action" href="report.html">Back to suite ↗</a>
  </section>

  <section id="model-leaders">
    <div class="section-head"><div class="section-title">Model leaders</div><div class="muted small">Fast takeaways across quality, speed, cost, and reliability.</div></div>
    <section class="insight-grid">${renderLeaderCards(models)}</section>
  </section>

  <section id="model-radar">
    <div class="section-head"><div class="section-title">Capability radar</div><div class="muted small">Normalized to this run. Use it as a relative comparison, not an absolute model benchmark.</div></div>
    <div class="model-radar-panel">
      <div class="radar-card">${renderMultiRadar(models)}</div>
      <div class="model-radar-legend">${models.map((model, index) => `<a href="${escapeAttribute(modelDetailReportPath(model.modelId))}" data-model-radar-legend="${escapeAttribute(slugify(model.modelId))}"><span style="background:${radarColors[index % radarColors.length]}"></span>${escapeHtml(model.modelId)}</a>`).join("")}</div>
    </div>
  </section>

  <section id="model-table">
    <div class="section-head"><div class="section-title">Model comparison table</div><div class="muted small">Detailed model-level aggregates with links to model profiles.</div></div>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>Model</th><th>Attempts</th><th>Pass rate</th><th>Avg score</th><th>Median speed</th><th>Avg cost</th><th>Failed tools</th><th>Avg files</th><th>Profile</th></tr></thead>
        <tbody>${models.map(renderModelRow).join("\n")}</tbody>
      </table>
    </div>
  </section>

  ${renderReportFooter("Models compared.")}
</div>
<script>
${reportScripts}
</script>
</body>
</html>`;
}

function renderLeaderCards(models: readonly ModelOverview[]): string {
  const bestQuality = [...models].sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))[0];
  const fastest = [...models]
    .filter((model) => model.medianSpeed !== undefined)
    .sort((a, b) => (b.medianSpeed ?? 0) - (a.medianSpeed ?? 0))[0];
  const cheapest = [...models]
    .filter((model) => model.averageCost !== undefined)
    .sort(
      (a, b) =>
        (a.averageCost ?? Number.POSITIVE_INFINITY) - (b.averageCost ?? Number.POSITIVE_INFINITY),
    )[0];
  const reliable = [...models].sort(
    (a, b) => b.passRate - a.passRate || b.attempts - a.attempts,
  )[0];
  const cards = [
    {
      tone: "quality",
      title: "Best quality",
      model: bestQuality,
      value:
        bestQuality?.averageScore === undefined
          ? "—"
          : String(Math.round(bestQuality.averageScore)),
      label: bestQuality?.modelId ?? "no data",
    },
    {
      tone: "speed",
      title: "Fastest",
      model: fastest,
      value: fastest?.medianSpeed === undefined ? "—" : formatNumber(fastest.medianSpeed, 1),
      label: fastest?.modelId ?? "no speed data",
    },
    {
      tone: "cost",
      title: "Cheapest",
      model: cheapest,
      value: formatUsd(cheapest?.averageCost),
      label: cheapest?.modelId ?? "no cost data",
    },
    {
      tone: "pending",
      title: "Most reliable",
      model: reliable,
      value: reliable === undefined ? "—" : `${Math.round(reliable.passRate)}%`,
      label: reliable?.modelId ?? "no data",
    },
  ];
  return cards
    .map(
      (card) =>
        `<a class="metric-card insight-card insight-card-link ${card.tone}" href="${card.model ? escapeAttribute(modelDetailReportPath(card.model.modelId)) : "#model-table"}"><div class="metric-head"><span class="metric-title">${escapeHtml(card.title)}</span><span class="rank">open profile</span></div><div class="metric-value"><span class="insight-value">${escapeHtml(card.value)}</span><span class="metric-label">${escapeHtml(card.label)}</span></div></a>`,
    )
    .join("");
}

function renderMultiRadar(models: readonly ModelOverview[]): string {
  const size = 390;
  const center = size / 2;
  const radius = 135;
  return `<svg class="radar-chart multi-radar-chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Model capability comparison radar chart">
    ${[25, 50, 75, 100].map((ring) => `<polygon class="radar-ring" points="${regularPolygonPoints(capabilityLabels.length, center, radius * (ring / 100))}"></polygon>`).join("")}
    ${capabilityLabels
      .map((_, index) => {
        const point = radarPoint(index, capabilityLabels.length, center, radius);
        return `<line class="radar-axis" x1="${center}" y1="${center}" x2="${point.x}" y2="${point.y}"></line>`;
      })
      .join("")}
    ${models
      .map((model, modelIndex) => {
        const color = radarColors[modelIndex % radarColors.length];
        const points = model.capabilities
          .map((value, index) =>
            radarPoint(index, capabilityLabels.length, center, radius * (value / 100)),
          )
          .map((point) => `${point.x},${point.y}`)
          .join(" ");
        return `<polygon class="radar-area multi-radar-area" points="${points}" style="--radar-color:${color}" data-model-radar="${escapeAttribute(slugify(model.modelId))}"></polygon>`;
      })
      .join("")}
    ${capabilityLabels
      .map((label, index) => {
        const point = radarPoint(index, capabilityLabels.length, center, radius + 34);
        return `<text class="radar-label" x="${point.x}" y="${point.y}">${escapeHtml(label)}</text>`;
      })
      .join("")}
  </svg>`;
}

function renderModelRow(model: ModelOverview): string {
  return `<tr><td>${escapeHtml(model.modelId)}</td><td>${model.attempts}</td><td>${Math.round(model.passRate)}%</td><td>${model.averageScore === undefined ? "—" : formatNumber(model.averageScore, 1)}</td><td>${model.medianSpeed === undefined ? "—" : formatNumber(model.medianSpeed, 1)}</td><td>${formatUsd(model.averageCost)}</td><td>${formatInteger(model.failedTools)}</td><td>${formatNumber(model.averageFilesChanged, 1)}</td><td><a class="artifact-row-link" href="${escapeAttribute(modelDetailReportPath(model.modelId))}">profile</a></td></tr>`;
}

function modelOverviews(attempts: readonly AttemptReport[]): ModelOverview[] {
  const byModel = new Map<string, AttemptReport[]>();
  for (const attempt of attempts) {
    const existing = byModel.get(attempt.model.id) ?? [];
    existing.push(attempt);
    byModel.set(attempt.model.id, existing);
  }
  const base = [...byModel.entries()].map(([modelId, modelAttempts]) =>
    aggregateModel(modelId, modelAttempts),
  );
  const maxSpeed = Math.max(...base.map((model) => model.medianSpeed ?? 0), 0);
  const costs = base
    .map((model) => model.averageCost)
    .filter((cost): cost is number => cost !== undefined && cost > 0);
  const minCost = costs.length > 0 ? Math.min(...costs) : undefined;
  const maxFailedToolsPerAttempt = Math.max(
    ...base.map((model) => model.failedTools / Math.max(model.attempts, 1)),
    0,
  );
  const maxFiles = Math.max(...base.map((model) => model.averageFilesChanged), 0);
  return base
    .map((model) => ({
      ...model,
      capabilities: [
        clamp(model.averageScore ?? 0),
        clamp(model.passRate),
        clamp(
          maxSpeed <= 0 || model.medianSpeed === undefined
            ? 0
            : (model.medianSpeed / maxSpeed) * 100,
        ),
        clamp(
          minCost === undefined || model.averageCost === undefined || model.averageCost <= 0
            ? 0
            : (minCost / model.averageCost) * 100,
        ),
        clamp(
          maxFailedToolsPerAttempt <= 0
            ? 100
            : 100 -
                (model.failedTools / Math.max(model.attempts, 1) / maxFailedToolsPerAttempt) * 100,
        ),
        clamp(maxFiles <= 0 ? 100 : 100 - (model.averageFilesChanged / maxFiles) * 100),
      ],
    }))
    .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0));
}

function aggregateModel(
  modelId: string,
  attempts: readonly AttemptReport[],
): Omit<ModelOverview, "capabilities"> {
  const scores = attempts
    .map((attempt) => attempt.evaluation?.score)
    .filter((score): score is number => score !== undefined);
  const speeds = attempts
    .map(outputTokensPerSecond)
    .filter((speed): speed is number => speed !== undefined);
  const costs = attempts
    .map((attempt) => attempt.agent.telemetry.usage.estimated_cost_usd?.total)
    .filter((cost): cost is number => cost !== undefined);
  const averageScore = average(scores);
  const medianSpeed = median(speeds);
  const averageCost = average(costs);
  return {
    modelId,
    attempts: attempts.length,
    passed: attempts.filter((attempt) => attempt.evaluation?.verdict === "passed").length,
    passRate:
      attempts.length === 0
        ? 0
        : (attempts.filter((attempt) => attempt.evaluation?.verdict === "passed").length /
            attempts.length) *
          100,
    ...(averageScore === undefined ? {} : { averageScore }),
    ...(medianSpeed === undefined ? {} : { medianSpeed }),
    ...(averageCost === undefined ? {} : { averageCost }),
    failedTools: attempts.reduce(
      (sum, attempt) => sum + (attempt.tool_usage?.summary.failed_tool_calls ?? 0),
      0,
    ),
    averageFilesChanged:
      average(attempts.map((attempt) => attempt.submission?.changed_files.length ?? 0)) ?? 0,
  };
}

function outputTokensPerSecond(attempt: AttemptReport): number | undefined {
  const outputTokens = attempt.agent.telemetry.usage.output_tokens;
  const processMs = attempt.timings_ms?.agent_process_ms;
  if (!outputTokens || !processMs || processMs <= 0) return undefined;
  return outputTokens / (processMs / 1000);
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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
