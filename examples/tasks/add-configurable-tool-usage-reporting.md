# Feature: configurable tool usage reporting

Add configurable, framework-agnostic tool usage reporting so ShipTest can show what tools an agent used, which tool calls failed, and which user-defined tool usage categories were observed.

## Problem

A benchmark report can look green because clean-room evaluation passed, while the agent's own workspace contained failed commands or other important tool activity. Users need visibility into that activity without ShipTest making framework-specific assumptions such as npm, bun, cargo, composer, or pytest semantics.

Tool output can contain source code, logs, secrets, or proprietary data, so ShipTest should not store plaintext tool output by default.

## Product direction

ShipTest should collect tool-call metadata generically. Users can optionally highlight categories that matter to them.

Examples:

- Verification commands
- Search/investigation commands
- Dependency install commands
- Formatting commands
- Any other user-defined category

ShipTest should not hardcode ecosystem-specific verification detection.

## Requirements

### Configuration

Add a top-level global `tool_usage` config section with security-focused defaults.

Suggested shape:

```yaml
tool_usage:
  record_tool_calls: true
  tool_output: none
  record_raw_events: false
  final_response: capped
  final_response_max_bytes: 8192
  stderr_max_bytes: 65536
  categories:
    - id: verification
      label: Verification
      highlights:
        - id: typecheck
          label: Typecheck
          match:
            tool: bash
            command_contains: npm run typecheck
```

Defaults should be safe if the section is omitted:

- record tool-call metadata
- omit tool output
- do not record raw agent events
- cap final response/stderr
- no highlighted categories by default

### Tool call recording

Record tool calls to an attempt artifact such as:

```txt
agent/tool-calls.jsonl
```

Each record should include at least:

- stable tool call id
- provider/native tool call id when available
- tool name
- command or input summary when available
- status: passed/failed/unknown/incomplete
- duration if available/derivable
- explicit output capture policy

When output is omitted, do not use ambiguous `null`. Use an explicit object, for example:

```json
{
  "mode": "omitted",
  "reason": "tool_usage_policy",
  "message": "Tool output omitted by tool_usage policy."
}
```

When excerpts are enabled, capture bounded excerpts only.

### Category-first highlights

Users define categories and highlights under each category.

Report and attempt JSON should group matched calls by category:

```json
{
  "tool_usage": {
    "summary": {
      "tool_calls": 34,
      "failed_tool_calls": 6
    },
    "categories": [
      {
        "id": "verification",
        "label": "Verification",
        "status": "failed",
        "summary": {
          "matched_tool_calls": 2,
          "failed_tool_calls": 1
        },
        "highlights": []
      }
    ]
  }
}
```

If no categories are configured, reports should still show generic tool-call and failed-tool-call counts.

### Streaming and safety

- Do not buffer full Pi stdout/stderr in memory.
- Raw Pi events should only be stored when `tool_usage.record_raw_events` is true.
- Tool output should be omitted by default.
- Stderr/final response should be capped according to config.

### Report

The HTML report should surface tool usage in the attempts table, including:

- total tool calls
- failed tool calls
- configured category statuses

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/agent/pi-json-harness.test.ts src/config/config.test.ts src/run/run.test.ts src/reporting/html-report.test.ts
npm run build
```

Optional manual smoke check with a fake Pi command should confirm:

- `agent/tool-calls.jsonl` is written
- tool output is omitted by default
- raw `pi-events.jsonl` is not written by default
- configured categories appear in `attempt.json` and the HTML report
