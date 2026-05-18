import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AttemptReport, RunResults } from "../run/types.js";

export async function writeHtmlReport(options: {
  readonly runRootPath: string;
  readonly reportPath: string;
}): Promise<void> {
  const results = JSON.parse(
    await readFile(path.join(options.runRootPath, "results.json"), "utf8"),
  ) as RunResults;
  const attempts: AttemptReport[] = [];
  for (const benchmark of results.benchmark_results) {
    for (const attemptPath of benchmark.attempts) {
      attempts.push(
        JSON.parse(
          await readFile(path.join(options.runRootPath, attemptPath), "utf8"),
        ) as AttemptReport,
      );
    }
  }

  await writeFile(options.reportPath, renderReport(results, attempts), "utf8");
}

function renderReport(results: RunResults, attempts: readonly AttemptReport[]): string {
  const rows = attempts
    .map(
      (attempt) => `<tr>
<td>${escapeHtml(attempt.benchmark_id)}</td>
<td>${escapeHtml(attempt.model.id)}</td>
<td>${escapeHtml(attempt.status)}</td>
<td>${escapeHtml(attempt.agent.status)}</td>
<td>${escapeHtml(attempt.evaluation?.verdict ?? "not_run")}</td>
<td>${attempt.evaluation?.score ?? ""}</td>
<td>${attempt.agent.telemetry.usage.total_tokens}</td>
<td>${attempt.agent.telemetry.usage.uncached_tokens}</td>
<td>${attempt.agent.telemetry.usage.cache_read_tokens}</td>
<td>${formatUsd(attempt.agent.telemetry.usage.estimated_cost_usd?.total)}</td>
<td>${formatDuration(attempt.timings_ms?.total_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.agent_workspace_prepare_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.evaluation_workspace_prepare_ms)}</td>
<td>${formatDuration(attempt.timings_ms?.evaluation_scoring_ms)}</td>
<td>${renderToolUsageCell(attempt)}</td>
<td>${artifactLink(attempt.artifacts.candidate_patch, "patch")}</td>
<td>${artifactLink(attempt.artifacts.attempt_json, "json")}</td>
</tr>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>ShipTest report ${escapeHtml(results.run_id)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem; color: #17202a; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #d5d8dc; padding: 0.5rem; text-align: left; vertical-align: top; }
th { background: #f4f6f7; }
code { background: #f4f6f7; padding: 0.1rem 0.25rem; border-radius: 0.2rem; }
.summary { display: flex; gap: 1rem; flex-wrap: wrap; margin: 1rem 0; }
.card { border: 1px solid #d5d8dc; border-radius: 0.4rem; padding: 0.75rem; min-width: 10rem; }
</style>
</head>
<body>
<h1>ShipTest report</h1>
<p><strong>Run:</strong> <code>${escapeHtml(results.run_id)}</code></p>
<p><strong>Status:</strong> ${escapeHtml(results.status)}</p>
<p><strong>Run mode:</strong> ${formatRunMode(results)}</p>
<div class="summary">
  <div class="card"><strong>Benchmarks</strong><br>${results.summary.benchmarks}</div>
  <div class="card"><strong>Agent runs</strong><br>${results.summary.agent_runs}</div>
  <div class="card"><strong>Passed</strong><br>${results.summary.passed}</div>
  <div class="card"><strong>Needs review</strong><br>${results.summary.needs_review}</div>
  <div class="card"><strong>Failed</strong><br>${results.summary.failed}</div>
  <div class="card"><strong>Total tokens</strong><br>${results.summary.total_tokens}</div>
  <div class="card"><strong>Uncached tokens</strong><br>${results.summary.uncached_tokens}</div>
  <div class="card"><strong>Cache read tokens</strong><br>${results.summary.cache_read_tokens}</div>
  <div class="card"><strong>Output tokens</strong><br>${results.summary.output_tokens}</div>
  <div class="card"><strong>Total estimated cost</strong><br>${formatUsd(results.summary.estimated_cost_usd)}</div>
  <div class="card"><strong>Elapsed</strong><br>${formatDuration(results.summary.duration_ms)}</div>
</div>
<h2>Benchmarks</h2>
<table>
<thead><tr><th>Benchmark</th><th>Attempts</th><th>Elapsed</th></tr></thead>
<tbody>
${renderBenchmarkRows(results)}
</tbody>
</table>
<h2>Attempts</h2>
<table>
<thead><tr><th>Benchmark</th><th>Model</th><th>Status</th><th>Agent</th><th>Verdict</th><th>Score</th><th>Total tokens</th><th>Uncached tokens</th><th>Cache read</th><th>Cost</th><th>Elapsed</th><th>Agent copy</th><th>Eval copy</th><th>Scoring</th><th>Tool usage</th><th>Patch</th><th>Attempt</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

function formatRunMode(results: RunResults): string {
  if (results.run_mode === "draft") {
    return "Draft / working tree — non-reproducible local files may be included";
  }
  return "Reproducible / git commit";
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
  return escapeHtml(
    `Tool calls: ${usage.summary.tool_calls}; Failed: ${usage.summary.failed_tool_calls}; ${categoryText}`,
  );
}

function renderBenchmarkRows(results: RunResults): string {
  return results.benchmark_results
    .map(
      (benchmark) => `<tr>
<td>${escapeHtml(benchmark.benchmark_id)}</td>
<td>${benchmark.attempts.length}</td>
<td>${formatDuration(benchmark.duration_ms)}</td>
</tr>`,
    )
    .join("\n");
}

function formatUsd(value: number | undefined): string {
  if (value === undefined) {
    return "not available";
  }
  return `$${value.toFixed(4)}`;
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function artifactLink(artifactPath: string | undefined, label: string): string {
  return artifactPath ? `<a href="${escapeAttribute(artifactPath)}">${escapeHtml(label)}</a>` : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
