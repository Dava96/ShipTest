import path from "node:path";
import { minimatch } from "minimatch";

import { safeRemoveDescendant, WalkEntryResult, walkEntries } from "../utils/filesystem.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import type { SnapshotCheck } from "./types.js";

export async function stripRealGitMetadata(snapshotPath: string): Promise<SnapshotCheck> {
  const gitMetadataPaths = await findRealGitMetadata(snapshotPath);
  await Promise.all(
    gitMetadataPaths.map((metadataPath) => safeRemoveDescendant(snapshotPath, metadataPath)),
  );

  return {
    code: SnapshotCheckCode.RealGitMetadataStripped,
    severity: SnapshotCheckSeverity.Pass,
    message: `Removed ${gitMetadataPaths.length} real Git metadata path(s) from the agent snapshot.`,
    paths: gitMetadataPaths.map((metadataPath) => toRepositoryPath(snapshotPath, metadataPath)),
  };
}

export async function findRealGitMetadata(snapshotPath: string): Promise<string[]> {
  const matches: string[] = [];
  await walkEntries(snapshotPath, async (entryPath, entryName) => {
    if (entryName === ".git") {
      matches.push(entryPath);
      return WalkEntryResult.Skip;
    }
    return WalkEntryResult.Continue;
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
      code: SnapshotCheckCode.AgentContextExclusionsApplied,
      severity: SnapshotCheckSeverity.Pass,
      message: "No agent context exclusions configured.",
      paths: [],
    };
  }

  await walkEntries(snapshotPath, async (entryPath) => {
    const repositoryPath = toRepositoryPath(snapshotPath, entryPath);
    if (excludePaths.some((pattern) => matchesRepositoryPath(repositoryPath, pattern))) {
      removedPaths.push(repositoryPath);
      await safeRemoveDescendant(snapshotPath, entryPath);
      return WalkEntryResult.Skip;
    }
    return WalkEntryResult.Continue;
  });

  return {
    code: SnapshotCheckCode.AgentContextExclusionsApplied,
    severity: SnapshotCheckSeverity.Pass,
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

export function toRepositoryPath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replaceAll(path.sep, "/");
}
