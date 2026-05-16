# Refactor workspace preparation to use resettable workspaces

ShipTest currently prepares a fresh agent workspace and a fresh clean-room evaluation workspace by copying the full prepared baseline for every attempt. This makes larger benchmark suites slow because workspace preparation time scales with `benchmarks × models × attempts`.

Refactor workspace preparation so repeated attempts can reuse resettable Git workspaces backed by ShipTest's synthetic prepared-baseline Git commit.

Expected behavior:

- Keep the existing prepared baseline and clean-room evaluation trust model: every agent attempt starts from the same prepared baseline, and every evaluation applies the candidate patch to a clean baseline state.
- Add a resettable workspace preparation path that:
  - copies the prepared baseline on first use
  - reuses the existing workspace on later uses
  - resets it with the prepared baseline's synthetic Git commit
  - removes untracked/ignored files before reuse
  - verifies the workspace is clean after reset
  - falls back to deleting and copying the prepared baseline if reset fails
- Use resettable workspaces for both agent workspaces and clean-room evaluation workspaces when prepared baseline metadata includes a synthetic baseline commit.
- Preserve the existing copy-based behavior as a fallback for callers that do not have a prepared baseline commit.
- Keep per-attempt artifacts under the attempt directory, including `attempt.json`, `candidate.patch`, `changed-files.json`, agent artifacts, and evaluation artifacts.
- Store reusable generated workspaces outside individual attempt directories under ShipTest-generated state, for example `.shiptest/workspaces/resettable/...`.
- Report enough timing/metadata to tell whether workspace preparation used a full copy or a reset/reuse path.
- Ensure the reset path works on Windows repositories that may contain long dependency paths.

Add or update focused tests for:

- copying a prepared baseline on first use
- resetting an existing workspace back to the baseline commit
- removing untracked files during reset
- falling back to a fresh copy when an existing workspace is corrupt or cannot be reset
- preserving the copy strategy for callers without a baseline commit
- run-level wiring that passes prepared baseline commit metadata into agent and evaluation workspace preparation

Constraints:

- Keep the change focused on workspace preparation and timing/reporting needed to observe it.
- Do not change benchmark task contents, model behavior, or clean-room scoring semantics.
- Do not include unrelated historical type/export fixes such as `src/results/*` or `/results/` `.gitignore` changes; those should already be fixed before this benchmark baseline is created.
- Do not add new runtime dependencies.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run -- src/workspace/resettable-workspace.test.ts src/agent/pi-json-harness.test.ts src/evaluation/clean-room-evaluator.test.ts src/run/run.test.ts
npm run build
```
