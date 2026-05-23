# Skip evaluation for invalid agent submissions

ShipTest should not run or count clean-room evaluation for attempts where the agent did not produce a valid benchmark submission. An agent that never participated in the task cannot pass the benchmark just because the unchanged baseline passes a broad scoring command.

## Requirements

- Before clean-room evaluation, run the attempt validity checks that can be computed from agent output.
- Skip evaluation when:
  - the agent failed
  - token usage checks fail
  - required file-change checks fail
  - any attempt quality signal has severity `error`
- Do not print `Running clean-room evaluation` for skipped attempts.
- Summary verdict counters must only count successful completed attempts.
- A failed or invalid agent attempt must not increase `passed`, even if an evaluation result from an older or partial path exists.

## Tests

Add or update tests proving:

- invalid/no-op implementation attempts have no evaluation result
- `results.summary.passed` remains zero for invalid agent attempts
- the attempt status remains `agent_failed`
- valid attempts still run clean-room evaluation normally
