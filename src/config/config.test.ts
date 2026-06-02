import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createShiptestConfigFixture } from "../test-support/shiptest-config-fixture.js";
import { git } from "../utils/git.js";
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

  it("defaults runner concurrency and model attempts", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { validate: ["npm test"] },
      models: [{ id: "fake", provider: "openai-codex", model: "fake" }],
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.runner).toEqual({ concurrency: 1, model_attempts: 1 });
  });

  it("normalizes simplified environment commands", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { setup: ["npm ci"], validate: ["npm test"] },
      models: [{ id: "fake", provider: "openai-codex", model: "fake" }],
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.repository_environment).toMatchObject({
      commands_run_in: "shiptest_environment",
      source: "local",
      setup_commands: ["npm ci"],
      validation_commands: { required: ["npm test"], advisory: [] },
      teardown_commands: [],
    });
  });

  it("normalizes baseline cache settings", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { validate: ["npm test"] },
      baselines: { cache: false },
      models: [{ id: "fake", provider: "openai-codex", model: "fake" }],
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.shiptest_runner).toEqual({
      clean_git_repo: { enabled: true },
      prepared_baseline: { enabled: true, cache: false },
    });
  });

  it("normalizes simple single-provider model config", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { validate: ["npm test"] },
      models: { provider: "openai-codex", include: ["gpt-5.4", "gpt-5.5"] },
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.models).toEqual([
      { id: "gpt-5.4", provider: "openai-codex", model: "gpt-5.4" },
      { id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" },
    ]);
  });

  it("normalizes artifact capture and reporting settings", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { validate: ["npm test"] },
      artifacts: {
        tool_calls: false,
        tool_output: "excerpts",
        raw_events: true,
        final_response: "none",
        stderr_max_bytes: 1234,
      },
      reporting: {
        tool_categories: [
          {
            id: "verification",
            label: "Verification",
            highlights: [
              {
                id: "tests",
                label: "Tests",
                match: { tool: "bash", command_contains: "npm test" },
              },
            ],
          },
        ],
      },
      models: [{ id: "fake", provider: "openai-codex", model: "fake" }],
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.tool_usage).toMatchObject({
      record_tool_calls: false,
      tool_output: "excerpts",
      tool_output_excerpt_bytes: 8192,
      record_raw_events: true,
      final_response: "none",
      final_response_max_bytes: 8192,
      stderr_max_bytes: 1234,
      categories: [expect.objectContaining({ id: "verification" })],
    });
  });

  it("normalizes workspace safety options", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture" },
      environment: { validate: ["npm test"] },
      workspace: { lfs: "allow_pointer_files", submodules: "leave_unchecked_out" },
      models: [{ id: "fake", provider: "openai-codex", model: "fake" }],
      defaults: {
        limits: {},
        agent_view: {},
        evaluation: { command: "npm test" },
      },
      benchmarks: [{ id: "bench", type: "implementation", task: "tasks/task.md" }],
    });

    expect(config.snapshot).toEqual({
      strategy: "sanitized_copy",
      git_lfs_handling: "allow_pointer_files",
      submodule_handling: "leave_unchecked_out",
      strip_real_git_metadata: true,
    });
  });

  it("defaults omitted project.repo to the nearest git root from the config file", async () => {
    const root = await createTempDirectory();
    const repo = path.join(root, "repo");
    await mkdir(repo, { recursive: true });
    const fixture = await createShiptestConfigFixture({
      root: repo,
      configSubdir: ".shiptest",
      createGitRoot: true,
      projectRepo: "omit",
    });

    const context = await loadShiptestConfigContext(fixture.configPath);

    expect(context.config.project.repo).toBe(repo);
  });

  it("infers omitted project.name from the resolved project repo directory", async () => {
    const root = await createTempDirectory();
    const repo = path.join(root, "repo", "services", "billing-api");
    await mkdir(repo, { recursive: true });
    const fixture = await createShiptestConfigFixture({
      root,
      configSubdir: "repo",
      projectName: "omit",
      projectRepo: "services/billing-api",
    });

    const context = await loadShiptestConfigContext(fixture.configPath);

    expect(context.config.project.name).toBe("billing-api");
    expect(context.config.project.repo).toBe(repo);
  });

  it("falls back to the config directory when project.repo is omitted outside a git repo", async () => {
    const fixture = await createShiptestConfigFixture({
      projectRepo: "omit",
    });

    await expect(loadShiptestConfig(fixture.configPath)).resolves.toMatchObject({
      project: { repo: fixture.configDir },
    });
  });

  it("validates semantic config references", async () => {
    const fixture = await createConfigFixture({
      excludePath: "../outside",
      hiddenDirectoryRepositoryPath: "../hidden-dir",
      instructionFile: "missing-instructions.md",
      hiddenFilePath: "missing-hidden.test.ts",
      hiddenDirectoryPath: "missing-fixtures",
      hiddenPatchPath: "missing.patch",
    });

    await expect(loadShiptestConfig(fixture.configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ path: "benchmarks[0].agent_view.instruction_files[0]" }),
        expect.objectContaining({
          path: "benchmarks[0].evaluation.hidden_files[0].shiptest_path",
        }),
        expect.objectContaining({ code: "REFERENCED_DIRECTORY_NOT_FOUND" }),
        expect.objectContaining({
          path: "benchmarks[0].evaluation.hidden_patches[0].shiptest_path",
        }),
      ]),
    } satisfies Partial<ShiptestConfigError>);
  });

  it("rejects replay reference commits that are not descendants of the base commit", async () => {
    const root = await createTempDirectory();
    const repo = path.join(root, "repo");
    await mkdir(repo, { recursive: true });
    await git(["init", "--initial-branch", "main"], repo);
    await git(["config", "user.email", "test@shiptest.local"], repo);
    await git(["config", "user.name", "ShipTest Test"], repo);
    await writeFile(path.join(repo, "file.txt"), "base\n", "utf8");
    await git(["add", "-A"], repo);
    await git(["commit", "-m", "base"], repo);
    const firstCommit = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
    await writeFile(path.join(repo, "file.txt"), "main\n", "utf8");
    await git(["commit", "-am", "main"], repo);
    const baseCommit = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
    await git(["checkout", "--detach", firstCommit], repo);
    await writeFile(path.join(repo, "file.txt"), "side\n", "utf8");
    await git(["commit", "-am", "side"], repo);
    const referenceCommit = (await git(["rev-parse", "HEAD"], repo)).stdout.trim();
    await mkdir(path.join(root, "tasks"), { recursive: true });
    await mkdir(path.join(root, "hidden"), { recursive: true });
    await writeFile(path.join(root, "tasks", "task.md"), "Task\n", "utf8");
    await writeFile(path.join(root, "hidden", "check.cjs"), "// hidden\n", "utf8");
    const configPath = path.join(root, "shiptest.yaml");
    await writeFile(
      configPath,
      `version: 1
project:
  name: p
  repo: ${repo.replaceAll("\\", "/")}
environment:
  validate:
    - node --version
models:
  - id: sonnet
    provider: anthropic
    model: claude
defaults:
  models:
    - sonnet
  limits: {}
  agent_view: {}
  evaluation:
    command: node --version
benchmarks:
  - id: replay
    type: replay_change
    base_commit: ${baseCommit}
    reference_solution:
      commit: ${referenceCommit}
    task: tasks/task.md
    evaluation:
      command: node hidden/check.cjs
      hidden_files:
        - shiptest_path: hidden/check.cjs
          repository_path: hidden/check.cjs
          write_mode: create_new
`,
      "utf8",
    );

    await expect(loadShiptestConfig(configPath)).rejects.toMatchObject({
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "REFERENCE_SOLUTION_NOT_DESCENDANT" }),
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

  it("accepts expanded environment validation commands", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: {
          setup: ["npm ci"],
          validate: { required: ["npm test"], advisory: ["npm run lint"] },
        },
        models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
        defaults: {
          models: ["sonnet"],
          limits: {},
          agent_view: {},
          evaluation: { command: "npm test" },
        },
        benchmarks: [
          {
            id: "invoice",
            type: "implementation",
            task: "task.md",
            evaluation: { command: "npm test" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires replay benchmarks to define local verifier and reference solution", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: { validate: ["npm test"] },
        models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
        defaults: {
          models: ["sonnet"],
          limits: {},
          agent_view: {},
          evaluation: {
            command: "npm test",
            hidden_files: [
              {
                shiptest_path: "hidden/default.test.ts",
                repository_path: "tests/default.test.ts",
                write_mode: "create_new",
              },
            ],
          },
        },
        benchmarks: [
          {
            id: "invoice",
            type: "replay_change",
            base_commit: "abc123",
            task: "task.md",
            evaluation: { command: "npm test" },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts replay benchmarks with a local verifier and reference solution patch", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: { validate: ["npm test"] },
        models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
        defaults: {
          models: ["sonnet"],
          limits: {},
          agent_view: {},
          evaluation: { command: "npm test" },
        },
        benchmarks: [
          {
            id: "invoice",
            type: "replay_change",
            base_commit: "abc123",
            reference_solution: { patch: "hidden/solution.patch" },
            task: "task.md",
            evaluation: {
              command: "npm test -- tests/hidden/invoice.test.ts",
              hidden_files: [
                {
                  shiptest_path: "hidden/invoice.test.ts",
                  repository_path: "tests/hidden/invoice.test.ts",
                  write_mode: "create_new",
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("requires an explicit policy for hidden evaluation patches", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: { validate: ["npm test"] },
        models: [{ id: "sonnet", provider: "anthropic", model: "claude" }],
        defaults: {
          models: ["sonnet"],
          limits: {},
          agent_view: {},
          evaluation: { command: "npm test" },
        },
        benchmarks: [
          {
            id: "invoice",
            type: "implementation",
            task: "task.md",
            evaluation: {
              command: "npm test",
              hidden_patches: [{ shiptest_path: "patch.diff" }],
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("accepts arbitrary Pi provider ids", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: { validate: ["npm test"] },
        models: [{ id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" }],
        defaults: {
          models: ["gpt-5.5"],
          limits: {},
          agent_view: {},
          evaluation: { command: "npm test" },
        },
        benchmarks: [
          {
            id: "invoice",
            type: "implementation",
            task: "task.md",
            evaluation: { command: "npm test" },
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("validates schema refinements", () => {
    expect(
      ShiptestConfigSchema.safeParse({
        version: 1,
        project: { name: "p", repo: "." },
        environment: { validate: ["npm test"] },
        models: [
          { id: "same", provider: "openai", model: "gpt" },
          { id: "same", provider: "anthropic", model: "claude" },
          { id: "local", provider: "openai_compatible", model: "qwen" },
        ],
        defaults: {
          models: ["same"],
          limits: {},
          agent_view: {},
          evaluation: { command: "npm test" },
        },
        benchmarks: [
          {
            id: "same-benchmark",
            type: "replay_change",
            task: "task.md",
            evaluation: {
              command: "npm test",
            },
          },
          {
            id: "same-benchmark",
            type: "implementation",
            task: "task.md",
            evaluation: { command: "npm test" },
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
  readonly excludePath?: string;
  readonly hiddenDirectoryPath?: string;
  readonly hiddenDirectoryRepositoryPath?: string;
  readonly hiddenFilePath?: string;
  readonly hiddenPatchPath?: string;
  readonly instructionFile?: string;
  readonly omitProjectRepo?: boolean;
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
  await writeFile(path.join(root, "hidden", "solution.patch"), "", "utf8");

  const configPath = path.join(root, "shiptest.yaml");
  await writeFile(
    configPath,
    `version: 1
project:
  name: payments-api
${options.omitProjectRepo ? "" : "  repo: repo\n"}environment:
  validate:
    - npm test
models:
  - id: sonnet
    provider: anthropic
    model: claude
defaults:
  models:
    - sonnet
  limits: {}
  agent_view:
    exclude_paths:
      - ${options.excludePath ?? "src/**"}
    instruction_files:
      - ${options.instructionFile ?? "instructions.md"}
  evaluation:
    command: npm test
    hidden_files:
      - shiptest_path: ${options.hiddenFilePath ?? "hidden/test.ts"}
        repository_path: tests/test.ts
        write_mode: create_new
    hidden_directories:
      - shiptest_path: ${options.hiddenDirectoryPath ?? "hidden/fixtures"}
        repository_path: ${options.hiddenDirectoryRepositoryPath ?? "tests/fixtures"}
        write_mode: create_new
    hidden_patches:
      - shiptest_path: ${options.hiddenPatchPath ?? "hidden/patch.diff"}
    hidden_patch_policy: advanced_allow_collision_risk
benchmarks:
  - id: invoice
    type: replay_change
    base_commit: abc123
    reference_solution:
      patch: hidden/solution.patch
    task: tasks/task.md
    evaluation:
      command: npm test
      hidden_files:
        - shiptest_path: ${options.hiddenFilePath ?? "hidden/test.ts"}
          repository_path: tests/test.ts
          write_mode: create_new
      hidden_directories:
        - shiptest_path: ${options.hiddenDirectoryPath ?? "hidden/fixtures"}
          repository_path: ${options.hiddenDirectoryRepositoryPath ?? "tests/fixtures"}
          write_mode: create_new
      hidden_patches:
        - shiptest_path: ${options.hiddenPatchPath ?? "hidden/patch.diff"}
      hidden_patch_policy: advanced_allow_collision_risk
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
