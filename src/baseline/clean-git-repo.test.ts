import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { git } from "../utils/git.js";
import { PreparedBaselineCheckCode } from "./check-codes.js";
import { initializeCleanGitRepo } from "./clean-git-repo.js";

async function createWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-clean-git-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  return root;
}

describe("initializeCleanGitRepo", () => {
  it("creates a clean local-only Git repo with a baseline commit", async () => {
    const workspace = await createWorkspace();

    const result = await initializeCleanGitRepo(workspace);

    expect(result).toMatchObject({
      ok: true,
      branch: "shiptest-baseline",
      baseline_commit: expect.any(String),
    });
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: PreparedBaselineCheckCode.CleanGitRepoVerified,
        severity: "pass",
      }),
    );

    await expect(git(["status", "--porcelain"], workspace)).resolves.toMatchObject({
      stdout: "",
    });
    await expect(git(["remote"], workspace)).resolves.toMatchObject({ stdout: "" });
    await expect(git(["rev-parse", "--abbrev-ref", "HEAD"], workspace)).resolves.toMatchObject({
      stdout: "shiptest-baseline\n",
    });
  });
});
