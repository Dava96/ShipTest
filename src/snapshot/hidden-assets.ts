import path from "node:path";

import { pathExists } from "../utils/filesystem.js";
import { SnapshotCheckCode, SnapshotCheckSeverity } from "./check-codes.js";
import type { BuildSnapshotOptions, SnapshotCheck } from "./types.js";

export async function verifyHiddenShiptestAssetPaths(options: {
  readonly agentSnapshotPath: string;
  readonly sourceRepoPath: string;
  readonly shiptestConfigDir: string;
  readonly evaluation: BuildSnapshotOptions["evaluation"];
  readonly additionalHiddenShiptestPaths?: readonly string[] | undefined;
}): Promise<SnapshotCheck[]> {
  const hiddenAssetRepositoryPaths = hiddenShiptestAssetRepositoryPaths({
    sourceRepoPath: options.sourceRepoPath,
    shiptestConfigDir: options.shiptestConfigDir,
    evaluation: options.evaluation,
    additionalHiddenShiptestPaths: options.additionalHiddenShiptestPaths ?? [],
  });

  const visiblePaths: string[] = [];
  for (const repositoryPath of hiddenAssetRepositoryPaths) {
    if (await pathExists(path.join(options.agentSnapshotPath, repositoryPath))) {
      visiblePaths.push(repositoryPath);
    }
  }

  if (visiblePaths.length === 0) {
    return [
      {
        code: SnapshotCheckCode.HiddenShiptestAssetsAbsent,
        severity: SnapshotCheckSeverity.Pass,
        message: "Hidden ShipTest evaluation assets are absent from the agent snapshot.",
        paths: [],
      },
    ];
  }

  return [
    {
      code: SnapshotCheckCode.HiddenEvaluationShiptestPathVisible,
      severity: SnapshotCheckSeverity.Error,
      message: "Hidden ShipTest evaluation assets are visible in the agent snapshot.",
      paths: visiblePaths,
    },
  ];
}

function hiddenShiptestAssetRepositoryPaths(options: {
  readonly sourceRepoPath: string;
  readonly shiptestConfigDir: string;
  readonly evaluation: BuildSnapshotOptions["evaluation"];
  readonly additionalHiddenShiptestPaths: readonly string[];
}): string[] {
  const sourceRepoPath = path.resolve(options.sourceRepoPath);
  const assetPaths = [
    ...options.evaluation.hidden_evaluation_files.map((file) => file.shiptest_path),
    ...options.evaluation.hidden_evaluation_directories.map((directory) => directory.shiptest_path),
    ...options.evaluation.hidden_evaluation_patches.map((patch) => patch.shiptest_path),
    ...options.additionalHiddenShiptestPaths,
  ];

  return assetPaths
    .map((assetPath) => path.resolve(options.shiptestConfigDir, assetPath))
    .map((assetPath) => path.relative(sourceRepoPath, assetPath))
    .filter(
      (relativePath) =>
        relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath),
    )
    .map((relativePath) => relativePath.replaceAll(path.sep, "/"))
    .sort();
}
