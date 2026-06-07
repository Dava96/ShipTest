import type { AttemptReport, RunResults } from "../../run/types.js";
import {
  costBars,
  escapeAttribute,
  escapeHtml,
  formatDuration,
  formatRunMode,
  formatStatus,
  modelDetailReportPath,
  modelsOverviewReportPath,
  qualityBars,
  renderAttemptRows,
  renderBarChart,
  renderBenchmarkRows,
  renderMetricCards,
  renderOutcomeMatrix,
  renderRunInsightCards,
  renderSelfVerificationOverview,
  speedBars,
} from "../html-report-components.js";
import { reportScripts } from "../html-report-scripts.js";
import { reportStyles } from "../html-report-styles.js";
import { renderReportFooter, renderTopbar } from "../shared/page-shell.js";

export function renderReport(results: RunResults, attempts: readonly AttemptReport[]): string {
  const pendingBenchmarks = results.benchmark_results.filter(
    (benchmark) => benchmark.attempts.length === 0,
  );
  const completedAttemptCount = attempts.length;
  const pendingCount = pendingBenchmarks.length;
  const running = results.status === "running";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ShipTest report ${escapeHtml(results.run_id)}</title>
<style>
${reportStyles}
</style>
</head>
<body data-theme="shiptest">
<div class="page">
  ${renderTopbar({
    ariaLabel: "Report navigation",
    nav: [
      { label: "Matrix", href: "#outcome-matrix", active: true },
      { label: "Models", href: modelsOverviewReportPath() },
      { label: "Charts", href: "#model-comparison" },
      { label: "Workflow", href: "#self-verification" },
      { label: "Benchmarks", href: "#benchmarks" },
      { label: "Artifacts", href: "#artifacts" },
    ],
  })}

  <section class="hero">
    <div>
      <div class="kicker">${escapeHtml(results.project.name)} • ${completedAttemptCount} completed attempt${completedAttemptCount === 1 ? "" : "s"}${pendingCount > 0 ? ` • ${pendingCount} pending` : ""}</div>
      <h1>Benchmark intelligence, speed, cost & reliability dashboard</h1>
      <div class="run-meta">
        <span class="meta-chip">Run <code>${escapeHtml(results.run_id)}</code></span>
        <span class="meta-chip status-chip ${escapeAttribute(results.status)}">${escapeHtml(formatStatus(results.status))}</span>
        <span class="meta-chip">${formatRunMode(results)}</span>
        <span class="meta-chip">Elapsed ${formatDuration(results.summary.duration_ms) || (running ? "running" : "not available")}</span>
      </div>
    </div>
    <a class="primary-action" href="results.json">View results JSON ↗</a>
  </section>

  ${renderMetricCards(results, attempts, pendingCount)}

  <section id="outcome-matrix">
    <div class="section-head"><div class="section-title">Outcome matrix</div><div class="muted small">Benchmark × model cells. Click a cell to inspect the attempt; ShipTest opens the candidate diff when a patch exists, otherwise the overview evidence.</div></div>
    ${renderOutcomeMatrix(results, attempts)}
  </section>

  <section id="model-comparison">
    <div class="section-head">
      <div class="section-title">Highlights</div>
      <div class="tabs"><a class="tab active" href="#model-comparison">Model Comparison</a><a class="tab" href="#benchmarks">Pending States</a></div>
    </div>
    <div class="panel">
      <div class="panel-tabs"><a class="tab active" href="#chart-quality">Quality</a><a class="tab" href="#chart-speed">Speed</a><a class="tab" href="#chart-cost">Cost</a></div>
      <div class="panel-body">
        <div class="chart-grid">
          ${renderBarChart("chart-quality", "Average Quality by Model", "Average score across attempted benchmarks · Failures count as 0", "var(--primary)", qualityBars(attempts, pendingBenchmarks, { hrefForModel: modelDetailReportPath }))}
          ${renderBarChart("chart-speed", "Median Speed by Model", "Median output tokens per second across attempts · Higher is better", "var(--yellow)", speedBars(attempts, pendingBenchmarks, { hrefForModel: modelDetailReportPath }))}
          ${renderBarChart("chart-cost", "Average Cost by Model", "Average estimated USD per attempt · Lower is better", "var(--orange)", costBars(attempts, pendingBenchmarks, { hrefForModel: modelDetailReportPath }))}
        </div>
      </div>
    </div>
  </section>

  <section id="run-insights">
    <div class="section-head"><div class="section-title">Run signals</div><div class="muted small">At-a-glance quality, reliability, and risk indicators for this suite.</div></div>
    ${renderRunInsightCards(results, attempts)}
  </section>

  <section id="self-verification">
    <div class="section-head"><div class="section-title">Agent workflow & reviewer insights</div><div class="muted small">Self-verification is based on observed agent tool calls. Baseline-backed checks are tied to commands doctor saw pass before agent attempts.</div></div>
    ${renderSelfVerificationOverview(attempts)}
  </section>

  <section id="benchmarks">
    <div class="section-head"><div class="section-title">Benchmarks</div><div class="muted small">Pending rows appear while incremental reports are still running.</div></div>
    <div class="panel table-wrap">
      <table>
        <thead><tr><th>Benchmark</th><th>Status</th><th>Attempts</th><th>Elapsed</th></tr></thead>
        <tbody>${renderBenchmarkRows(results)}</tbody>
      </table>
    </div>
  </section>

  <section id="artifacts">
    <div class="section-head"><div class="section-title">Attempts & artifacts</div><div class="muted small">Completed attempts only; pending benchmarks are shown above until their attempt JSON is written.</div></div>
    <div class="panel table-wrap paginated-table" data-paginated-table data-page-size="5">
      <table>
        <thead><tr><th>Benchmark</th><th>Model</th><th>Status</th><th>Agent</th><th>Verdict</th><th>Score</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Uncached</th><th>Total tokens</th><th>Cost</th><th>Elapsed</th><th>Agent copy</th><th>Eval copy</th><th>Scoring</th><th>Tool usage</th><th>Patch</th><th>Attempt</th></tr></thead>
        <tbody>${renderAttemptRows(attempts)}</tbody>
      </table>
    </div>
  </section>

  ${renderReportFooter("Make every run count. Compare models. Ship with confidence.")}
</div>
<script>
${reportScripts}
</script>
</body>
</html>
`;
}
