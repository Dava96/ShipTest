import { readFile } from "node:fs/promises";
import path from "node:path";

import { GitLfsHandling } from "../config/schema-values.js";
import { walkFiles } from "../utils/filesystem.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import type { SnapshotCheck } from "./types.js";

const lfsPointerPrefix = "version https://git-lfs.github.com/spec/v1";

export async function findLfsPointerFiles(snapshotPath: string): Promise<string[]> {
  const pointers: string[] = [];
  await walkFiles(snapshotPath, async (filePath) => {
    const fileHandle = await readFile(filePath, { encoding: "utf8" });
    if (fileHandle.startsWith(lfsPointerPrefix)) {
      pointers.push(path.relative(snapshotPath, filePath).replaceAll(path.sep, "/"));
    }
  });
  return pointers.sort();
}

export async function createLfsPointerCheck(
  snapshotPath: string,
  handling: GitLfsHandling,
): Promise<SnapshotCheck> {
  const pointers = await findLfsPointerFiles(snapshotPath);
  if (pointers.length === 0) {
    return {
      code: SnapshotCheckCode.GitLfsPointersAbsent,
      severity: SnapshotCheckSeverity.Pass,
      message: "No unresolved Git LFS pointer files found in the agent snapshot.",
      paths: [],
    };
  }

  return {
    code: SnapshotCheckCode.InvalidLfsPointers,
    severity:
      handling === GitLfsHandling.AllowPointerFiles
        ? SnapshotCheckSeverity.Warning
        : SnapshotCheckSeverity.Error,
    message: `Found ${pointers.length} unresolved Git LFS pointer file(s).`,
    paths: pointers,
  };
}

export async function handleGitLfs(
  stagingCheckoutPath: string,
  handling: GitLfsHandling,
  gitOperations: GitOperations = defaultGitOperations,
): Promise<SnapshotCheck[]> {
  if (handling !== GitLfsHandling.DownloadLfsFiles) {
    return [];
  }

  if (!(await gitOperations.hasGitLfs())) {
    return [
      {
        code: SnapshotCheckCode.GitLfsUnavailable,
        severity: SnapshotCheckSeverity.Error,
        message: `Git LFS is not available, but snapshot.git_lfs_handling is ${GitLfsHandling.DownloadLfsFiles}.`,
      },
    ];
  }

  try {
    await gitOperations.git(["lfs", "pull"], stagingCheckoutPath);
    return [
      {
        code: SnapshotCheckCode.GitLfsDownloaded,
        severity: SnapshotCheckSeverity.Pass,
        message: "Git LFS files downloaded successfully.",
      },
    ];
  } catch (error) {
    return [
      {
        code: SnapshotCheckCode.GitLfsDownloadFailed,
        severity: SnapshotCheckSeverity.Error,
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
