import type { ResolvedShiptestConfig } from "../config/schema.js";
import type { RunPlan, RunPlanItem } from "./types.js";

export function createRunPlan(options: {
  readonly config: ResolvedShiptestConfig;
  readonly benchmarkIds?: readonly string[] | undefined;
  readonly modelIds?: readonly string[] | undefined;
}): RunPlan {
  const benchmarkFilter = new Set(options.benchmarkIds ?? []);
  const modelFilter = new Set(options.modelIds ?? []);
  const allModelIds = new Set(options.config.models.map((model) => model.id));
  for (const benchmarkId of benchmarkFilter) {
    if (!options.config.benchmarks.some((benchmark) => benchmark.id === benchmarkId)) {
      throw new Error(`Unknown benchmark id: ${benchmarkId}`);
    }
  }
  for (const modelId of modelFilter) {
    if (!allModelIds.has(modelId)) {
      throw new Error(`Unknown model id: ${modelId}`);
    }
  }

  const modelById = new Map(options.config.models.map((model) => [model.id, model]));
  const items: RunPlanItem[] = [];
  const warnings: string[] = [];
  if (options.config.shiptest_runner.prepared_baseline.cache) {
    warnings.push(
      "Prepared baseline cache is created after environment.setup. Include formatters, code generation, or other normalization commands there so cached baselines stay clean for model verification.",
    );
  }
  for (const benchmark of options.config.benchmarks) {
    if (benchmarkFilter.size > 0 && !benchmarkFilter.has(benchmark.id)) {
      continue;
    }
    if (benchmark.benchmark_runs > 1) {
      warnings.push(
        `Benchmark '${benchmark.id}' configures ${benchmark.benchmark_runs} benchmark runs; this run command currently executes one run per benchmark/model.`,
      );
    }
    const benchmarkModelIds = benchmark.models ?? options.config.models.map((model) => model.id);
    for (const modelId of benchmarkModelIds) {
      if (modelFilter.size > 0 && !modelFilter.has(modelId)) {
        continue;
      }
      const model = modelById.get(modelId);
      if (!model) {
        throw new Error(`Unknown model id for benchmark '${benchmark.id}': ${modelId}`);
      }
      items.push({ benchmark, model });
    }
  }

  if (items.length === 0) {
    throw new Error("Run plan did not select any benchmark/model pairs.");
  }

  return {
    default_model_ids:
      options.config.defaults.run.models ?? options.config.models.map((model) => model.id),
    items,
    warnings,
  };
}

export function formatRunPlan(plan: RunPlan): string {
  const benchmarkTasks = new Map<string, string>();
  const modelsByBenchmark = new Map<string, string[]>();
  const selectedModelIds: string[] = [];
  for (const item of plan.items) {
    benchmarkTasks.set(item.benchmark.id, item.benchmark.task);
    appendUnique(modelsByBenchmark, item.benchmark.id, item.model.id);
    if (!selectedModelIds.includes(item.model.id)) {
      selectedModelIds.push(item.model.id);
    }
  }
  const benchmarkLines = [...benchmarkTasks.entries()].map(([benchmarkId, task]) => {
    const selectedModels = modelsByBenchmark.get(benchmarkId) ?? [];
    return `- ${benchmarkId}  ${task}  models: ${formatList(selectedModels)}`;
  });

  return [
    "ShipTest run plan",
    "",
    `Benchmarks: ${benchmarkLines.length}`,
    `Selected models: ${formatList(selectedModelIds)}`,
    "",
    "Benchmarks:",
    ...benchmarkLines.slice(0, 20),
    ...(benchmarkLines.length > 20 ? [`... (+${benchmarkLines.length - 20} more)`] : []),
    "",
    `Benchmark/model pairs: ${plan.items.length}`,
  ].join("\n");
}

function appendUnique(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key) ?? [];
  if (!list.includes(value)) {
    list.push(value);
  }
  map.set(key, list);
}

function formatList(values: readonly string[]): string {
  if (values.length <= 5) {
    return values.join(", ");
  }
  return `${values.slice(0, 5).join(", ")}, ... (+${values.length - 5} more)`;
}
