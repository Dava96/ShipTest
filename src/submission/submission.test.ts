import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import { createSnapshotManifest } from "../snapshot/manifest.js";
import { applySubmissionDiff } from "./apply.js";
import { SubmissionCheckCode } from "./check-codes.js";
import { extractSubmission } from "./extract.js";

async function createPreparedWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-submission-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
  await writeFile(path.join(root, ".gitignore"), "ignored/\n", "utf8");
  await initializeCleanGitRepo(root);
  return root;
}

describe("submission extraction and application", () => {
  it("extracts a Git submission diff and separate workspace evidence for ignored files", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });

    await writeFile(path.join(workspace, "src", "index.ts"), "export const value = 2;\n", "utf8");
    await mkdir(path.join(workspace, "ignored"), { recursive: true });
    await writeFile(path.join(workspace, "ignored", "side-effect.txt"), "ignored\n", "utf8");

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected submission extraction to succeed");
    }
    expect(result.submission.is_empty).toBe(false);
    expect(result.submission.changed_files).toEqual(["src/index.ts"]);
    expect(
      result.submission.workspace_diff.modified.map((change) => change.before.repository_path),
    ).toEqual(["src/index.ts"]);
    expect(result.submission.workspace_diff.added.map((file) => file.repository_path)).toEqual([
      "ignored/side-effect.txt",
    ]);

    const freshWorkspace = await mkdtemp(path.join(os.tmpdir(), "shiptest-submission-apply-"));
    await rm(freshWorkspace, { force: true, recursive: true });
    await cp(workspace, freshWorkspace, { recursive: true });
    await writeFile(
      path.join(freshWorkspace, "src", "index.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await rm(path.join(freshWorkspace, "ignored"), { force: true, recursive: true });

    await expect(
      applySubmissionDiff(freshWorkspace, result.submission.diff),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(path.join(freshWorkspace, "src", "index.ts"), "utf8")).resolves.toContain(
      "export const value = 2;",
    );
  });

  it("round-trips added tracked files through extraction and application", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });
    const freshWorkspace = await mkdtemp(path.join(os.tmpdir(), "shiptest-submission-apply-"));
    await rm(freshWorkspace, { force: true, recursive: true });
    await cp(workspace, freshWorkspace, { recursive: true });

    await writeFile(path.join(workspace, "src", "new.ts"), "export const added = true;\n", "utf8");

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected submission extraction to succeed");
    }
    expect(result.submission.changed_files).toEqual(["src/new.ts"]);
    expect(result.submission.workspace_diff.added.map((file) => file.repository_path)).toEqual([
      "src/new.ts",
    ]);

    await expect(
      applySubmissionDiff(freshWorkspace, result.submission.diff),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(path.join(freshWorkspace, "src", "new.ts"), "utf8")).resolves.toContain(
      "export const added = true;",
    );
  });

  it("round-trips deleted tracked files through extraction and application", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });
    const freshWorkspace = await mkdtemp(path.join(os.tmpdir(), "shiptest-submission-apply-"));
    await rm(freshWorkspace, { force: true, recursive: true });
    await cp(workspace, freshWorkspace, { recursive: true });

    await rm(path.join(workspace, "src", "index.ts"));

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected submission extraction to succeed");
    }
    expect(result.submission.changed_files).toEqual(["src/index.ts"]);
    expect(result.submission.workspace_diff.deleted.map((file) => file.repository_path)).toEqual([
      "src/index.ts",
    ]);

    await expect(
      applySubmissionDiff(freshWorkspace, result.submission.diff),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(path.join(freshWorkspace, "src", "index.ts"), "utf8")).rejects.toThrow();
  });

  it("round-trips binary files through extraction and application", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });
    const freshWorkspace = await mkdtemp(path.join(os.tmpdir(), "shiptest-submission-apply-"));
    await rm(freshWorkspace, { force: true, recursive: true });
    await cp(workspace, freshWorkspace, { recursive: true });

    const binaryContent = Buffer.from([0, 255, 128, 64, 10, 0, 1, 2]);
    await mkdir(path.join(workspace, "assets"), { recursive: true });
    await writeFile(path.join(workspace, "assets", "blob.bin"), binaryContent);

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected submission extraction to succeed");
    }
    expect(result.submission.changed_files).toEqual(["assets/blob.bin"]);
    expect(result.submission.workspace_diff.added.map((file) => file.repository_path)).toEqual([
      "assets/blob.bin",
    ]);

    await expect(
      applySubmissionDiff(freshWorkspace, result.submission.diff),
    ).resolves.toMatchObject({
      ok: true,
    });
    await expect(readFile(path.join(freshWorkspace, "assets", "blob.bin"))).resolves.toEqual(
      binaryContent,
    );
  });

  it("preserves workspace evidence when Git extraction fails", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });
    await writeFile(path.join(workspace, "src", "index.ts"), "export const value = 2;\n", "utf8");
    await rm(path.join(workspace, ".git"), { force: true, recursive: true });

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected submission extraction to fail");
    }
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: SubmissionCheckCode.SubmissionExtractionFailed }),
    );
    expect(result.workspace_diff?.modified.map((change) => change.before.repository_path)).toEqual([
      "src/index.ts",
    ]);
  });

  it("treats empty submission diffs as valid no-op submissions", async () => {
    const workspace = await createPreparedWorkspace();
    const baselineManifest = await createSnapshotManifest({
      snapshotPath: workspace,
      sourceCommit: "commit",
      sourceTree: "tree",
    });

    const result = await extractSubmission({ workspacePath: workspace, baselineManifest });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected submission extraction to succeed");
    }
    expect(result.submission.is_empty).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: SubmissionCheckCode.SubmissionDiffEmpty }),
    );
    await expect(applySubmissionDiff(workspace, result.submission.diff)).resolves.toMatchObject({
      ok: true,
    });
  });
});
