#!/usr/bin/env node
import { Command } from "commander";

import { ShiptestConfigError } from "./config/errors.js";
import { loadShiptestConfigContext } from "./config/load-config.js";

const program = new Command();

program
  .name("shiptest")
  .description("Evaluate AI coding models on private repositories")
  .version("0.1.0");

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
