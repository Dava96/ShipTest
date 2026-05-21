# Add config-backed model attempt concurrency scheduling

ShipTest currently runs benchmark/model work sequentially and does not fully exercise repeated attempts for the same model. Add config-backed execution controls and make the run pipeline schedule individual model attempts concurrently while preserving deterministic artifacts and reports.

## Requirements

- Add a top-level `runner` config section with positive-integer defaults:
  - `runner.concurrency`, default `1`
  - `runner.model_attempts`, default `1`
- Add CLI overrides:
  - `--concurrency <count>`
  - `--model-attempts <count>`
  - CLI values should override config values.
- Treat one scheduled unit as:
  - `benchmark × model × attempt_number`
- Implement a benchmark-aware fair scheduler:
  - spread initial work across benchmark IDs before stacking more attempts onto the same benchmark
  - stack multiple attempts/models on one benchmark when it is the only benchmark with pending work
  - cap active attempts at `runner.concurrency` / `--concurrency`
- Keep default behavior conservative:
  - default concurrency remains `1`
  - default model attempts remains `1`
- Repeated attempts for the same benchmark/model must not collide:
  - attempt artifacts should remain under `attempts/001`, `attempts/002`, etc.
  - resettable workspace paths should include the attempt number.
- Preserve incremental reporting under concurrency:
  - write `results.json` and report pages as attempts finish
  - serialize shared writes so concurrent completions cannot corrupt artifacts
- Preserve stable final ordering regardless of completion order:
  - benchmark order
  - model order
  - attempt number
- On unexpected infrastructure errors:
  - stop scheduling new work
  - let already-running attempts finish if cancellation is not already available
  - mark/write crashed run artifacts where possible
- Make progress output attempt-aware, for example:
  - `[benchmark/model/a001] Running agent.`
- Print a warning when effective concurrency is greater than `1` because provider rate-limit errors and token spend may increase.

## Tests

Add or update tests covering:

- scheduler fairness across benchmarks
- scheduler stacking when only one benchmark has pending work
- config defaults for `runner.concurrency` and `runner.model_attempts`
- CLI/config option parsing where practical
- repeated attempts for the same model produce attempt `001`, `002`, etc.
- final `results.json` ordering is stable even if attempts complete out of order
- fake-Pi or equivalent harness validation that `concurrency: 2` with `model_attempts: 4` runs no more than two active model attempts at once

## Validation

At minimum, the implementation should pass:

```bash
npm run lint
npm run typecheck
npm run test:run -- src/run/attempt-scheduler.test.ts src/run/run.test.ts src/run/plan.test.ts src/config/config.test.ts
npm run build
```
