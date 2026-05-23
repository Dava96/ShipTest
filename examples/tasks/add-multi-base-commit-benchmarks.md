# Add multi-base-commit benchmark support

ShipTest benchmarks should be able to run the same task from more than one Git starting point. This lets a benchmark evaluate whether a model can complete the right remaining work from different historical states of the codebase.

This task may run from different historical base commits. Inspect the current code state before editing. Some requirements may already be partially or fully implemented in a given base commit; do not duplicate working functionality.

## Requirements

### Config

- Replace single `base_commit` benchmark config with `base_commits`.
- `base_commits` must accept one or more entries.
- Support shorthand string entries:

  ```yaml
  base_commits:
    - abc123
  ```

- Support labeled object entries:

  ```yaml
  base_commits:
    - commit: abc123
      label: before-config
  ```

- Normalize base commits internally with:
  - `commit`
  - `label`
  - `slug`
  - `index`
- Validate duplicate labels/slugs per benchmark.

### Planning and scheduling

- Expand run plans by:

  ```txt
  benchmark × base commit × model × attempt
  ```

- Scheduler fairness should group by benchmark and base commit, not benchmark alone.
- Run-plan output should make it clear that base commits multiply benchmark/model pairs.

### Paths and workspaces

- Attempt artifacts must include the base commit slug in the path:

  ```txt
  benchmarks/<benchmark>/base-commits/<slug>/models/<model>/attempts/001/
  ```

- Doctor/prepared-baseline artifacts should also be base-commit aware.
- Resettable workspace paths should include the base commit slug to avoid collisions.

### Results and reports

- Attempt reports should record the base commit metadata.
- `results.json` should group benchmark attempts by base commit.
- Reports should load attempts from the base-commit-aware results structure.
- Report tables should remain stable and deterministic.

## Tests

Add or update tests covering:

- config parsing for shorthand and labeled `base_commits`
- plan expansion across multiple base commits
- base-commit-aware artifact paths
- doctor output paths grouped by base commit
- results/report loading from base-commit grouped attempts

## Validation

Run focused validation, for example:

```bash
npm run test:run -- src/config/config.test.ts src/run/plan.test.ts src/run/attempt-scheduler.test.ts src/run/run-layout.test.ts src/run/run.test.ts src/doctor/run-doctor.test.ts src/reporting/html-report.test.ts
npm run typecheck
```
