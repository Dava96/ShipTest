import { readdir } from "node:fs/promises";
import path from "node:path";

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

export type WalkEntryResult = "continue" | "skip";

export type WalkEntryVisitor = (entryPath: string, entryName: string) => Promise<WalkEntryResult>;

export async function walkEntries(rootPath: string, visitor: WalkEntryVisitor): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    const result = await visitor(entryPath, entry.name);
    if (result === "skip") {
      continue;
    }
    if (entry.isDirectory()) {
      await walkEntries(entryPath, visitor);
    }
  }
}
