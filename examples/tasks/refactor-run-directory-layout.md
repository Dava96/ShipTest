# Refactor run directory layout benchmark

ShipTest currently writes each run directly under `.shiptest/runs/` using a timestamp plus random suffix. Make the run output layout easier to browse by grouping runs by date and assigning a sequential run number within that date.

Implement a new default run layout:

```txt
.shiptest/runs/YYYYMMDD/run-001/
.shiptest/runs/YYYYMMDD/run-002/
.shiptest/runs/YYYYMMDD/run-003/
```

Expected behavior:

- The contents inside each individual run directory should remain the same, including `results.json`, `events.jsonl`, `report.html`, `doctor/`, and `benchmarks/`.
- The default `run_id` should reflect the date-grouped run path, for example `20260516/run-001`.
- Explicit output directories passed by the user should continue to work.
- Explicit run IDs used by tests/internal callers should continue to produce deterministic paths.
- Allocation of the next daily run directory should be safe if another process creates the same candidate directory first: skip existing `run-NNN` folders and allocate the next available number.
- Keep benchmark/model attempt directories unchanged, for example `benchmarks/<benchmark>/models/<model>/attempts/001/`.

Add or update focused tests for:

- default date-grouped run directory creation
- sequential allocation of multiple runs on the same date
- skipping an already-existing run directory
- explicit run ID or explicit output directory behavior remaining compatible
- attempt path layout remaining unchanged

Constraints:

- Keep the change focused on run layout/allocation.
- Do not change agent, evaluation, or report generation behavior except for paths/run IDs produced by the new layout.
- Do not add dependencies.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run -- src/run/run-layout.test.ts src/run/run.test.ts
npm run build
```
