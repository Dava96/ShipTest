import { describe, expect, it } from "vitest";

import { parsePiJsonLines, telemetryHasContextExhaustion } from "./pi-events.js";

describe("Pi JSON event parsing", () => {
  it("extracts broad telemetry from Pi JSON mode events", () => {
    const telemetry = parsePiJsonLines(
      [
        JSON.stringify({
          type: "session",
          version: 3,
          id: "session-1",
          cwd: "/repo",
          timestamp: "now",
        }),
        JSON.stringify({ type: "agent_start" }),
        JSON.stringify({ type: "turn_start" }),
        JSON.stringify({ type: "message_start", message: { role: "assistant" } }),
        JSON.stringify({ type: "tool_execution_start", toolName: "bash" }),
        JSON.stringify({ type: "tool_execution_end", toolName: "bash", isError: true }),
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Done" }],
            usage: {
              input: 10,
              output: 5,
              cacheRead: 2,
              cacheWrite: 1,
              totalTokens: 18,
              cost: { input: 0.1, output: 0.05, cacheRead: 0.02, cacheWrite: 0.03, total: 0.25 },
            },
          },
        }),
        JSON.stringify({ type: "compaction_start", reason: "threshold" }),
        JSON.stringify({
          type: "compaction_end",
          reason: "threshold",
          aborted: false,
          willRetry: false,
        }),
        JSON.stringify({
          type: "auto_retry_start",
          attempt: 1,
          maxAttempts: 3,
          delayMs: 100,
          errorMessage: "rate limit",
        }),
        JSON.stringify({ type: "auto_retry_end", attempt: 1, success: true }),
        JSON.stringify({ type: "agent_end", messages: [] }),
        "not-json",
      ],
      0,
    );

    expect(telemetry.session).toMatchObject({ id: "session-1", version: 3, cwd: "/repo" });
    expect(telemetry.lifecycle).toEqual({
      agent_started: true,
      agent_ended: true,
      process_exit_code: 0,
    });
    expect(telemetry.counts).toMatchObject({
      events: 12,
      turns: 1,
      messages_started: 1,
      messages_completed: 1,
      tool_calls: 1,
      failed_tool_calls: 1,
      compactions: 1,
      auto_retries: 1,
      malformed_events: 1,
      oversized_events: 0,
    });
    expect(telemetry.tools.bash).toEqual({ calls: 1, failures: 1 });
    expect(telemetry.usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 2,
      cache_write_tokens: 1,
      total_tokens: 18,
      uncached_tokens: 16,
      estimated_cost_usd: {
        input: 0.1,
        output: 0.05,
        cache_read: 0.02,
        cache_write: 0.03,
        total: 0.25,
      },
      source: "pi",
    });
    expect(telemetry.final_response).toBe("Done");
    expect(telemetry.auto_retries).toHaveLength(2);
    expect(telemetry.compactions).toHaveLength(1);
  });

  it("detects context exhaustion from telemetry errors and stderr", () => {
    const telemetry = parsePiJsonLines(
      [
        JSON.stringify({
          type: "message_end",
          message: { role: "assistant", errorMessage: "maximum context reached" },
        }),
      ],
      1,
    );

    expect(telemetryHasContextExhaustion(telemetry)).toBe(true);
    expect(telemetryHasContextExhaustion(parsePiJsonLines([], 1), "input is too long")).toBe(true);
  });
});
