# Feature: draft run mode for local working-tree benchmark development

Add an explicit draft run mode so users can test benchmark ideas against local uncommitted changes without ShipTest silently mixing working-tree config/tasks with a committed source snapshot.

## Problem

ShipTest should not silently create a reproducible-looking benchmark from mismatched inputs, for example:

- `shiptest.yaml` or task files read from the local working tree
- source snapshot created from Git `HEAD`
- untracked or modified files required by typecheck/build not included in the baseline

This caused baseline failures because the benchmark configuration and the source snapshot were not from the same world.

Users still need a good local development workflow: write a task, test it locally, iterate, then commit the task/config once it is useful.

## Product behavior

Introduce a clear distinction:

- default run = reproducible committed benchmark
- draft run = real benchmark using local working-tree state, marked non-reproducible

## Requirements

### Default mode

- `shiptest run` must require a clean Git working state before starting benchmark work.
- Any dirty state should block the run:
  - modified tracked files
  - staged changes
  - deleted files
  - untracked files
- The failure message must explain why the run is blocked and how to intentionally run a draft benchmark.
- Do not prompt to continue as draft automatically.

Example message shape:

```txt
Cannot run reproducible benchmark because the repository has uncommitted changes.

Commit or stash changes, or intentionally run a draft benchmark:

  shiptest run --draft

Draft runs are real runs, may spend tokens, and are marked non-reproducible.
```

### Draft mode

- Add a CLI flag:

```bash
shiptest run --draft
```

- Draft mode should snapshot/use the local working tree intentionally.
- Draft mode should allow dirty and untracked local files.
- Draft mode results must be clearly distinguishable from reproducible results.
- Record run metadata in `results.json`, for example:

```json
{
  "run_mode": "draft",
  "snapshot_source": "working_tree"
}
```

or an equivalent explicit schema.

- Reproducible/default runs should also be explicit, for example:

```json
{
  "run_mode": "reproducible",
  "snapshot_source": "git_commit"
}
```

- The HTML report should show the run mode clearly:
  - reproducible committed run
  - draft working-tree run / non-reproducible

### Cache correctness

- Ensure prepared-baseline cache keys remain safe for draft runs.
- A draft run with different file contents must not reuse a stale prepared baseline from a previous local state.
- If snapshot manifests already include file content hashes, verify this with tests.

### CI stance

- Do not add CI-specific benchmark execution support in this task.
- The key behavior is local explicit draft mode plus default reproducibility protection.

## E2E-style verification

Add a focused integration/e2e-style test that exercises the user workflow with a fake Pi command so it does not spend tokens:

1. Create a temporary Git repository fixture.
2. Make the repo dirty/untracked.
3. Verify normal `shiptest run` fails before agent execution with the reproducibility explanation.
4. Verify `shiptest run --draft` succeeds with the fake Pi command.
5. Verify `results.json` records draft/working-tree mode.
6. Verify `report.html` visibly marks the run as draft/non-reproducible.

Prefer putting this coverage in a dedicated test file such as:

```txt
src/run/draft-mode.test.ts
```

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/run/draft-mode.test.ts src/run/run.test.ts src/snapshot/snapshot.test.ts src/reporting/html-report.test.ts
npm run build
```

Manual command for this benchmark only:

```bash
npx shiptest run -c examples/shiptest.yaml --benchmark add-draft-working-tree-run-mode --yes
```
