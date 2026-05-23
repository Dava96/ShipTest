# Fail zero-token agent attempts

ShipTest can receive Pi/agent output that exits successfully even though no model inference occurred. A run with zero token usage is not a valid benchmark datapoint, regardless of whether the configured model is cloud-hosted or local.

## Requirements

- Treat zero reported token usage as an error-level attempt quality signal.
- The check applies to every model-backed agent attempt, not only cloud providers.
- If an attempt reports no token usage, it must not be considered successful.
- If agent telemetry includes error messages and token usage is zero, emit a more specific error signal explaining that errors occurred without model usage.
- Preserve recovered attempts: telemetry error messages with non-zero token usage should be warning-only unless another validity check fails.

## Expected signals

Add attempt-level quality signals such as:

- `agent_no_token_usage`
- `agent_reported_errors_without_usage`
- `agent_reported_errors` as warning-only when token usage is non-zero

## Tests

Add or update tests proving:

- zero-token attempts become `agent_failed`
- zero-token attempts appear in `results.json` as failed attempts, not completed attempts
- recovered error messages with token usage and a valid patch remain eligible for success with a warning signal
