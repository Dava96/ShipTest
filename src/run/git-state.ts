import { git } from "../utils/git.js";

export interface GitDirtyState {
  readonly clean: boolean;
  readonly entries: readonly string[];
}

export async function getGitDirtyState(repoPath: string): Promise<GitDirtyState> {
  const result = await git(["status", "--porcelain=v1", "--untracked-files=all"], repoPath);
  const entries = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  return { clean: entries.length === 0, entries };
}

export function formatDirtyStateError(state: GitDirtyState): string {
  const previewLimit = 30;
  const preview = state.entries.slice(0, previewLimit).map((entry) => `- ${entry}`);
  const remaining = state.entries.length - preview.length;
  return [
    "Cannot run reproducible benchmark because the repository has uncommitted changes.",
    "",
    "Dirty files:",
    ...preview,
    ...(remaining > 0 ? [`... and ${remaining} more`] : []),
    "",
    "Commit or stash changes, or intentionally run a draft benchmark:",
    "",
    "  shiptest run --draft",
    "",
    "Draft runs are real runs, may spend tokens, and are marked non-reproducible.",
  ].join("\n");
}
