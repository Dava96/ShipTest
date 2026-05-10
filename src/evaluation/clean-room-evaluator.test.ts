import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import { type ResolvedShiptestConfig, ShiptestConfigSchema } from "../config/schema.js";
import { createSnapshotManifest } from "../snapshot/manifest.js";
import { extractSubmission } from "../submission/extract.js";
import type { Submission } from "../submission/types.js";
import { runCleanRoomEvaluation } from "./clean-room-evaluator.js";

interface Fixture {
  readonly root: string;
  readonly configDir: string;
  readonly preparedBaselinePath: string;
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly repositoryEnvironment: ResolvedShiptestConfig["repository_environment"];
}

describe("clean-room evaluator", () => {
  it("applies a candidate patch, injects hidden files, and records a passing verdict", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createSubmission(fixture.preparedBaselinePath, async (workspace) => {
      await writeFile(path.join(workspace, "src", "answer.txt"), "fixed\n", "utf8");
    });

    const evaluationWorkspacePath = path.join(fixture.root, "eval-pass");
    await mkdir(evaluationWorkspacePath, { recursive: true });
    await writeFile(path.join(evaluationWorkspacePath, "stale.txt"), "stale\n", "utf8");

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath,
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result.status).toBe("EVALUATED");
    expect(result.verdict).toBe("passed");
    expect(result.score).toBe(100);
    expect(result.signals.map((signal) => signal.id)).toContain("scoring_command_passed");
    await expect(
      readFile(path.join(result.evaluation_workspace_path, "hidden", "check.js"), "utf8"),
    ).resolves.toContain("answer.txt");
    expect(result.artifacts.candidate_patch).toBeDefined();
    expect(result.commands).toHaveLength(1);
  });

  it("keeps a failed scoring command as a needs_review evaluation", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createSubmission(fixture.preparedBaselinePath, async (workspace) => {
      await writeFile(path.join(workspace, "src", "answer.txt"), "renamed-field\n", "utf8");
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-needs-review"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("EVALUATED");
    expect(result.verdict).toBe("needs_review");
    expect(result.score).toBe(60);
    expect(result.signals.map((signal) => signal.id)).toContain("scoring_command_failed");
    expect(result.commands[0]).toMatchObject({ exit_code: 1 });
  });

  it("retains a policy_issue result when protected files are modified", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createSubmission(fixture.preparedBaselinePath, async (workspace) => {
      await writeFile(path.join(workspace, "src", "answer.txt"), "fixed\n", "utf8");
      await writeFile(path.join(workspace, ".env.production"), "SECRET=changed\n", "utf8");
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-policy"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result.status).toBe("EVALUATED");
    expect(result.verdict).toBe("policy_issue");
    expect(result.score).toBe(0);
    expect(result.signals).toContainEqual(
      expect.objectContaining({
        id: "protected_path_modified",
        paths: [".env.production"],
      }),
    );
  });

  it("does not rerun setup for dependency changes by default", async () => {
    const fixture = await createFixture({
      scoringCommand: "node hidden/check.js",
      setupCommands: ['node -e "process.exit(1)"'],
    });
    const submission = await createDependencyChangeSubmission(fixture.preparedBaselinePath);

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-deps"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result.verdict).toBe("passed");
    expect(result.score).toBe(90);
    expect(result.commands).toHaveLength(1);
    expect(result.signals.map((signal) => signal.id)).toContain("dependency_manifest_modified");
  });

  it("returns infrastructure error when evaluation workspace exists and overwrite is false", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const evaluationWorkspacePath = path.join(fixture.root, "eval-existing");
    await mkdir(evaluationWorkspacePath, { recursive: true });
    const submission = await createSubmission(fixture.preparedBaselinePath, async (workspace) => {
      await writeFile(path.join(workspace, "src", "answer.txt"), "fixed\n", "utf8");
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath,
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "INFRASTRUCTURE_ERROR",
      verdict: "inconclusive",
    });
    expect(result.commands).toEqual([]);
  });

  it("keeps candidate patch application failures as partial evidence", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createInvalidSubmission(fixture.preparedBaselinePath);

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-invalid-patch"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "PARTIAL",
      verdict: "inconclusive",
      score: 0,
    });
    expect(result.signals).toContainEqual(
      expect.objectContaining({ id: "candidate_patch_apply_failed" }),
    );
    expect(result.artifacts.candidate_patch).toBeDefined();
  });

  it("stops before scoring when dependency changes are disallowed", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createDependencyChangeSubmission(fixture.preparedBaselinePath);
    const benchmark = withEvaluation(fixture.benchmark, { dependency_changes: "fail" });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-deps-fail"),
      configDir: fixture.configDir,
      benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "EVALUATED",
      verdict: "policy_issue",
      score: 0,
    });
    expect(result.commands).toEqual([]);
    expect(result.signals.map((signal) => signal.id)).toContain("dependency_change_policy_failed");
  });

  it("reruns setup on dependency changes only when configured", async () => {
    const fixture = await createFixture({
      scoringCommand: "node hidden/check.js",
      setupCommands: ["node --version"],
    });
    const submission = await createDependencyChangeSubmission(fixture.preparedBaselinePath);
    const benchmark = withEvaluation(fixture.benchmark, {
      rerun_setup_on_dependency_change: true,
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-setup-rerun"),
      configDir: fixture.configDir,
      benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result.status).toBe("EVALUATED");
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]).toMatchObject({ exit_code: 0 });
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: "EVALUATION_SETUP_COMMAND_PASSED" }),
    );
  });

  it("returns partial evidence when setup rerun fails", async () => {
    const fixture = await createFixture({
      scoringCommand: "node hidden/check.js",
      setupCommands: ['node -e "process.exit(1)"'],
    });
    const submission = await createDependencyChangeSubmission(fixture.preparedBaselinePath);
    const benchmark = withEvaluation(fixture.benchmark, {
      rerun_setup_on_dependency_change: true,
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-setup-fail"),
      configDir: fixture.configDir,
      benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "PARTIAL",
      verdict: "inconclusive",
      score: 0,
    });
    expect(result.signals.map((signal) => signal.id)).toContain("setup_rerun_failed");
    expect(result.commands).toHaveLength(1);
  });

  it("classifies hidden evaluation payload application failures as invalid benchmark", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const submission = await createSubmission(fixture.preparedBaselinePath, async (workspace) => {
      await writeFile(path.join(workspace, "src", "answer.txt"), "fixed\n", "utf8");
    });
    const benchmark = withEvaluation(fixture.benchmark, {
      hidden_evaluation_files: [
        {
          shiptest_path: "hidden/check.js",
          repository_path: "src/answer.txt",
          write_mode: "create_new",
        },
      ],
    });

    const result = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-hidden-fail"),
      configDir: fixture.configDir,
      benchmark,
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission,
      overwrite: true,
    });

    expect(result).toMatchObject({
      ok: false,
      status: "INVALID_BENCHMARK",
      verdict: "invalid_benchmark",
    });
    expect(result.signals.map((signal) => signal.id)).toContain("hidden_evaluation_apply_failed");
  });

  it("uses policy presets to change verdicts without dropping evidence", async () => {
    const fixture = await createFixture({ scoringCommand: "node hidden/check.js" });
    const failingSubmission = await createSubmission(
      fixture.preparedBaselinePath,
      async (workspace) => {
        await writeFile(path.join(workspace, "src", "answer.txt"), "renamed-field\n", "utf8");
      },
    );

    const testGateResult = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-test-gate"),
      configDir: fixture.configDir,
      benchmark: withEvaluation(fixture.benchmark, { policy_preset: "test_gate" }),
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission: failingSubmission,
      overwrite: true,
    });

    expect(testGateResult).toMatchObject({
      ok: true,
      status: "EVALUATED",
      verdict: "failed",
      score: 60,
    });

    const dependencySubmission = await createDependencyChangeSubmission(
      fixture.preparedBaselinePath,
    );
    const riskAverseResult = await runCleanRoomEvaluation({
      preparedBaselinePath: fixture.preparedBaselinePath,
      evaluationWorkspacePath: path.join(fixture.root, "eval-risk-averse"),
      configDir: fixture.configDir,
      benchmark: withEvaluation(fixture.benchmark, { policy_preset: "risk_averse" }),
      repositoryEnvironment: fixture.repositoryEnvironment,
      submission: dependencySubmission,
      overwrite: true,
    });

    expect(riskAverseResult).toMatchObject({
      ok: true,
      status: "EVALUATED",
      verdict: "policy_issue",
      score: 90,
    });
  });
});

async function createDependencyChangeSubmission(preparedBaselinePath: string): Promise<Submission> {
  return createSubmission(preparedBaselinePath, async (workspace) => {
    await writeFile(path.join(workspace, "src", "answer.txt"), "fixed\n", "utf8");
    await writeFile(
      path.join(workspace, "package.json"),
      '{"dependencies":{"left-pad":"1.3.0"}}\n',
      "utf8",
    );
  });
}

async function createInvalidSubmission(preparedBaselinePath: string): Promise<Submission> {
  const baselineManifest = await createSnapshotManifest({
    snapshotPath: preparedBaselinePath,
    sourceCommit: "commit",
    sourceTree: "tree",
  });
  return {
    diff: "this is not a valid patch\n",
    changed_files: ["src/answer.txt"],
    is_empty: false,
    baseline_manifest: baselineManifest,
    workspace_manifest: baselineManifest,
    workspace_diff: {
      added: [],
      modified: [],
      deleted: [],
      unchanged_count: baselineManifest.files.length,
    },
  };
}

function withEvaluation(
  benchmark: ResolvedShiptestConfig["benchmarks"][number],
  evaluation: Partial<ResolvedShiptestConfig["benchmarks"][number]["evaluation"]>,
): ResolvedShiptestConfig["benchmarks"][number] {
  return {
    ...benchmark,
    evaluation: {
      ...benchmark.evaluation,
      ...evaluation,
    },
  };
}

async function createFixture(options: {
  readonly scoringCommand: string;
  readonly setupCommands?: readonly string[];
}): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-evaluation-"));
  const configDir = path.join(root, "config");
  const preparedBaselinePath = path.join(root, "prepared-baseline");
  await mkdir(path.join(preparedBaselinePath, "src"), { recursive: true });
  await mkdir(path.join(configDir, "hidden"), { recursive: true });
  await writeFile(path.join(preparedBaselinePath, "src", "answer.txt"), "buggy\n", "utf8");
  await writeFile(path.join(preparedBaselinePath, ".env.production"), "SECRET=original\n", "utf8");
  await writeFile(path.join(preparedBaselinePath, "package.json"), '{"dependencies":{}}\n', "utf8");
  await writeFile(
    path.join(configDir, "hidden", "check.js"),
    "const { readFileSync } = require('node:fs');\nif (readFileSync('src/answer.txt', 'utf8').trim() !== 'fixed') process.exit(1);\n",
    "utf8",
  );
  await initializeCleanGitRepo(preparedBaselinePath);

  const config = ShiptestConfigSchema.parse({
    version: 1,
    project: { name: "fixture", repo: "." },
    repository_environment: {
      setup_commands: options.setupCommands ?? [],
      validation_commands: { required: ["node --version"] },
    },
    models: [{ id: "model", provider: "openai", model: "gpt" }],
    benchmarks: [
      {
        id: "bench",
        type: "replay_change",
        base_commit: "base",
        task: "task.md",
        evaluation: {
          hidden_evaluation_files: [
            {
              shiptest_path: "hidden/check.js",
              repository_path: "hidden/check.js",
              write_mode: "create_new",
            },
          ],
          scoring_command: options.scoringCommand,
        },
      },
    ],
  });

  const [benchmark] = config.benchmarks;
  if (!benchmark) {
    throw new Error("expected fixture benchmark");
  }

  return {
    root,
    configDir,
    preparedBaselinePath,
    benchmark,
    repositoryEnvironment: config.repository_environment,
  };
}

async function createSubmission(
  preparedBaselinePath: string,
  mutate: (workspace: string) => Promise<void>,
): Promise<Submission> {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "shiptest-evaluation-submission-"));
  await rm(workspace, { force: true, recursive: true });
  await cp(preparedBaselinePath, workspace, { recursive: true, verbatimSymlinks: true });
  const baselineManifest = await createSnapshotManifest({
    snapshotPath: workspace,
    sourceCommit: "commit",
    sourceTree: "tree",
  });
  await mutate(workspace);
  const result = await extractSubmission({ workspacePath: workspace, baselineManifest });
  if (!result.ok) {
    throw new Error("expected submission extraction to succeed");
  }
  return result.submission;
}
