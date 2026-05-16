import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import { pathExists } from "../utils/filesystem.js";
import { git } from "../utils/git.js";
import { prepareCopiedWorkspace, prepareResettableGitWorkspace } from "./resettable-workspace.js";

async function createPreparedBaseline(): Promise<{
  readonly path: string;
  readonly baselineCommit: string;
}> {
  const preparedBaselinePath = await mkdtemp(path.join(os.tmpdir(), "shiptest-resettable-base-"));
  await mkdir(path.join(preparedBaselinePath, "src"), { recursive: true });
  await writeFile(path.join(preparedBaselinePath, "src", "index.ts"), "export const value = 1;\n");
  await writeFile(path.join(preparedBaselinePath, "README.md"), "baseline\n");

  const gitResult = await initializeCleanGitRepo(preparedBaselinePath);
  if (!gitResult.ok || !gitResult.baseline_commit) {
    throw new Error("Failed to initialize test baseline Git repo.");
  }

  return { path: preparedBaselinePath, baselineCommit: gitResult.baseline_commit };
}

describe("resettable workspaces", () => {
  it("copies the prepared baseline on first use", async () => {
    const baseline = await createPreparedBaseline();
    const workspacePath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "shiptest-resettable-")),
      "agent",
    );

    const result = await prepareResettableGitWorkspace({
      preparedBaselinePath: baseline.path,
      workspacePath,
      baselineCommit: baseline.baselineCommit,
    });

    expect(result).toEqual({
      workspace_path: workspacePath,
      strategy: "resettable_git",
      reused: false,
      fallback_used: false,
    });
    await expect(readFile(path.join(workspacePath, "README.md"), "utf8")).resolves.toBe(
      "baseline\n",
    );
    await expect(git(["status", "--porcelain"], workspacePath)).resolves.toMatchObject({
      stdout: "",
    });
  });

  it("resets an existing workspace back to the baseline commit", async () => {
    const baseline = await createPreparedBaseline();
    const workspacePath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "shiptest-resettable-")),
      "agent",
    );
    await prepareResettableGitWorkspace({
      preparedBaselinePath: baseline.path,
      workspacePath,
      baselineCommit: baseline.baselineCommit,
    });
    await writeFile(path.join(workspacePath, "README.md"), "changed\n");
    await writeFile(path.join(workspacePath, "untracked.txt"), "delete me\n");

    const result = await prepareResettableGitWorkspace({
      preparedBaselinePath: baseline.path,
      workspacePath,
      baselineCommit: baseline.baselineCommit,
    });

    expect(result).toMatchObject({
      strategy: "resettable_git",
      reused: true,
      fallback_used: false,
    });
    await expect(readFile(path.join(workspacePath, "README.md"), "utf8")).resolves.toBe(
      "baseline\n",
    );
    await expect(pathExists(path.join(workspacePath, "untracked.txt"))).resolves.toBe(false);
    await expect(git(["status", "--porcelain"], workspacePath)).resolves.toMatchObject({
      stdout: "",
    });
  });

  it("falls back to a fresh copy when an existing workspace cannot be reset", async () => {
    const baseline = await createPreparedBaseline();
    const workspacePath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "shiptest-resettable-")),
      "agent",
    );
    await mkdir(workspacePath, { recursive: true });
    await writeFile(path.join(workspacePath, "stale.txt"), "not a git repo\n");

    const result = await prepareResettableGitWorkspace({
      preparedBaselinePath: baseline.path,
      workspacePath,
      baselineCommit: baseline.baselineCommit,
    });

    expect(result).toMatchObject({
      strategy: "resettable_git",
      reused: false,
      fallback_used: true,
    });
    await expect(pathExists(path.join(workspacePath, "stale.txt"))).resolves.toBe(false);
    await expect(readFile(path.join(workspacePath, "README.md"), "utf8")).resolves.toBe(
      "baseline\n",
    );
  });

  it("keeps the copy strategy available for callers without a baseline commit", async () => {
    const baseline = await createPreparedBaseline();
    const workspacePath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "shiptest-copy-")),
      "workspace",
    );

    const result = await prepareCopiedWorkspace({
      preparedBaselinePath: baseline.path,
      workspacePath,
      overwrite: false,
    });

    expect(result).toEqual({
      workspace_path: workspacePath,
      strategy: "copy",
      reused: false,
      fallback_used: false,
    });
    await expect(readFile(path.join(workspacePath, "src", "index.ts"), "utf8")).resolves.toBe(
      "export const value = 1;\n",
    );
    await expect(
      prepareCopiedWorkspace({
        preparedBaselinePath: baseline.path,
        workspacePath,
        overwrite: false,
      }),
    ).rejects.toThrow("Workspace already exists");
  });
});
