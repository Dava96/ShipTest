import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runShellCommand } from "./run-command.js";

async function tempCwd(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "shiptest-command-"));
}

describe("runShellCommand", () => {
  it("captures command output and exit code", async () => {
    const result = await runShellCommand({
      command: 'node -e "console.log(process.cwd())"',
      cwd: await tempCwd(),
      maxOutputBytes: 1_000,
    });

    expect(result.exit_code).toBe(0);
    expect(result.stdout.trim()).toContain("shiptest-command-");
    expect(result.stderr).toBe("");
    expect(result.stdout_truncated).toBe(false);
  });

  it("caps stdout and stderr", async () => {
    const result = await runShellCommand({
      command:
        "node -e \"process.stdout.write('x'.repeat(20)); process.stderr.write('y'.repeat(20))\"",
      cwd: await tempCwd(),
      maxOutputBytes: 5,
    });

    expect(result).toMatchObject({
      stdout: "xxxxx",
      stderr: "yyyyy",
      stdout_truncated: true,
      stderr_truncated: true,
    });
  });
});
