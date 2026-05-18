# Reliability: stream Pi output with bounded parsing

Prevent long/high-token ShipTest runs from crashing due to unbounded Pi stdout buffering.

## Problem

Pi JSON mode can emit very large JSONL streams during long agent runs. ShipTest should not accumulate the entire stdout stream in memory and then convert it into one giant string before writing artifacts. That can exceed V8's maximum string size and crash the process.

## Requirements

- Do not buffer the full Pi stdout stream in memory.
- Parse Pi JSON telemetry incrementally as chunks arrive.
- If `tool_usage.record_raw_events` is enabled, stream raw Pi event chunks to `agent/pi-events.jsonl` instead of buffering them.
- Handle write-stream backpressure when writing raw events.
- Keep only bounded in-memory stdout state for the current pending JSONL line.
- Cap the pending JSONL line at 10MB for structured parsing.
- If a single JSONL line exceeds the cap:
  - skip structured parsing for that line
  - increment a distinct `oversized_events` telemetry counter
  - continue parsing later lines
  - do not fail the benchmark solely because of the oversized line
- Keep `malformed_events` and `oversized_events` semantically separate.
- Continue using bounded stderr tail behavior.

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/agent/pi-json-harness.test.ts src/agent/pi-events.test.ts
npm run build
```

Add/keep test coverage proving:

- an oversized Pi JSON line increments `oversized_events`
- subsequent valid events are still parsed
- the attempt can complete successfully after an oversized event
