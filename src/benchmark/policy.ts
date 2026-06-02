import { BenchmarkType } from "../config/schema-values.js";

export interface BenchmarkTypePolicy {
  readonly label: string;
  readonly requiresRepositoryChanges: boolean;
  readonly requiresBaseCommit: boolean;
  readonly requiresBenchmarkLocalEvaluationCommand: boolean;
  readonly requiresBenchmarkLocalHiddenVerifier: boolean;
  readonly requiresReferenceSolution: boolean;
  readonly emptySubmissionMessage: string;
  readonly emptyPatchMessage: string;
}

export const BenchmarkPolicies = {
  [BenchmarkType.Implementation]: {
    label: "Implementation",
    requiresRepositoryChanges: true,
    requiresBaseCommit: false,
    requiresBenchmarkLocalEvaluationCommand: false,
    requiresBenchmarkLocalHiddenVerifier: false,
    requiresReferenceSolution: false,
    emptySubmissionMessage:
      "Implementation benchmarks require repository changes, but the submission changed no files.",
    emptyPatchMessage: "Implementation benchmarks require a non-empty submission patch.",
  },
  [BenchmarkType.ReplayChange]: {
    label: "Replay-change",
    requiresRepositoryChanges: true,
    requiresBaseCommit: true,
    requiresBenchmarkLocalEvaluationCommand: true,
    requiresBenchmarkLocalHiddenVerifier: true,
    requiresReferenceSolution: true,
    emptySubmissionMessage:
      "Replay-change benchmarks require repository changes, but the submission changed no files.",
    emptyPatchMessage: "Replay-change benchmarks require a non-empty submission patch.",
  },
} satisfies Record<BenchmarkType, BenchmarkTypePolicy>;

export function getBenchmarkPolicy(type: BenchmarkType): BenchmarkTypePolicy {
  return BenchmarkPolicies[type];
}

export function hasHiddenVerifier(evaluation: {
  readonly hidden_evaluation_files?: readonly unknown[] | undefined;
  readonly hidden_evaluation_directories?: readonly unknown[] | undefined;
  readonly hidden_evaluation_patches?: readonly unknown[] | undefined;
}): boolean {
  return (
    (evaluation.hidden_evaluation_files?.length ?? 0) > 0 ||
    (evaluation.hidden_evaluation_directories?.length ?? 0) > 0 ||
    (evaluation.hidden_evaluation_patches?.length ?? 0) > 0
  );
}

export function hasBenchmarkLocalHiddenVerifier(evaluation: {
  readonly hidden_files?: readonly unknown[] | undefined;
  readonly hidden_directories?: readonly unknown[] | undefined;
  readonly hidden_patches?: readonly unknown[] | undefined;
}): boolean {
  return (
    (evaluation.hidden_files?.length ?? 0) > 0 ||
    (evaluation.hidden_directories?.length ?? 0) > 0 ||
    (evaluation.hidden_patches?.length ?? 0) > 0
  );
}
