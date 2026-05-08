import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { CheckSeverity } from "../checks/severity.js";
import type { SnapshotManifest } from "../snapshot/types.js";
import {
  isDirectory,
  isFilesystemRoot,
  isPathInside,
  pathExists,
  safeRemoveDescendant,
  samePath,
  WalkEntryResult,
  walkEntries,
} from "../utils/filesystem.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { sha256Json } from "../utils/hash.js";
import { type PreparedBaselineCheck, PreparedBaselineCheckCode } from "./check-codes.js";
import { initializeCleanGitRepo } from "./clean-git-repo.js";

export const PreparedBaselineDefaults = {
  CacheSchemaVersion: 1,
  CacheKind: "prepared_baseline",
  CacheDirectoryName: "prepared-baselines",
  DefaultLabel: "prepared-baseline",
  MetadataFileName: "metadata.json",
  WorkspaceDirectoryName: "workspace",
  ShortCacheKeyLength: 16,
} as const;

export interface PreparedBaselineCacheKeyInput {
  readonly snapshot_manifest_sha256: string;
  readonly repository_environment: unknown;
  readonly prepared_baseline: unknown;
  readonly shiptest_version: string;
}

export interface PreparedBaselineTimings {
  readonly total_ms: number;
  readonly cache_lookup_ms: number;
  readonly cache_restore_ms: number;
  readonly copy_source_ms: number;
  readonly clean_git_ms: number;
  readonly size_scan_ms: number;
  readonly cache_save_ms: number;
}

export interface PreparedBaselineMetadata {
  readonly schema_version: 1;
  readonly cache_key: string;
  readonly short_cache_key: string;
  readonly labels: readonly string[];
  readonly created_at: string;
  readonly last_used_at: string;
  readonly shiptest_version: string;
  readonly snapshot_manifest_sha256: string;
  readonly source_commit: string;
  readonly source_tree: string;
  readonly file_count: number;
  readonly size_bytes: number;
  readonly clean_git_repo: {
    readonly enabled: true;
    readonly branch: string;
    readonly baseline_commit: string;
  };
}

export type PreparedBaselineResult = PreparedBaselineSuccess | PreparedBaselineFailure;

export interface PreparedBaselineSuccess {
  readonly ok: true;
  readonly prepared_workspace_path: string;
  readonly cache_hit: boolean;
  readonly cache_entry_path?: string;
  readonly metadata: PreparedBaselineMetadata;
  readonly checks: readonly PreparedBaselineCheck[];
  readonly timings_ms: PreparedBaselineTimings;
}

export interface PreparedBaselineFailure {
  readonly ok: false;
  readonly prepared_workspace_path: string;
  readonly cache_hit: false;
  readonly checks: readonly PreparedBaselineCheck[];
  readonly timings_ms: PreparedBaselineTimings;
}

export interface RestorePreparedBaselineFromCacheOptions {
  readonly preparedWorkspacePath: string;
  readonly cacheRootPath: string;
  readonly cacheKeyInput: PreparedBaselineCacheKeyInput;
  readonly cacheLabel?: string;
  readonly overwrite?: boolean;
}

export interface PrepareBaselineFromWorkspaceOptions {
  readonly sourceWorkspacePath: string;
  readonly preparedWorkspacePath: string;
  readonly snapshotManifest: SnapshotManifest;
  readonly cacheKeyInput: PreparedBaselineCacheKeyInput;
  readonly cacheEnabled?: boolean;
  readonly cacheRootPath?: string;
  readonly cacheLabel?: string;
  readonly overwrite?: boolean;
  readonly gitOperations?: GitOperations;
}

export type RestorePreparedBaselineFromCacheResult =
  | RestorePreparedBaselineFromCacheSuccess
  | RestorePreparedBaselineFromCacheMiss;

export interface RestorePreparedBaselineFromCacheSuccess {
  readonly ok: true;
  readonly prepared_workspace_path: string;
  readonly cache_entry_path: string;
  readonly metadata: PreparedBaselineMetadata;
  readonly checks: readonly PreparedBaselineCheck[];
}

export interface RestorePreparedBaselineFromCacheMiss {
  readonly ok: false;
  readonly prepared_workspace_path: string;
  readonly checks: readonly PreparedBaselineCheck[];
}

interface CacheEntryLookupResult {
  readonly entryPath: string;
  readonly metadata: PreparedBaselineMetadata;
}

export function createPreparedBaselineCacheKey(input: PreparedBaselineCacheKeyInput): string {
  return sha256Json({
    kind: PreparedBaselineDefaults.CacheKind,
    schema_version: PreparedBaselineDefaults.CacheSchemaVersion,
    ...input,
  });
}

export async function restorePreparedBaselineFromCache(
  options: RestorePreparedBaselineFromCacheOptions,
): Promise<RestorePreparedBaselineFromCacheResult> {
  const checks: PreparedBaselineCheck[] = [];
  const cacheKey = createPreparedBaselineCacheKey(options.cacheKeyInput);
  const label = sanitizeCacheLabel(options.cacheLabel ?? PreparedBaselineDefaults.DefaultLabel);

  if (await pathExists(options.preparedWorkspacePath)) {
    if (!options.overwrite) {
      return {
        ok: false,
        prepared_workspace_path: options.preparedWorkspacePath,
        checks: [
          {
            code: PreparedBaselineCheckCode.DestinationExists,
            severity: CheckSeverity.Error,
            message: `Prepared baseline destination already exists: ${options.preparedWorkspacePath}`,
          },
        ],
      };
    }
    await removePreparedWorkspacePath(options.preparedWorkspacePath);
  }

  const invalidCacheEntryPaths: string[] = [];
  const cacheEntry = await findPreparedBaselineCacheEntry(
    options.cacheRootPath,
    cacheKey,
    invalidCacheEntryPaths,
  );
  for (const invalidCacheEntryPath of invalidCacheEntryPaths) {
    checks.push({
      code: PreparedBaselineCheckCode.CacheEntryInvalid,
      severity: CheckSeverity.Warning,
      message: "Ignored invalid prepared baseline cache entry.",
      paths: [invalidCacheEntryPath],
    });
  }

  if (!cacheEntry) {
    return {
      ok: false,
      prepared_workspace_path: options.preparedWorkspacePath,
      checks: [
        ...checks,
        {
          code: PreparedBaselineCheckCode.CacheRequiredMiss,
          severity: CheckSeverity.Warning,
          message: "Prepared baseline cache entry was not found.",
        },
      ],
    };
  }

  try {
    await restoreCacheEntry(cacheEntry.entryPath, options.preparedWorkspacePath);
    const metadata = await updateCacheEntryUsage(cacheEntry.entryPath, cacheEntry.metadata, label);
    return {
      ok: true,
      prepared_workspace_path: options.preparedWorkspacePath,
      cache_entry_path: cacheEntry.entryPath,
      metadata,
      checks: [
        ...checks,
        {
          code: PreparedBaselineCheckCode.CacheHit,
          severity: CheckSeverity.Pass,
          message: "Prepared baseline cache hit.",
          paths: [cacheEntry.entryPath],
        },
        {
          code: PreparedBaselineCheckCode.CacheRestored,
          severity: CheckSeverity.Pass,
          message: "Restored prepared baseline from cache.",
          paths: [cacheEntry.entryPath],
        },
      ],
    };
  } catch (error) {
    await removePreparedWorkspacePath(options.preparedWorkspacePath);
    return {
      ok: false,
      prepared_workspace_path: options.preparedWorkspacePath,
      checks: [
        ...checks,
        {
          code: PreparedBaselineCheckCode.CacheRestoreFailed,
          severity: CheckSeverity.Warning,
          message: `Prepared baseline cache restore failed. ${formatError(error)}`,
          paths: [cacheEntry.entryPath],
        },
      ],
    };
  }
}

export function getPreparedBaselineCacheEntryPath(
  cacheRootPath: string,
  cacheKey: string,
  label?: string,
): string {
  const safeLabel = sanitizeCacheLabel(label ?? PreparedBaselineDefaults.DefaultLabel);
  return path.join(
    cacheRootPath,
    PreparedBaselineDefaults.CacheDirectoryName,
    `${safeLabel}--${shortCacheKey(cacheKey)}`,
  );
}

export async function prepareBaselineFromWorkspace(
  options: PrepareBaselineFromWorkspaceOptions,
): Promise<PreparedBaselineResult> {
  const startedAt = Date.now();
  const timings = createEmptyPreparedBaselineTimings();
  const checks: PreparedBaselineCheck[] = [];
  const gitOperations = options.gitOperations ?? defaultGitOperations;
  const cacheEnabled = options.cacheEnabled ?? true;
  const cacheKey = createPreparedBaselineCacheKey(options.cacheKeyInput);
  const label = sanitizeCacheLabel(options.cacheLabel ?? PreparedBaselineDefaults.DefaultLabel);

  if (preparedBaselinePathsOverlap(options.sourceWorkspacePath, options.preparedWorkspacePath)) {
    return failure(options.preparedWorkspacePath, timings, startedAt, checks, {
      code: PreparedBaselineCheckCode.InvalidPaths,
      severity: CheckSeverity.Error,
      message:
        "Prepared baseline source and destination paths must be different and must not contain each other.",
    });
  }

  if (!(await isDirectory(options.sourceWorkspacePath))) {
    return failure(options.preparedWorkspacePath, timings, startedAt, checks, {
      code: PreparedBaselineCheckCode.SourceMissing,
      severity: CheckSeverity.Error,
      message: `Prepared baseline source workspace does not exist: ${options.sourceWorkspacePath}`,
    });
  }

  if (await pathExists(options.preparedWorkspacePath)) {
    if (!options.overwrite) {
      return failure(options.preparedWorkspacePath, timings, startedAt, checks, {
        code: PreparedBaselineCheckCode.DestinationExists,
        severity: CheckSeverity.Error,
        message: `Prepared baseline destination already exists: ${options.preparedWorkspacePath}`,
      });
    }
    await removePreparedWorkspacePath(options.preparedWorkspacePath);
  }

  if (cacheEnabled && !options.cacheRootPath) {
    return failure(options.preparedWorkspacePath, timings, startedAt, checks, {
      code: PreparedBaselineCheckCode.CacheRestoreFailed,
      severity: CheckSeverity.Error,
      message: "Prepared baseline cache is enabled but no cacheRootPath was provided.",
    });
  }

  if (cacheEnabled && options.cacheRootPath) {
    const cacheRootPath = options.cacheRootPath;
    const invalidCacheEntryPaths: string[] = [];
    const cacheEntry = await measurePreparedBaselineTiming(timings, "cache_lookup_ms", () =>
      findPreparedBaselineCacheEntry(cacheRootPath, cacheKey, invalidCacheEntryPaths),
    );
    for (const invalidCacheEntryPath of invalidCacheEntryPaths) {
      checks.push({
        code: PreparedBaselineCheckCode.CacheEntryInvalid,
        severity: CheckSeverity.Warning,
        message: "Ignored invalid prepared baseline cache entry.",
        paths: [invalidCacheEntryPath],
      });
    }
    if (cacheEntry) {
      checks.push({
        code: PreparedBaselineCheckCode.CacheHit,
        severity: CheckSeverity.Pass,
        message: "Prepared baseline cache hit.",
        paths: [cacheEntry.entryPath],
      });
      try {
        await measurePreparedBaselineTiming(timings, "cache_restore_ms", () =>
          restoreCacheEntry(cacheEntry.entryPath, options.preparedWorkspacePath),
        );
        const metadata = await updateCacheEntryUsage(
          cacheEntry.entryPath,
          cacheEntry.metadata,
          label,
        );
        checks.push({
          code: PreparedBaselineCheckCode.CacheRestored,
          severity: CheckSeverity.Pass,
          message: "Restored prepared baseline from cache.",
          paths: [cacheEntry.entryPath],
        });
        return {
          ok: true,
          prepared_workspace_path: options.preparedWorkspacePath,
          cache_hit: true,
          cache_entry_path: cacheEntry.entryPath,
          metadata,
          checks,
          timings_ms: finishPreparedBaselineTimings(timings, startedAt),
        };
      } catch (error) {
        checks.push({
          code: PreparedBaselineCheckCode.CacheRestoreFailed,
          severity: CheckSeverity.Warning,
          message: `Prepared baseline cache restore failed; rebuilding from source. ${formatError(error)}`,
          paths: [cacheEntry.entryPath],
        });
        await removePreparedWorkspacePath(options.preparedWorkspacePath);
      }
    } else {
      checks.push({
        code: PreparedBaselineCheckCode.CacheMiss,
        severity: CheckSeverity.Warning,
        message: "Prepared baseline cache miss; building from source workspace.",
      });
    }
  } else {
    checks.push({
      code: PreparedBaselineCheckCode.CacheDisabled,
      severity: CheckSeverity.Warning,
      message: "Prepared baseline cache is disabled.",
    });
  }

  try {
    await measurePreparedBaselineTiming(timings, "copy_source_ms", () =>
      cp(options.sourceWorkspacePath, options.preparedWorkspacePath, {
        recursive: true,
        verbatimSymlinks: true,
      }),
    );
    const cleanGitRepoResult = await measurePreparedBaselineTiming(timings, "clean_git_ms", () =>
      initializeCleanGitRepo(options.preparedWorkspacePath, {
        gitOperations,
      }),
    );
    checks.push(...cleanGitRepoResult.checks);
    if (
      !cleanGitRepoResult.ok ||
      !cleanGitRepoResult.branch ||
      !cleanGitRepoResult.baseline_commit
    ) {
      return {
        ok: false,
        prepared_workspace_path: options.preparedWorkspacePath,
        cache_hit: false,
        checks,
        timings_ms: finishPreparedBaselineTimings(timings, startedAt),
      };
    }

    const now = new Date().toISOString();
    const metadata: PreparedBaselineMetadata = {
      schema_version: 1,
      cache_key: cacheKey,
      short_cache_key: shortCacheKey(cacheKey),
      labels: [label],
      created_at: now,
      last_used_at: now,
      shiptest_version: options.cacheKeyInput.shiptest_version,
      snapshot_manifest_sha256: options.snapshotManifest.manifest_sha256,
      source_commit: options.snapshotManifest.source_commit,
      source_tree: options.snapshotManifest.source_tree,
      file_count: options.snapshotManifest.files.length,
      size_bytes: await measurePreparedBaselineTiming(timings, "size_scan_ms", () =>
        directorySizeBytes(options.preparedWorkspacePath),
      ),
      clean_git_repo: {
        enabled: true,
        branch: cleanGitRepoResult.branch,
        baseline_commit: cleanGitRepoResult.baseline_commit,
      },
    };

    checks.push({
      code: PreparedBaselineCheckCode.Created,
      severity: CheckSeverity.Pass,
      message: "Created prepared baseline from source workspace.",
    });

    let cacheEntryPath: string | undefined;
    if (cacheEnabled && options.cacheRootPath) {
      const cacheRootPath = options.cacheRootPath;
      try {
        cacheEntryPath = await measurePreparedBaselineTiming(timings, "cache_save_ms", () =>
          savePreparedBaselineToCache({
            cacheRootPath,
            cacheKey,
            label,
            workspacePath: options.preparedWorkspacePath,
            metadata,
          }),
        );
        checks.push({
          code: PreparedBaselineCheckCode.CacheSaved,
          severity: CheckSeverity.Pass,
          message: "Saved prepared baseline to cache.",
          paths: [cacheEntryPath],
        });
      } catch (error) {
        checks.push({
          code: PreparedBaselineCheckCode.CacheSaveFailed,
          severity: CheckSeverity.Warning,
          message: `Prepared baseline cache save failed; continuing uncached. ${formatError(error)}`,
        });
      }
    }

    return {
      ok: true,
      prepared_workspace_path: options.preparedWorkspacePath,
      cache_hit: false,
      ...(cacheEntryPath ? { cache_entry_path: cacheEntryPath } : {}),
      metadata,
      checks,
      timings_ms: finishPreparedBaselineTimings(timings, startedAt),
    };
  } catch (error) {
    return failure(options.preparedWorkspacePath, timings, startedAt, checks, {
      code: PreparedBaselineCheckCode.Created,
      severity: CheckSeverity.Error,
      message: `Failed to create prepared baseline. ${formatError(error)}`,
    });
  }
}

async function savePreparedBaselineToCache(options: {
  readonly cacheRootPath: string;
  readonly cacheKey: string;
  readonly label: string;
  readonly workspacePath: string;
  readonly metadata: PreparedBaselineMetadata;
}): Promise<string> {
  const existingEntry = await findPreparedBaselineCacheEntry(
    options.cacheRootPath,
    options.cacheKey,
  );
  if (existingEntry) {
    await updateCacheEntryUsage(existingEntry.entryPath, existingEntry.metadata, options.label);
    return existingEntry.entryPath;
  }

  const preparedBaselinesPath = path.join(
    options.cacheRootPath,
    PreparedBaselineDefaults.CacheDirectoryName,
  );
  await mkdir(preparedBaselinesPath, { recursive: true });
  const finalEntryPath = getPreparedBaselineCacheEntryPath(
    options.cacheRootPath,
    options.cacheKey,
    options.label,
  );
  const tempEntryPath = path.join(preparedBaselinesPath, `.tmp-${randomUUID()}`);

  await mkdir(tempEntryPath, { recursive: true });
  await writeMetadata(tempEntryPath, options.metadata);
  await cp(
    options.workspacePath,
    path.join(tempEntryPath, PreparedBaselineDefaults.WorkspaceDirectoryName),
    {
      recursive: true,
      verbatimSymlinks: true,
    },
  );

  try {
    await rename(tempEntryPath, finalEntryPath);
    return finalEntryPath;
  } catch (error) {
    await safeRemoveDescendant(preparedBaselinesPath, tempEntryPath);
    const concurrentlyCreatedEntry = await findPreparedBaselineCacheEntry(
      options.cacheRootPath,
      options.cacheKey,
    );
    if (concurrentlyCreatedEntry) {
      await updateCacheEntryUsage(
        concurrentlyCreatedEntry.entryPath,
        concurrentlyCreatedEntry.metadata,
        options.label,
      );
      return concurrentlyCreatedEntry.entryPath;
    }
    throw error;
  }
}

async function findPreparedBaselineCacheEntry(
  cacheRootPath: string,
  cacheKey: string,
  invalidEntryPaths: string[] = [],
): Promise<CacheEntryLookupResult | undefined> {
  const preparedBaselinesPath = path.join(
    cacheRootPath,
    PreparedBaselineDefaults.CacheDirectoryName,
  );
  if (!(await isDirectory(preparedBaselinesPath))) {
    return undefined;
  }

  for (const entry of await readdir(preparedBaselinesPath, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".tmp-")) {
      continue;
    }
    const entryPath = path.join(preparedBaselinesPath, entry.name);
    try {
      const metadata = await readMetadata(entryPath);
      if (metadata.cache_key !== cacheKey) {
        continue;
      }
      await validateCacheEntry(entryPath, metadata, cacheKey);
      return { entryPath, metadata };
    } catch {
      invalidEntryPaths.push(entryPath);
    }
  }

  return undefined;
}

async function validateCacheEntry(
  entryPath: string,
  metadata: PreparedBaselineMetadata,
  cacheKey: string,
): Promise<void> {
  if (metadata.schema_version !== 1) {
    throw new Error("Prepared baseline cache metadata schema version is unsupported.");
  }
  if (metadata.cache_key !== cacheKey) {
    throw new Error("Prepared baseline cache metadata key does not match requested key.");
  }
  const workspacePath = path.join(entryPath, PreparedBaselineDefaults.WorkspaceDirectoryName);
  if (!(await isDirectory(workspacePath))) {
    throw new Error("Prepared baseline cache workspace is missing.");
  }
  if (!(await isDirectory(path.join(workspacePath, ".git")))) {
    throw new Error("Prepared baseline cache workspace is missing its clean Git repo.");
  }
}

async function restoreCacheEntry(entryPath: string, preparedWorkspacePath: string): Promise<void> {
  const workspacePath = path.join(entryPath, PreparedBaselineDefaults.WorkspaceDirectoryName);
  await cp(workspacePath, preparedWorkspacePath, { recursive: true, verbatimSymlinks: true });
}

async function readMetadata(entryPath: string): Promise<PreparedBaselineMetadata> {
  return JSON.parse(
    await readFile(path.join(entryPath, PreparedBaselineDefaults.MetadataFileName), "utf8"),
  ) as PreparedBaselineMetadata;
}

async function writeMetadata(entryPath: string, metadata: PreparedBaselineMetadata): Promise<void> {
  await writeFile(
    path.join(entryPath, PreparedBaselineDefaults.MetadataFileName),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

async function updateCacheEntryUsage(
  entryPath: string,
  metadata: PreparedBaselineMetadata,
  label: string,
): Promise<PreparedBaselineMetadata> {
  const updatedMetadata: PreparedBaselineMetadata = {
    ...metadata,
    labels: metadata.labels.includes(label) ? metadata.labels : [...metadata.labels, label],
    last_used_at: new Date().toISOString(),
  };
  await writeMetadata(entryPath, updatedMetadata);
  return updatedMetadata;
}

async function directorySizeBytes(rootPath: string): Promise<number> {
  let size = 0;
  await walkEntries(rootPath, async (entryPath) => {
    const entryStat = await stat(entryPath);
    if (entryStat.isFile()) {
      size += entryStat.size;
    }
    return WalkEntryResult.Continue;
  });
  return size;
}

async function removePreparedWorkspacePath(preparedWorkspacePath: string): Promise<void> {
  const resolvedPath = path.resolve(preparedWorkspacePath);
  if (isFilesystemRoot(resolvedPath)) {
    throw new Error(
      `Refusing to remove filesystem root as prepared baseline path: ${preparedWorkspacePath}`,
    );
  }

  await safeRemoveDescendant(path.dirname(resolvedPath), resolvedPath);
}

function preparedBaselinePathsOverlap(
  sourceWorkspacePath: string,
  preparedWorkspacePath: string,
): boolean {
  return (
    samePath(sourceWorkspacePath, preparedWorkspacePath) ||
    isPathInside(preparedWorkspacePath, sourceWorkspacePath) ||
    isPathInside(sourceWorkspacePath, preparedWorkspacePath)
  );
}

type MutablePreparedBaselineTimings = {
  -readonly [Key in keyof PreparedBaselineTimings]: PreparedBaselineTimings[Key];
};

function createEmptyPreparedBaselineTimings(): MutablePreparedBaselineTimings {
  return {
    total_ms: 0,
    cache_lookup_ms: 0,
    cache_restore_ms: 0,
    copy_source_ms: 0,
    clean_git_ms: 0,
    size_scan_ms: 0,
    cache_save_ms: 0,
  };
}

async function measurePreparedBaselineTiming<T>(
  timings: MutablePreparedBaselineTimings,
  key: Exclude<keyof PreparedBaselineTimings, "total_ms">,
  operation: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await operation();
  } finally {
    timings[key] += Date.now() - startedAt;
  }
}

function finishPreparedBaselineTimings(
  timings: MutablePreparedBaselineTimings,
  startedAt: number,
): PreparedBaselineTimings {
  return {
    ...timings,
    total_ms: Date.now() - startedAt,
  };
}

function sanitizeCacheLabel(label: string): string {
  const sanitized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return sanitized || PreparedBaselineDefaults.DefaultLabel;
}

function shortCacheKey(cacheKey: string): string {
  return cacheKey.slice(0, PreparedBaselineDefaults.ShortCacheKeyLength);
}

function failure(
  preparedWorkspacePath: string,
  timings: MutablePreparedBaselineTimings,
  startedAt: number,
  checks: PreparedBaselineCheck[],
  check: PreparedBaselineCheck,
): PreparedBaselineFailure {
  return {
    ok: false,
    prepared_workspace_path: preparedWorkspacePath,
    cache_hit: false,
    checks: [...checks, check],
    timings_ms: finishPreparedBaselineTimings(timings, startedAt),
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
