import path from "node:path";

import type { ShiptestConfigContext } from "../config/load-config.js";
import { resolveConfigRelativePath } from "../config/paths.js";
import type { BuildSnapshotOptions } from "./types.js";

export function createBuildSnapshotOptions(options: {
  readonly context: ShiptestConfigContext;
  readonly benchmark_id: string;
  readonly output_root_path: string;
}): BuildSnapshotOptions {
  const benchmark = options.context.config.benchmarks.find(
    (candidate) => candidate.id === options.benchmark_id,
  );

  if (!benchmark) {
    throw new Error(`Unknown benchmark id: ${options.benchmark_id}`);
  }

  const buildOptions = {
    source_repo_path: resolveConfigRelativePath(
      options.context.configDir,
      options.context.config.project.repo,
    ),
    output_root_path: path.resolve(options.output_root_path),
    shiptest_config_dir: options.context.configDir,
    snapshot: options.context.config.snapshot,
    agent_context: benchmark.agent_context,
    evaluation: benchmark.evaluation,
  } satisfies Omit<BuildSnapshotOptions, "base_commit">;

  if (!benchmark.base_commit) {
    return buildOptions;
  }

  return { ...buildOptions, base_commit: benchmark.base_commit };
}
