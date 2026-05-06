import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSnapshotManifest } from "../snapshot/manifest.js";
import { git } from "../utils/git.js";
import { PreparedBaselineCheckCode } from "./check-codes.js";
import {
  createPreparedBaselineCacheKey,
  getPreparedBaselineCacheEntryPath,
  type PreparedBaselineCacheKeyInput,
  prepareBaselineFromWorkspace,
} from "./prepared-baseline.js";

const baseCacheKeyInput: PreparedBaselineCacheKeyInput = {
  snapshot_manifest_sha256: "snapshot",
  repository_environment: { setup_commands: ["npm ci"], validation_commands: ["npm test"] },
  prepared_baseline: { cache: true, enabled: true },
  shiptest_version: "0.1.0",
};

describe("createPreparedBaselineCacheKey", () => {
  it("creates stable keys for equivalent inputs", () => {
    const left = createPreparedBaselineCacheKey(baseCacheKeyInput);
    const right = createPreparedBaselineCacheKey({
      shiptest_version: "0.1.0",
      prepared_baseline: { enabled: true, cache: true },
      repository_environment: { validation_commands: ["npm test"], setup_commands: ["npm ci"] },
      snapshot_manifest_sha256: "snapshot",
    });

    expect(left).toBe(right);
  });

  it("changes keys when relevant inputs change", () => {
    expect(createPreparedBaselineCacheKey(baseCacheKeyInput)).not.toBe(
      createPreparedBaselineCacheKey({ ...baseCacheKeyInput, snapshot_manifest_sha256: "other" }),
    );
  });
});

describe("prepareBaselineFromWorkspace", () => {
  it("creates a prepared baseline with a clean Git repo and metadata", async () => {
    const fixture = await createFixture();

    const result = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: fixture.preparedWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
      cacheRootPath: fixture.cacheRootPath,
      cacheLabel: "Invoice Rounding!",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected prepared baseline to succeed");
    }
    expect(result.cache_hit).toBe(false);
    expect(result.metadata.labels).toEqual(["invoice-rounding"]);
    expect(result.metadata.clean_git_repo).toMatchObject({
      enabled: true,
      branch: "shiptest-baseline",
      baseline_commit: expect.any(String),
    });
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: PreparedBaselineCheckCode.CacheSaved, severity: "pass" }),
    );
    await expect(
      git(["status", "--porcelain"], fixture.preparedWorkspacePath),
    ).resolves.toMatchObject({
      stdout: "",
    });
  });

  it("restores from cache and keeps metadata outside the workspace", async () => {
    const fixture = await createFixture();
    const cacheKeyInput = cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256);

    const first = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: fixture.preparedWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput,
      cacheRootPath: fixture.cacheRootPath,
      cacheLabel: "invoice-rounding",
    });
    expect(first.ok).toBe(true);

    const restoredWorkspacePath = path.join(fixture.rootPath, "restored-prepared-baseline");
    const second = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: restoredWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput,
      cacheRootPath: fixture.cacheRootPath,
      cacheLabel: "tax-edge-case",
    });

    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected cache restore to succeed");
    }
    expect(second.cache_hit).toBe(true);
    expect(second.metadata.labels).toEqual(["invoice-rounding", "tax-edge-case"]);
    await expect(
      readFile(path.join(restoredWorkspacePath, "metadata.json"), "utf8"),
    ).rejects.toThrow();
    await writeFile(
      path.join(restoredWorkspacePath, "src", "index.ts"),
      "export const value = 2;\n",
    );
    await expect(
      git(["rev-parse", second.metadata.clean_git_repo.baseline_commit], restoredWorkspacePath),
    ).resolves.toMatchObject({
      stdout: `${second.metadata.clean_git_repo.baseline_commit}\n`,
    });
    await expect(
      git(["diff", "--name-only", "HEAD"], restoredWorkspacePath),
    ).resolves.toMatchObject({
      stdout: "src/index.ts\n",
    });
  });

  it("fails when the destination exists unless overwrite is enabled", async () => {
    const fixture = await createFixture();
    await mkdir(fixture.preparedWorkspacePath, { recursive: true });

    await expect(
      prepareBaselineFromWorkspace({
        sourceWorkspacePath: fixture.sourceWorkspacePath,
        preparedWorkspacePath: fixture.preparedWorkspacePath,
        snapshotManifest: fixture.snapshotManifest,
        cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
        cacheEnabled: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      checks: [expect.objectContaining({ code: PreparedBaselineCheckCode.DestinationExists })],
    });

    await expect(
      prepareBaselineFromWorkspace({
        sourceWorkspacePath: fixture.sourceWorkspacePath,
        preparedWorkspacePath: fixture.preparedWorkspacePath,
        snapshotManifest: fixture.snapshotManifest,
        cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
        cacheEnabled: false,
        overwrite: true,
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("rejects preparing in place", async () => {
    const fixture = await createFixture();

    await expect(
      prepareBaselineFromWorkspace({
        sourceWorkspacePath: fixture.sourceWorkspacePath,
        preparedWorkspacePath: fixture.sourceWorkspacePath,
        snapshotManifest: fixture.snapshotManifest,
        cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
        cacheEnabled: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      checks: [expect.objectContaining({ code: PreparedBaselineCheckCode.InvalidPaths })],
    });
  });

  it("ignores invalid cache entries and rebuilds from source", async () => {
    const fixture = await createFixture();
    await mkdir(path.join(fixture.cacheRootPath, "prepared-baselines", "bad-entry"), {
      recursive: true,
    });
    await writeFile(
      path.join(fixture.cacheRootPath, "prepared-baselines", "bad-entry", "metadata.json"),
      "not json",
    );

    const result = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: fixture.preparedWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
      cacheRootPath: fixture.cacheRootPath,
      cacheLabel: "invoice-rounding",
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: PreparedBaselineCheckCode.CacheEntryInvalid }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: PreparedBaselineCheckCode.CacheSaved }),
    );
  });

  it("ignores matching cache metadata when the cached workspace is missing", async () => {
    const fixture = await createFixture();
    const cacheKeyInput = cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256);
    const cacheKey = createPreparedBaselineCacheKey(cacheKeyInput);
    const entryPath = getPreparedBaselineCacheEntryPath(
      fixture.cacheRootPath,
      cacheKey,
      "invoice-rounding",
    );
    await mkdir(entryPath, { recursive: true });
    await writeFile(
      path.join(entryPath, "metadata.json"),
      `${JSON.stringify(createMetadataFixture(cacheKey, fixture.snapshotManifest), null, 2)}\n`,
    );

    const result = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: fixture.preparedWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput,
      cacheRootPath: fixture.cacheRootPath,
      cacheLabel: "invoice-rounding",
    });

    expect(result.ok).toBe(true);
    expect(result.cache_hit).toBe(false);
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: PreparedBaselineCheckCode.CacheEntryInvalid }),
    );
  });

  it("fails clearly when cache is enabled without a cache root", async () => {
    const fixture = await createFixture();

    await expect(
      prepareBaselineFromWorkspace({
        sourceWorkspacePath: fixture.sourceWorkspacePath,
        preparedWorkspacePath: fixture.preparedWorkspacePath,
        snapshotManifest: fixture.snapshotManifest,
        cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
        cacheEnabled: true,
      }),
    ).resolves.toMatchObject({
      ok: false,
      checks: [expect.objectContaining({ code: PreparedBaselineCheckCode.CacheRestoreFailed })],
    });
  });

  it("fails clearly when the source workspace is missing", async () => {
    const fixture = await createFixture();

    await expect(
      prepareBaselineFromWorkspace({
        sourceWorkspacePath: path.join(fixture.rootPath, "missing-source"),
        preparedWorkspacePath: fixture.preparedWorkspacePath,
        snapshotManifest: fixture.snapshotManifest,
        cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
        cacheEnabled: false,
      }),
    ).resolves.toMatchObject({
      ok: false,
      checks: [expect.objectContaining({ code: PreparedBaselineCheckCode.SourceMissing })],
    });
  });

  it("continues uncached when saving to cache fails", async () => {
    const fixture = await createFixture();
    const cacheRootFilePath = path.join(fixture.rootPath, "cache-file");
    await writeFile(cacheRootFilePath, "not a directory");

    const result = await prepareBaselineFromWorkspace({
      sourceWorkspacePath: fixture.sourceWorkspacePath,
      preparedWorkspacePath: fixture.preparedWorkspacePath,
      snapshotManifest: fixture.snapshotManifest,
      cacheKeyInput: cacheKeyInputForManifest(fixture.snapshotManifest.manifest_sha256),
      cacheRootPath: cacheRootFilePath,
      cacheLabel: "invoice-rounding",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ cache_hit: false });
    expect(result.checks).toContainEqual(
      expect.objectContaining({ code: PreparedBaselineCheckCode.CacheSaveFailed }),
    );
  });

  it("uses a human-readable cache path while validating by full key", () => {
    const cacheKey = createPreparedBaselineCacheKey(baseCacheKeyInput);

    expect(getPreparedBaselineCacheEntryPath("/cache", cacheKey, "Invoice Rounding!")).toContain(
      `prepared-baselines${path.sep}invoice-rounding--${cacheKey.slice(0, 16)}`,
    );
    expect(getPreparedBaselineCacheEntryPath("/cache", cacheKey, "!!!")).toContain(
      `prepared-baselines${path.sep}prepared-baseline--${cacheKey.slice(0, 16)}`,
    );
    expect(
      path.basename(getPreparedBaselineCacheEntryPath("/cache", cacheKey, "A".repeat(120))),
    ).toHaveLength(98);
  });
});

async function createFixture(): Promise<{
  readonly rootPath: string;
  readonly sourceWorkspacePath: string;
  readonly preparedWorkspacePath: string;
  readonly cacheRootPath: string;
  readonly snapshotManifest: Awaited<ReturnType<typeof createSnapshotManifest>>;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "shiptest-prepared-baseline-"));
  const sourceWorkspacePath = path.join(rootPath, "source");
  await mkdir(path.join(sourceWorkspacePath, "src"), { recursive: true });
  await writeFile(path.join(sourceWorkspacePath, "src", "index.ts"), "export const value = 1;\n");
  const snapshotManifest = await createSnapshotManifest({
    snapshotPath: sourceWorkspacePath,
    sourceCommit: "commit",
    sourceTree: "tree",
  });
  return {
    rootPath,
    sourceWorkspacePath,
    preparedWorkspacePath: path.join(rootPath, "prepared-baseline"),
    cacheRootPath: path.join(rootPath, "cache"),
    snapshotManifest,
  };
}

function cacheKeyInputForManifest(snapshotManifestSha256: string): PreparedBaselineCacheKeyInput {
  return {
    ...baseCacheKeyInput,
    snapshot_manifest_sha256: snapshotManifestSha256,
  };
}

function createMetadataFixture(
  cacheKey: string,
  snapshotManifest: Awaited<ReturnType<typeof createSnapshotManifest>>,
): unknown {
  return {
    schema_version: 1,
    cache_key: cacheKey,
    short_cache_key: cacheKey.slice(0, 16),
    labels: ["invoice-rounding"],
    created_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    shiptest_version: "0.1.0",
    snapshot_manifest_sha256: snapshotManifest.manifest_sha256,
    source_commit: snapshotManifest.source_commit,
    source_tree: snapshotManifest.source_tree,
    file_count: snapshotManifest.files.length,
    size_bytes: 1,
    clean_git_repo: {
      enabled: true,
      branch: "shiptest-baseline",
      baseline_commit: "commit",
    },
  };
}
