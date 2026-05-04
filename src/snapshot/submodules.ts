import path from "node:path";

import { defaultGitOperations, type GitOperations } from "./git.js";
import { pathExists } from "./sanitizer.js";
import type { SnapshotCheck } from "./types.js";

export type SubmoduleHandling = "fail_if_detected" | "checkout_recursive" | "leave_unchecked_out";

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
        code: "SNAPSHOT_SUBMODULES_ABSENT",
        severity: "pass",
        message: "No Git submodules detected.",
        paths: [],
      },
    ];
  }

  if (handling === "fail_if_detected") {
    return [
      {
        code: "SNAPSHOT_SUBMODULES_DETECTED",
        severity: "error",
        message:
          "Git submodules were detected, but snapshot.submodule_handling is fail_if_detected.",
        paths: [".gitmodules"],
      },
    ];
  }

  if (handling === "leave_unchecked_out") {
    return [
      {
        code: "SNAPSHOT_SUBMODULES_LEFT_UNCHECKED_OUT",
        severity: "warning",
        message: "Git submodules were detected and left unchecked out by configuration.",
        paths: [".gitmodules"],
      },
    ];
  }

  try {
    await gitOperations.git(["submodule", "update", "--init", "--recursive"], stagingCheckoutPath);
    checks.push({
      code: "SNAPSHOT_SUBMODULES_CHECKED_OUT",
      severity: "pass",
      message: "Git submodules checked out recursively.",
      paths: [".gitmodules"],
    });
  } catch (error) {
    checks.push({
      code: "SNAPSHOT_SUBMODULE_CHECKOUT_FAILED",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
      paths: [".gitmodules"],
    });
  }

  return checks;
}
