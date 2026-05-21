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
import { renderReportFooter, renderTopbar } from "../shared/page-shell.js";

export function renderBenchmarkReport(options: {
  readonly results: RunResults;
  readonly benchmarkId: string;
  readonly attempts: readonly AttemptReport[];
}): string {
  const { results, benchmarkId, attempts } = options;
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
      { label: "← Suite report", href: "report.html", active: true },
      { label: "Overview", href: "#benchmark-overview" },
      { label: "Quality", href: "#benchmark-quality" },
      { label: "Speed", href: "#benchmark-speed" },
      { label: "Cost", href: "#benchmark-cost" },
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
            ${renderBarChart("chart-quality-overview", "Quality by Model", "Score for this benchmark · Higher is better", "var(--primary)", qualityBars(attempts, []), benchmarkQualitySeries(attempts))}
            ${renderBarChart("chart-speed-overview", "Speed by Model", "Output tokens per second for this benchmark", "var(--yellow)", speedBars(attempts, []), benchmarkSpeedSeries(attempts))}
            ${renderBarChart("chart-cost-overview", "Cost by Model", "Estimated USD for this benchmark · Lower is better", "var(--orange)", costBars(attempts, []), benchmarkCostSeries(attempts))}
          </div>
        </section>
        <section class="tab-panel" data-tab-panel="quality" hidden>
          <div class="chart-grid single">${renderBarChart("chart-quality", "Quality by Model", "Score for this benchmark · Higher is better", "var(--primary)", qualityBars(attempts, []), benchmarkQualitySeries(attempts))}</div>
          ${renderQualityBreakdownTable(attempts)}
        </section>
        <section class="tab-panel" data-tab-panel="speed" hidden>
          <div class="chart-grid single">${renderBarChart("chart-speed", "Speed by Model", "Output tokens per second for this benchmark", "var(--yellow)", speedBars(attempts, []), benchmarkSpeedSeries(attempts))}</div>
          ${renderSpeedBreakdownTable(attempts)}
        </section>
        <section class="tab-panel" data-tab-panel="cost" hidden>
          <div class="chart-grid single">${renderBarChart("chart-cost", "Cost by Model", "Estimated USD for this benchmark · Lower is better", "var(--orange)", costBars(attempts, []), benchmarkCostSeries(attempts))}</div>
          ${renderCostBreakdownTable(attempts)}
        </section>
      </div>
    </div>
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
