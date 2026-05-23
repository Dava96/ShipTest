import type { AttemptReport } from "../../run/types.js";
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
    <label><span>Status</span><select data-quality-status><option value="all">All</option><option value="passed">Passed</option><option value="needs_review">Needs review</option><option value="failed">Failed</option></select></label>
    <label><span>Model</span><select data-quality-model><option value="all">All models</option>${summary.models.map((model) => `<option value="${escapeAttribute(model)}">${escapeHtml(model)}</option>`).join("")}</select></label>
    <label><span>Failed tools</span><select data-quality-failed-tools><option value="all">All</option><option value="none">None</option><option value="some">1+</option></select></label>
    <label><span>Min score</span><input type="number" min="0" max="100" data-quality-min-score></label>
    <label><span>Max score</span><input type="number" min="0" max="100" data-quality-max-score></label>
    <button type="button" class="tab" data-quality-clear>Clear filters</button>
    <button type="button" class="tab" data-quality-export>Export report</button>
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
  return {
    id: `quality-${slugify(`${attempt.benchmark_id}-${attempt.model.id}-${attempt.attempt}`)}`,
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
    ]
      .join(" ")
      .toLowerCase(),
    sections: [
      {
        id: "overview",
        title: "Overview",
        bodyHtml: renderQualityOverview(attempt, signals, commands, failedTools, toolCalls),
      },
      { id: "signals", title: "Signals", bodyHtml: renderSignalList(signals) },
      { id: "files", title: "Files", bodyHtml: renderChangedFiles(files) },
      { id: "commands", title: "Commands", bodyHtml: renderCommandList(commands) },
      {
        id: "tools",
        title: "Tool Usage",
        bodyHtml: `<ul class="quality-list"><li>Tool calls: ${toolCalls}</li><li>Failed tool calls: ${failedTools}</li><li>${escapeHtml(renderToolUsageText(attempt))}</li>${attempt.tool_usage?.artifacts.tool_calls_jsonl ? `<li>${artifactLink(attempt.tool_usage.artifacts.tool_calls_jsonl, "tool calls jsonl")}</li>` : ""}</ul>`,
      },
      {
        id: "artifacts",
        title: "Artifacts",
        bodyHtml: `<div class="quality-links">${artifactLink(attempt.artifacts.candidate_patch, "patch")}${artifactLink(attempt.artifacts.attempt_json, "attempt json")}${artifactLink(attempt.tool_usage?.artifacts.tool_calls_jsonl, "tool calls")}</div>`,
      },
    ],
  };
}

function renderQualityOverview(
  attempt: AttemptReport,
  signals: readonly { readonly id: string; readonly severity: string; readonly message: string }[],
  commands: NonNullable<AttemptReport["evaluation"]>["commands"],
  failedTools: number,
  toolCalls: number,
): string {
  return `<div class="quality-overview">
    <div class="quality-overview-column"><h4>Outcome</h4><ul class="quality-list"><li>Attempt: ${escapeHtml(attempt.status)}</li><li>Agent: ${escapeHtml(attempt.agent.status)}</li><li>Evaluation: ${escapeHtml(attempt.evaluation?.status ?? "not run")}</li><li>Verdict: ${escapeHtml(attempt.evaluation?.verdict ?? "not run")}</li></ul></div>
    <div class="quality-overview-column"><h4>Key signals</h4>${renderSignalList(signals.slice(0, 3))}</div>
    <div class="quality-overview-column"><h4>Commands</h4>${renderCommandList(commands.slice(0, 3))}</div>
    <div class="quality-overview-column"><h4>Tool usage</h4><ul class="quality-list"><li>${toolCalls} calls</li><li>${failedTools} failed</li><li>${escapeHtml(renderToolUsageText(attempt))}</li></ul></div>
    <div class="quality-overview-column"><h4>Artifacts</h4><div class="quality-links">${artifactLink(attempt.artifacts.candidate_patch, "patch")}${artifactLink(attempt.artifacts.attempt_json, "attempt json")}${artifactLink(attempt.tool_usage?.artifacts.tool_calls_jsonl, "tool calls")}</div></div>
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
    ${view.sections.map((section, index) => `<section class="quality-tab-panel" data-quality-tab-panel="${escapeAttribute(section.id)}"${index === 0 ? "" : " hidden"}>${section.bodyHtml}</section>`).join("")}
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
    .slice(0, 12)
    .map((file) => `<li>${escapeHtml(file)}</li>`)
    .join("")}${files.length > 12 ? `<li>+${files.length - 12} more</li>` : ""}</ul>`;
}

function renderCommandList(commands: NonNullable<AttemptReport["evaluation"]>["commands"]): string {
  if (commands.length === 0) {
    return `<div class="muted small">No evaluation commands.</div>`;
  }
  return `<ul class="quality-list">${commands.map((command) => `<li>${escapeHtml(command.command)} · exit ${command.exit_code ?? "null"} · ${formatDuration(command.duration_ms)}${command.stdout_artifact ? ` · ${artifactLink(command.stdout_artifact, "stdout")}` : ""}${command.stderr_artifact ? ` · ${artifactLink(command.stderr_artifact, "stderr")}` : ""}</li>`).join("")}</ul>`;
}

function renderToolUsageText(attempt: AttemptReport): string {
  const usage = attempt.tool_usage;
  if (!usage || usage.categories.length === 0) {
    return "No highlighted categories configured";
  }
  return usage.categories.map((category) => `${category.label}: ${category.status}`).join("; ");
}
