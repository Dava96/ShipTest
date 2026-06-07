import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { PiJsonEvent } from "./pi-event-types.js";

export type ToolCallStatus = "passed" | "failed" | "unknown" | "incomplete";
export type ToolUsageCategoryStatus = "passed" | "failed" | "observed" | "not_observed";

export interface ToolCallOutputCapture {
  readonly mode: "omitted" | "excerpt";
  readonly reason?: string;
  readonly message?: string;
  readonly strategy?: "tail";
  readonly bytes?: number;
  readonly truncated?: boolean;
  readonly excerpt?: string;
}

export interface ToolCallSummary {
  readonly id: string;
  readonly provider_tool_call_id?: string;
  readonly tool: string;
  readonly command?: string;
  readonly input_summary?: string;
  readonly status: ToolCallStatus;
  readonly is_error?: boolean;
  readonly started_at_ms?: number;
  readonly completed_at_ms?: number;
  readonly duration_ms?: number;
  readonly output_capture: ToolCallOutputCapture;
}

export interface ToolUsageHighlightSummary {
  readonly id: string;
  readonly label: string;
  readonly status: ToolUsageCategoryStatus;
  readonly matched_tool_call_ids: readonly string[];
  readonly failed_tool_call_ids: readonly string[];
}

export interface ToolUsageCategorySummary {
  readonly id: string;
  readonly label: string;
  readonly status: ToolUsageCategoryStatus;
  readonly summary: {
    readonly matched_tool_calls: number;
    readonly failed_tool_calls: number;
  };
  readonly highlights: readonly ToolUsageHighlightSummary[];
}

export interface ToolCallEvidence {
  readonly id: string;
  readonly tool: string;
  readonly command?: string;
  readonly input_summary?: string;
  readonly status: ToolCallStatus;
}

export interface ToolUsageSummary {
  readonly summary: {
    readonly tool_calls: number;
    readonly failed_tool_calls: number;
  };
  readonly tool_calls: readonly ToolCallEvidence[];
  readonly categories: readonly ToolUsageCategorySummary[];
  readonly artifacts: {
    readonly tool_calls_jsonl?: string;
  };
}

type ToolUsageConfig = ResolvedShiptestConfig["tool_usage"];

interface PendingToolCall {
  readonly id: string;
  readonly providerToolCallId?: string;
  readonly tool: string;
  readonly command?: string;
  readonly inputSummary?: string;
  readonly startedAtMs: number;
  outputTail: string;
  outputBytes: number;
  outputTruncated: boolean;
}

export class ToolUsageRecorder {
  private readonly pending = new Map<string, PendingToolCall>();
  private readonly summaries: ToolCallSummary[] = [];
  private nextIndex = 1;
  private stream: WriteStream | undefined;

  private constructor(
    private readonly config: ToolUsageConfig,
    private readonly toolCallsPath: string,
  ) {}

  static async create(options: {
    readonly config: ToolUsageConfig;
    readonly artifactsDir: string;
  }): Promise<ToolUsageRecorder> {
    const toolCallsPath = path.join(options.artifactsDir, "tool-calls.jsonl");
    const recorder = new ToolUsageRecorder(options.config, toolCallsPath);
    if (options.config.record_tool_calls) {
      await mkdir(options.artifactsDir, { recursive: true });
      recorder.stream = createWriteStream(toolCallsPath, { flags: "w", encoding: "utf8" });
    }
    return recorder;
  }

  get artifactPath(): string | undefined {
    return this.config.record_tool_calls ? this.toolCallsPath : undefined;
  }

  handlePiEvent(event: PiJsonEvent): void {
    if (!this.config.record_tool_calls) {
      return;
    }
    if (event.type === "tool_execution_start") {
      this.startToolCall(event);
      return;
    }
    if (event.type === "tool_execution_update") {
      this.updateToolCall(event);
      return;
    }
    if (event.type === "tool_execution_end") {
      this.endToolCall(event);
    }
  }

  async finish(): Promise<ToolUsageSummary> {
    for (const pending of [...this.pending.values()]) {
      this.writeSummary(this.createSummary(pending, "incomplete", false, Date.now()));
    }
    this.pending.clear();
    await new Promise<void>((resolve, reject) => {
      if (!this.stream) {
        resolve();
        return;
      }
      this.stream.on("error", reject);
      this.stream.end(resolve);
    });
    return this.createToolUsageSummary();
  }

  private startToolCall(event: PiJsonEvent & { readonly type: "tool_execution_start" }): void {
    const providerToolCallId = stringValue(event.toolCallId);
    const key = providerToolCallId ?? `anonymous-${this.nextIndex}`;
    const tool = stringValue(event.toolName) ?? "unknown";
    this.pending.set(key, {
      id: `tool-${String(this.nextIndex++).padStart(4, "0")}`,
      ...(providerToolCallId ? { providerToolCallId } : {}),
      tool,
      ...extractInput(event.args),
      startedAtMs: Date.now(),
      outputTail: "",
      outputBytes: 0,
      outputTruncated: false,
    });
  }

  private updateToolCall(event: PiJsonEvent & { readonly type: "tool_execution_update" }): void {
    const pending = this.findPending(event);
    if (!pending) {
      return;
    }
    appendOutput(pending, textFromToolResult(event.partialResult), this.outputExcerptBytes());
  }

  private endToolCall(event: PiJsonEvent & { readonly type: "tool_execution_end" }): void {
    const pending = this.findPending(event) ?? this.createLatePending(event);
    appendOutput(pending, textFromToolResult(event.result), this.outputExcerptBytes());
    this.pending.delete(pending.providerToolCallId ?? pending.id);
    this.writeSummary(
      this.createSummary(
        pending,
        event.isError === true ? "failed" : "passed",
        event.isError === true,
        Date.now(),
      ),
    );
  }

  private findPending(event: {
    readonly toolCallId?: unknown;
    readonly toolName?: unknown;
  }): PendingToolCall | undefined {
    const providerToolCallId = stringValue(event.toolCallId);
    if (providerToolCallId) {
      return this.pending.get(providerToolCallId);
    }
    const toolName = stringValue(event.toolName);
    return [...this.pending.values()].find((pending) => pending.tool === toolName);
  }

  private createLatePending(
    event: PiJsonEvent & { readonly type: "tool_execution_end" },
  ): PendingToolCall {
    const providerToolCallId = stringValue(event.toolCallId);
    return {
      id: `tool-${String(this.nextIndex++).padStart(4, "0")}`,
      ...(providerToolCallId ? { providerToolCallId } : {}),
      tool: stringValue(event.toolName) ?? "unknown",
      ...extractInput(event.args),
      startedAtMs: Date.now(),
      outputTail: "",
      outputBytes: 0,
      outputTruncated: false,
    };
  }

  private createSummary(
    pending: PendingToolCall,
    status: ToolCallStatus,
    isError: boolean,
    completedAtMs: number,
  ): ToolCallSummary {
    return {
      id: pending.id,
      ...(pending.providerToolCallId ? { provider_tool_call_id: pending.providerToolCallId } : {}),
      tool: pending.tool,
      ...(pending.command ? { command: pending.command } : {}),
      ...(pending.inputSummary ? { input_summary: pending.inputSummary } : {}),
      status,
      is_error: isError,
      started_at_ms: pending.startedAtMs,
      completed_at_ms: completedAtMs,
      duration_ms: completedAtMs - pending.startedAtMs,
      output_capture: this.createOutputCapture(pending),
    };
  }

  private createOutputCapture(pending: PendingToolCall): ToolCallOutputCapture {
    if (this.config.tool_output === "excerpts") {
      return {
        mode: "excerpt",
        strategy: "tail",
        bytes: Buffer.byteLength(pending.outputTail, "utf8"),
        truncated: pending.outputTruncated,
        excerpt: pending.outputTail,
      };
    }
    return {
      mode: "omitted",
      reason: "tool_usage_policy",
      message: "Tool output omitted by tool_usage policy.",
    };
  }

  private writeSummary(summary: ToolCallSummary): void {
    this.summaries.push(summary);
    this.stream?.write(`${JSON.stringify(summary)}\n`);
  }

  private outputExcerptBytes(): number {
    return this.config.tool_output === "excerpts" ? this.config.tool_output_excerpt_bytes : 0;
  }

  private createToolUsageSummary(): ToolUsageSummary {
    const failedToolCalls = this.summaries.filter((summary) => summary.status === "failed");
    const categories = this.config.categories.map((category) => {
      const highlights = category.highlights.map((highlight) => {
        const matched = this.summaries.filter((summary) =>
          matchesHighlight(summary, highlight.match),
        );
        const failed = matched.filter((summary) => summary.status === "failed");
        return {
          id: highlight.id,
          label: highlight.label,
          status: statusFromMatches(matched, failed),
          matched_tool_call_ids: matched.map((summary) => summary.id),
          failed_tool_call_ids: failed.map((summary) => summary.id),
        };
      });
      const matchedIds = new Set(
        highlights.flatMap((highlight) => highlight.matched_tool_call_ids),
      );
      const failedIds = new Set(highlights.flatMap((highlight) => highlight.failed_tool_call_ids));
      return {
        id: category.id,
        label: category.label,
        status: categoryStatus(highlights),
        summary: { matched_tool_calls: matchedIds.size, failed_tool_calls: failedIds.size },
        highlights,
      };
    });
    return {
      summary: { tool_calls: this.summaries.length, failed_tool_calls: failedToolCalls.length },
      tool_calls: this.summaries.map((summary) => ({
        id: summary.id,
        tool: summary.tool,
        ...(summary.command ? { command: summary.command } : {}),
        ...(summary.input_summary ? { input_summary: summary.input_summary } : {}),
        status: summary.status,
      })),
      categories,
      artifacts: { ...(this.artifactPath ? { tool_calls_jsonl: this.artifactPath } : {}) },
    };
  }
}

function matchesHighlight(
  summary: ToolCallSummary,
  match: ToolUsageConfig["categories"][number]["highlights"][number]["match"],
): boolean {
  if (match.tool && summary.tool !== match.tool) {
    return false;
  }
  const command = summary.command ?? "";
  if (match.command_equals && command.trim() !== match.command_equals.trim()) {
    return false;
  }
  if (match.command_contains && !command.includes(match.command_contains)) {
    return false;
  }
  return Boolean(match.tool || match.command_equals || match.command_contains);
}

function categoryStatus(highlights: readonly ToolUsageHighlightSummary[]): ToolUsageCategoryStatus {
  if (
    highlights.length === 0 ||
    highlights.every((highlight) => highlight.status === "not_observed")
  ) {
    return "not_observed";
  }
  if (highlights.some((highlight) => highlight.status === "failed")) {
    return "failed";
  }
  if (
    highlights.every(
      (highlight) => highlight.status === "passed" || highlight.status === "not_observed",
    )
  ) {
    return "passed";
  }
  return "observed";
}

function statusFromMatches(
  matched: readonly ToolCallSummary[],
  failed: readonly ToolCallSummary[],
): ToolUsageCategoryStatus {
  if (matched.length === 0) {
    return "not_observed";
  }
  if (failed.length > 0) {
    return "failed";
  }
  if (matched.every((summary) => summary.status === "passed")) {
    return "passed";
  }
  return "observed";
}

function extractInput(args: unknown): {
  readonly command?: string;
  readonly inputSummary?: string;
} {
  if (!isRecord(args)) {
    return {};
  }
  const command = stringValue(args.command);
  if (command) {
    return { command };
  }
  const pathValue = stringValue(args.path);
  if (pathValue) {
    return { inputSummary: `path: ${pathValue}` };
  }
  return { inputSummary: JSON.stringify(args).slice(0, 500) };
}

function textFromToolResult(result: unknown): string {
  if (!isRecord(result) || !Array.isArray(result.content)) {
    return "";
  }
  return result.content
    .map((block) =>
      isRecord(block) && block.type === "text" ? (stringValue(block.text) ?? "") : "",
    )
    .join("");
}

function appendOutput(pending: PendingToolCall, text: string, maxBytes: number): void {
  if (!text || maxBytes <= 0) {
    return;
  }
  pending.outputBytes += Buffer.byteLength(text, "utf8");
  pending.outputTail = tailString(`${pending.outputTail}${text}`, maxBytes);
  pending.outputTruncated = pending.outputTruncated || pending.outputBytes > maxBytes;
}

function tailString(value: string, maxBytes: number): string {
  let text = value;
  while (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = text.slice(Math.max(1, Math.floor(text.length / 4)));
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
