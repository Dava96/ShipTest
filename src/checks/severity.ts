export const CheckSeverity = {
  Error: "error",
  Pass: "pass",
  Warning: "warning",
} as const;

export type CheckSeverity = (typeof CheckSeverity)[keyof typeof CheckSeverity];
