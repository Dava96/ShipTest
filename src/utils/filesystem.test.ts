import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  isDirectory,
  isFile,
  isFilesystemRoot,
  isPathInside,
  pathExists,
  resolvePhysicalPath,
  safeRemoveDescendant,
  samePath,
  WalkEntryResult,
  walkEntries,
  walkFiles,
} from "./filesystem.js";

describe("filesystem utilities", () => {
  it("checks whether paths exist", async () => {
    const root = await createTempDirectory();
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "hello\n", "utf8");

    await expect(pathExists(filePath)).resolves.toBe(true);
    await expect(pathExists(path.join(root, "missing.txt"))).resolves.toBe(false);
  });

  it("checks whether paths are files", async () => {
    const root = await createTempDirectory();
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "hello\n", "utf8");

    await expect(isFile(filePath)).resolves.toBe(true);
    await expect(isFile(root)).resolves.toBe(false);
    await expect(isFile(path.join(root, "missing.txt"))).resolves.toBe(false);
  });

  it("checks whether paths are directories", async () => {
    const root = await createTempDirectory();
    const filePath = path.join(root, "file.txt");
    await writeFile(filePath, "hello\n", "utf8");

    await expect(isDirectory(root)).resolves.toBe(true);
    await expect(isDirectory(filePath)).resolves.toBe(false);
    await expect(isDirectory(path.join(root, "missing"))).resolves.toBe(false);
  });

  it("walks files recursively", async () => {
    const root = await createTempDirectory();
    await mkdir(path.join(root, "nested"), { recursive: true });
    await writeFile(path.join(root, "a.txt"), "a", "utf8");
    await writeFile(path.join(root, "nested", "b.txt"), "b", "utf8");

    const files: string[] = [];
    await walkFiles(root, async (filePath) => {
      files.push(path.relative(root, filePath).replaceAll(path.sep, "/"));
    });

    expect(files.sort()).toEqual(["a.txt", "nested/b.txt"]);
  });

  it("walks entries recursively and supports skipping descendants", async () => {
    const root = await createTempDirectory();
    await mkdir(path.join(root, "included"), { recursive: true });
    await mkdir(path.join(root, "skipped"), { recursive: true });
    await writeFile(path.join(root, "included", "file.txt"), "included", "utf8");
    await writeFile(path.join(root, "skipped", "file.txt"), "skipped", "utf8");

    const entries: string[] = [];
    await walkEntries(root, async (entryPath, entryName) => {
      entries.push(path.relative(root, entryPath).replaceAll(path.sep, "/"));
      return entryName === "skipped" ? WalkEntryResult.Skip : WalkEntryResult.Continue;
    });

    expect(entries.sort()).toEqual(["included", "included/file.txt", "skipped"]);
  });

  it("compares path relationships", async () => {
    const root = await createTempDirectory();
    const child = path.join(root, "child");

    expect(isFilesystemRoot(path.parse(root).root)).toBe(true);
    expect(isFilesystemRoot(root)).toBe(false);
    expect(isPathInside(child, root)).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, child)).toBe(false);
    expect(samePath(root, path.join(root, "."))).toBe(true);
  });

  it("resolves physical paths through the nearest existing parent", async () => {
    const root = await createTempDirectory();
    const missingDescendant = path.join(root, "missing", "nested", "file.txt");

    await expect(resolvePhysicalPath(missingDescendant)).resolves.toBe(
      path.join(await realpath(root), "missing", "nested", "file.txt"),
    );
  });

  it("safely removes descendants but refuses to remove the protected root or outside paths", async () => {
    const root = await createTempDirectory();
    const removableFile = path.join(root, "nested", "file.txt");
    await mkdir(path.dirname(removableFile), { recursive: true });
    await writeFile(removableFile, "delete me", "utf8");

    await safeRemoveDescendant(root, removableFile);
    await expect(stat(removableFile)).rejects.toThrow();

    await expect(safeRemoveDescendant(root, root)).rejects.toThrow(/Refusing to remove/);
    await expect(safeRemoveDescendant(root, path.dirname(root))).rejects.toThrow(
      /Refusing to remove/,
    );
  });
});

async function createTempDirectory(): Promise<string> {
  const root = path.join(os.tmpdir(), "shiptest-filesystem-fixtures", crypto.randomUUID());
  await mkdir(root, { recursive: true });
  return root;
}
