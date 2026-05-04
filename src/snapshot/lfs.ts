import { readFile } from "node:fs/promises";
import path from "node:path";

import { walkFiles } from "./files.js";
import { defaultGitOperations, type GitOperations } from "./git.js";
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

export type GitLfsHandling = "fail_on_pointers" | "download_lfs_files" | "allow_pointer_files";

export async function createLfsPointerCheck(
  snapshotPath: string,
  handling: GitLfsHandling,
): Promise<SnapshotCheck> {
  const pointers = await findLfsPointerFiles(snapshotPath);
  if (pointers.length === 0) {
    return {
      code: "SNAPSHOT_GIT_LFS_POINTERS_ABSENT",
      severity: "pass",
      message: "No unresolved Git LFS pointer files found in the agent snapshot.",
      paths: [],
    };
  }

  return {
    code: "INVALID_SNAPSHOT_LFS_POINTERS",
    severity: handling === "allow_pointer_files" ? "warning" : "error",
    message: `Found ${pointers.length} unresolved Git LFS pointer file(s).`,
    paths: pointers,
  };
}

export async function handleGitLfs(
  stagingCheckoutPath: string,
  handling: GitLfsHandling,
  gitOperations: GitOperations = defaultGitOperations,
): Promise<SnapshotCheck[]> {
  if (handling !== "download_lfs_files") {
    return [];
  }

  if (!(await gitOperations.hasGitLfs())) {
    return [
      {
        code: "SNAPSHOT_GIT_LFS_UNAVAILABLE",
        severity: "error",
        message: "Git LFS is not available, but snapshot.git_lfs_handling is download_lfs_files.",
      },
    ];
  }

  try {
    await gitOperations.git(["lfs", "pull"], stagingCheckoutPath);
    return [
      {
        code: "SNAPSHOT_GIT_LFS_DOWNLOADED",
        severity: "pass",
        message: "Git LFS files downloaded successfully.",
      },
    ];
  } catch (error) {
    return [
      {
        code: "SNAPSHOT_GIT_LFS_DOWNLOAD_FAILED",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
