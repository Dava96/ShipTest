import { type PiEventType, type PiJsonEvent, piEventTypes } from "./pi-event-types.js";
import type { AgentTelemetry } from "./types.js";

type PiEventHandler<Event extends PiJsonEvent = PiJsonEvent> = (
  telemetry: MutableTelemetry,
  event: Event,
) => void;

type PiEventHandlerMap = {
  readonly [Event in PiJsonEvent as Event["type"]]: PiEventHandler<Event>;
};

type MutableUsage = {
  -readonly [Key in keyof AgentTelemetry["usage"]]: AgentTelemetry["usage"][Key];
};

interface MutableTelemetry {
  session?: AgentTelemetry["session"];
  lifecycle: {
    agent_started: boolean;
    agent_ended: boolean;
    process_exit_code: number | null;
  };
  counts: {
    events: number;
    turns: number;
    messages_started: number;
    messages_completed: number;
    tool_calls: number;
    failed_tool_calls: number;
    compactions: number;
    auto_retries: number;
    malformed_events: number;
  };
  tools: Record<string, { calls: number; failures: number }>;
  usage: MutableUsage;
  final_response?: string;
  error_messages: string[];
  compactions: Array<{
    reason?: string;
    aborted?: boolean;
    will_retry?: boolean;
    error_message?: string;
  }>;
  auto_retries: Array<{
    attempt?: number;
    max_attempts?: number;
    delay_ms?: number;
    error_message?: string;
    success?: boolean;
  }>;
}

export function createEmptyAgentTelemetry(): AgentTelemetry {
  return createMutableTelemetry() as AgentTelemetry;
}

export function parsePiJsonLines(
  lines: readonly string[],
  processExitCode: number | null,
): AgentTelemetry {
  const telemetry = createMutableTelemetry();
  for (const line of lines) {
    parsePiJsonLineIntoTelemetry(telemetry as AgentTelemetry, line);
  }
  telemetry.lifecycle.process_exit_code = processExitCode;
  return telemetry as AgentTelemetry;
}

export function parsePiJsonLineIntoTelemetry(telemetry: AgentTelemetry, line: string): void {
  const mutable = telemetry as MutableTelemetry;
  const parsed = parsePiJsonLine(line);
  if (parsed === "empty") {
    return;
  }
  if (parsed === "malformed") {
    mutable.counts.malformed_events += 1;
    return;
  }

  mutable.counts.events += 1;
  if (!parsed) {
    return;
  }
  dispatchPiEvent(mutable, parsed);
}

export function parsePiJsonLine(line: string): PiJsonEvent | undefined | "empty" | "malformed" {
  const trimmed = line.trim();
  if (!trimmed) {
    return "empty";
  }

  let rawEvent: Record<string, unknown>;
  try {
    rawEvent = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return "malformed";
  }

  return toPiJsonEvent(rawEvent);
}

const piEventHandlers: PiEventHandlerMap = {
  session: (telemetry, event) => {
    telemetry.session = optionalSession({
      id: stringValue(event.id),
      version: numberValue(event.version),
      cwd: stringValue(event.cwd),
      timestamp: stringValue(event.timestamp),
    });
  },
  agent_start: (telemetry) => {
    telemetry.lifecycle.agent_started = true;
  },
  agent_end: (telemetry, event) => {
    telemetry.lifecycle.agent_ended = true;
    updateFinalResponseFromMessages(telemetry, event.messages);
  },
  turn_start: (telemetry) => {
    telemetry.counts.turns += 1;
  },
  turn_end: (telemetry, event) => {
    addUsageFromMessage(telemetry, event.message);
    addToolResults(telemetry, event.toolResults);
  },
  message_start: (telemetry) => {
    telemetry.counts.messages_started += 1;
  },
  message_end: (telemetry, event) => {
    telemetry.counts.messages_completed += 1;
    addUsageFromMessage(telemetry, event.message);
    updateFinalResponseFromMessage(telemetry, event.message);
    addErrorFromMessage(telemetry, event.message);
  },
  tool_execution_start: (telemetry, event) => {
    addToolCall(telemetry, stringValue(event.toolName) ?? "unknown");
  },
  tool_execution_update: () => {
    // Updates are consumed by tool-usage recording; telemetry counts completed calls/failures.
  },
  tool_execution_end: (telemetry, event) => {
    if (event.isError === true) {
      addToolFailure(telemetry, stringValue(event.toolName) ?? "unknown");
    }
  },
  compaction_start: (telemetry) => {
    telemetry.counts.compactions += 1;
  },
  compaction_end: (telemetry, event) => {
    const errorMessage = stringValue(event.errorMessage);
    telemetry.compactions.push(
      optionalCompaction({
        reason: stringValue(event.reason),
        aborted: booleanValue(event.aborted),
        will_retry: booleanValue(event.willRetry),
        error_message: errorMessage,
      }),
    );
    addErrorMessage(telemetry, errorMessage);
  },
  auto_retry_start: (telemetry, event) => {
    const errorMessage = stringValue(event.errorMessage);
    telemetry.counts.auto_retries += 1;
    telemetry.auto_retries.push(
      optionalAutoRetry({
        attempt: numberValue(event.attempt),
        max_attempts: numberValue(event.maxAttempts),
        delay_ms: numberValue(event.delayMs),
        error_message: errorMessage,
      }),
    );
    addErrorMessage(telemetry, errorMessage);
  },
  auto_retry_end: (telemetry, event) => {
    const errorMessage = stringValue(event.finalError);
    telemetry.auto_retries.push(
      optionalAutoRetry({
        attempt: numberValue(event.attempt),
        success: booleanValue(event.success),
        error_message: errorMessage,
      }),
    );
    addErrorMessage(telemetry, errorMessage);
  },
};

function toPiJsonEvent(event: Record<string, unknown>): PiJsonEvent | undefined {
  const type = stringValue(event.type);
  if (!isPiEventType(type)) {
    return undefined;
  }
  return { ...event, type } as PiJsonEvent;
}

function isPiEventType(type: string | undefined): type is PiEventType {
  return type !== undefined && (piEventTypes as readonly string[]).includes(type);
}

function dispatchPiEvent(telemetry: MutableTelemetry, event: PiJsonEvent): void {
  const handler = piEventHandlers[event.type] as PiEventHandler<PiJsonEvent>;
  handler(telemetry, event);
}

export function telemetryHasContextExhaustion(telemetry: AgentTelemetry, stderr = ""): boolean {
  const haystack = [...telemetry.error_messages, stderr].join("\n").toLowerCase();
  return [
    "context length",
    "context window",
    "maximum context",
    "too many tokens",
    "input is too long",
  ].some((needle) => haystack.includes(needle));
}

function optionalSession(input: {
  readonly id: string | undefined;
  readonly version: number | undefined;
  readonly cwd: string | undefined;
  readonly timestamp: string | undefined;
}): NonNullable<AgentTelemetry["session"]> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as NonNullable<AgentTelemetry["session"]>;
}

function optionalCompaction(input: {
  readonly reason: string | undefined;
  readonly aborted: boolean | undefined;
  readonly will_retry: boolean | undefined;
  readonly error_message: string | undefined;
}): MutableTelemetry["compactions"][number] {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as MutableTelemetry["compactions"][number];
}

function optionalAutoRetry(input: {
  readonly attempt: number | undefined;
  readonly max_attempts?: number | undefined;
  readonly delay_ms?: number | undefined;
  readonly error_message: string | undefined;
  readonly success?: boolean | undefined;
}): MutableTelemetry["auto_retries"][number] {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as MutableTelemetry["auto_retries"][number];
}

function createMutableTelemetry(): MutableTelemetry {
  return {
    lifecycle: { agent_started: false, agent_ended: false, process_exit_code: null },
    counts: {
      events: 0,
      turns: 0,
      messages_started: 0,
      messages_completed: 0,
      tool_calls: 0,
      failed_tool_calls: 0,
      compactions: 0,
      auto_retries: 0,
      malformed_events: 0,
    },
    tools: {},
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      total_tokens: 0,
      uncached_tokens: 0,
      source: "pi",
    },
    error_messages: [],
    compactions: [],
    auto_retries: [],
  };
}

function addToolCall(telemetry: MutableTelemetry, toolName: string): void {
  telemetry.counts.tool_calls += 1;
  const tool = getToolTelemetry(telemetry, toolName);
  tool.calls += 1;
}

function addToolFailure(telemetry: MutableTelemetry, toolName: string): void {
  telemetry.counts.failed_tool_calls += 1;
  const tool = getToolTelemetry(telemetry, toolName);
  tool.failures += 1;
}

function getToolTelemetry(
  telemetry: MutableTelemetry,
  toolName: string,
): { calls: number; failures: number } {
  const existing = telemetry.tools[toolName];
  if (existing) {
    return existing;
  }
  const created = { calls: 0, failures: 0 };
  telemetry.tools[toolName] = created;
  return created;
}

function addToolResults(telemetry: MutableTelemetry, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const result of value) {
    if (!isRecord(result)) {
      continue;
    }
    const toolName = stringValue(result.toolName) ?? "unknown";
    if (result.isError === true) {
      addToolFailure(telemetry, toolName);
    }
  }
}

function addUsageFromMessage(telemetry: MutableTelemetry, value: unknown): void {
  if (!isRecord(value) || !isRecord(value.usage)) {
    return;
  }
  const usage = value.usage;
  const inputTokens = numberValue(usage.input) ?? 0;
  const outputTokens = numberValue(usage.output) ?? 0;
  const cacheReadTokens = numberValue(usage.cacheRead) ?? 0;
  const cacheWriteTokens = numberValue(usage.cacheWrite) ?? 0;
  telemetry.usage.input_tokens += inputTokens;
  telemetry.usage.output_tokens += outputTokens;
  telemetry.usage.cache_read_tokens += cacheReadTokens;
  telemetry.usage.cache_write_tokens += cacheWriteTokens;
  telemetry.usage.total_tokens += numberValue(usage.totalTokens) ?? 0;
  telemetry.usage.uncached_tokens += inputTokens + outputTokens + cacheWriteTokens;
  if (isRecord(usage.cost)) {
    const existing = telemetry.usage.estimated_cost_usd ?? {};
    telemetry.usage.estimated_cost_usd = {
      input: (existing.input ?? 0) + (numberValue(usage.cost.input) ?? 0),
      output: (existing.output ?? 0) + (numberValue(usage.cost.output) ?? 0),
      cache_read: (existing.cache_read ?? 0) + (numberValue(usage.cost.cacheRead) ?? 0),
      cache_write: (existing.cache_write ?? 0) + (numberValue(usage.cost.cacheWrite) ?? 0),
      total: (existing.total ?? 0) + (numberValue(usage.cost.total) ?? 0),
    };
  }
}

function updateFinalResponseFromMessages(telemetry: MutableTelemetry, value: unknown): void {
  if (!Array.isArray(value)) {
    return;
  }
  for (const message of value) {
    updateFinalResponseFromMessage(telemetry, message);
    addUsageFromMessage(telemetry, message);
    addErrorFromMessage(telemetry, message);
  }
}

function updateFinalResponseFromMessage(telemetry: MutableTelemetry, value: unknown): void {
  if (!isRecord(value) || value.role !== "assistant") {
    return;
  }
  const text = messageText(value);
  if (text) {
    telemetry.final_response = text;
  }
}

function addErrorFromMessage(telemetry: MutableTelemetry, value: unknown): void {
  if (!isRecord(value)) {
    return;
  }
  addErrorMessage(telemetry, stringValue(value.errorMessage));
}

function addErrorMessage(telemetry: MutableTelemetry, errorMessage: string | undefined): void {
  if (errorMessage) {
    telemetry.error_messages.push(errorMessage);
  }
}

function messageText(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) =>
      isRecord(block) && block.type === "text" ? (stringValue(block.text) ?? "") : "",
    )
    .filter(Boolean)
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
