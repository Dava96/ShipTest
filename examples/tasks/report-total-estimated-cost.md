# Report: show total estimated benchmark cost

Add clearer cost visibility to the ShipTest HTML report.

## Problem

ShipTest already records `summary.estimated_cost_usd` in `results.json`, but the HTML report summary does not show the total estimated USD cost. Users should be able to open the report and immediately see the estimated cost of the benchmark run without inspecting JSON.

## Requirements

- Render total estimated benchmark cost in the HTML report summary cards.
- Source the value from `results.summary.estimated_cost_usd`.
- Format the value as USD for humans, for example `$0.1235`.
- If the value is missing, render a clear fallback such as `not available`.
- Add or update report tests to cover both present and missing cost values.

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/reporting/html-report.test.ts
npm run build
```
