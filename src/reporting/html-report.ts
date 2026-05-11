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
<div class="summary">
  <div class="card"><strong>Benchmarks</strong><br>${results.summary.benchmarks}</div>
  <div class="card"><strong>Agent runs</strong><br>${results.summary.agent_runs}</div>
  <div class="card"><strong>Passed</strong><br>${results.summary.passed}</div>
  <div class="card"><strong>Needs review</strong><br>${results.summary.needs_review}</div>
  <div class="card"><strong>Failed</strong><br>${results.summary.failed}</div>
  <div class="card"><strong>Total tokens</strong><br>${results.summary.total_tokens}</div>
</div>
<h2>Attempts</h2>
<table>
<thead><tr><th>Benchmark</th><th>Model</th><th>Status</th><th>Agent</th><th>Verdict</th><th>Score</th><th>Tokens</th><th>Patch</th><th>Attempt</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
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
