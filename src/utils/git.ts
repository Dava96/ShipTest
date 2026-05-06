import { spawn } from "node:child_process";

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export const GitCommandLimits = {
  MaxBufferBytes: 10 * 1024 * 1024,
} as const;

export async function git(
  args: readonly string[],
  cwd?: string,
  input?: string,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, windowsHide: true });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > GitCommandLimits.MaxBufferBytes) {
        child.kill();
        reject(new Error(`Git stdout exceeded ${GitCommandLimits.MaxBufferBytes} bytes.`));
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > GitCommandLimits.MaxBufferBytes) {
        child.kill();
        reject(new Error(`Git stderr exceeded ${GitCommandLimits.MaxBufferBytes} bytes.`));
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (exitCode) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `Git command failed with exit code ${exitCode}.`));
    });

    if (input !== undefined) {
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

export async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  const result = await git(["rev-parse", `${ref}^{commit}`], repoPath);
  return result.stdout.trim();
}

export async function resolveTree(repoPath: string, ref: string): Promise<string> {
  const result = await git(["rev-parse", `${ref}^{tree}`], repoPath);
  return result.stdout.trim();
}

export async function hasGitLfs(): Promise<boolean> {
  try {
    await git(["lfs", "version"]);
    return true;
  } catch {
    return false;
  }
}

export interface GitOperations {
  readonly git: typeof git;
  readonly hasGitLfs: typeof hasGitLfs;
}

export const defaultGitOperations: GitOperations = {
  git,
  hasGitLfs,
};
