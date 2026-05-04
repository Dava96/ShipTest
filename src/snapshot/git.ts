import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const GitCommandLimits = {
  MaxBufferBytes: 10 * 1024 * 1024,
} as const;

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

export async function git(args: readonly string[], cwd?: string): Promise<GitCommandResult> {
  const result = await execFileAsync("git", args, {
    cwd,
    maxBuffer: GitCommandLimits.MaxBufferBytes,
    windowsHide: true,
  });
  return { stdout: result.stdout, stderr: result.stderr };
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
