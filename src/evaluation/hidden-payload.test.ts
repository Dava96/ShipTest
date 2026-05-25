import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { ResolvedShiptestConfig } from "../config/schema.js";
import {
  type BenchmarkInput,
  benchmark as configBenchmark,
  createResolvedShiptestConfig,
} from "../test-support/shiptest-config-fixture.js";
import type { GitOperations } from "../utils/git.js";
import { EvaluationCheckCode } from "./check-codes.js";
import { applyHiddenEvaluationPayload } from "./hidden-payload.js";

interface Fixture {
  readonly root: string;
  readonly configDir: string;
  readonly workspacePath: string;
}

describe("hidden evaluation payload", () => {
  it("creates and replaces hidden evaluation files according to write mode", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.configDir, "hidden", "new.txt"), "new\n", "utf8");
    await writeFile(path.join(fixture.configDir, "hidden", "replace.txt"), "replaced\n", "utf8");
    await writeFile(path.join(fixture.workspacePath, "existing.txt"), "old\n", "utf8");

    const result = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_files: [
          {
            shiptest_path: "hidden/new.txt",
            repository_path: "nested/new.txt",
            write_mode: "create_new",
          },
          {
            shiptest_path: "hidden/replace.txt",
            repository_path: "existing.txt",
            write_mode: "create_or_replace",
          },
        ],
      }),
    });

    expect(result.ok).toBe(true);
    await expect(
      readFile(path.join(fixture.workspacePath, "nested", "new.txt"), "utf8"),
    ).resolves.toBe("new\n");
    await expect(readFile(path.join(fixture.workspacePath, "existing.txt"), "utf8")).resolves.toBe(
      "replaced\n",
    );
  });

  it("fails file payloads when write mode preconditions are not met", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.configDir, "hidden", "file.txt"), "hidden\n", "utf8");
    await writeFile(path.join(fixture.workspacePath, "existing.txt"), "existing\n", "utf8");

    const createNewResult = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_files: [
          {
            shiptest_path: "hidden/file.txt",
            repository_path: "existing.txt",
            write_mode: "create_new",
          },
        ],
      }),
    });

    expect(createNewResult).toMatchObject({ ok: false });
    expect(createNewResult.checks[0]).toMatchObject({
      code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
      paths: ["existing.txt"],
    });

    const replaceMissingResult = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_files: [
          {
            shiptest_path: "hidden/file.txt",
            repository_path: "missing.txt",
            write_mode: "replace_existing",
          },
        ],
      }),
    });

    expect(replaceMissingResult).toMatchObject({ ok: false });
    expect(replaceMissingResult.checks[0]).toMatchObject({
      code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
      paths: ["missing.txt"],
    });
  });

  it("handles directory replace, merge, and collision policies", async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.configDir, "hidden", "fixtures", "nested"), { recursive: true });
    await writeFile(
      path.join(fixture.configDir, "hidden", "fixtures", "nested", "data.json"),
      "new\n",
      "utf8",
    );
    await mkdir(path.join(fixture.workspacePath, "fixtures", "nested"), { recursive: true });
    await writeFile(path.join(fixture.workspacePath, "fixtures", "stale.txt"), "stale\n", "utf8");
    await writeFile(
      path.join(fixture.workspacePath, "fixtures", "nested", "data.json"),
      "old\n",
      "utf8",
    );

    const collisionResult = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "fixtures",
            write_mode: "merge_without_overwrite",
          },
        ],
      }),
    });

    expect(collisionResult).toMatchObject({ ok: false });
    expect(collisionResult.checks[0]).toMatchObject({ paths: ["fixtures/nested/data.json"] });

    const replaceResult = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "fixtures",
            write_mode: "replace_existing",
          },
        ],
      }),
    });

    expect(replaceResult.ok).toBe(true);
    await expect(
      readFile(path.join(fixture.workspacePath, "fixtures", "nested", "data.json"), "utf8"),
    ).resolves.toBe("new\n");
    await expect(
      readFile(path.join(fixture.workspacePath, "fixtures", "stale.txt"), "utf8"),
    ).rejects.toThrow();

    await writeFile(
      path.join(fixture.configDir, "hidden", "fixtures", "nested", "data.json"),
      "overwritten\n",
      "utf8",
    );
    const mergeAndReplaceResult = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "fixtures",
            write_mode: "merge_and_replace",
          },
        ],
      }),
    });

    expect(mergeAndReplaceResult.ok).toBe(true);
    await expect(
      readFile(path.join(fixture.workspacePath, "fixtures", "nested", "data.json"), "utf8"),
    ).resolves.toBe("overwritten\n");
  });

  it("reports directory payload precondition failures and supports non-overwriting merges", async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.configDir, "hidden", "fixtures"), { recursive: true });
    await writeFile(
      path.join(fixture.configDir, "hidden", "fixtures", "new.json"),
      "new\n",
      "utf8",
    );
    await mkdir(path.join(fixture.workspacePath, "existing"), { recursive: true });

    const missingSource = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/missing-directory",
            repository_path: "missing-source",
            write_mode: "create_new",
          },
        ],
      }),
    });
    expect(missingSource).toMatchObject({ ok: false });

    const createNewCollision = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "existing",
            write_mode: "create_new",
          },
        ],
      }),
    });
    expect(createNewCollision).toMatchObject({ ok: false });

    const replaceMissing = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "missing-target",
            write_mode: "replace_existing",
          },
        ],
      }),
    });
    expect(replaceMissing).toMatchObject({ ok: false });

    const mergeWithoutOverwrite = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "existing",
            write_mode: "merge_without_overwrite",
          },
        ],
      }),
    });
    expect(mergeWithoutOverwrite.ok).toBe(true);
    await expect(
      readFile(path.join(fixture.workspacePath, "existing", "new.json"), "utf8"),
    ).resolves.toBe("new\n");
  });

  it("applies hidden patches through git operations and reports patch failures", async () => {
    const fixture = await createFixture();
    const calls: string[][] = [];
    const gitOperations: GitOperations = {
      git: async (args) => {
        calls.push([...args]);
        return { stdout: "", stderr: "" };
      },
      hasGitLfs: async () => false,
    };

    const result = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_patches: [{ shiptest_path: "hidden/change.patch" }],
        hidden_patch_policy: "advanced_allow_collision_risk",
      }),
      gitOperations,
    });

    expect(result.ok).toBe(true);
    expect(calls[0]).toEqual([
      "apply",
      "--binary",
      "--whitespace=nowarn",
      path.join(fixture.configDir, "hidden", "change.patch"),
    ]);

    const failingGitOperations: GitOperations = {
      git: async () => {
        throw new Error("patch collision");
      },
      hasGitLfs: async () => false,
    };
    const failed = await applyHiddenEvaluationPayload({
      workspacePath: fixture.workspacePath,
      configDir: fixture.configDir,
      evaluation: evaluationConfig({
        hidden_patches: [{ shiptest_path: "hidden/change.patch" }],
        hidden_patch_policy: "advanced_allow_collision_risk",
      }),
      gitOperations: failingGitOperations,
    });

    expect(failed).toMatchObject({ ok: false });
    expect(failed.checks[0]).toMatchObject({
      code: EvaluationCheckCode.HiddenEvaluationApplyFailed,
      paths: ["hidden/change.patch"],
    });
  });
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-hidden-payload-"));
  const configDir = path.join(root, "config");
  const workspacePath = path.join(root, "workspace");
  await mkdir(path.join(configDir, "hidden"), { recursive: true });
  await mkdir(workspacePath, { recursive: true });
  return { root, configDir, workspacePath };
}

function evaluationConfig(
  evaluation: NonNullable<BenchmarkInput["evaluation"]>,
): ResolvedShiptestConfig["benchmarks"][number]["evaluation"] {
  const config = createResolvedShiptestConfig({
    benchmarks: [configBenchmark("bench", { evaluation })],
  });
  const [benchmark] = config.benchmarks;
  if (!benchmark) {
    throw new Error("expected benchmark");
  }
  return benchmark.evaluation;
}
