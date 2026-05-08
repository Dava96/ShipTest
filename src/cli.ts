#!/usr/bin/env node
import path from "node:path";

import { Command } from "commander";

import { ShiptestConfigError } from "./config/errors.js";
import { loadShiptestConfigContext } from "./config/load-config.js";
import { runDoctor } from "./doctor/run-doctor.js";

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

program.parseAsync().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
