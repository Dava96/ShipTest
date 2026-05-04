import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildSnapshot } from "./build-snapshot.js";
import { git } from "./git.js";
import type { BuildSnapshotOptions } from "./types.js";

describe("buildSnapshot", () => {
  it("creates a sanitized copy without real Git metadata and records a manifest", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      agent_context: { exclude_paths: ["AGENTS.md"], instruction_files: [] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected snapshot build to succeed");
    }

    await expect(readFile(path.join(result.agent_snapshot_path, ".git"))).rejects.toThrow();
    await expect(readFile(path.join(result.agent_snapshot_path, "AGENTS.md"))).rejects.toThrow();
    expect(result.manifest.files.map((file) => file.repository_path)).toContain("src/index.ts");
    expect(result.manifest.files.map((file) => file.repository_path)).not.toContain("AGENTS.md");
    expect(result.checks.some((check) => check.code === "SNAPSHOT_REAL_GIT_METADATA_ABSENT")).toBe(
      true,
    );
  });

  it("returns a structured error when LFS pointer files remain", async () => {
    const fixture = await createGitRepoFixture({ includeLfsPointer: true });
    const result = await buildSnapshot(baseSnapshotOptions(fixture));

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "INVALID_SNAPSHOT_LFS_POINTERS",
        severity: "error",
        paths: ["large.bin"],
      }),
    );
  });

  it("validates hidden evaluation write modes against repository paths", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      evaluation: {
        ...baseSnapshotOptions(fixture).evaluation,
        hidden_evaluation_files: [
          {
            shiptest_path: "hidden/existing.test.ts",
            repository_path: "tests/existing.test.ts",
            write_mode: "replace_existing",
          },
        ],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_FILE_WRITE_MODE_VALID",
        severity: "pass",
        paths: ["tests/existing.test.ts"],
      }),
    );
  });

  it("uses HEAD when no base commit is provided", async () => {
    const fixture = await createGitRepoFixture();
    const { base_commit: _baseCommit, ...options } = baseSnapshotOptions(fixture);
    const result = await buildSnapshot(options);

    expect(result.ok).toBe(true);
  });

  it("does not include untracked local files from the source repo", async () => {
    const fixture = await createGitRepoFixture();
    await writeFile(path.join(fixture.repoPath, "local-only.txt"), "do not include\n", "utf8");

    const result = await buildSnapshot(baseSnapshotOptions(fixture));

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected snapshot build to succeed");
    }
    await expect(
      readFile(path.join(result.agent_snapshot_path, "local-only.txt")),
    ).rejects.toThrow();
    expect(result.manifest.files.map((file) => file.repository_path)).not.toContain(
      "local-only.txt",
    );
  });

  it("returns a structured error for unsupported snapshot strategies", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      snapshot: {
        ...baseSnapshotOptions(fixture).snapshot,
        strategy: "git_archive",
      },
    });

    expect(result).toEqual({
      ok: false,
      checks: [
        expect.objectContaining({
          code: "SNAPSHOT_STRATEGY_NOT_IMPLEMENTED",
          severity: "error",
        }),
      ],
    });
  });

  it("allows unresolved LFS pointer files when configured", async () => {
    const fixture = await createGitRepoFixture({ includeLfsPointer: true });
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      snapshot: {
        ...baseSnapshotOptions(fixture).snapshot,
        git_lfs_handling: "allow_pointer_files",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "INVALID_SNAPSHOT_LFS_POINTERS",
        severity: "warning",
        paths: ["large.bin"],
      }),
    );
  });

  it("fails when create_new hidden evaluation files target existing repository paths", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      evaluation: {
        ...baseSnapshotOptions(fixture).evaluation,
        hidden_evaluation_files: [
          {
            shiptest_path: "hidden/existing.test.ts",
            repository_path: "tests/existing.test.ts",
            write_mode: "create_new",
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_PATH_ALREADY_EXISTS",
        severity: "error",
        paths: ["tests/existing.test.ts"],
      }),
    );
  });

  it("fails when replace_existing hidden evaluation files target missing repository paths", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      evaluation: {
        ...baseSnapshotOptions(fixture).evaluation,
        hidden_evaluation_files: [
          {
            shiptest_path: "hidden/missing.test.ts",
            repository_path: "tests/missing.test.ts",
            write_mode: "replace_existing",
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_PATH_MISSING_FOR_REPLACE",
        severity: "error",
        paths: ["tests/missing.test.ts"],
      }),
    );
  });

  it("validates hidden evaluation directory write modes", async () => {
    const fixture = await createGitRepoFixture();
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      evaluation: {
        ...baseSnapshotOptions(fixture).evaluation,
        hidden_evaluation_files: [],
        hidden_evaluation_directories: [
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "tests",
            write_mode: "create_new",
          },
          {
            shiptest_path: "hidden/missing-fixtures",
            repository_path: "tests/missing-fixtures",
            write_mode: "replace_existing",
          },
          {
            shiptest_path: "hidden/fixtures",
            repository_path: "tests",
            write_mode: "merge_and_replace",
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_DIRECTORY_ALREADY_EXISTS",
        severity: "error",
        paths: ["tests"],
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_DIRECTORY_MISSING_FOR_REPLACE",
        severity: "error",
        paths: ["tests/missing-fixtures"],
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "HIDDEN_EVALUATION_DIRECTORY_WRITE_MODE_VALID",
        severity: "warning",
        paths: ["tests"],
      }),
    );
  });

  it("fails when submodules are detected and configured to fail", async () => {
    const fixture = await createGitRepoFixture({ includeGitModules: true });
    const result = await buildSnapshot(baseSnapshotOptions(fixture));

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "SNAPSHOT_SUBMODULES_DETECTED",
        severity: "error",
        paths: [".gitmodules"],
      }),
    );
  });

  it("warns when submodules are detected and configured to be left unchecked out", async () => {
    const fixture = await createGitRepoFixture({ includeGitModules: true });
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      snapshot: {
        ...baseSnapshotOptions(fixture).snapshot,
        submodule_handling: "leave_unchecked_out",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "SNAPSHOT_SUBMODULES_LEFT_UNCHECKED_OUT",
        severity: "warning",
        paths: [".gitmodules"],
      }),
    );
  });

  it("checks out submodules recursively when configured", async () => {
    const fixture = await createGitRepoFixture({ includeGitModules: true });
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      snapshot: {
        ...baseSnapshotOptions(fixture).snapshot,
        submodule_handling: "checkout_recursive",
      },
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "SNAPSHOT_SUBMODULES_CHECKED_OUT",
        severity: "pass",
        paths: [".gitmodules"],
      }),
    );
  });

  it("returns structured checks for Git LFS download mode", async () => {
    const fixture = await createGitRepoFixture({ includeLfsPointer: true });
    const result = await buildSnapshot({
      ...baseSnapshotOptions(fixture),
      snapshot: {
        ...baseSnapshotOptions(fixture).snapshot,
        git_lfs_handling: "download_lfs_files",
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: expect.stringMatching(/SNAPSHOT_GIT_LFS_(DOWNLOADED|UNAVAILABLE|DOWNLOAD_FAILED)/),
      }),
    );
  });
});

interface GitRepoFixture {
  readonly repoPath: string;
  readonly outputRootPath: string;
  readonly commit: string;
}

interface GitRepoFixtureOptions {
  readonly includeGitModules?: boolean;
  readonly includeLfsPointer?: boolean;
}

async function createGitRepoFixture(options: GitRepoFixtureOptions = {}): Promise<GitRepoFixture> {
  const root = path.join(os.tmpdir(), "shiptest-snapshot-fixtures", crypto.randomUUID());
  const repoPath = path.join(root, "repo");
  const outputRootPath = path.join(root, "snapshot-output");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await mkdir(path.join(repoPath, "tests"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await writeFile(
    path.join(repoPath, "tests", "existing.test.ts"),
    "test('existing', () => {});\n",
    "utf8",
  );
  await writeFile(path.join(repoPath, "AGENTS.md"), "Use project conventions.\n", "utf8");
  if (options.includeLfsPointer) {
    await writeFile(
      path.join(repoPath, "large.bin"),
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc123\nsize 123\n",
      "utf8",
    );
  }
  if (options.includeGitModules) {
    await writeFile(
      path.join(repoPath, ".gitmodules"),
      '[submodule "vendor/example"]\n\tpath = vendor/example\n\turl = https://example.com/vendor/example.git\n',
      "utf8",
    );
  }

  await git(["init"], repoPath);
  await git(["config", "user.email", "test@shiptest.local"], repoPath);
  await git(["config", "user.name", "ShipTest Test"], repoPath);
  await git(["add", "-A"], repoPath);
  await git(["commit", "-m", "initial"], repoPath);
  const commit = (await git(["rev-parse", "HEAD"], repoPath)).stdout.trim();

  return { repoPath, outputRootPath, commit };
}

function baseSnapshotOptions(fixture: GitRepoFixture): BuildSnapshotOptions {
  return {
    source_repo_path: fixture.repoPath,
    base_commit: fixture.commit,
    output_root_path: fixture.outputRootPath,
    snapshot: {
      strategy: "sanitized_copy",
      git_lfs_handling: "fail_on_pointers",
      submodule_handling: "fail_if_detected",
      strip_real_git_metadata: true,
    },
    agent_context: { exclude_paths: [], instruction_files: [] },
    evaluation: {
      clean_room: true,
      hidden_evaluation_files: [
        {
          shiptest_path: "hidden/new.test.ts",
          repository_path: "tests/new.test.ts",
          write_mode: "create_new",
        },
      ],
      hidden_evaluation_directories: [],
      hidden_evaluation_patches: [],
      scoring_command: "npm test",
      dependency_changes: "warn",
      rerun_setup_on_dependency_change: true,
    },
  };
}
