import type { CheckSeverity } from "../checks/severity.js";

export const DoctorCheckCode = {
  AdvisoryValidationFailed: "DOCTOR_ADVISORY_VALIDATION_FAILED",
  AdvisoryValidationPassed: "DOCTOR_ADVISORY_VALIDATION_PASSED",
  BaselinePrepared: "DOCTOR_BASELINE_PREPARED",
  BenchmarkStarted: "DOCTOR_BENCHMARK_STARTED",
  CacheUsed: "DOCTOR_CACHE_USED",
  EnvironmentUnsupported: "DOCTOR_ENVIRONMENT_UNSUPPORTED",
  OutputPathUnsafe: "DOCTOR_OUTPUT_PATH_UNSAFE",
  ReplayBaseValidationFailedAsExpected: "DOCTOR_REPLAY_BASE_VALIDATION_FAILED_AS_EXPECTED",
  ReplayBaseValidationUnexpectedlyPassed: "DOCTOR_REPLAY_BASE_VALIDATION_UNEXPECTEDLY_PASSED",
  ReplayHiddenPayloadApplied: "DOCTOR_REPLAY_HIDDEN_PAYLOAD_APPLIED",
  ReplayHiddenPayloadFailed: "DOCTOR_REPLAY_HIDDEN_PAYLOAD_FAILED",
  ReplayHiddenVerifierTouchedPathsReset: "DOCTOR_REPLAY_HIDDEN_VERIFIER_TOUCHED_PATHS_RESET",
  ReplayReferencePatchApplyFailed: "DOCTOR_REPLAY_REFERENCE_PATCH_APPLY_FAILED",
  ReplayReferenceValidationFailed: "DOCTOR_REPLAY_REFERENCE_VALIDATION_FAILED",
  ReplayReferenceValidationPassed: "DOCTOR_REPLAY_REFERENCE_VALIDATION_PASSED",
  ReplayValidationEnvironmentFailed: "DOCTOR_REPLAY_VALIDATION_ENVIRONMENT_FAILED",
  ReplayVerifierFlaky: "DOCTOR_REPLAY_VERIFIER_FLAKY",
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
