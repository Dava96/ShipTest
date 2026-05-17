# Refactor: pre-check configured Pi models before benchmark runs

Improve the ShipTest CLI run workflow so users get early, actionable feedback when `shiptest.yaml` references a model that is not listed by their local Pi installation.

## Problem

Users can run `pi --list-models` successfully in their shell, but ShipTest currently starts expensive benchmark setup/agent work before discovering model configuration issues. On Windows, spawning the bare `pi` command from Node can also fail even when `pi --list-models` works in PowerShell.

## Requirements

- Before `shiptest run` asks for confirmation, compare the selected models from `shiptest.yaml` against `pi --list-models`.
- Warn when any selected model's `{ provider, model }` pair is not present in the Pi model list.
- Do not hard-fail automatically; let the user decide whether to continue.
- Keep `--json` stdout machine-readable; warnings should not corrupt JSON output.
- Use the same `--pi` and `--pi-args` options as the benchmark run.
- Make the default Pi invocation reliable on Windows by avoiding direct `spawn("pi")` when ShipTest can resolve the installed Pi package CLI.
- Keep the runtime agent error handling generic. Do not add speculative provider-error string classifiers for model availability.
- Add focused test coverage for model-list parsing, missing model detection, warning formatting, process failures, timeouts, and output caps.

## Verification

Run:

```bash
npm run typecheck
npm run test:run -- src/run/model-availability.test.ts src/run/run.test.ts src/agent/pi-json-harness.test.ts
npm run build
```

Manual smoke check:

1. Temporarily set one configured model in `examples/shiptest.yaml` to a fake model name.
2. Run:

```bash
npx shiptest run -c examples/shiptest.yaml --benchmark shiptest-smoke --model gpt-5.4-mini
```

3. Confirm ShipTest prints a warning before `Proceed? [y/N]`.
4. Restore the real model name after the check.
