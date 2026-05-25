# Add concurrent shared baseline preparation for doctor

ShipTest should speed up multi-benchmark runs by preparing unique repository baselines concurrently and reusing shared baselines across benchmarks.

## Requirements

- Use the existing `runner.concurrency` setting as the only concurrency knob.
- `shiptest run --concurrency <n>` should apply to both:
  - baseline/doctor preparation
  - model attempt execution
- `shiptest doctor --concurrency <n>` should override doctor baseline preparation concurrency.
- Group selected benchmarks by prepared-baseline identity rather than benchmark id.
- Benchmarks with the same baseline identity should prepare setup/validation/prepared-baseline work once and share the result.
- Benchmarks with different baseline identities should prepare concurrently up to the configured concurrency.
- Keep output deterministic even when baseline groups finish out of order.
- If one shared baseline fails, all benchmarks that depend on that baseline should fail before spending model-attempt tokens.

## Artifact layout

Use baseline-oriented doctor artifacts plus benchmark-facing wrappers:

```txt
doctor/
  baselines/<baseline-id>/baseline-result.json
  benchmarks/<benchmark-id>/doctor-result.json
  doctor-result.json
```

The aggregate `doctor-result.json` should include both `baseline_results` and `benchmark_results`.

Benchmark doctor results should reference the shared baseline result and expose the prepared baseline path/metadata needed by the runner.

## Baseline identity

A baseline identity should include inputs that affect the prepared repository baseline, such as:

- snapshot source / base commit
- snapshot config
- repository environment setup and validation config
- prepared baseline config
- ShipTest version

It should not include benchmark-specific agent view or evaluation-only settings, such as:

- `agent_context.exclude_paths`
- task file
- hidden evaluation files/patches
- scoring command

## Tests

Add or update tests proving:

- two benchmarks with the same baseline identity run setup/validation once and share one baseline result
- benchmarks with distinct baseline identities prepare concurrently up to `runner.concurrency`
- aggregate doctor output remains ordered deterministically
- benchmark doctor wrappers reference the shared baseline result
- `shiptest run` uses the shared baseline mapping for model attempts
- `shiptest doctor --concurrency` is accepted and used

## Validation

Run focused validation, for example:

```bash
npm run test:run -- src/doctor/run-doctor.test.ts src/run/run.test.ts
npm run typecheck
```
