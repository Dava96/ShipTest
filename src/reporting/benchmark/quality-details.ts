import type { AttemptArtifactTextPreview, AttemptReport } from "../../run/types.js";
import { artifactLink } from "../shared/artifacts.js";
import { statusBadge } from "../shared/badge.js";
import { formatDuration } from "../shared/format.js";
import { escapeAttribute, escapeHtml } from "../shared/html.js";
import { slugify } from "../shared/paths.js";

interface QualityDetailSection {
  readonly id: string;
  readonly title: string;
  readonly bodyHtml: string;
}

interface QualityDetailViewModel {
  readonly id: string;
  readonly benchmarkId: string;
  readonly modelId: string;
  readonly attempt: number;
  readonly attemptLabel: string;
  readonly status: string;
  readonly score: number | undefined;
  readonly changedFiles: number;
  readonly failedTools: number;
  readonly signalCount: number;
  readonly topSignal: string;
  readonly toolCalls: number;
  readonly durationLabel: string;
  readonly searchText: string;
  readonly sections: readonly QualityDetailSection[];
}

interface QualitySummaryViewModel {
  readonly models: readonly string[];
}

type PatchLineKind = "addition" | "deletion" | "context" | "hunk" | "metadata";

interface ParsedPatchLine {
  readonly kind: PatchLineKind;
  readonly text: string;
}

interface ParsedPatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly lines: readonly ParsedPatchLine[];
}

interface ParsedPatch {
  readonly files: readonly ParsedPatchFile[];
  readonly truncated: boolean;
  readonly sizeBytes: number;
  readonly maxBytes: number;
  readonly rawText: string;
}

export function renderQualityDetails(
  attempts: readonly AttemptReport[],
  options: {
    readonly primaryLabel?: "benchmark" | "model";
    readonly showAttemptLabel?: boolean;
  } = {},
): string {
  const views = attempts.map(qualityDetailViewModel);
  const summary = qualitySummaryViewModel(views);
  return `<div class="quality-report" data-quality-report>
  ${renderQualityToolbar(summary)}
  <div class="quality-attempt-list" data-quality-list>${views.length > 0 ? views.map((view) => renderQualityDetail(view, options.primaryLabel ?? "benchmark", options.showAttemptLabel ?? false)).join("\n") : `<div class="quality-empty">No completed attempts yet.</div>`}</div>
</div>`;
}

function qualitySummaryViewModel(
  views: readonly QualityDetailViewModel[],
): QualitySummaryViewModel {
  return {
    models: [...new Set(views.map((view) => view.modelId))].sort(),
  };
}

function renderQualityToolbar(summary: QualitySummaryViewModel): string {
  return `<div class="quality-toolbar">
    <label class="quality-search"><span>Search</span><input type="search" data-quality-search placeholder="Search models, benchmarks, signals…"></label>
    <label><span>Verdict</span><select data-quality-status><option value="all">All</option><option value="passed">Passed</option><option value="needs_review">Evaluator review</option><option value="failed">Failed</option></select></label>
    <label><span>Model</span><select data-quality-model><option value="all">All models</option>${summary.models.map((model) => `<option value="${escapeAttribute(model)}">${escapeHtml(model)}</option>`).join("")}</select></label>
    <label><span>Failed tools</span><select data-quality-failed-tools><option value="all">All</option><option value="none">None</option><option value="some">1+</option></select></label>
    <label><span>Min score</span><input type="number" min="0" max="100" data-quality-min-score></label>
    <label><span>Max score</span><input type="number" min="0" max="100" data-quality-max-score></label>
    <button type="button" class="tab" data-quality-clear>Clear filters</button>
    <button type="button" class="tab" data-quality-export>Download rows JSON</button>
  </div>`;
}

function qualityDetailViewModel(attempt: AttemptReport): QualityDetailViewModel {
  const signals = [
    ...(attempt.quality_signals ?? []),
    ...attempt.agent.signals,
    ...(attempt.evaluation?.signals ?? []),
  ];
  const files = attempt.submission?.changed_files ?? [];
  const commands = attempt.evaluation?.commands ?? [];
  const failedTools = attempt.tool_usage?.summary.failed_tool_calls ?? 0;
  const toolCalls = attempt.tool_usage?.summary.tool_calls ?? 0;
  const status =
    attempt.status === "completed" && attempt.evaluation
      ? attempt.evaluation.verdict
      : attempt.status === "agent_failed"
        ? "agent_failed"
        : "not_run";
  const score = attempt.status === "completed" ? attempt.evaluation?.score : undefined;
  const topSignal = signals[0]?.id ?? "none";
  const id = `quality-${slugify(`${attempt.benchmark_id}-${attempt.model.id}-${attempt.attempt}`)}`;
  return {
    id,
    benchmarkId: attempt.benchmark_id,
    modelId: attempt.model.id,
    attempt: attempt.attempt,
    attemptLabel: `attempt ${String(attempt.attempt).padStart(3, "0")}`,
    status,
    score,
    changedFiles: files.length,
    failedTools,
    signalCount: signals.length,
    topSignal,
    toolCalls,
    durationLabel: formatDuration(attempt.timings_ms?.total_ms) || "—",
    searchText: [
      attempt.benchmark_id,
      attempt.model.id,
      `attempt ${attempt.attempt}`,
      status,
      topSignal,
      ...signals.map((signal) => signal.id),
      ...signals.map((signal) => signal.message),
      ...files,
    ]
      .join(" ")
      .toLowerCase(),
    sections: [
      {
        id: "overview",
        title: "Overview",
        bodyHtml: renderQualityOverview(attempt, signals, files, commands, failedTools, toolCalls),
      },
      {
        id: "candidate-diff",
        title: "Candidate diff",
        bodyHtml: renderCandidateDiff(attempt, id),
      },
      { id: "signals", title: "Signals", bodyHtml: renderSignalList(signals) },
      { id: "commands", title: "Commands", bodyHtml: renderCommandList(commands) },
      {
        id: "tools",
        title: "Tool usage",
        bodyHtml: `<ul class="quality-list"><li>Tool calls: ${toolCalls}</li><li>Failed tool calls: ${failedTools}</li><li>${escapeHtml(renderToolUsageText(attempt))}</li>${attempt.tool_usage?.artifacts.tool_calls_jsonl ? `<li>${artifactLink(attempt.tool_usage.artifacts.tool_calls_jsonl, "tool calls jsonl")}</li>` : ""}</ul>`,
      },
    ],
  };
}

function renderQualityOverview(
  attempt: AttemptReport,
  signals: readonly { readonly id: string; readonly severity: string; readonly message: string }[],
  files: readonly string[],
  commands: NonNullable<AttemptReport["evaluation"]>["commands"],
  failedTools: number,
  toolCalls: number,
): string {
  return `<div class="quality-overview">
    <div class="quality-overview-column"><h4>Outcome</h4><ul class="quality-list"><li>Attempt: ${escapeHtml(attempt.status)}</li><li>Agent: ${escapeHtml(attempt.agent.status)}</li><li>Evaluation: ${escapeHtml(attempt.evaluation?.status ?? "not run")}</li><li>Verdict: ${escapeHtml(attempt.evaluation?.verdict ?? "not run")}</li></ul></div>
    <div class="quality-overview-column"><h4>Key signals</h4>${renderSignalList(signals.slice(0, 3))}</div>
    <div class="quality-overview-column"><h4>Changed files</h4>${renderChangedFiles(files)}</div>
    <div class="quality-overview-column"><h4>Commands</h4>${renderCommandList(commands.slice(0, 3))}</div>
    <div class="quality-overview-column"><h4>Tool usage</h4><ul class="quality-list"><li>${toolCalls} calls</li><li>${failedTools} failed</li><li>${escapeHtml(renderToolUsageText(attempt))}</li></ul></div>
    <div class="quality-overview-column"><h4>Artifact links</h4>${renderRawArtifacts(attempt)}</div>
  </div>`;
}

function renderQualityDetail(
  view: QualityDetailViewModel,
  primaryLabel: "benchmark" | "model",
  showAttemptLabel: boolean,
): string {
  const primary = primaryLabel === "model" ? view.modelId : view.benchmarkId;
  const secondary =
    primaryLabel === "model" ? (showAttemptLabel ? view.attemptLabel : undefined) : view.modelId;
  return `<details class="quality-detail quality-attempt" id="${escapeAttribute(view.id)}" data-quality-attempt data-model="${escapeAttribute(view.modelId)}" data-status="${escapeAttribute(view.status)}" data-score="${view.score ?? ""}" data-failed-tools="${view.failedTools}" data-search="${escapeAttribute(view.searchText)}">
  <summary class="quality-attempt-summary">
    <span class="quality-expand">+</span>
    <span class="quality-status-dot ${escapeAttribute(statusClass(view.status))}"></span>
    ${statusBadge(view.status)}
    <strong>${escapeHtml(primary)}</strong>
    ${secondary ? `<span class="muted small mono">${escapeHtml(secondary)}</span>` : `<span></span>`}
    <span>${view.score ?? "—"} score</span>
    <span>${view.changedFiles} files</span>
    <span>${view.failedTools} failed tools</span>
    <span class="mono">${escapeHtml(view.topSignal)}</span>
    <span>${view.toolCalls} tool calls</span>
    <span class="mono">${escapeHtml(view.durationLabel)}</span>
  </summary>
  <div class="quality-attempt-panel" data-quality-tabs>
    <div class="quality-panel-tabs" role="tablist">${view.sections.map((section, index) => `<button type="button" class="tab${index === 0 ? " active" : ""}" data-quality-tab-button="${escapeAttribute(section.id)}">${escapeHtml(section.title)}</button>`).join("")}</div>
    ${view.sections.map((section, index) => `<section id="${escapeAttribute(`${view.id}-${section.id}`)}" class="quality-tab-panel" data-quality-tab-panel="${escapeAttribute(section.id)}"${index === 0 ? "" : " hidden"}>${section.bodyHtml}</section>`).join("")}
  </div>
</details>`;
}

function statusClass(status: string): string {
  if (status === "passed") return "passed";
  if (status === "needs_review") return "review";
  if (status === "running") return "running";
  return "failed";
}

function renderSignalList(
  signals: readonly { readonly id: string; readonly severity: string; readonly message: string }[],
): string {
  if (signals.length === 0) {
    return `<div class="muted small">No signals.</div>`;
  }
  return `<ul class="quality-list">${signals
    .slice(0, 6)
    .map((signal) => `<li>${escapeHtml(signal.severity)} · ${escapeHtml(signal.id)}</li>`)
    .join("")}${signals.length > 6 ? `<li>+${signals.length - 6} more</li>` : ""}</ul>`;
}

function renderChangedFiles(files: readonly string[]): string {
  if (files.length === 0) {
    return `<div class="muted small">No changed files.</div>`;
  }
  return `<ul class="quality-list">${files
    .slice(0, 6)
    .map((file) => `<li>${escapeHtml(file)}</li>`)
    .join("")}${files.length > 6 ? `<li>+${files.length - 6} more</li>` : ""}</ul>`;
}

function renderCommandList(commands: NonNullable<AttemptReport["evaluation"]>["commands"]): string {
  if (commands.length === 0) {
    return `<div class="muted small">No evaluation commands.</div>`;
  }
  return `<ul class="quality-list">${commands.map((command) => `<li>${escapeHtml(command.command)} · exit ${command.exit_code ?? "null"} · ${formatDuration(command.duration_ms)}${command.stdout_artifact ? ` · ${artifactLink(command.stdout_artifact, "stdout")}` : ""}${command.stderr_artifact ? ` · ${artifactLink(command.stderr_artifact, "stderr")}` : ""}</li>`).join("")}</ul>`;
}

function renderRawArtifacts(attempt: AttemptReport): string {
  return `<div class="quality-links">${artifactLink(attempt.artifacts.candidate_patch, "raw patch")}${artifactLink(attempt.artifacts.attempt_json, "attempt json")}${artifactLink(attempt.tool_usage?.artifacts.tool_calls_jsonl, "tool calls")}</div>`;
}

function renderRawArtifactsSection(attempt: AttemptReport): string {
  return `<section class="candidate-diff-artifacts" aria-label="Raw artifacts">
    <h4>Raw artifacts</h4>
    <p class="muted small">Open the underlying evidence files for this candidate diff.</p>
    ${renderRawArtifacts(attempt)}
  </section>`;
}

function renderToolUsageText(attempt: AttemptReport): string {
  const usage = attempt.tool_usage;
  if (!usage || usage.categories.length === 0) {
    return "No highlighted categories configured";
  }
  return usage.categories.map((category) => `${category.label}: ${category.status}`).join("; ");
}

function renderCandidateDiff(attempt: AttemptReport, baseId: string): string {
  const patch = parseCandidatePatch(attempt.artifact_previews?.candidate_patch);
  if (!patch) {
    const message = attempt.artifacts.candidate_patch
      ? "A raw candidate patch exists, but no inline preview is available for this report."
      : "This attempt did not produce a candidate patch. Inspect the overview, commands, tool usage, or raw attempt JSON for the failure evidence.";
    return `<div class="candidate-diff-empty"><p class="muted small">${escapeHtml(message)}</p>${renderRawArtifactsSection(attempt)}</div>`;
  }

  if (patch.files.length === 0) {
    return `<div class="candidate-diff">
      ${renderPatchSummary(patch)}
      <pre class="raw-patch-preview">${escapeHtml(patch.rawText)}</pre>
      ${renderRawArtifactsSection(attempt)}
    </div>`;
  }

  return `<div class="candidate-diff">
    ${renderPatchSummary(patch)}
    <div class="patch-review-layout">
      <aside class="patch-file-tree" aria-label="Changed files">
        <div class="patch-file-tree-title">${patch.files.length} file${patch.files.length === 1 ? "" : "s"}</div>
        <ul>${patch.files.map((file, index) => renderPatchFileTreeItem(file, `${baseId}-patch-file-${index}`)).join("")}</ul>
      </aside>
      <div class="patch-diff-stack">${patch.files.map((file, index) => renderPatchFile(file, `${baseId}-patch-file-${index}`)).join("")}</div>
    </div>
    ${renderRawArtifactsSection(attempt)}
  </div>`;
}

function renderPatchSummary(patch: ParsedPatch): string {
  const totals = patch.files.reduce(
    (summary, file) => ({
      additions: summary.additions + file.additions,
      deletions: summary.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
  return `<div class="patch-summary">
    <div><strong>Candidate patch</strong><span class="muted small">Rendered from the model's saved unified diff artifact.</span></div>
    <div class="patch-summary-actions"><button type="button" class="patch-action" data-patch-expand-all>Expand all</button><button type="button" class="patch-action" data-patch-collapse-all>Minimise all</button></div>
    <div class="patch-summary-stats"><span class="patch-stat additions">+${totals.additions}</span><span class="patch-stat deletions">−${totals.deletions}</span><span>${formatBytes(patch.sizeBytes)}</span>${patch.truncated ? `<span class="patch-truncated">preview truncated at ${formatBytes(patch.maxBytes)}</span>` : ""}</div>
  </div>`;
}

function renderPatchFileTreeItem(file: ParsedPatchFile, id: string): string {
  return `<li><a href="#${escapeAttribute(id)}" title="${escapeAttribute(file.path)}"><span class="patch-file-icon">▱</span><span class="patch-file-path">${escapeHtml(file.path)}</span><span class="patch-file-stats"><span class="additions">+${file.additions}</span><span class="deletions">−${file.deletions}</span></span></a></li>`;
}

function renderPatchFile(file: ParsedPatchFile, id: string): string {
  const bodyId = `${id}-body`;
  return `<article class="patch-file" id="${escapeAttribute(id)}" data-patch-file data-collapsed="false">
    <header><button type="button" class="patch-file-toggle" data-patch-file-toggle aria-expanded="true" aria-controls="${escapeAttribute(bodyId)}"><span class="patch-file-toggle-icon" aria-hidden="true">−</span><span class="patch-file-title">${escapeHtml(file.path)}</span><span class="patch-file-counts"><span class="patch-stat additions">+${file.additions}</span><span class="patch-stat deletions">−${file.deletions}</span></span></button></header>
    <pre class="patch-code" id="${escapeAttribute(bodyId)}" data-patch-file-body aria-label="Diff for ${escapeAttribute(file.path)}">${file.lines.map(renderPatchLine).join("")}</pre>
  </article>`;
}

function renderPatchLine(line: ParsedPatchLine): string {
  const prefix = patchLinePrefix(line);
  const text = patchLineText(line);
  return `<span class="patch-line patch-line-${line.kind}"><span class="patch-line-prefix">${escapeHtml(prefix)}</span><span class="patch-line-text">${escapeHtml(text)}</span></span>`;
}

function parseCandidatePatch(
  preview: AttemptArtifactTextPreview | undefined,
): ParsedPatch | undefined {
  if (!preview || typeof preview !== "object" || !("text" in preview)) {
    return undefined;
  }
  const text = String(preview.text);
  if (text.trim().length === 0) {
    return undefined;
  }

  const files: ParsedPatchFile[] = [];
  let current:
    | {
        path: string;
        additions: number;
        deletions: number;
        lines: ParsedPatchLine[];
      }
    | undefined;

  const flushCurrent = () => {
    if (!current) return;
    files.push({
      path: current.path,
      additions: current.additions,
      deletions: current.deletions,
      lines: current.lines,
    });
  };

  for (const line of text.split(/\r?\n/)) {
    const diffMatch = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (diffMatch) {
      flushCurrent();
      const [, leftPath, rightPath] = diffMatch;
      current = {
        path: rightPath === "/dev/null" ? (leftPath ?? "unknown") : (rightPath ?? "unknown"),
        additions: 0,
        deletions: 0,
        lines: [{ kind: "metadata", text: line }],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    const kind = patchLineKind(line);
    if (kind === "addition") current.additions += 1;
    if (kind === "deletion") current.deletions += 1;
    current.lines.push({ kind, text: line });
  }

  flushCurrent();
  return {
    files,
    rawText: text,
    truncated: Boolean(preview.truncated),
    sizeBytes: Number(preview.size_bytes ?? text.length),
    maxBytes: Number(preview.max_bytes ?? text.length),
  };
}

function patchLineKind(line: string): PatchLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "addition";
  if (line.startsWith("-") && !line.startsWith("---")) return "deletion";
  if (line.startsWith(" ")) return "context";
  return "metadata";
}

function patchLinePrefix(line: ParsedPatchLine): string {
  if (line.kind === "addition") return "+";
  if (line.kind === "deletion") return "−";
  if (line.kind === "context") return " ";
  return "";
}

function patchLineText(line: ParsedPatchLine): string {
  if (["addition", "deletion", "context"].includes(line.kind)) {
    return line.text.slice(1);
  }
  return line.text;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`;
}
