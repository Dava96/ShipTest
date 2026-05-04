export type { ShiptestConfigContext } from "./config/load-config.js";
export { loadShiptestConfig, loadShiptestConfigContext } from "./config/load-config.js";
export type {
  BenchmarkType,
  ResolvedShiptestConfig,
  ShiptestConfig,
} from "./config/schema.js";
export { ShiptestConfigSchema } from "./config/schema.js";
export type {
  AttemptResult,
  BenchmarkResult,
  CommandResult,
  EvaluationResult,
  EvaluationStatus,
  HumanReviewResult,
  HumanReviewStatus,
  ModelResult,
  ShiptestRunnerResult,
  ShiptestRunResult,
  SnapshotResult,
} from "./results/types.js";
export { buildSnapshot } from "./snapshot/build-snapshot.js";
export type {
  BuildSnapshotOptions,
  SnapshotBuildResult,
  SnapshotCheck,
  SnapshotCheckSeverity,
  SnapshotManifest,
  SnapshotManifestFile,
} from "./snapshot/types.js";

export const SHIPTEST_PROJECT_NAME = "ShipTest" as const;
