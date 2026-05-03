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

    expect(config.snapshot.strategy).toBe("materialized_checkout");
    expect(config.shiptest_runner.validated_baseline).toEqual({ enabled: true, cache: true });
    expect(config.limits.max_runtime_minutes).toBe(30);
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
    const workspace = await createFixtureWorkspace({ hiddenDestination: "../leak.test.ts" });

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
  readonly hiddenDestination?: string;
}

async function createFixtureWorkspace(options: FixtureOptions = {}): Promise<string> {
  const workspace = path.join(os.tmpdir(), "shiptest-fixtures");
  await mkdir(workspace, { recursive: true });
  const fixture = path.join(workspace, crypto.randomUUID());
  await mkdir(fixture, { recursive: true });
  const repo = path.join(fixture, "repo");
  await mkdir(path.join(fixture, "tasks"), { recursive: true });
  await mkdir(path.join(fixture, "hidden"), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, "Dockerfile"), "FROM node:22\n", "utf8");
  await writeFile(path.join(fixture, "tasks", "invoice.md"), "Fix invoice rounding.\n", "utf8");
  await writeFile(path.join(fixture, "hidden", "invoice.test.ts"), "// hidden test\n", "utf8");

  await writeFile(
    path.join(fixture, "shiptest.yaml"),
    `version: 1
project:
  name: payments-api
  repo: repo
environment:
  mode: workload
  source: dockerfile_target
  dockerfile: Dockerfile
  target: test
  setup:
    - npm ci
  test:
    - npm test
models:
  - id: sonnet-4.5
    provider: anthropic
    model: claude-sonnet-4.5
benchmarks:
  - id: invoice-rounding
    type: replay_change
    base_commit: abc123
    task: tasks/invoice.md
    models:
      - ${options.benchmarkModel ?? "sonnet-4.5"}
    agent_context:
      exclude_paths:
        - AGENTS.md
        - "**/CLAUDE.md"
    evaluation:
      hidden_evaluation_files:
        - from: hidden/invoice.test.ts
          to: ${options.hiddenDestination ?? "tests/invoice.test.ts"}
      command: npm test -- tests/invoice.test.ts
`,
    "utf8",
  );

  return fixture;
}
