import type { SnapshotManifest, SnapshotManifestFile } from "../snapshot/types.js";
import type { WorkspaceManifestDiff, WorkspaceManifestFileChange } from "./types.js";

export function createWorkspaceManifestDiff(
  before: SnapshotManifest,
  after: SnapshotManifest,
): WorkspaceManifestDiff {
  const beforeByPath = indexManifestFiles(before.files);
  const afterByPath = indexManifestFiles(after.files);
  const added: SnapshotManifestFile[] = [];
  const modified: WorkspaceManifestFileChange[] = [];
  const deleted: SnapshotManifestFile[] = [];
  let unchangedCount = 0;

  for (const beforeFile of before.files) {
    const afterFile = afterByPath.get(beforeFile.repository_path);
    if (!afterFile) {
      deleted.push(beforeFile);
      continue;
    }
    if (manifestFilesEqual(beforeFile, afterFile)) {
      unchangedCount += 1;
      continue;
    }
    modified.push({ before: beforeFile, after: afterFile });
  }

  for (const afterFile of after.files) {
    if (!beforeByPath.has(afterFile.repository_path)) {
      added.push(afterFile);
    }
  }

  return {
    added: sortManifestFiles(added),
    modified: modified.sort((left, right) =>
      left.before.repository_path.localeCompare(right.before.repository_path),
    ),
    deleted: sortManifestFiles(deleted),
    unchanged_count: unchangedCount,
  };
}

function indexManifestFiles(
  files: readonly SnapshotManifestFile[],
): Map<string, SnapshotManifestFile> {
  return new Map(files.map((file) => [file.repository_path, file]));
}

function manifestFilesEqual(left: SnapshotManifestFile, right: SnapshotManifestFile): boolean {
  return (
    left.repository_path === right.repository_path &&
    left.sha256 === right.sha256 &&
    left.size_bytes === right.size_bytes &&
    left.executable === right.executable
  );
}

function sortManifestFiles(files: readonly SnapshotManifestFile[]): SnapshotManifestFile[] {
  return [...files].sort((left, right) =>
    left.repository_path.localeCompare(right.repository_path),
  );
}
