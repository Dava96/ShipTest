import { CheckSeverity } from "../checks/severity.js";
import { defaultGitOperations, type GitOperations } from "../utils/git.js";
import { type PreparedBaselineCheck, PreparedBaselineCheckCode } from "./check-codes.js";

export const CleanGitRepoDefaults = {
  BaselineBranch: "shiptest-baseline",
  BaselineCommitMessage: "shiptest_baseline",
  UserEmail: "bot@shiptest.local",
  DisabledHooksPath: ".git/shiptest-disabled-hooks",
  UserName: "ShipTest",
} as const;

export interface CleanGitRepoOptions {
  readonly branch?: string;
  readonly commitMessage?: string;
  readonly userEmail?: string;
  readonly userName?: string;
  readonly hooksPath?: string;
  readonly gitOperations?: GitOperations;
}

export interface CleanGitRepoResult {
  readonly ok: boolean;
  readonly branch?: string;
  readonly baseline_commit?: string;
  readonly checks: readonly PreparedBaselineCheck[];
}

export async function initializeCleanGitRepo(
  workspacePath: string,
  options: CleanGitRepoOptions = {},
): Promise<CleanGitRepoResult> {
  const gitOperations = options.gitOperations ?? defaultGitOperations;
  const branch = options.branch ?? CleanGitRepoDefaults.BaselineBranch;
  const commitMessage = options.commitMessage ?? CleanGitRepoDefaults.BaselineCommitMessage;
  const userEmail = options.userEmail ?? CleanGitRepoDefaults.UserEmail;
  const userName = options.userName ?? CleanGitRepoDefaults.UserName;
  const hooksPath = options.hooksPath ?? CleanGitRepoDefaults.DisabledHooksPath;

  try {
    await gitOperations.git(["init", "--initial-branch", branch], workspacePath);
    await gitOperations.git(["config", "user.email", userEmail], workspacePath);
    await gitOperations.git(["config", "user.name", userName], workspacePath);
    await gitOperations.git(["config", "--local", "core.autocrlf", "false"], workspacePath);
    await gitOperations.git(["config", "--local", "core.longpaths", "true"], workspacePath);
    await gitOperations.git(["config", "--local", "core.hooksPath", hooksPath], workspacePath);
    await gitOperations.git(["add", "-A"], workspacePath);
    await gitOperations.git(["commit", "--allow-empty", "-m", commitMessage], workspacePath);

    const baselineCommit = (
      await gitOperations.git(["rev-parse", "HEAD"], workspacePath)
    ).stdout.trim();
    const verificationChecks = await verifyCleanGitRepo(workspacePath, hooksPath, gitOperations);
    const hasVerificationError = verificationChecks.some(
      (check) => check.severity === CheckSeverity.Error,
    );

    return {
      ok: !hasVerificationError,
      branch,
      baseline_commit: baselineCommit,
      checks: [
        {
          code: PreparedBaselineCheckCode.CleanGitRepoInitialized,
          severity: CheckSeverity.Pass,
          message: "Initialized clean Git repo for the prepared baseline.",
        },
        ...verificationChecks,
      ],
    };
  } catch (error) {
    return {
      ok: false,
      checks: [
        {
          code: PreparedBaselineCheckCode.CleanGitRepoInitFailed,
          severity: CheckSeverity.Error,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

async function verifyCleanGitRepo(
  workspacePath: string,
  hooksPath: string,
  gitOperations: GitOperations,
): Promise<PreparedBaselineCheck[]> {
  const remotes = (await gitOperations.git(["remote"], workspacePath)).stdout
    .split(/\r?\n/)
    .filter(Boolean);
  if (remotes.length > 0) {
    return [
      {
        code: PreparedBaselineCheckCode.CleanGitRepoVerificationFailed,
        severity: CheckSeverity.Error,
        message: "Clean Git repo must not contain remotes.",
        paths: remotes,
      },
    ];
  }

  const status = (await gitOperations.git(["status", "--porcelain"], workspacePath)).stdout.trim();
  if (status.length > 0) {
    return [
      {
        code: PreparedBaselineCheckCode.CleanGitRepoVerificationFailed,
        severity: CheckSeverity.Error,
        message: "Clean Git repo baseline commit did not leave a clean working tree.",
      },
    ];
  }

  const configuredHooksPath = (
    await gitOperations.git(["config", "--local", "--get", "core.hooksPath"], workspacePath)
  ).stdout.trim();
  if (configuredHooksPath !== hooksPath) {
    return [
      {
        code: PreparedBaselineCheckCode.CleanGitRepoVerificationFailed,
        severity: CheckSeverity.Error,
        message: "Clean Git repo hooks were not disabled.",
      },
    ];
  }

  return [
    {
      code: PreparedBaselineCheckCode.CleanGitRepoVerified,
      severity: CheckSeverity.Pass,
      message: "Verified clean Git repo has no remotes, disabled hooks, and a clean status.",
    },
  ];
}
