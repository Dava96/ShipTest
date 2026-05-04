import path from "node:path";

import {
  isFilesystemRoot,
  isPathInside,
  resolvePhysicalPath,
  samePath,
} from "../utils/filesystem.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import type { SnapshotCheck } from "./types.js";

export interface SnapshotOutputPathSafetyOptions {
  readonly outputRootPath: string;
  readonly sourceRepoPath: string;
  readonly cwd?: string;
}

export async function validateSnapshotOutputPathSafety(
  options: SnapshotOutputPathSafetyOptions,
): Promise<SnapshotCheck[]> {
  const checks: SnapshotCheck[] = [];
  const outputInput = options.outputRootPath;
  const sourceInput = options.sourceRepoPath;
  const cwdInput = options.cwd ?? process.cwd();

  if (!path.isAbsolute(outputInput)) {
    checks.push(createUnsafeOutputPathCheck("snapshot output path must be absolute.", outputInput));
    return checks;
  }

  const outputPath = path.resolve(outputInput);
  const sourcePath = path.resolve(sourceInput);
  const cwdPath = path.resolve(cwdInput);

  const outputPhysicalPath = await resolvePhysicalPath(outputPath);
  const sourcePhysicalPath = await resolvePhysicalPath(sourcePath);
  const cwdPhysicalPath = await resolvePhysicalPath(cwdPath);

  if (isFilesystemRoot(outputPhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be a filesystem root.",
        outputPath,
      ),
    );
  }

  if (samePath(outputPhysicalPath, sourcePhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be the source repository.",
        outputPath,
      ),
    );
  } else if (isPathInside(sourcePhysicalPath, outputPhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be a parent directory of the source repository.",
        outputPath,
      ),
    );
  } else if (isPathInside(outputPhysicalPath, sourcePhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be inside the source repository.",
        outputPath,
      ),
    );
  }

  if (samePath(outputPhysicalPath, cwdPhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be the current working directory.",
        outputPath,
      ),
    );
  } else if (isPathInside(cwdPhysicalPath, outputPhysicalPath)) {
    checks.push(
      createUnsafeOutputPathCheck(
        "snapshot output path must not be a parent directory of the current working directory.",
        outputPath,
      ),
    );
  }

  return checks;
}

function createUnsafeOutputPathCheck(message: string, outputPath: string): SnapshotCheck {
  return {
    code: SnapshotCheckCode.UnsafeOutputPath,
    severity: SnapshotCheckSeverity.Error,
    message: `Unsafe snapshot output path: ${message}`,
    paths: [outputPath],
  };
}
