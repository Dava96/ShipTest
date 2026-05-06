import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createSnapshotManifest } from "./manifest.js";

describe("createSnapshotManifest", () => {
  it("records repository files but excludes synthetic .git metadata", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-manifest-"));
    await mkdir(path.join(root, ".git", "objects"), { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/shiptest-baseline\n", "utf8");
    await writeFile(path.join(root, ".gitignore"), "dist/\n", "utf8");
    await writeFile(path.join(root, "package.json"), "{}\n", "utf8");

    const manifest = await createSnapshotManifest({
      snapshotPath: root,
      sourceCommit: "commit",
      sourceTree: "tree",
    });

    expect(manifest.files.map((file) => file.repository_path)).toEqual([
      ".gitignore",
      "package.json",
    ]);
  });
});
