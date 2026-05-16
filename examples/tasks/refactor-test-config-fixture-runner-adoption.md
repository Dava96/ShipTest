# Expanded config fixture refactor benchmark

ShipTest now has repeated file-based test setup that writes full `shiptest.yaml` configs by hand. Expand the config fixture utility usage to additional integration-style tests where it improves readability.

Starting from an existing reusable ShipTest config test fixture utility, apply it to additional tests that create real config files or workspaces.

Prioritize this scope:

- `src/doctor/run-doctor.test.ts`
- `src/run/run.test.ts`

Expected behavior:

- Keep each test's purpose obvious.
- Preserve test-specific setup such as fake repositories, fake agents, and command behavior.
- Replace repeated config YAML/config boilerplate where the fixture helper makes the test shorter and clearer.
- Only specify fixture options that affect the behavior being tested.
- Do not force the abstraction into parts of the test where explicit setup is clearer.

Constraints:

- Do not change production behavior.
- Do not add dependencies.
- Avoid broad formatting-only churn.
- Do not refactor the entire suite in this expanded task.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run -- src/doctor/run-doctor.test.ts src/run/run.test.ts src/run/plan.test.ts src/config/config.test.ts
npm run build
```
