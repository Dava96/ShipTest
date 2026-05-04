import { access, lstat, readdir, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";

export const WalkEntryResult = {
  Continue: "continue",
  Skip: "skip",
} as const;

export type WalkEntryResult = (typeof WalkEntryResult)[keyof typeof WalkEntryResult];

export type WalkEntryVisitor = (entryPath: string, entryName: string) => Promise<WalkEntryResult>;

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

export async function isDirectory(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isDirectory();
  } catch {
    return false;
  }
}

export async function walkFiles(
  rootPath: string,
  visitor: (filePath: string) => Promise<void>,
): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(entryPath, visitor);
    } else if (entry.isFile()) {
      await visitor(entryPath);
    }
  }
}

export async function walkEntries(rootPath: string, visitor: WalkEntryVisitor): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    const result = await visitor(entryPath, entry.name);
    if (result === WalkEntryResult.Skip) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkEntries(entryPath, visitor);
    }
  }
}

export async function safeRemoveDescendant(rootPath: string, targetPath: string): Promise<void> {
  const rootPhysicalPath = await resolvePhysicalPath(path.resolve(rootPath));
  const targetPhysicalPath = await resolvePhysicalPath(path.resolve(targetPath));

  if (
    samePath(rootPhysicalPath, targetPhysicalPath) ||
    !isPathInside(targetPhysicalPath, rootPhysicalPath)
  ) {
    throw new Error(
      `Refusing to remove '${targetPath}' because it is not a descendant of '${rootPath}'.`,
    );
  }

  await rm(targetPath, { force: true, recursive: true });
}

export async function resolvePhysicalPath(inputPath: string): Promise<string> {
  const resolvedPath = path.resolve(inputPath);
  const existingPath = await nearestExistingPath(resolvedPath);
  const physicalExistingPath = await realpath(existingPath);
  const suffix = path.relative(existingPath, resolvedPath);
  return suffix ? path.join(physicalExistingPath, suffix) : physicalExistingPath;
}

export function isFilesystemRoot(inputPath: string): boolean {
  const resolvedPath = normalizeForComparison(path.resolve(inputPath));
  return resolvedPath === normalizeForComparison(path.parse(resolvedPath).root);
}

export function samePath(left: string, right: string): boolean {
  return normalizeForComparison(path.resolve(left)) === normalizeForComparison(path.resolve(right));
}

export function isPathInside(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return (
    relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
  );
}

async function nearestExistingPath(inputPath: string): Promise<string> {
  let currentPath = path.resolve(inputPath);

  while (!(await pathExistsForRealpath(currentPath))) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return currentPath;
    }
    currentPath = parentPath;
  }

  return currentPath;
}

async function pathExistsForRealpath(inputPath: string): Promise<boolean> {
  try {
    await lstat(inputPath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function normalizeForComparison(inputPath: string): string {
  const resolvedPath = path.normalize(inputPath);
  return process.platform === "win32" ? resolvedPath.toLowerCase() : resolvedPath;
}
