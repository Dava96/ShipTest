# Optional project repo default benchmark

ShipTest currently expects configs to declare `project.repo`. Make config setup easier by supporting a sensible default when that field is omitted.

Implement support for omitting `project.repo` from `shiptest.yaml`.

Expected behavior:

- Existing configs with an explicit `project.repo` must continue to work as they do today.
- If `project.repo` is omitted, resolve the project repository to the nearest Git repository root by walking upward from the directory containing `shiptest.yaml`.
- If no Git repository root is found, fall back to the directory containing `shiptest.yaml`.
- Benchmark task files and other ShipTest-owned asset paths should continue to resolve relative to the config file directory.
- Repository-relative paths should continue to resolve relative to the resolved project repository.

Add focused test coverage for:

- A config below a Git root, such as `.shiptest/shiptest.yaml`, with omitted `project.repo` resolving to the Git root.
- A config outside any Git repository with omitted `project.repo` resolving to the config directory.
- Existing explicit `project.repo` behavior remaining valid.

Constraints:

- Keep the change small and focused on config loading/path resolution.
- Preserve backwards compatibility for existing configs.
- Do not add dependencies.
- Do not change unrelated run, reporting, agent, or evaluation behavior.
- Do not run `npm run check:fix`; the prepared baseline is already normalized.

Before finishing, verify with:

```bash
npm run typecheck
npm run test:run -- src/config/config.test.ts
npm run build
```
