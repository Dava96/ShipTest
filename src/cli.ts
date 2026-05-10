#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";

import { Command } from "commander";

import { ShiptestConfigError } from "./config/errors.js";
import { loadShiptestConfigContext } from "./config/load-config.js";
import type { ResolvedShiptestConfig } from "./config/schema.js";
import { runDoctor } from "./doctor/run-doctor.js";
import { runCleanRoomEvaluation } from "./evaluation/clean-room-evaluator.js";
import { createSnapshotManifest } from "./snapshot/manifest.js";
import type { Submission } from "./submission/types.js";

const program = new Command();

program
  .name("shiptest")
  .description("Evaluate AI coding models on private repositories")
  .version("0.1.0");

program
  .command("doctor")
  .description("Validate snapshot, setup, baseline, and prepared-baseline cache gates")
  .option("-c, --config <path>", "Path to shiptest.yaml")
  .option("--benchmark <id>", "Only run doctor for one benchmark")
  .option("--output <path>", "Doctor output directory", path.join(".shiptest", "doctor"))
  .option("--cache-root <path>", "Prepared baseline cache directory")
  .option("--no-cache", "Do not use existing prepared-baseline cache for this doctor run")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      readonly benchmark?: string;
      readonly cache?: boolean;
      readonly cacheRoot?: string;
      readonly config?: string;
      readonly json?: boolean;
      readonly output: string;
    }) => {
      const context = await loadShiptestConfigContext(options.config);
      const result = await runDoctor(context, {
        outputRootPath: path.resolve(options.output),
        ...(options.cacheRoot ? { cacheRootPath: path.resolve(options.cacheRoot) } : {}),
        ...(options.benchmark ? { benchmarkId: options.benchmark } : {}),
        noCache: options.cache === false,
        ...(options.json
          ? {}
          : {
              onProgress: (event) => {
                const prefix = event.benchmark_id ? `[${event.benchmark_id}] ` : "";
                console.log(`${prefix}${event.message}`);
              },
            }),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`ShipTest doctor ${result.ok ? "passed" : "failed"}.`);
        for (const benchmarkResult of result.benchmark_results) {
          console.log(`${benchmarkResult.ok ? "✓" : "✗"} ${benchmarkResult.benchmark_id}`);
          for (const check of benchmarkResult.checks) {
            if (check.severity !== "pass") {
              console.log(`  ${check.severity === "warning" ? "⚠" : "✗"} ${check.message}`);
            }
          }
        }
      }
      process.exitCode = result.ok ? 0 : 1;
    },
  );

program
  .command("evaluate-patch")
  .description("Run clean-room evaluation for a candidate patch against a prepared baseline")
  .requiredOption("--prepared-baseline <path>", "Path to a prepared baseline workspace")
  .requiredOption("--patch <path>", "Path to candidate patch file")
  .requiredOption("--workspace <path>", "Clean-room evaluation workspace to create")
  .option("-c, --config <path>", "Path to shiptest.yaml")
  .option("--benchmark <id>", "Benchmark id to evaluate")
  .option("--artifacts <path>", "Directory for clean-room evaluation artifacts")
  .option("--overwrite", "Overwrite the evaluation workspace if it exists")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      readonly artifacts?: string;
      readonly benchmark?: string;
      readonly config?: string;
      readonly json?: boolean;
      readonly overwrite?: boolean;
      readonly patch: string;
      readonly preparedBaseline: string;
      readonly workspace: string;
    }) => {
      const context = await loadShiptestConfigContext(options.config);
      const benchmark = selectBenchmark(context.config.benchmarks, options.benchmark);
      const patchPath = path.resolve(options.patch);
      const preparedBaselinePath = path.resolve(options.preparedBaseline);
      const patch = await readFile(patchPath, "utf8");
      const baselineManifest = await createSnapshotManifest({
        snapshotPath: preparedBaselinePath,
        sourceCommit: benchmark.base_commit ?? "manual",
        sourceTree: "manual",
      });
      const submission: Submission = {
        diff: patch,
        changed_files: parsePatchChangedFiles(patch),
        is_empty: patch.length === 0,
        baseline_manifest: baselineManifest,
        workspace_manifest: baselineManifest,
        workspace_diff: {
          added: [],
          modified: [],
          deleted: [],
          unchanged_count: baselineManifest.files.length,
        },
      };

      const result = await runCleanRoomEvaluation({
        preparedBaselinePath,
        evaluationWorkspacePath: path.resolve(options.workspace),
        configDir: context.configDir,
        benchmark,
        repositoryEnvironment: context.config.repository_environment,
        submission,
        ...(options.artifacts ? { artifactsDir: path.resolve(options.artifacts) } : {}),
        overwrite: options.overwrite ?? false,
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`ShipTest clean-room evaluation: ${result.verdict}`);
        console.log(
          `Status: ${result.status}${result.score === undefined ? "" : `, score: ${result.score}`}`,
        );
        for (const signal of result.signals) {
          console.log(`- ${signal.severity}: ${signal.id} (${signal.weight}) ${signal.message}`);
        }
        if (result.commands.length > 0) {
          console.log("Commands:");
          for (const command of result.commands) {
            console.log(`- ${command.exit_code ?? "null"}: ${command.command}`);
          }
        }
      }
      process.exitCode = result.status === "INFRASTRUCTURE_ERROR" ? 1 : 0;
    },
  );

program
  .command("validate")
  .description("Validate a ShipTest configuration file")
  .option("-c, --config <path>", "Path to shiptest.yaml")
  .option("--json", "Print machine-readable JSON")
  .action(async (options: { readonly config?: string; readonly json?: boolean }) => {
    try {
      const context = await loadShiptestConfigContext(options.config);
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              valid: true,
              configPath: context.configPath,
              benchmarkCount: context.config.benchmarks.length,
              modelCount: context.config.models.length,
              config: context.config,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(`ShipTest config is valid: ${context.configPath}`);
      console.log(`Benchmarks: ${context.config.benchmarks.length}`);
      console.log(`Models: ${context.config.models.length}`);
    } catch (error) {
      if (error instanceof ShiptestConfigError) {
        if (options.json) {
          console.log(
            JSON.stringify(
              {
                valid: false,
                errors: error.issues,
              },
              null,
              2,
            ),
          );
        } else {
          console.error(error.message);
          console.error("");
          for (const issue of error.issues) {
            console.error(`${issue.path || "config"}`);
            console.error(`  ${issue.message}`);
          }
        }
        process.exitCode = 1;
        return;
      }

      throw error;
    }
  });

function selectBenchmark(
  benchmarks: readonly ResolvedShiptestConfig["benchmarks"][number][],
  benchmarkId?: string,
): ResolvedShiptestConfig["benchmarks"][number] {
  if (benchmarkId) {
    const benchmark = benchmarks.find((candidate) => candidate.id === benchmarkId);
    if (!benchmark) {
      throw new Error(`Unknown benchmark id: ${benchmarkId}`);
    }
    return benchmark;
  }
  if (benchmarks.length !== 1) {
    throw new Error("--benchmark is required when the config contains multiple benchmarks.");
  }
  const [benchmark] = benchmarks;
  if (!benchmark) {
    throw new Error("Config does not contain any benchmarks.");
  }
  return benchmark;
}

function parsePatchChangedFiles(patch: string): string[] {
  const paths = new Set<string>();
  for (const line of patch.split(/\r?\n/)) {
    const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (!match) {
      continue;
    }
    const [, leftPath, rightPath] = match;
    const repositoryPath = rightPath === "/dev/null" ? leftPath : rightPath;
    if (repositoryPath) {
      paths.add(repositoryPath);
    }
  }
  return [...paths].sort();
}

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
