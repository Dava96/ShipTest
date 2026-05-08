import { spawn } from "node:child_process";

export interface ShellCommandResult {
  readonly command: string;
  readonly exit_code: number | null;
  readonly duration_ms: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdout_truncated: boolean;
  readonly stderr_truncated: boolean;
}

export interface RunShellCommandOptions {
  readonly command: string;
  readonly cwd: string;
  readonly maxOutputBytes: number;
}

export async function runShellCommand(
  options: RunShellCommandOptions,
): Promise<ShellCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const child = spawn(options.command, {
      cwd: options.cwd,
      shell: true,
      windowsHide: true,
    });
    const stdout = createOutputAccumulator(options.maxOutputBytes);
    const stderr = createOutputAccumulator(options.maxOutputBytes);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      resolve({
        command: options.command,
        exit_code: null,
        duration_ms: Date.now() - startedAt,
        stdout: stdout.text(),
        stderr: error.message,
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
      });
    });
    child.on("close", (exitCode) => {
      resolve({
        command: options.command,
        exit_code: exitCode,
        duration_ms: Date.now() - startedAt,
        stdout: stdout.text(),
        stderr: stderr.text(),
        stdout_truncated: stdout.truncated,
        stderr_truncated: stderr.truncated,
      });
    });
  });
}

function createOutputAccumulator(maxBytes: number): {
  readonly truncated: boolean;
  push(chunk: Buffer): void;
  text(): string;
} {
  const chunks: Buffer[] = [];
  let bytes = 0;
  let truncated = false;

  return {
    get truncated() {
      return truncated;
    },
    push(chunk: Buffer) {
      if (bytes >= maxBytes) {
        truncated = true;
        return;
      }
      const remainingBytes = maxBytes - bytes;
      if (chunk.length > remainingBytes) {
        chunks.push(chunk.subarray(0, remainingBytes));
        bytes = maxBytes;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      bytes += chunk.length;
    },
    text() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}
