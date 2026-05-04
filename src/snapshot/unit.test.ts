import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyAgentContextExclusions, findRealGitMetadata } from "./sanitizer.js";
import { verifyHiddenEvaluationPaths, verifyNoRealGitMetadata } from "./verify.js";

describe("snapshot verification and sanitization helpers", () => {
  it("reports remaining real Git metadata", async () => {
    const root = await createTempDirectory();
    await mkdir(path.join(root, ".git"));

    await expect(verifyNoRealGitMetadata(root)).resolves.toMatchObject({
      code: "INVALID_SNAPSHOT_GIT_METADATA",
      severity: "error",
      paths: [".git"],
    });
    await expect(findRealGitMetadata(root)).resolves.toEqual([path.join(root, ".git")]);
  });

  it("reports create_or_replace file mode as a warning", async () => {
    const root = await createTempDirectory();

    await expect(
      verifyHiddenEvaluationPaths(root, {
        clean_room: true,
        hidden_evaluation_files: [
          {
            shiptest_path: "hidden/file.ts",
            repository_path: "tests/file.ts",
            write_mode: "create_or_replace",
          },
        ],
        hidden_evaluation_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "tests/fixtures",
            write_mode: "merge_without_overwrite",
          },
        ],
        hidden_evaluation_patches: [],
        scoring_command: "npm test",
        dependency_changes: "warn",
        rerun_setup_on_dependency_change: true,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_FILE_WRITE_MODE_VALID",
        severity: "warning",
      }),
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_DIRECTORY_WRITE_MODE_VALID",
        severity: "pass",
      }),
    ]);
  });

  it("applies glob and exact agent context exclusions", async () => {
    const root = await createTempDirectory();
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "CLAUDE.md"), "Claude\n", "utf8");
    await writeFile(path.join(root, "nested", "AGENTS.md"), "Agents\n", "utf8");

    const check = await applyAgentContextExclusions(root, ["CLAUDE.md", "**/AGENTS.md"]);

    expect(check.paths).toEqual(["CLAUDE.md", "nested/AGENTS.md"]);
  });
});

async function createTempDirectory(): Promise<string> {
  const root = path.join(os.tmpdir(), "shiptest-snapshot-unit-fixtures", crypto.randomUUID());
  await mkdir(root, { recursive: true });
  return root;
}
