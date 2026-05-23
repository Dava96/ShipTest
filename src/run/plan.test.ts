import { describe, expect, it } from "vitest";

import {
  benchmark,
  createResolvedShiptestConfig,
  model,
} from "../test-support/shiptest-config-fixture.js";
import { createRunPlan, formatRunPlan } from "./plan.js";

describe("run plan", () => {
  it("uses default models and benchmark model overrides", () => {
    const config = createResolvedShiptestConfig({
      models: [model("gpt-5.5"), model("sonnet")],
      defaultModels: ["gpt-5.5", "sonnet"],
      benchmarks: [benchmark("invoice"), benchmark("legacy-auth", { models: ["gpt-5.5"] })],
    });

    const plan = createRunPlan({ config });

    expect(
      plan.items.map((item) => `${item.benchmark.id}/${item.baseCommit.slug}/${item.model.id}`),
    ).toEqual(["invoice/head/gpt-5.5", "invoice/head/sonnet", "legacy-auth/head/gpt-5.5"]);
    expect(formatRunPlan(plan)).toContain("Benchmark/base-commit/model pairs: 3");
    expect(formatRunPlan(plan)).toContain("Default models: gpt-5.5, sonnet");
    expect(plan.warnings).toContain(
      "Prepared baseline cache is created after repository_environment.setup_commands. Include formatters, code generation, or other normalization commands there so cached baselines stay clean for model verification.",
    );
  });

  it("reports warnings, truncates long lists, and falls back to all models without defaults", () => {
    const formatRunPlanPreviewLimit = 20;
    const modelCountExceedingPreviewLimit = 6;
    const benchmarkCountExceedingPreviewLimit = formatRunPlanPreviewLimit + 1;

    const config = createResolvedShiptestConfig({
      models: Array.from({ length: modelCountExceedingPreviewLimit }, (_, index) =>
        model(`model-${index + 1}`),
      ),
      defaultModels: "omit",
      benchmarks: Array.from({ length: benchmarkCountExceedingPreviewLimit }, (_, index) =>
        benchmark(`benchmark-${index + 1}`, {
          task: `.shiptest/tasks/${index + 1}.md`,
          attempts: index === 0 ? 2 : 1,
        }),
      ),
    });

    const plan = createRunPlan({ config });
    const output = formatRunPlan(plan);

    expect(plan.default_model_ids).toEqual([
      "model-1",
      "model-2",
      "model-3",
      "model-4",
      "model-5",
      "model-6",
    ]);
    expect(plan.warnings).toEqual([
      "Prepared baseline cache is created after repository_environment.setup_commands. Include formatters, code generation, or other normalization commands there so cached baselines stay clean for model verification.",
      "Benchmark 'benchmark-1' configures 2 attempts; this run command currently executes one agent run per benchmark/model.",
    ]);
    expect(output).toContain(
      "Default models: model-1, model-2, model-3, model-4, model-5, ... (+1 more)",
    );
    expect(output).toContain("... (+1 more)");
  });

  it("rejects unknown filters and empty plans", () => {
    const config = createResolvedShiptestConfig({
      models: [model("gpt-5.5")],
      benchmarks: [benchmark("invoice")],
    });

    expect(() => createRunPlan({ config, benchmarkIds: ["missing"] })).toThrow(
      "Unknown benchmark id: missing",
    );
    expect(() => createRunPlan({ config, modelIds: ["missing"] })).toThrow(
      "Unknown model id: missing",
    );
    expect(() => createRunPlan({ config, modelIds: ["gpt-5.5"], benchmarkIds: [] })).not.toThrow();
    expect(() => createRunPlan({ config, modelIds: [] })).not.toThrow();
  });

  it("rejects benchmark model references that are missing from an unchecked config", () => {
    const config = createResolvedShiptestConfig({
      models: [model("gpt-5.5")],
      benchmarks: [benchmark("invoice")],
    });
    const [selectedBenchmark] = config.benchmarks;
    if (!selectedBenchmark) {
      throw new Error("expected benchmark");
    }
    const uncheckedConfig = {
      ...config,
      benchmarks: [{ ...selectedBenchmark, models: ["missing"] }],
    };

    expect(() => createRunPlan({ config: uncheckedConfig })).toThrow(
      "Unknown model id for benchmark 'invoice': missing",
    );
  });

  it("throws when filters remove all benchmark/model pairs", () => {
    const config = createResolvedShiptestConfig({
      models: [model("gpt-5.5"), model("sonnet")],
      benchmarks: [benchmark("invoice", { models: ["gpt-5.5"] })],
    });

    expect(() => createRunPlan({ config, modelIds: ["sonnet"] })).toThrow(
      "Run plan did not select any benchmark/model pairs.",
    );
  });

  it("filters benchmarks and models", () => {
    const config = createResolvedShiptestConfig({
      models: [model("gpt-5.5"), model("sonnet")],
      defaultModels: ["gpt-5.5", "sonnet"],
      benchmarks: [benchmark("invoice"), benchmark("tax")],
    });

    const plan = createRunPlan({ config, benchmarkIds: ["invoice"], modelIds: ["sonnet"] });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.benchmark.id).toBe("invoice");
    expect(plan.items[0]?.model.id).toBe("sonnet");
  });
});
