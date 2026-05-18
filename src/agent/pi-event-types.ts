export const piEventTypes = [
  "session",
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "compaction_start",
  "compaction_end",
  "auto_retry_start",
  "auto_retry_end",
] as const;

export type PiEventType = (typeof piEventTypes)[number];

export type PiJsonEvent =
  | PiSessionEvent
  | PiAgentStartEvent
  | PiAgentEndEvent
  | PiTurnStartEvent
  | PiTurnEndEvent
  | PiMessageStartEvent
  | PiMessageEndEvent
  | PiToolExecutionStartEvent
  | PiToolExecutionUpdateEvent
  | PiToolExecutionEndEvent
  | PiCompactionStartEvent
  | PiCompactionEndEvent
  | PiAutoRetryStartEvent
  | PiAutoRetryEndEvent;

export interface PiSessionEvent extends Record<string, unknown> {
  readonly type: "session";
  readonly id?: unknown;
  readonly version?: unknown;
  readonly cwd?: unknown;
  readonly timestamp?: unknown;
}

export interface PiAgentStartEvent extends Record<string, unknown> {
  readonly type: "agent_start";
}

export interface PiAgentEndEvent extends Record<string, unknown> {
  readonly type: "agent_end";
  readonly messages?: unknown;
}

export interface PiTurnStartEvent extends Record<string, unknown> {
  readonly type: "turn_start";
}

export interface PiTurnEndEvent extends Record<string, unknown> {
  readonly type: "turn_end";
  readonly message?: unknown;
  readonly toolResults?: unknown;
}

export interface PiMessageStartEvent extends Record<string, unknown> {
  readonly type: "message_start";
}

export interface PiMessageEndEvent extends Record<string, unknown> {
  readonly type: "message_end";
  readonly message?: unknown;
}

export interface PiToolExecutionStartEvent extends Record<string, unknown> {
  readonly type: "tool_execution_start";
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly args?: unknown;
}

export interface PiToolExecutionUpdateEvent extends Record<string, unknown> {
  readonly type: "tool_execution_update";
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly args?: unknown;
  readonly partialResult?: unknown;
}

export interface PiToolExecutionEndEvent extends Record<string, unknown> {
  readonly type: "tool_execution_end";
  readonly toolCallId?: unknown;
  readonly toolName?: unknown;
  readonly args?: unknown;
  readonly result?: unknown;
  readonly isError?: unknown;
}

export interface PiCompactionStartEvent extends Record<string, unknown> {
  readonly type: "compaction_start";
}

export interface PiCompactionEndEvent extends Record<string, unknown> {
  readonly type: "compaction_end";
  readonly reason?: unknown;
  readonly aborted?: unknown;
  readonly willRetry?: unknown;
  readonly errorMessage?: unknown;
}

export interface PiAutoRetryStartEvent extends Record<string, unknown> {
  readonly type: "auto_retry_start";
  readonly attempt?: unknown;
  readonly maxAttempts?: unknown;
  readonly delayMs?: unknown;
  readonly errorMessage?: unknown;
}

export interface PiAutoRetryEndEvent extends Record<string, unknown> {
  readonly type: "auto_retry_end";
  readonly attempt?: unknown;
  readonly success?: unknown;
  readonly finalError?: unknown;
}
