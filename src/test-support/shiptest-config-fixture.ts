import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import type { z } from "zod";

import { ShiptestConfigSchema } from "../config/schema.js";

export type ShiptestConfigInput = z.input<typeof ShiptestConfigSchema>;
export type ModelInput = Extract<ShiptestConfigInput["models"], readonly unknown[]>[number];
type GroupedBenchmarksInput = Extract<
  ShiptestConfigInput["benchmarks"],
  { readonly implementation?: unknown }
>;
type ImplementationBenchmarkInput = NonNullable<
  GroupedBenchmarksInput["implementation"]
>[number] & {
  readonly type?: "implementation";
};
type ReplayChangeBenchmarkInput = NonNullable<GroupedBenchmarksInput["replay_change"]>[number] & {
  readonly type: "replay_change";
};
export type BenchmarkInput = ImplementationBenchmarkInput | ReplayChangeBenchmarkInput;
export type ProjectNameFixtureValue = string | "omit";
export type ProjectRepoFixtureValue = string | "omit";

export interface ShiptestConfigInputOptions {
  readonly projectName?: ProjectNameFixtureValue;
  readonly projectRepo?: ProjectRepoFixtureValue;
  readonly environment?: ShiptestConfigInput["environment"];
  readonly runner?: ShiptestConfigInput["runner"];
  readonly models?: readonly ModelInput[];
  readonly defaultModels?: readonly string[] | "omit";
  readonly benchmarks?: readonly BenchmarkInput[];
  readonly scoringCommand?: string;
}

export interface ShiptestConfigFixtureOptions extends ShiptestConfigInputOptions {
  readonly root?: string;
  readonly configSubdir?: string;
  readonly createGitRoot?: boolean;
  readonly files?: Readonly<Record<string, string>>;
}

export interface ShiptestConfigFixture {
  readonly root: string;
  readonly configDir: string;
  readonly configPath: string;
}

export function model(id = "gpt-5.5", overrides: Partial<ModelInput> = {}): ModelInput {
  return {
    id,
    provider: "openai-codex",
    model: id,
    ...overrides,
  };
}

export function benchmark(
  id = "invoice",
  overrides: Partial<ImplementationBenchmarkInput> = {},
): BenchmarkInput {
  return {
    id,
    type: "implementation",
    task: `tasks/${id}.md`,
    ...overrides,
  };
}

export function createShiptestConfigInput(
  options: ShiptestConfigInputOptions = {},
): ShiptestConfigInput {
  const models = options.models ?? [model()];
  const defaultModels =
    options.defaultModels === "omit"
      ? undefined
      : (options.defaultModels ?? [models[0]?.id ?? "gpt-5.5"]);

  return {
    version: 1,
    project: {
      ...(options.projectName === "omit" ? {} : { name: options.projectName ?? "fixture" }),
      ...(options.projectRepo === "omit" ? {} : { repo: options.projectRepo ?? "." }),
    },
    environment: options.environment ?? {
      validate: ["npm test"],
    },
    ...(options.runner === undefined ? {} : { runner: options.runner }),
    models: [...models],
    defaults: {
      ...(defaultModels === undefined ? {} : { models: [...defaultModels] }),
      limits: {},
      agent_view: {},
      evaluation: { command: options.scoringCommand ?? "npm test" },
    },
    benchmarks: groupBenchmarkInputs(options.benchmarks ?? [benchmark()]),
  };
}

function groupBenchmarkInputs(
  benchmarks: readonly BenchmarkInput[],
): ShiptestConfigInput["benchmarks"] {
  return {
    implementation: benchmarks
      .filter((item) => (item.type ?? "implementation") === "implementation")
      .map(({ type: _type, ...item }) => item),
    replay_change: benchmarks
      .filter((item) => item.type === "replay_change")
      .map(({ type: _type, ...item }) => item),
  };
}

export function createResolvedShiptestConfig(options: ShiptestConfigInputOptions = {}) {
  return ShiptestConfigSchema.parse(createShiptestConfigInput(options));
}

export async function createShiptestConfigFixture(
  options: ShiptestConfigFixtureOptions = {},
): Promise<ShiptestConfigFixture> {
  const root =
    options.root ?? path.join(os.tmpdir(), "shiptest-config-fixtures", crypto.randomUUID());
  const configDir = options.configSubdir ? path.join(root, options.configSubdir) : root;
  await mkdir(configDir, { recursive: true });

  if (options.createGitRoot) {
    await mkdir(path.join(root, ".git"), { recursive: true });
  }

  const files = options.files ?? { "tasks/invoice.md": "Task\n" };
  for (const [relativePath, contents] of Object.entries(files)) {
    const filePath = path.join(configDir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }

  const configPath = path.join(configDir, "shiptest.yaml");
  await writeFile(configPath, stringifyYaml(createShiptestConfigInput(options)), "utf8");

  return { root, configDir, configPath };
}
