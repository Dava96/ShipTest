import type { CheckSeverity } from "../checks/severity.js";

export const DoctorCheckCode = {
  AdvisoryValidationFailed: "DOCTOR_ADVISORY_VALIDATION_FAILED",
  AdvisoryValidationPassed: "DOCTOR_ADVISORY_VALIDATION_PASSED",
  BaselinePrepared: "DOCTOR_BASELINE_PREPARED",
  BenchmarkStarted: "DOCTOR_BENCHMARK_STARTED",
  CacheUsed: "DOCTOR_CACHE_USED",
  EnvironmentUnsupported: "DOCTOR_ENVIRONMENT_UNSUPPORTED",
  OutputPathUnsafe: "DOCTOR_OUTPUT_PATH_UNSAFE",
  RequiredValidationFailed: "DOCTOR_REQUIRED_VALIDATION_FAILED",
  RequiredValidationPassed: "DOCTOR_REQUIRED_VALIDATION_PASSED",
  SetupFailed: "DOCTOR_SETUP_FAILED",
  SetupPassed: "DOCTOR_SETUP_PASSED",
  SnapshotBuilt: "DOCTOR_SNAPSHOT_BUILT",
  SnapshotFailed: "DOCTOR_SNAPSHOT_FAILED",
} as const;

export type DoctorCheckCode = (typeof DoctorCheckCode)[keyof typeof DoctorCheckCode];

export interface DoctorCheck {
  readonly code: DoctorCheckCode;
  readonly severity: CheckSeverity;
  readonly message: string;
  readonly paths?: readonly string[];
}
