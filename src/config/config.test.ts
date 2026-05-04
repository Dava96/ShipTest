import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ShiptestConfigError } from "./errors.js";
import {
  loadShiptestConfig,
  loadShiptestConfigContext,
  resolveHostAssetPath,
} from "./load-config.js";
import { isSafeWorkspacePath, pathToConfigPath } from "./paths.js";
import { ShiptestConfigSchema } from "./schema.js";

describe("config loading and validation", () => {
  it("loads the default config file from the current directory", async () => {
    const fixture = await createConfigFixture();
    const previousCwd = process.cwd();
    process.chdir(fixture.root);
    try {
      const context = await loadShiptestConfigContext();
      expect(context.configPath).toBe(path.join(fixture.root, "shiptest.yaml"));
      expect(context.config.project.name).toBe("payments-api");
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("returns a structured error when no default config file exists", async () => {
    const root = await createTempDirectory();
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      await expect(loadShiptestConfig()).rejects.toMatchObject({
        issues: [expect.objectContaining({ code: "CONFIG_FILE_NOT_FOUND" })],
      } satisfies Partial<ShiptestConfigError>);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("returns a structured error when an explicit config path does not exist", async () => {
    await expect(
      loadShiptestConfig(path.join(os.tmpdir(), crypto.randomUUID())),
    ).rejects.toMatchObject({
      issues: [expect.objectContaining({ code: "CONFIG_FILE_NOT_FOUND", path: "config" })],
    } satisfies Partial<ShiptestConfigError>);
  });

  it("returns schema issues for malformed configs", async () => {
    const root = await createTempDirectory();
    const configPath = path.join(root, "shiptest.yaml");
    await writeFile(configPath, "version: 2\n", "utf8");

    await expect(loadShiptestConfig(configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "CONFIG_SCHEMA_INVALID", path: "version" }),
      ]),
    } satisfies Partial<ShiptestConfigError>);
  });

  it("loads config without optional repository environment file paths", async () => {
    const fixture = await createConfigFixture();
    const configText = await import("node:fs/promises").then((fs) =>
      fs.readFile(fixture.configPath, "utf8"),
    );
    await import("node:fs/promises").then((fs) =>
      fs.writeFile(
        fixture.configPath,
        configText
          .replace("  source: dockerfile_target\n", "")
          .replace("  commands_run_in: repository_environment\n", "")
          .replace("  dockerfile_path: Dockerfile\n", "")
          .replace("  dockerfile_target: test\n", "")
          .replace("  compose_file: compose.yaml\n", ""),
        "utf8",
      ),
    );

    await expect(loadShiptestConfig(fixture.configPath)).resolves.toMatchObject({
      repository_environment: { source: "local" },
    });
  });

  it("validates semantic config references", async () => {
    const fixture = await createConfigFixture({
      dockerfilePath: "Missing.Dockerfile",
      composeFile: "missing-compose.yaml",
      excludePath: "../outside",
      hiddenDirectoryRepositoryPath: "../hidden-dir",
      instructionFile: "missing-instructions.md",
      hiddenFilePath: "missing-hidden.test.ts",
      hiddenDirectoryPath: "missing-fixtures",
      hiddenPatchPath: "missing.patch",
    });

    await expect(loadShiptestConfig(fixture.configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "repository_environment.dockerfile_path" }),
        expect.objectContaining({ path: "repository_environment.compose_file" }),
        expect.objectContaining({ path: "benchmarks[0].agent_context.instruction_files[0]" }),
        expect.objectContaining({
          path: "benchmarks[0].evaluation.hidden_evaluation_files[0].shiptest_path",
        }),
        expect.objectContaining({ code: "REFERENCED_DIRECTORY_NOT_FOUND" }),
        expect.objectContaining({
          path: "benchmarks[0].evaluation.hidden_evaluation_patches[0].shiptest_path",
        }),
      ]),
    } satisfies Partial<ShiptestConfigError>);
  });

  it("reports when hidden evaluation asset path types are wrong", async () => {
    const directoryPathFixture = await createConfigFixture({
      hiddenDirectoryPath: "tasks/task.md",
    });
    await expect(loadShiptestConfig(directoryPathFixture.configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCED_DIRECTORY_NOT_FOUND",
          message: expect.stringContaining("Path is not a directory"),
        }),
      ]),
    } satisfies Partial<ShiptestConfigError>);

    const filePathFixture = await createConfigFixture({ hiddenFilePath: "hidden/fixtures" });
    await expect(loadShiptestConfig(filePathFixture.configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCED_FILE_NOT_FOUND",
          message: expect.stringContaining("Path is not a file"),
        }),
      ]),
    } satisfies Partial<ShiptestConfigError>);
  });

  it("requires source-specific repository environment fields", () => {
    const baseConfig = {
      version: 1,
      project: { name: "p", repo: "." },
      models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
      benchmarks: [
        {
          id: "invoice",
          type: "implementation",
          task: "task.md",
          evaluation: { scoring_command: "npm test" },
        },
      ],
    };

    expect(
      ShiptestConfigSchema.safeParse({
        ...baseConfig,
        repository_environment: {
          source: "dockerfile_target",
          validation_commands: ["npm test"],
        },
      }).success,
    ).toBe(false);
    expect(
      ShiptestConfigSchema.safeParse({
        ...baseConfig,
        repository_environment: {
          source: "docker_image",
          validation_commands: ["npm test"],
        },
      }).success,
    ).toBe(false);
    expect(
      ShiptestConfigSchema.safeParse({
        ...baseConfig,
        repository_environment: {
          source: "compose",
          compose_file: "compose.yaml",
          validation_commands: ["npm test"],
        },
      }).success,
    ).toBe(false);
    expect(
      ShiptestConfigSchema.safeParse({
        ...baseConfig,
        repository_environment: {
          source: "devcontainer",
          validation_commands: ["npm test"],
        },
      }).success,
    ).toBe(false);
    expect(
      ShiptestConfigSchema.safeParse({
        ...baseConfig,
        repository_environment: {
          commands_run_in: "repository_environment",
          source: "scripts",
          setup_commands: ["./install.sh"],
          validation_commands: ["./test.sh --filter invoice"],
          teardown_commands: ["./stop.sh"],
        },
      }).success,
    ).toBe(true);
  });

  it("requires an explicit policy for hidden evaluation patches", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        repository_environment: { validation_commands: ["npm test"] },
        models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
        benchmarks: [
          {
            id: "invoice",
            type: "implementation",
            task: "task.md",
            evaluation: {
              scoring_command: "npm test",
              hidden_evaluation_patches: [{ shiptest_path: "patch.diff" }],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("validates schema refinements", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        repository_environment: { validation_commands: ["npm test"] },
        models: [
          { id: "same", provider: "openai", model: "gpt" },
          { id: "same", provider: "anthropic", model: "claude" },
          { id: "local", provider: "openai_compatible", model: "qwen" },
        ],
        benchmarks: [
          {
            id: "same-benchmark",
            type: "replay_change",
            task: "task.md",
            evaluation: {
              scoring_command: "npm test",
            },
          },
          {
            id: "same-benchmark",
            type: "implementation",
            task: "task.md",
            evaluation: { scoring_command: "npm test" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("handles path helpers", () => {
    expect(resolveHostAssetPath("/repo/.shiptest", "tasks/a.md").replaceAll("\\", "/")).toMatch(
      /\/repo\/\.shiptest\/tasks\/a\.md$/,
    );
    expect(pathToConfigPath(["benchmarks", 0, "id"])).toBe("benchmarks[0].id");
    expect(isSafeWorkspacePath(".")).toBe(false);
    expect(isSafeWorkspacePath("../secret")).toBe(false);
    expect(isSafeWorkspacePath("/absolute/path")).toBe(false);
    expect(isSafeWorkspacePath("src/index.ts")).toBe(true);
  });
});

interface ConfigFixtureOptions {
  readonly composeFile?: string;
  readonly dockerfilePath?: string;
  readonly excludePath?: string;
  readonly hiddenDirectoryPath?: string;
  readonly hiddenDirectoryRepositoryPath?: string;
  readonly hiddenFilePath?: string;
  readonly hiddenPatchPath?: string;
  readonly instructionFile?: string;
}

interface ConfigFixture {
  readonly configPath: string;
  readonly root: string;
}

async function createConfigFixture(options: ConfigFixtureOptions = {}): Promise<ConfigFixture> {
  const root = await createTempDirectory();
  const repo = path.join(root, "repo");
  await mkdir(path.join(root, "tasks"), { recursive: true });
  await mkdir(path.join(root, "hidden", "fixtures"), { recursive: true });
  await mkdir(repo, { recursive: true });
  await writeFile(path.join(repo, "Dockerfile"), "FROM node:22\n", "utf8");
  await writeFile(path.join(repo, "compose.yaml"), "services: {}\n", "utf8");
  await writeFile(path.join(root, "tasks", "task.md"), "Task\n", "utf8");
  await writeFile(path.join(root, "instructions.md"), "Instructions\n", "utf8");
  await writeFile(path.join(root, "hidden", "test.ts"), "// test\n", "utf8");
  await writeFile(path.join(root, "hidden", "patch.diff"), "diff --git a/a b/a\n", "utf8");

  const configPath = path.join(root, "shiptest.yaml");
  await writeFile(
    configPath,
    `version: 1
project:
  name: payments-api
  repo: repo
repository_environment:
  source: dockerfile_target
  commands_run_in: repository_environment
  dockerfile_path: ${options.dockerfilePath ?? "Dockerfile"}
  dockerfile_target: test
  compose_file: ${options.composeFile ?? "compose.yaml"}
  validation_commands:
    - npm test
models:
  - id: sonnet
    provider: anthropic
    model: claude
benchmarks:
  - id: invoice
    type: replay_change
    base_commit: abc123
    task: tasks/task.md
    agent_context:
      exclude_paths:
        - ${options.excludePath ?? "src/**"}
      instruction_files:
        - ${options.instructionFile ?? "instructions.md"}
    evaluation:
      scoring_command: npm test
      hidden_evaluation_files:
        - shiptest_path: ${options.hiddenFilePath ?? "hidden/test.ts"}
          repository_path: tests/test.ts
          write_mode: create_new
      hidden_evaluation_directories:
        - shiptest_path: ${options.hiddenDirectoryPath ?? "hidden/fixtures"}
          repository_path: ${options.hiddenDirectoryRepositoryPath ?? "tests/fixtures"}
          write_mode: create_new
      hidden_evaluation_patches:
        - shiptest_path: ${options.hiddenPatchPath ?? "hidden/patch.diff"}
      hidden_evaluation_patch_policy: advanced_allow_collision_risk
`,
    "utf8",
  );

  return { configPath, root };
}

async function createTempDirectory(): Promise<string> {
  const root = path.join(os.tmpdir(), "shiptest-config-fixtures", crypto.randomUUID());
  await mkdir(root, { recursive: true });
  return root;
}
