import { cp, mkdir, rm } from "node:fs/promises";
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

  const ref = options.base_commit ?? "HEAD";
  await git(["clone", "--no-checkout", options.source_repo_path, stagingCheckoutPath]);
  await git(["checkout", "--detach", ref], stagingCheckoutPath);

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
    await applyAgentContextExclusions(agentSnapshotPath, options.agent_context.exclude_paths),
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
    })),
  );

  const sourceCommit = await resolveCommit(stagingCheckoutPath, "HEAD");
  const sourceTree = await resolveTree(stagingCheckoutPath, "HEAD");
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
