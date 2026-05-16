# Bounded config fixture refactor benchmark

ShipTest tests repeatedly construct full `shiptest.yaml`-style config objects. Introduce a small reusable test fixture utility for common ShipTest config setup, then apply it to a focused set of tests.

Implement a reusable test-support helper that can create parsed ShipTest config inputs for tests without repeating unrelated schema boilerplate.

Apply it only where it clearly improves readability in this bounded scope:

- `src/run/plan.test.ts`
- focused config-loading tests in `src/config/config.test.ts` that benefit from file-based config fixture setup

Expected behavior:

- Existing tests should keep testing the same behavior.
- Tests should only override config fields that are relevant to the scenario being tested.
- The fixture API should make common config setup concise while keeping test intent obvious.
- Keep explicit local setup when it makes an edge case clearer.

Constraints:

- Keep the change focused on test fixture setup and test readability.
- Do not change production behavior.
- Do not add dependencies.
- Avoid broad formatting-only churn.
- Do not refactor unrelated tests in this bounded task.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run -- src/run/plan.test.ts src/config/config.test.ts
npm run build
```
