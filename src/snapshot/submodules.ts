import path from "node:path";

import { SubmoduleHandling } from "../config/schema-values.js";
import { pathExists } from "../utils/filesystem.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import { defaultGitOperations, type GitOperations } from "./git.js";
import type { SnapshotCheck } from "./types.js";

export async function handleSubmodules(
  stagingCheckoutPath: string,
  handling: SubmoduleHandling,
  gitOperations: GitOperations = defaultGitOperations,
): Promise<SnapshotCheck[]> {
  const checks: SnapshotCheck[] = [];
  const hasSubmodules = await pathExists(path.join(stagingCheckoutPath, ".gitmodules"));
  if (!hasSubmodules) {
    return [
      {
        code: SnapshotCheckCode.SubmodulesAbsent,
        severity: SnapshotCheckSeverity.Pass,
        message: "No Git submodules detected.",
        paths: [],
      },
    ];
  }

  if (handling === SubmoduleHandling.FailIfDetected) {
    return [
      {
        code: SnapshotCheckCode.SubmodulesDetected,
        severity: SnapshotCheckSeverity.Error,
        message: `Git submodules were detected, but snapshot.submodule_handling is ${SubmoduleHandling.FailIfDetected}.`,
        paths: [".gitmodules"],
      },
    ];
  }

  if (handling === SubmoduleHandling.LeaveUncheckedOut) {
    return [
      {
        code: SnapshotCheckCode.SubmodulesLeftUncheckedOut,
        severity: SnapshotCheckSeverity.Warning,
        message: "Git submodules were detected and left unchecked out by configuration.",
        paths: [".gitmodules"],
      },
    ];
  }

  try {
    await gitOperations.git(["submodule", "update", "--init", "--recursive"], stagingCheckoutPath);
    checks.push({
      code: SnapshotCheckCode.SubmodulesCheckedOut,
      severity: SnapshotCheckSeverity.Pass,
      message: "Git submodules checked out recursively.",
      paths: [".gitmodules"],
    });
  } catch (error) {
    checks.push({
      code: SnapshotCheckCode.SubmoduleCheckoutFailed,
      severity: SnapshotCheckSeverity.Error,
      message: error instanceof Error ? error.message : String(error),
      paths: [".gitmodules"],
    });
  }

  return checks;
}
