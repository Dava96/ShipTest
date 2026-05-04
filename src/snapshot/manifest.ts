import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { walkFiles } from "../utils/filesystem.js";
import type { SnapshotManifest, SnapshotManifestFile } from "./types.js";

export async function createSnapshotManifest(options: {
  readonly snapshotPath: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
}): Promise<SnapshotManifest> {
  const files = await collectManifestFiles(options.snapshotPath);
  const manifestContent = JSON.stringify({
    schema_version: 1,
    source_commit: options.sourceCommit,
    source_tree: options.sourceTree,
    files,
  });

  return {
    schema_version: 1,
    created_at: new Date().toISOString(),
    source_commit: options.sourceCommit,
    source_tree: options.sourceTree,
    files,
    manifest_sha256: sha256Text(manifestContent),
  };
}

async function collectManifestFiles(snapshotPath: string): Promise<SnapshotManifestFile[]> {
  const files: SnapshotManifestFile[] = [];
  await walkFiles(snapshotPath, async (filePath) => {
    const fileStat = await stat(filePath);
    const content = await readFile(filePath);
    files.push({
      repository_path: path.relative(snapshotPath, filePath).replaceAll(path.sep, "/"),
      size_bytes: fileStat.size,
      sha256: sha256Buffer(content),
      executable: (fileStat.mode & 0o111) !== 0,
    });
  });
  return files.sort((left, right) => left.repository_path.localeCompare(right.repository_path));
}

function sha256Buffer(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
