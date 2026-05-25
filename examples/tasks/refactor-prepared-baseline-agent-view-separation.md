# Separate prepared baselines from benchmark-specific agent views

ShipTest should prepare reusable repository baselines independently from the files a specific benchmark hides from the agent. This improves correctness and makes future baseline/doctor concurrency more effective because multiple benchmarks that share the same repository/environment baseline can reuse it.

## Requirements

- Prepared baseline creation must not apply benchmark-specific `agent_context.exclude_paths`.
- The prepared baseline should still remove global ShipTest/internal state that must never be exposed from a repository snapshot, such as `.shiptest/**`.
- Apply `agent_context.exclude_paths` after copying/resetting the prepared baseline into the agent workspace and before the model runs.
- Excluded files should be physically absent from the agent workspace, not merely omitted from prompt context.
- Clean-room evaluation should use the unfiltered prepared baseline, then apply the candidate patch and hidden evaluation payloads.
- Hidden evaluation files and directories must remain unavailable to the agent and available only in the evaluation workspace.
- Submission patches that create, modify, or delete files matching `agent_context.exclude_paths` should fail the attempt with an error quality signal.

## Path matching

- Match `agent_context.exclude_paths` against workspace-relative paths.
- Normalize path separators to `/` so behavior is stable on Windows, macOS, and Linux.
- Keep existing glob-style matching semantics.

## Tests

Add or update tests proving:

- repository snapshots/prepared baselines keep benchmark-excluded files when they are normal repository files
- `.shiptest/**` or equivalent ShipTest internal state is still stripped from snapshots by default
- agent workspaces remove files matching `agent_context.exclude_paths`
- clean-room evaluation workspaces still contain files excluded from the agent workspace
- attempts fail with an `excluded_path_modified` error quality signal if the submitted patch touches an excluded path

## Validation

Run focused validation, for example:

```bash
npm run test:run -- src/snapshot/snapshot.test.ts src/run/run.test.ts
npm run typecheck
```
