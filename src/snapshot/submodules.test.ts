import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SnapshotCheckCode } from "./check-codes.js";

import { handleSubmodules } from "./submodules.js";

describe("Git submodule snapshot handling", () => {
  it("reports no submodules when .gitmodules is absent", async () => {
    const root = await createTempDirectory();

    await expect(handleSubmodules(root, "fail_if_detected")).resolves.toEqual([
      {
        code: SnapshotCheckCode.SubmodulesAbsent,
        severity: "pass",
        message: "No Git submodules detected.",
        paths: [],
      },
    ]);
  });

  it("returns policy checks when submodules are detected", async () => {
    const root = await createTempDirectory({ withGitModules: true });

    await expect(handleSubmodules(root, "fail_if_detected")).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.SubmodulesDetected, severity: "error" }),
    );
    await expect(handleSubmodules(root, "leave_unchecked_out")).resolves.toContainEqual(
      expect.objectContaining({
        code: SnapshotCheckCode.SubmodulesLeftUncheckedOut,
        severity: "warning",
      }),
    );
  });

  it("returns structured checks for recursive checkout success and failure", async () => {
    const root = await createTempDirectory({ withGitModules: true });

    await expect(
      handleSubmodules(root, "checkout_recursive", {
        git: async () => ({ stdout: "", stderr: "" }),
        hasGitLfs: async () => true,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({ code: SnapshotCheckCode.SubmodulesCheckedOut, severity: "pass" }),
    );

    await expect(
      handleSubmodules(root, "checkout_recursive", {
        git: async () => {
          throw new Error("submodule error");
        },
        hasGitLfs: async () => true,
      }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        code: SnapshotCheckCode.SubmoduleCheckoutFailed,
        message: "submodule error",
        severity: "error",
      }),
    );
  });
});

interface TempDirectoryOptions {
  readonly withGitModules?: boolean;
}

async function createTempDirectory(options: TempDirectoryOptions = {}): Promise<string> {
  const root = path.join(os.tmpdir(), "shiptest-submodule-fixtures", crypto.randomUUID());
  await mkdir(root, { recursive: true });
  if (options.withGitModules) {
    await writeFile(
      path.join(root, ".gitmodules"),
      '[submodule "vendor/example"]\n\tpath = vendor/example\n\turl = https://example.com/vendor/example.git\n',
      "utf8",
    );
  }
  return root;
}
