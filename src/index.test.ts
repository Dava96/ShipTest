import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ShiptestConfigError } from "./config/errors.js";
import { loadShiptestConfig, SHIPTEST_PROJECT_NAME } from "./index.js";

describe("ShipTest project exports", () => {
  it("exposes the project name", () => {
    expect(SHIPTEST_PROJECT_NAME).toBe("ShipTest");
  });

  it("loads and resolves a valid config", async () => {
    const workspace = await createFixtureWorkspace();
    const config = await loadShiptestConfig(path.join(workspace, "shiptest.yaml"));

    expect(config.snapshot.strategy).toBe("sanitized_copy");
    expect(config.snapshot.git_lfs_handling).toBe("fail_on_pointers");
    expect(config.snapshot.submodule_handling).toBe("fail_if_detected");
    expect(config.shiptest_runner.prepared_baseline).toEqual({ enabled: true, cache: true });
    expect(config.defaults.limits.max_attempt_mins).toBe(30);
    expect(config.benchmarks[0]?.limits.max_attempt_mins).toBe(30);
    expect(config.benchmarks[0]?.type).toBe("replay_change");
  });

  it("rejects unknown benchmark model references", async () => {
    const workspace = await createFixtureWorkspace({ benchmarkModel: "missing-model" });

    await expect(loadShiptestConfig(path.join(workspace, "shiptest.yaml"))).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          message: "Unknown model reference: missing-model",
        }),
      ],
    } satisfies Partial<ShiptestConfigError>);
  });

  it("rejects unsafe hidden evaluation destinations", async () => {
    const workspace = await createFixtureWorkspace({ hiddenRepositoryPath: "../leak.test.ts" });

    await expect(loadShiptestConfig(path.join(workspace, "shiptest.yaml"))).rejects.toMatchObject({
      issues: [
        expect.objectContaining({
          code: "UNSAFE_WORKSPACE_PATH",
        }),
      ],
    } satisfies Partial<ShiptestConfigError>);
  });
});

interface FixtureOptions {
  readonly benchmarkModel?: string;
  readonly hiddenRepositoryPath?: string;
}

async function createFixtureWorkspace(options: FixtureOptions = {}): Promise<string> {
  const workspace = path.join(os.tmpdir(), "shiptest-fixtures");
  await mkdir(workspace, { recursive: true });
  const fixture = path.join(workspace, crypto.randomUUID());
  await mkdir(fixture, { recursive: true });
  const repo = path.join(fixture, "repo");
  await mkdir(path.join(fixture, "tasks"), { recursive: true });
  await mkdir(path.join(fixture, "hidden", "fixtures"), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, "Dockerfile"), "FROM node:22\n", "utf8");
  await writeFile(path.join(fixture, "tasks", "invoice.md"), "Fix invoice rounding.\n", "utf8");
  await writeFile(path.join(fixture, "hidden", "invoice.test.ts"), "// hidden test\n", "utf8");
  await writeFile(path.join(fixture, "hidden", "fixtures", "invoice.json"), "{}\n", "utf8");

  await writeFile(
    path.join(fixture, "shiptest.yaml"),
    `version: 1
project:
  name: payments-api
  repo: repo
repository_environment:
  commands_run_in: repository_environment
  source: dockerfile_target
  dockerfile_path: Dockerfile
  dockerfile_target: test
  setup_commands:
    - npm ci
  validation_commands:
    required:
      - npm test
models:
  - id: sonnet-4.5
    provider: anthropic
    model: claude-sonnet-4.5
defaults:
  run:
    models:
      - sonnet-4.5
  limits: {}
  agent_context:
    exclude_paths:
      - AGENTS.md
      - "**/CLAUDE.md"
  evaluation:
    scoring_command: npm test -- tests/invoice.test.ts
benchmarks:
  - id: invoice-rounding
    type: replay_change
    base_commit: abc123
    task: tasks/invoice.md
    models:
      - ${options.benchmarkModel ?? "sonnet-4.5"}
    evaluation:
      hidden_evaluation_files:
        - shiptest_path: hidden/invoice.test.ts
          repository_path: ${options.hiddenRepositoryPath ?? "tests/invoice.test.ts"}
          write_mode: create_new
      hidden_evaluation_directories:
        - shiptest_path: hidden/fixtures
          repository_path: tests/fixtures/invoice
          write_mode: create_new
`,
    "utf8",
  );

  return fixture;
}
