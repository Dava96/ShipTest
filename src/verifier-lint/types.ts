export type VerifierLintStatus = "passed" | "warnings";
export type VerifierLintCheckSeverity = "pass" | "info" | "warning";

export interface VerifierLintCheck {
  readonly code: string;
  readonly severity: VerifierLintCheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}

export interface VerifierLintChecklistItem {
  readonly id: string;
  readonly prompt: string;
}

export interface VerifierLintBenchmarkResult {
  readonly benchmark_id: string;
  readonly benchmark_type: string;
  readonly status: VerifierLintStatus;
  readonly checks: readonly VerifierLintCheck[];
  readonly checklist: readonly VerifierLintChecklistItem[];
}

export interface VerifierLintResult {
  readonly schema_version: 1;
  readonly status: VerifierLintStatus;
  readonly summary: {
    readonly benchmarks: number;
    readonly warnings: number;
    readonly passes: number;
    readonly info: number;
  };
  readonly benchmark_results: readonly VerifierLintBenchmarkResult[];
}
