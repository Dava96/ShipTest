import type { ConfigIssueCode } from "./issue-codes.js";

export interface ValidationIssue {
  readonly code: ConfigIssueCode;
  readonly path: string;
  readonly message: string;
}

export class ShiptestConfigError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message);
    this.name = "ShiptestConfigError";
    this.issues = issues;
  }
}
