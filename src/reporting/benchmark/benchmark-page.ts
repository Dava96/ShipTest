import type { AttemptReport, RunResults } from "../../run/types.js";
import {
  benchmarkCostSeries,
  benchmarkQualitySeries,
  benchmarkSpeedSeries,
  costBars,
  escapeAttribute,
  escapeHtml,
  formatRunMode,
  formatStatus,
  preferredQualityAttemptHref,
  qualityBars,
  renderAttemptRows,
  renderBarChart,
  renderCostBreakdownTable,
  renderQualityBreakdownTable,
  renderQualityDetails,
  renderSpeedBreakdownTable,
  speedBars,
} from "../html-report-components.js";
import { reportScripts } from "../html-report-scripts.js";
import { reportStyles } from "../html-report-styles.js";
import { artifactLink } from "../shared/artifacts.js";
import { renderReportFooter, renderTopbar } from "../shared/page-shell.js";

export function renderBenchmarkReport(options: {
  readonly results: RunResults;
  readonly benchmarkId: string;
  readonly attempts: readonly AttemptReport[];
}): string {
  const { results, benchmarkId, attempts } = options;
  const preferredReviewHrefForModel = (modelId: string) => {
    const attempt = attempts.find((item) => item.model.id === modelId);
    return attempt ? preferredQualityAttemptHref(attempt) : "#quality-details";
  };
  const attemptBarLinks = { hrefForAttempt: preferredQualityAttemptHref };
  const modelBarLinks = { hrefForModel: preferredReviewHrefForModel };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ShipTest benchmark ${escapeHtml(benchmarkId)}</title>
<style>
${reportStyles}
</style>
</head>
<body data-theme="shiptest">
<div class="page">
  ${renderTopbar({
    ariaLabel: "Benchmark report navigation",
    nav: [
      { label: "← Suite report", href: "report.html" },
      { label: "Comparison", href: "#benchmark-comparison", active: true },
      { label: "Task", href: "#task" },
      { label: "Quality details", href: "#quality-details" },
      { label: "Artifacts", href: "#artifacts" },
    ],
  })}

  <section class="hero">
    <div>
      <div class="kicker">${escapeHtml(results.project.name)} • ${attempts.length} model attempt${attempts.length === 1 ? "" : "s"}</div>
      <h1>${escapeHtml(benchmarkId)}</h1>
      <div class="run-meta">
        <span class="meta-chip">Run <code>${escapeHtml(results.run_id)}</code></span>
        <span class="meta-chip status-chip ${escapeAttribute(results.status)}">${escapeHtml(formatStatus(results.status))}</span>
        <span class="meta-chip">${formatRunMode(results)}</span>
      </div>
    </div>
    <a class="primary-action" href="report.html">Back to suite ↗</a>
  </section>

  <section id="benchmark-comparison">
    <div class="section-head"><div class="section-title">Benchmark model comparison</div><div class="muted small">Quality, speed, and cost for models that ran this benchmark.</div></div>
    <div class="panel" data-tabs>
      <div class="panel-tabs" role="tablist" aria-label="Benchmark comparison views">
        <button class="tab active" type="button" data-tab-button="overview" role="tab">Overview</button>
        <button class="tab" type="button" data-tab-button="quality" role="tab">Quality</button>
        <button class="tab" type="button" data-tab-button="speed" role="tab">Speed</button>
        <button class="tab" type="button" data-tab-button="cost" role="tab">Cost</button>
      </div>
      <div class="panel-body">
        <section class="tab-panel" data-tab-panel="overview">
          <div class="chart-grid">
            ${renderBarChart("chart-quality-overview", "Quality by Model", "Score for this benchmark · Higher is better", "var(--primary)", qualityBars(attempts, [], modelBarLinks), benchmarkQualitySeries(attempts, attemptBarLinks))}
            ${renderBarChart("chart-speed-overview", "Speed by Model", "Output tokens per second for this benchmark", "var(--yellow)", speedBars(attempts, [], modelBarLinks), benchmarkSpeedSeries(attempts, attemptBarLinks))}
            ${renderBarChart("chart-cost-overview", "Cost by Model", "Estimated USD for this benchmark · Lower is better", "var(--orange)", costBars(attempts, [], modelBarLinks), benchmarkCostSeries(attempts, attemptBarLinks))}
          </div>
        </section>
        <section class="tab-panel" data-tab-panel="quality" hidden>
          <div class="chart-grid single">${renderBarChart("chart-quality", "Quality by Model", "Score for this benchmark · Higher is better", "var(--primary)", qualityBars(attempts, [], modelBarLinks), benchmarkQualitySeries(attempts, attemptBarLinks))}</div>
          ${renderQualityBreakdownTable(attempts)}
        </section>
        <section class="tab-panel" data-tab-panel="speed" hidden>
          <div class="chart-grid single">${renderBarChart("chart-speed", "Speed by Model", "Output tokens per second for this benchmark", "var(--yellow)", speedBars(attempts, [], modelBarLinks), benchmarkSpeedSeries(attempts, attemptBarLinks))}</div>
          ${renderSpeedBreakdownTable(attempts)}
        </section>
        <section class="tab-panel" data-tab-panel="cost" hidden>
          <div class="chart-grid single">${renderBarChart("chart-cost", "Cost by Model", "Estimated USD for this benchmark · Lower is better", "var(--orange)", costBars(attempts, [], modelBarLinks), benchmarkCostSeries(attempts, attemptBarLinks))}</div>
          ${renderCostBreakdownTable(attempts)}
        </section>
      </div>
    </div>
  </section>

  <section id="task">
    <div class="section-head"><div class="section-title">Task</div><div class="muted small">The prompt/instruction shown to the agent for this benchmark.</div></div>
    ${renderBenchmarkTask(attempts)}
  </section>

  <section id="quality-details">
    <div class="section-head"><div class="section-title">Quality details</div><div class="muted small">Per-model outcome, signals, tool usage, and artifacts.</div></div>
    <div class="panel quality-details">${renderQualityDetails(attempts, { primaryLabel: "model", showAttemptLabel: true })}</div>
  </section>

  <section id="artifacts">
    <div class="section-head"><div class="section-title">Attempts & artifacts</div><div class="muted small">Raw attempt links for this benchmark.</div></div>
    <div class="panel table-wrap paginated-table" data-paginated-table data-page-size="5">
      <table>
        <thead><tr><th>Benchmark</th><th>Model</th><th>Status</th><th>Agent</th><th>Verdict</th><th>Score</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Uncached</th><th>Total tokens</th><th>Cost</th><th>Elapsed</th><th>Agent copy</th><th>Eval copy</th><th>Scoring</th><th>Tool usage</th><th>Patch</th><th>Attempt</th></tr></thead>
        <tbody>${renderAttemptRows(attempts)}</tbody>
      </table>
    </div>
  </section>
  ${renderReportFooter("Benchmark detail inspected.")}
</div>
<script>
${reportScripts}
</script>
</body>
</html>`;
}

function renderBenchmarkTask(attempts: readonly AttemptReport[]): string {
  const attemptWithTask = attempts.find((attempt) => attempt.artifact_previews?.task !== undefined);
  const fallbackAttempt = attempts[0];
  const taskPreview = attemptWithTask?.artifact_previews?.task;
  const taskPath = attemptWithTask?.task ?? fallbackAttempt?.task;
  const taskArtifact =
    attemptWithTask?.artifacts.agent_task ?? fallbackAttempt?.artifacts.agent_task;

  if (!taskPreview) {
    return `<div class="panel benchmark-task-panel benchmark-task-empty">
      <div>
        <h2>Task prompt unavailable</h2>
        <p class="muted small">No task artifact has been written yet for this benchmark. It will appear after at least one attempt records its agent task artifact.</p>
        ${taskPath ? `<p class="muted small">Configured task path: <code>${escapeHtml(taskPath)}</code></p>` : ""}
      </div>
      ${artifactLink(taskArtifact, "task artifact")}
    </div>`;
  }

  return `<div class="panel benchmark-task-panel" data-task-panel data-task-expanded="false">
    <div class="benchmark-task-header">
      <div>
        <h2>Task prompt</h2>
        ${taskPath ? `<p class="muted small">Configured task path: <code>${escapeHtml(taskPath)}</code></p>` : ""}
      </div>
      <div class="benchmark-task-actions">
        <span class="patch-stat">${formatTaskBytes(taskPreview.size_bytes)}</span>
        ${taskPreview.truncated ? `<span class="patch-truncated">preview truncated at ${formatTaskBytes(taskPreview.max_bytes)}</span>` : ""}
        ${artifactLink(taskArtifact, "raw task")}
      </div>
    </div>
    <pre class="benchmark-task-content">${escapeHtml(taskPreview.text)}</pre>
    <button type="button" class="benchmark-task-toggle" data-task-toggle>Show full task</button>
  </div>`;
}

function formatTaskBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}
