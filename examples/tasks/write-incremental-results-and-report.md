# Reliability: write incremental results and report during runs

Make long ShipTest runs more resilient by writing `results.json` and `report.html` incrementally instead of only at the end of the entire run.

## Problem

If ShipTest crashes or is interrupted late in a multi-benchmark run, useful artifacts can be missing even though earlier attempts completed successfully.

Previously, final artifacts were written only after all attempts finished:

```txt
results.json
report.html
```

A crash before finalization could leave only partial attempt artifacts and no easy report to inspect.

## Required behavior

ShipTest should write partial run artifacts as the run progresses:

- after doctor/baseline preparation completes
- after each completed attempt
- at final completion
- on caught top-level failure when possible

While a run is active, partial results should use:

```json
"status": "running"
```

If a caught top-level error happens, write a best-effort partial result with:

```json
"status": "crashed"
```

If the process hard-crashes, the last successfully written report may still say `running`, which is acceptable and useful.

## Scope

- Keep the report static HTML.
- Do not add pending/planned attempt states yet.
- Partial reports should include completed attempts only.
- Use atomic writes to avoid corrupt `results.json` or `report.html`:

```txt
results.json.tmp -> results.json
report.html.tmp -> report.html
```

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/run/run.test.ts src/reporting/html-report.test.ts
npm run build
```

Add/keep test coverage proving that `results.json` and `report.html` exist with status `running` before the first agent attempt finishes.

Manual smoke check:

```bash
npx shiptest run -c examples/shiptest.yaml --benchmark report-total-estimated-cost --model gpt-5.4-mini --draft --yes
```

Confirm final artifacts exist and the final status is `completed` or `completed_with_issues`.
