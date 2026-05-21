#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";

import { Command } from "commander";

import { runPiJsonAgentAttempt } from "./agent/pi-json-harness.js";
import { ShiptestConfigError } from "./config/errors.js";
import { loadShiptestConfigContext } from "./config/load-config.js";
import { resolveConfigRelativePath } from "./config/paths.js";
import type { ResolvedShiptestConfig } from "./config/schema.js";
import { runDoctor } from "./doctor/run-doctor.js";
import { runCleanRoomEvaluation } from "./evaluation/clean-room-evaluator.js";
import { formatDirtyStateError, getGitDirtyState } from "./run/git-state.js";
import {
  checkPiModelAvailability,
  formatMissingPiModelsMessage,
} from "./run/model-availability.js";
import { createRunPlan, formatRunPlan } from "./run/plan.js";
import { regenerateReport, runShiptest } from "./run/run.js";
import { createSnapshotManifest } from "./snapshot/manifest.js";
import type { Submission } from "./submission/types.js";

const program = new Command();

program
  .name("shiptest")
  .description("Evaluate AI coding models on private repositories")
  .version("0.1.0");

program
  .command("run")
  .description("Run configured ShipTest benchmarks and write a local report")
  .option("-c, --config <path>", "Path to shiptest.yaml")
  .option("--benchmark <ids...>", "Benchmark id filter; supports comma-separated values")
  .option("--model <ids...>", "Model id filter; supports comma-separated values")
  .option("--output <path>", "Run output directory")
  .option("--pi <path>", "Pi executable", "pi")
  .option("--pi-args <json>", "JSON array of arguments to pass before ShipTest Pi arguments")
  .option("--yes", "Run without confirmation")
  .option("--draft", "Run against local working-tree state and mark results non-reproducible")
  .option("--concurrency <count>", "Maximum concurrently running model attempts")
  .option("--model-attempts <count>", "Number of repeated attempts per benchmark/model pair")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      readonly benchmark?: string[];
      readonly concurrency?: string;
      readonly config?: string;
      readonly draft?: boolean;
      readonly json?: boolean;
      readonly model?: string[];
      readonly modelAttempts?: string;
      readonly output?: string;
      readonly pi: string;
      readonly piArgs?: string;
      readonly yes?: boolean;
    }) => {
      const context = await loadShiptestConfigContext(options.config);
      const benchmarkIds = parseListOption(options.benchmark);
      const modelIds = parseListOption(options.model);
      const plan = createRunPlan({ config: context.config, benchmarkIds, modelIds });
      const piExecutableArgs = parseJsonStringArrayOption(options.piArgs, "--pi-args");
      const concurrency = parseOptionalPositiveIntegerOption(options.concurrency, "--concurrency");
      const modelAttempts = parseOptionalPositiveIntegerOption(
        options.modelAttempts,
        "--model-attempts",
      );
      const resolvedConcurrency = concurrency ?? context.config.runner.concurrency;
      const resolvedModelAttempts = modelAttempts ?? context.config.runner.model_attempts;
      if (!options.draft) {
        const projectRootPath = resolveConfigRelativePath(
          context.configDir,
          context.config.project.repo,
        );
        const dirtyState = await getGitDirtyState(projectRootPath);
        if (!dirtyState.clean) {
          throw new Error(formatDirtyStateError(dirtyState));
        }
      }
      const modelAvailabilityWarning = await getModelAvailabilityWarning({
        models: uniqueModels(plan.items.map((item) => item.model)),
        piExecutable: options.pi,
        piExecutableArgs,
      });

      if (!options.json) {
        console.log(formatRunPlan(plan));
        console.log(`Model attempts per benchmark/model: ${resolvedModelAttempts}`);
        console.log(`Max active attempts: ${resolvedConcurrency}`);
        for (const warning of plan.warnings) {
          console.log(`⚠ ${warning}`);
        }
        if (resolvedConcurrency > 1) {
          console.log(
            `⚠ Running ${resolvedConcurrency} attempts concurrently may increase provider rate-limit errors and token spend.`,
          );
        }
        if (modelAvailabilityWarning) {
          console.log(`⚠ ${modelAvailabilityWarning}`);
        }
      } else if (modelAvailabilityWarning) {
        console.error(modelAvailabilityWarning);
      }

      if (!options.yes && !options.json) {
        const confirmed = await confirmPrompt("Proceed? [y/N] ");
        if (!confirmed) {
          console.log("ShipTest run status: cancelled");
          return;
        }
      }

      const result = await runShiptest({
        ...(options.config ? { configPath: options.config } : {}),
        ...(benchmarkIds ? { benchmarkIds } : {}),
        ...(modelIds ? { modelIds } : {}),
        ...(options.output ? { runRootPath: path.resolve(options.output) } : {}),
        ...(concurrency === undefined ? {} : { concurrency }),
        ...(modelAttempts === undefined ? {} : { modelAttempts }),
        draft: options.draft ?? false,
        piExecutable: options.pi,
        piExecutableArgs,
        ...(options.json
          ? {}
          : {
              onProgress: (message) => {
                console.log(message);
              },
            }),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`ShipTest run status: ${result.status}`);
        console.log(
          `Results: ${path.join(options.output ?? path.join(".shiptest", "runs", result.run_id), "results.json")}`,
        );
        console.log(
          `Report: ${path.join(options.output ?? path.join(".shiptest", "runs", result.run_id), "report.html")}`,
        );
      }
    },
  );

program
  .command("report")
  .description("Regenerate the static HTML report for a ShipTest run")
  .requiredOption("--run <path>", "Path to a .shiptest/runs/<run-id> directory")
  .option("--json", "Print machine-readable JSON")
  .action(async (options: { readonly run: string; readonly json?: boolean }) => {
    const reportPath = await regenerateReport(path.resolve(options.run));
    if (options.json) {
      console.log(JSON.stringify({ ok: true, report: reportPath }, null, 2));
    } else {
      console.log(`ShipTest report written: ${reportPath}`);
    }
  });

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
  .command("run-agent")
  .description("Run one model attempt with the default Pi JSON agent harness")
  .requiredOption("--prepared-baseline <path>", "Path to a prepared baseline workspace")
  .requiredOption("--workspace <path>", "Agent workspace to create")
  .requiredOption("--artifacts <path>", "Directory for agent artifacts")
  .option("-c, --config <path>", "Path to shiptest.yaml")
  .option("--benchmark <id>", "Benchmark id to run")
  .option("--model <id>", "Model id from shiptest.yaml")
  .option("--pi <path>", "Pi executable", "pi")
  .option("--pi-args <json>", "JSON array of arguments to pass before ShipTest Pi arguments")
  .option("--overwrite", "Overwrite the agent workspace if it exists")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      readonly artifacts: string;
      readonly benchmark?: string;
      readonly config?: string;
      readonly json?: boolean;
      readonly model?: string;
      readonly overwrite?: boolean;
      readonly pi: string;
      readonly piArgs?: string;
      readonly preparedBaseline: string;
      readonly workspace: string;
    }) => {
      const context = await loadShiptestConfigContext(options.config);
      const benchmark = selectBenchmark(context.config.benchmarks, options.benchmark);
      const model = selectModel(context.config.models, benchmark.models, options.model);
      const result = await runPiJsonAgentAttempt({
        preparedBaselinePath: path.resolve(options.preparedBaseline),
        agentWorkspacePath: path.resolve(options.workspace),
        configDir: context.configDir,
        benchmark,
        model,
        limits: benchmark.limits,
        artifactsDir: path.resolve(options.artifacts),
        overwrite: options.overwrite ?? false,
        piExecutable: options.pi,
        piExecutableArgs: parseJsonStringArrayOption(options.piArgs, "--pi-args"),
      });

      if (options.json) {
        console.log(JSON.stringify(toCliAgentRunResult(result), null, 2));
      } else {
        console.log(`ShipTest agent attempt: ${result.status}`);
        for (const signal of result.signals) {
          console.log(`- ${signal.severity}: ${signal.id} ${signal.message}`);
        }
        if (result.submission) {
          console.log(`Changed files: ${result.submission.changed_files.length}`);
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

function toCliAgentRunResult(result: Awaited<ReturnType<typeof runPiJsonAgentAttempt>>): unknown {
  return {
    ok: result.ok,
    status: result.status,
    signals: result.signals,
    telemetry: result.telemetry,
    agent_workspace_path: result.agent_workspace_path,
    artifacts: result.artifacts,
    ...(result.submission
      ? {
          submission: {
            changed_files: result.submission.changed_files,
            is_empty: result.submission.is_empty,
          },
        }
      : {}),
  };
}

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

function selectModel(
  models: readonly ResolvedShiptestConfig["models"][number][],
  benchmarkModelIds: readonly string[] | undefined,
  modelId?: string,
): ResolvedShiptestConfig["models"][number] {
  const allowedModelIds = benchmarkModelIds ?? models.map((model) => model.id);
  const candidates = models.filter((model) => allowedModelIds.includes(model.id));
  if (modelId) {
    const model = candidates.find((candidate) => candidate.id === modelId);
    if (!model) {
      throw new Error(`Unknown or unavailable model id for benchmark: ${modelId}`);
    }
    return model;
  }
  if (candidates.length !== 1) {
    throw new Error("--model is required when the benchmark can run multiple models.");
  }
  const [model] = candidates;
  if (!model) {
    throw new Error("No model is available for benchmark.");
  }
  return model;
}

async function getModelAvailabilityWarning(options: {
  readonly models: readonly ResolvedShiptestConfig["models"][number][];
  readonly piExecutable: string;
  readonly piExecutableArgs: readonly string[];
}): Promise<string | undefined> {
  try {
    const result = await checkPiModelAvailability(options);
    return result.ok ? undefined : formatMissingPiModelsMessage(result);
  } catch (error) {
    return `Could not verify configured models with \`pi --list-models\`: ${formatError(error)}`;
  }
}

function uniqueModels(
  models: readonly ResolvedShiptestConfig["models"][number][],
): readonly ResolvedShiptestConfig["models"][number][] {
  const byId = new Map<string, ResolvedShiptestConfig["models"][number]>();
  for (const model of models) {
    byId.set(model.id, model);
  }
  return [...byId.values()];
}

function parseListOption(values: readonly string[] | undefined): string[] | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }
  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

async function confirmPrompt(prompt: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(prompt);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    readline.close();
  }
}

function parseJsonStringArrayOption(value: string | undefined, optionName: string): string[] {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${optionName} must be a JSON array of strings.`);
  }
  return parsed;
}

function parseOptionalPositiveIntegerOption(
  value: string | undefined,
  optionName: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
