# Suite-wide config fixture refactor benchmark

Refactor repeated ShipTest config setup across the test suite using a shared fixture utility, while preserving readability and test intent.

Use or introduce a reusable test-support helper for common ShipTest config objects and file-based `shiptest.yaml` fixtures. Apply it across the suite where it clearly improves tests.

Likely candidates include tests that repeatedly construct or parse ShipTest configs, such as:

- `src/run/plan.test.ts`
- `src/config/config.test.ts`
- `src/doctor/run-doctor.test.ts`
- `src/run/run.test.ts`
- `src/agent/pi-json-harness.test.ts`
- `src/evaluation/clean-room-evaluator.test.ts`
- `src/evaluation/hidden-payload.test.ts`
- `src/snapshot/snapshot.test.ts`

Expected behavior:

- Existing tests should keep testing the same behavior.
- Prefer readability over maximum deduplication.
- Only override config fields that matter to each test scenario.
- Keep explicit setup where it makes an edge case or integration behavior clearer.
- Do not hide important test intent behind overly generic helpers.
- Leave tests alone when the fixture abstraction would make them harder to understand.

Constraints:

- Do not change production behavior.
- Do not add dependencies.
- Avoid broad formatting-only churn.
- Do not rewrite unrelated assertions or test structure unnecessarily.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run
npm run build
```
