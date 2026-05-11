# ShipTest

This directory is reserved for ShipTest benchmark assets and generated local artifacts.

Common paths:

- `../shiptest.yaml` - main ShipTest configuration when a project uses a root config.
- `tasks/` - benchmark task prompts that are visible to agents.
- `hidden/` - optional hidden evaluation assets used only during clean-room evaluation.
- `runs/` - generated run artifacts and reports. Ignored by Git.
- `cache/` - prepared baseline cache. Ignored by Git.
- `tmp/` - temporary local files. Ignored by Git.

Commit benchmark definitions and task files when they should be shared with the team. Avoid committing generated run artifacts.
