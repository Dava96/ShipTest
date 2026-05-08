import { describe, expect, it } from "vitest";

import type { SnapshotManifest, SnapshotManifestFile } from "../snapshot/types.js";
import { createWorkspaceManifestDiff } from "./manifest-diff.js";

function file(
  repositoryPath: string,
  options: Partial<Omit<SnapshotManifestFile, "repository_path">> = {},
): SnapshotManifestFile {
  return {
    repository_path: repositoryPath,
    size_bytes: options.size_bytes ?? 10,
    sha256: options.sha256 ?? `sha-${repositoryPath}`,
    executable: options.executable ?? false,
  };
}

function manifest(files: readonly SnapshotManifestFile[]): SnapshotManifest {
  return {
    schema_version: 1,
    created_at: "2026-05-08T00:00:00.000Z",
    source_commit: "commit",
    source_tree: "tree",
    files,
    manifest_sha256: "manifest",
  };
}

describe("createWorkspaceManifestDiff", () => {
  it("returns no changes when manifests contain equivalent files", () => {
    const before = manifest([file("src/index.ts"), file("package.json")]);
    const after = manifest([file("package.json"), file("src/index.ts")]);

    expect(createWorkspaceManifestDiff(before, after)).toEqual({
      added: [],
      modified: [],
      deleted: [],
      unchanged_count: 2,
    });
  });

  it("detects added, modified, and deleted files", () => {
    const unchanged = file("README.md");
    const beforeModified = file("src/index.ts", { sha256: "old", size_bytes: 10 });
    const afterModified = file("src/index.ts", { sha256: "new", size_bytes: 12 });
    const deleted = file("src/old.ts");
    const added = file("src/new.ts");

    const diff = createWorkspaceManifestDiff(
      manifest([beforeModified, deleted, unchanged]),
      manifest([added, afterModified, unchanged]),
    );

    expect(diff.added).toEqual([added]);
    expect(diff.modified).toEqual([{ before: beforeModified, after: afterModified }]);
    expect(diff.deleted).toEqual([deleted]);
    expect(diff.unchanged_count).toBe(1);
  });

  it("treats executable bit changes as modifications", () => {
    const before = file("scripts/build.sh", { executable: false });
    const after = file("scripts/build.sh", { executable: true });

    expect(createWorkspaceManifestDiff(manifest([before]), manifest([after])).modified).toEqual([
      { before, after },
    ]);
  });

  it("sorts added, modified, and deleted paths deterministically", () => {
    const diff = createWorkspaceManifestDiff(
      manifest([
        file("z-deleted.ts"),
        file("b-modified.ts", { sha256: "old-b" }),
        file("a-modified.ts", { sha256: "old-a" }),
      ]),
      manifest([
        file("c-added.ts"),
        file("a-added.ts"),
        file("b-modified.ts", { sha256: "new-b" }),
        file("a-modified.ts", { sha256: "new-a" }),
      ]),
    );

    expect(diff.added.map((entry) => entry.repository_path)).toEqual(["a-added.ts", "c-added.ts"]);
    expect(diff.modified.map((entry) => entry.before.repository_path)).toEqual([
      "a-modified.ts",
      "b-modified.ts",
    ]);
    expect(diff.deleted.map((entry) => entry.repository_path)).toEqual(["z-deleted.ts"]);
  });
});
