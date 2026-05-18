# Refactor: preserve doctor details for every benchmark in a run

Fix the run doctor artifact layout so multi-benchmark runs do not overwrite doctor diagnostics from earlier benchmarks.

## Problem

`runShiptest` prepares baselines for each selected benchmark. Previously it called doctor separately for each benchmark while using the same output directory:

```txt
.shiptest/runs/<run-id>/doctor/doctor-result.json
```

That meant benchmark doctor results overwrote each other. In a run with benchmarks A, B, and C, only C's doctor details remained in the final artifact.

This makes debugging misleading because cache hits/misses, setup warnings, validation output, timings, and snapshot/prepared-baseline checks for earlier benchmarks are lost.

## Required behavior

For a run with multiple benchmarks, write an aggregate doctor index and full per-benchmark doctor results:

```txt
doctor/
  doctor-result.json
  benchmarks/
    benchmark-a/
      doctor-result.json
    benchmark-b/
      doctor-result.json
```

The top-level `doctor/doctor-result.json` should act as a compact index, for example:

```json
{
  "ok": true,
  "benchmark_results": [
    {
      "benchmark_id": "benchmark-a",
      "ok": true,
      "doctor_result": "benchmarks/benchmark-a/doctor-result.json"
    }
  ]
}
```

Each per-benchmark file should contain the full verbose doctor result for that benchmark.

## Additional requirements

- `runShiptest` should call doctor once for the selected benchmark set, rather than once per benchmark.
- `shiptest run --benchmark a b` should only doctor selected benchmarks.
- Existing `shiptest doctor --benchmark <id>` behavior should continue to work.
- Add tests for:
  - aggregate doctor index
  - per-benchmark doctor files
  - multi-benchmark `runShiptest` preserving all doctor details

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/doctor/run-doctor.test.ts src/run/run.test.ts
npm run build
```

Manual smoke check:

```bash
npx shiptest run -c examples/shiptest.yaml --benchmark report-total-estimated-cost surface-prepared-baseline-normalization-warning --model gpt-5.4-mini --draft --yes
```

Confirm the run contains:

```txt
doctor/doctor-result.json
doctor/benchmarks/report-total-estimated-cost/doctor-result.json
doctor/benchmarks/surface-prepared-baseline-normalization-warning/doctor-result.json
```
