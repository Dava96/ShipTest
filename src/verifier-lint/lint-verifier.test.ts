import { describe, expect, it } from "vitest";

import { loadShiptestConfigContext } from "../config/load-config.js";
import { createShiptestConfigFixture } from "../test-support/shiptest-config-fixture.js";
import { VerifierLintCheckCode } from "./check-codes.js";
import { formatVerifierLintResult, lintVerifier } from "./lint-verifier.js";
import type { VerifierLintResult } from "./types.js";

describe("lintVerifier", () => {
  it("reports advisory warnings for risky hidden verifier patterns", async () => {
    const fixture = await createShiptestConfigFixture({
      benchmarks: [
        {
          id: "replay-risky",
          type: "replay_change",
          base_commit: "abc123",
          reference_solution: { patch: "hidden/solution.patch" },
          task: "tasks/replay-risky.md",
          evaluation: {
            command: "npm test -- tests/hidden/replay-risky.test.ts",
            hidden_files: [
              {
                shiptest_path: "hidden/replay-risky.test.ts",
                repository_path: "tests/hidden/replay-risky.test.ts",
                write_mode: "create_new",
              },
            ],
          },
        },
      ],
      files: {
        "tasks/replay-risky.md": "Fix the risky behavior.\n",
        "hidden/solution.patch": "",
        "hidden/replay-risky.test.ts": `test("risky verifier", async () => {
  await fetch("https://api.example.test/check");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(true).toBe(true);
});
`,
      },
    });
    const context = await loadShiptestConfigContext(fixture.configPath);

    const result = await lintVerifier(context);

    expect(result.status).toBe("warnings");
    expect(warningCodes(result)).toEqual(
      expect.arrayContaining([
        VerifierLintCheckCode.ExternalNetworkReference,
        VerifierLintCheckCode.FlakinessPatternDetected,
        VerifierLintCheckCode.FlakinessRunsLow,
        VerifierLintCheckCode.HiddenOnlyScoringCommand,
        VerifierLintCheckCode.WeakNegativeCoverage,
      ]),
    );
    expect(JSON.stringify(result)).not.toContain("https://api.example.test/check");
    expect(formatVerifierLintResult(result)).toContain("Manual checklist");
  });

  it("passes when replay verifier checks are wired and repeated flake runs are configured", async () => {
    const fixture = await createShiptestConfigFixture({
      benchmarks: [
        {
          id: "replay-good",
          type: "replay_change",
          base_commit: "abc123",
          reference_solution: { patch: "hidden/solution.patch" },
          replay_validation: { flakiness_runs: 3 },
          task: "tasks/replay-good.md",
          evaluation: {
            command: "npm run typecheck && npm test -- tests/hidden/replay-good.test.ts",
            hidden_files: [
              {
                shiptest_path: "hidden/replay-good.test.ts",
                repository_path: "tests/hidden/replay-good.test.ts",
                write_mode: "create_new",
              },
            ],
          },
        },
      ],
      files: {
        "tasks/replay-good.md": "Fix the behavior.\n",
        "hidden/solution.patch": "",
        "hidden/replay-good.test.ts": `test("regression", () => {
  expect("fixed").toBe("fixed");
  expect("fixed").not.toBe("bug");
});
`,
      },
    });
    const context = await loadShiptestConfigContext(fixture.configPath);

    const result = await lintVerifier(context);

    expect(result.status).toBe("passed");
    expect(warningCodes(result)).toEqual([]);
    expect(result.benchmark_results[0]?.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: VerifierLintCheckCode.HiddenVerifierConfigured,
          severity: "pass",
        }),
        expect.objectContaining({
          code: VerifierLintCheckCode.FlakinessRunsConfigured,
          severity: "pass",
        }),
      ]),
    );
  });

  it("treats implementation benchmarks without hidden verifiers as informational", async () => {
    const fixture = await createShiptestConfigFixture();
    const context = await loadShiptestConfigContext(fixture.configPath);

    const result = await lintVerifier(context);

    expect(result.status).toBe("passed");
    expect(result.benchmark_results[0]?.checks).toContainEqual(
      expect.objectContaining({
        code: VerifierLintCheckCode.HiddenVerifierMissing,
        severity: "info",
      }),
    );
  });

  it("warns when hidden patch reset may erase implementation changes", async () => {
    const fixture = await createShiptestConfigFixture({
      benchmarks: [
        {
          id: "replay-reset-risk",
          type: "replay_change",
          base_commit: "abc123",
          reference_solution: { patch: "hidden/solution.patch" },
          task: "tasks/replay-reset-risk.md",
          evaluation: {
            command: "npm test",
            hidden_patches: [
              {
                shiptest_path: "hidden/verifier.patch",
                reset_touched_paths_before_apply: true,
              },
            ],
            hidden_patch_policy: "advanced_allow_collision_risk",
          },
        },
      ],
      files: {
        "tasks/replay-reset-risk.md": "Fix the behavior.\n",
        "hidden/solution.patch": "",
        "hidden/verifier.patch": `diff --git a/src/lib.ts b/src/lib.ts
--- a/src/lib.ts
+++ b/src/lib.ts
@@ -1 +1 @@
-export const value = "old";
+export const value = "new";
`,
      },
    });
    const context = await loadShiptestConfigContext(fixture.configPath);

    const result = await lintVerifier(context);

    expect(warningCodes(result)).toContain(
      VerifierLintCheckCode.PatchResetTouchesImplementationPaths,
    );
    expect(
      result.benchmark_results[0]?.checks.find(
        (check) => check.code === VerifierLintCheckCode.PatchResetTouchesImplementationPaths,
      ),
    ).toMatchObject({ paths: ["src/lib.ts"] });
  });
});

function warningCodes(result: VerifierLintResult): string[] {
  return result.benchmark_results
    .flatMap((benchmarkResult) => benchmarkResult.checks)
    .filter((check) => check.severity === "warning")
    .map((check) => check.code)
    .sort();
}
