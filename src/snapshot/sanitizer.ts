import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { minimatch } from "minimatch";

import { walkEntries } from "./files.js";
import type { SnapshotCheck } from "./types.js";

export async function stripRealGitMetadata(snapshotPath: string): Promise<SnapshotCheck> {
  const gitMetadataPaths = await findRealGitMetadata(snapshotPath);
  await Promise.all(
    gitMetadataPaths.map((metadataPath) => rm(metadataPath, { force: true, recursive: true })),
  );

  return {
    code: "SNAPSHOT_REAL_GIT_METADATA_STRIPPED",
    severity: "pass",
    message: `Removed ${gitMetadataPaths.length} real Git metadata path(s) from the agent snapshot.`,
    paths: gitMetadataPaths.map((metadataPath) => toRepositoryPath(snapshotPath, metadataPath)),
  };
}

export async function findRealGitMetadata(snapshotPath: string): Promise<string[]> {
  const matches: string[] = [];
  await walkEntries(snapshotPath, async (entryPath, entryName) => {
    if (entryName === ".git") {
      matches.push(entryPath);
      return "skip";
    }
    return "continue";
  });
  return matches;
}

export async function applyAgentContextExclusions(
  snapshotPath: string,
  excludePaths: readonly string[],
): Promise<SnapshotCheck> {
  const removedPaths: string[] = [];
  if (excludePaths.length === 0) {
    return {
      code: "SNAPSHOT_AGENT_CONTEXT_EXCLUSIONS_APPLIED",
      severity: "pass",
      message: "No agent context exclusions configured.",
      paths: [],
    };
  }

  await walkEntries(snapshotPath, async (entryPath) => {
    const repositoryPath = toRepositoryPath(snapshotPath, entryPath);
    if (excludePaths.some((pattern) => matchesRepositoryPath(repositoryPath, pattern))) {
      removedPaths.push(repositoryPath);
      await rm(entryPath, { force: true, recursive: true });
      return "skip";
    }
    return "continue";
  });

  return {
    code: "SNAPSHOT_AGENT_CONTEXT_EXCLUSIONS_APPLIED",
    severity: "pass",
    message: `Applied agent context exclusions and removed ${removedPaths.length} path(s).`,
    paths: removedPaths,
  };
}

export function matchesRepositoryPath(repositoryPath: string, pattern: string): boolean {
  const normalizedPattern = pattern.replaceAll("\\", "/");
  return (
    minimatch(repositoryPath, normalizedPattern, { dot: true }) ||
    repositoryPath === normalizedPattern
  );
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function toRepositoryPath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replaceAll(path.sep, "/");
}
