import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { SnapshotStrategy } from "../config/schema-values.js";
import { git, resolveCommit, resolveTree } from "../utils/git.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import { verifyHiddenShiptestAssetPaths } from "./hidden-assets.js";
import { createLfsPointerCheck, handleGitLfs } from "./lfs.js";
import { createSnapshotManifest } from "./manifest.js";
import { validateSnapshotOutputPathSafety } from "./safety.js";
import { applyAgentContextExclusions, stripRealGitMetadata } from "./sanitizer.js";
import { handleSubmodules } from "./submodules.js";
import type { BuildSnapshotOptions, SnapshotBuildResult, SnapshotCheck } from "./types.js";
import { verifyHiddenEvaluationPaths, verifyNoRealGitMetadata } from "./verify.js";

export async function buildSnapshot(options: BuildSnapshotOptions): Promise<SnapshotBuildResult> {
  const checks: SnapshotCheck[] = [];

  if (options.snapshot.strategy !== SnapshotStrategy.SanitizedCopy) {
    return {
      ok: false,
      checks: [
        {
          code: SnapshotCheckCode.StrategyNotImplemented,
          severity: SnapshotCheckSeverity.Error,
          message: `Snapshot strategy '${options.snapshot.strategy}' is not implemented yet.`,
        },
      ],
    };
  }

  const outputPathSafetyChecks = await validateSnapshotOutputPathSafety({
    outputRootPath: options.output_root_path,
    sourceRepoPath: options.source_repo_path,
  });
  if (outputPathSafetyChecks.length > 0) {
    return {
      ok: false,
      checks: outputPathSafetyChecks,
    };
  }

  const stagingCheckoutPath = path.join(options.output_root_path, "staging-checkout");
  const agentSnapshotPath = path.join(options.output_root_path, "agent-snapshot");
  await rm(options.output_root_path, { force: true, recursive: true });
  await mkdir(options.output_root_path, { recursive: true });

  const snapshotSource = options.source ?? "git_commit";
  if (snapshotSource === "working_tree") {
    await copyGitWorkingTree(options.source_repo_path, stagingCheckoutPath);
  } else {
    const ref = options.base_commit ?? "HEAD";
    await git(["clone", "--no-checkout", options.source_repo_path, stagingCheckoutPath]);
    await git(["checkout", "--detach", ref], stagingCheckoutPath);
  }

  checks.push(
    ...(await handleSubmodules(stagingCheckoutPath, options.snapshot.submodule_handling)),
  );
  checks.push(...(await handleGitLfs(stagingCheckoutPath, options.snapshot.git_lfs_handling)));

  await cp(stagingCheckoutPath, agentSnapshotPath, {
    recursive: true,
    verbatimSymlinks: true,
  });

  checks.push(await stripRealGitMetadata(agentSnapshotPath));
  checks.push(
    await applyAgentContextExclusions(agentSnapshotPath, [
      ".shiptest/**",
      ...activeConfigExclusions(options),
    ]),
  );
  checks.push(await verifyNoRealGitMetadata(agentSnapshotPath));
  checks.push(await createLfsPointerCheck(agentSnapshotPath, options.snapshot.git_lfs_handling));
  checks.push(...(await verifyHiddenEvaluationPaths(agentSnapshotPath, options.evaluation)));
  checks.push(
    ...(await verifyHiddenShiptestAssetPaths({
      agentSnapshotPath,
      sourceRepoPath: options.source_repo_path,
      shiptestConfigDir: options.shiptest_config_dir,
      evaluation: options.evaluation,
      additionalHiddenShiptestPaths: [
        ...(options.shiptest_config_path ? [options.shiptest_config_path] : []),
        ...(options.additional_hidden_shiptest_paths ?? []),
      ],
    })),
  );

  const sourceCommit =
    snapshotSource === "working_tree"
      ? await resolveCommit(options.source_repo_path, "HEAD")
      : await resolveCommit(stagingCheckoutPath, "HEAD");
  const sourceTree =
    snapshotSource === "working_tree"
      ? "working_tree"
      : await resolveTree(stagingCheckoutPath, "HEAD");
  const hasErrors = checks.some((check) => check.severity === SnapshotCheckSeverity.Error);

  if (hasErrors) {
    return {
      ok: false,
      staging_checkout_path: stagingCheckoutPath,
      agent_snapshot_path: agentSnapshotPath,
      checks,
    };
  }

  return {
    ok: true,
    staging_checkout_path: stagingCheckoutPath,
    agent_snapshot_path: agentSnapshotPath,
    manifest: await createSnapshotManifest({
      snapshotPath: agentSnapshotPath,
      sourceCommit,
      sourceTree,
    }),
    checks,
  };
}

function activeConfigExclusions(options: BuildSnapshotOptions): string[] {
  if (!options.shiptest_config_path) {
    return [];
  }
  const relativeConfigPath = path.relative(
    path.resolve(options.source_repo_path),
    path.resolve(options.shiptest_config_path),
  );
  if (
    !relativeConfigPath ||
    relativeConfigPath.startsWith("..") ||
    path.isAbsolute(relativeConfigPath)
  ) {
    return [];
  }
  return [relativeConfigPath.replaceAll(path.sep, "/")];
}

async function copyGitWorkingTree(sourceRepoPath: string, destinationPath: string): Promise<void> {
  await mkdir(destinationPath, { recursive: true });
  const result = await git(
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    sourceRepoPath,
  );
  const files = result.stdout.split("\0").filter(Boolean);
  for (const file of files) {
    const sourcePath = path.join(sourceRepoPath, file);
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isFile() && !sourceStat.isSymbolicLink()) {
        continue;
      }
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    const destinationFilePath = path.join(destinationPath, file);
    await mkdir(path.dirname(destinationFilePath), { recursive: true });
    await cp(sourcePath, destinationFilePath, { verbatimSymlinks: true });
  }
}
