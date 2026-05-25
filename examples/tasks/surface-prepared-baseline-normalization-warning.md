# UX: surface prepared-baseline normalization guidance

Improve the ShipTest run UX so users understand when and where to normalize a repository before the prepared baseline is cached.

## Problem

ShipTest creates the prepared baseline cache after repository setup. If setup does not run required normalization commands such as formatting, code generation, or `check:fix`, later model verification can produce noisy diffs unrelated to the task. This makes benchmark results harder to trust and harder to review.

Today this behavior is easy to miss. Users should be told that `environment.setup` is the place to put normalization steps before ShipTest caches the baseline.

## Requirements

- Surface a user-facing warning or guidance during run planning when prepared-baseline caching is enabled.
- The message should clearly explain that the prepared baseline cache is created after `environment.setup`.
- The message should recommend putting formatters, code generation, and other normalization commands in `environment.setup`.
- Keep the implementation lightweight and suitable for future TUI integration, where this can become a richer UX hint.
- Add or update tests for the warning/guidance.
- Do not change the core clean-room trust model.

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/run/plan.test.ts src/run/run.test.ts
npm run build
```
