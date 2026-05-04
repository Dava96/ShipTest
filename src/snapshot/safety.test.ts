import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SnapshotCheckCode } from "./check-codes.js";
import { validateSnapshotOutputPathSafety } from "./safety.js";

async function createSafetyFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-safety-"));
  const sourceRepoPath = path.join(root, "repo");
  const outputRootPath = path.join(root, "snapshot-output");
  await mkdir(sourceRepoPath, { recursive: true });
  return { root, sourceRepoPath, outputRootPath };
}

describe("validateSnapshotOutputPathSafety", () => {
  it("allows an absolute output path outside the source repo and cwd", async () => {
    const fixture = await createSafetyFixture();

    await expect(
      validateSnapshotOutputPathSafety({
        outputRootPath: fixture.outputRootPath,
        sourceRepoPath: fixture.sourceRepoPath,
        cwd: path.join(fixture.root, "somewhere-else"),
      }),
    ).resolves.toEqual([]);
  });

  it("rejects filesystem root output paths", async () => {
    const fixture = await createSafetyFixture();

    await expect(
      validateSnapshotOutputPathSafety({
        outputRootPath: path.parse(fixture.root).root,
        sourceRepoPath: fixture.sourceRepoPath,
        cwd: path.join(fixture.root, "somewhere-else"),
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.UnsafeOutputPath, severity: "error" }),
    );
  });

  it("rejects relative output paths", async () => {
    const fixture = await createSafetyFixture();

    await expect(
      validateSnapshotOutputPathSafety({
        outputRootPath: "snapshot-output",
        sourceRepoPath: fixture.sourceRepoPath,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.UnsafeOutputPath, severity: "error" }),
    );
  });

  it("rejects output paths that are the source repo, inside it, or a parent of it", async () => {
    const fixture = await createSafetyFixture();

    for (const outputRootPath of [
      fixture.sourceRepoPath,
      path.join(fixture.sourceRepoPath, ".shiptest", "snapshots"),
      fixture.root,
    ]) {
      await expect(
        validateSnapshotOutputPathSafety({
          outputRootPath,
          sourceRepoPath: fixture.sourceRepoPath,
          cwd: path.join(fixture.root, "somewhere-else"),
        }),
      ).resolves.toContainEqual(
        expect.objectContaining({ code: SnapshotCheckCode.UnsafeOutputPath, severity: "error" }),
      );
    }
  });

  it("rejects output paths that are the cwd or a parent of the cwd", async () => {
    const fixture = await createSafetyFixture();
    const cwd = path.join(fixture.root, "work", "project");
    await mkdir(cwd, { recursive: true });

    for (const outputRootPath of [cwd, path.dirname(cwd)]) {
      await expect(
        validateSnapshotOutputPathSafety({
          outputRootPath,
          sourceRepoPath: fixture.sourceRepoPath,
          cwd,
        }),
      ).resolves.toContainEqual(
        expect.objectContaining({ code: SnapshotCheckCode.UnsafeOutputPath, severity: "error" }),
      );
    }
  });

  it("rejects output paths that resolve through a symlink into the source repo", async () => {
    const fixture = await createSafetyFixture();
    const linkPath = path.join(fixture.root, "repo-link");
    try {
      await symlink(fixture.sourceRepoPath, linkPath, "dir");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EPERM") {
        return;
      }
      throw error;
    }

    await expect(
      validateSnapshotOutputPathSafety({
        outputRootPath: path.join(linkPath, "snapshots"),
        sourceRepoPath: fixture.sourceRepoPath,
        cwd: path.join(fixture.root, "somewhere-else"),
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.UnsafeOutputPath, severity: "error" }),
    );
  });
});
