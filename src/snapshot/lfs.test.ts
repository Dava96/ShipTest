import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hasGitLfs } from "../utils/git.js";
import { SnapshotCheckCode } from "./check-codes.js";
import { createLfsPointerCheck, findLfsPointerFiles, handleGitLfs } from "./lfs.js";

describe("Git LFS snapshot handling", () => {
  it("ignores non-LFS files while scanning LFS pointers", async () => {
    const root = await createTempDirectory();
    await writeFile(path.join(root, "binary.bin"), Buffer.from([0xff, 0x00, 0x01]));

    await expect(findLfsPointerFiles(root)).resolves.toEqual([]);
  });

  it("returns a pass check when no LFS pointers exist", async () => {
    const root = await createTempDirectory();
    await writeFile(path.join(root, "file.txt"), "hello\n", "utf8");

    await expect(createLfsPointerCheck(root, "fail_on_pointers")).resolves.toEqual({
      code: SnapshotCheckCode.GitLfsPointersAbsent,
      severity: "pass",
      message: "No unresolved Git LFS pointer files found in the agent snapshot.",
      paths: [],
    });
  });

  it("returns structured checks for unavailable or failed Git LFS downloads", async () => {
    const root = await createTempDirectory();

    await expect(
      handleGitLfs(root, "download_lfs_files", {
        git: async () => ({ stdout: "", stderr: "" }),
        hasGitLfs: async () => false,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.GitLfsUnavailable, severity: "error" }),
    );

    await expect(
      handleGitLfs(root, "download_lfs_files", {
        git: async () => {
          throw new Error("lfs error");
        },
        hasGitLfs: async () => true,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        code: SnapshotCheckCode.GitLfsDownloadFailed,
        message: "lfs error",
        severity: "error",
      }),
    );
  });

  it("returns no checks unless download_lfs_files is configured", async () => {
    const root = await createTempDirectory();

    await expect(handleGitLfs(root, "fail_on_pointers")).resolves.toEqual([]);
  });

  it("can report Git LFS as unavailable", async () => {
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      await expect(hasGitLfs()).resolves.toBe(false);
    } finally {
      process.env.PATH = originalPath;
    }
  });
});

async function createTempDirectory(): Promise<string> {
  const root = path.join(os.tmpdir(), "shiptest-lfs-fixtures", crypto.randomUUID());
  await mkdir(root, { recursive: true });
  return root;
}
