import { describe, expect, it } from "vitest";

import { ShiptestConfigSchema } from "../config/schema.js";
import { createRunPlan, formatRunPlan } from "./plan.js";

describe("run plan", () => {
  it("uses default models and benchmark model overrides", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: [
        { id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" },
        { id: "sonnet", provider: "anthropic", model: "claude" },
      ],
      defaults: {
        run: { models: ["gpt-5.5", "sonnet"] },
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: [
        { id: "invoice", type: "implementation", task: ".shiptest/tasks/invoice.md" },
        {
          id: "legacy-auth",
          type: "implementation",
          task: ".shiptest/tasks/auth.md",
          models: ["gpt-5.5"],
        },
      ],
    });

    const plan = createRunPlan({ config });

    expect(plan.items.map((item) => `${item.benchmark.id}/${item.model.id}`)).toEqual([
      "invoice/gpt-5.5",
      "invoice/sonnet",
      "legacy-auth/gpt-5.5",
    ]);
    expect(formatRunPlan(plan)).toContain("Agent runs: 3");
    expect(formatRunPlan(plan)).toContain("Default models: gpt-5.5, sonnet");
  });

  it("reports warnings, truncates long lists, and falls back to all models without defaults", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: Array.from({ length: 6 }, (_, index) => ({
        id: `model-${index + 1}`,
        provider: "openai-codex",
        model: `model-${index + 1}`,
      })),
      defaults: {
        run: {},
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: Array.from({ length: 21 }, (_, index) => ({
        id: `benchmark-${index + 1}`,
        type: "implementation" as const,
        task: `.shiptest/tasks/${index + 1}.md`,
        attempts: index === 0 ? 2 : 1,
      })),
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
      "Benchmark 'benchmark-1' configures 2 attempts; this run command currently executes one agent run per benchmark/model.",
    ]);
    expect(output).toContain(
      "Default models: model-1, model-2, model-3, model-4, model-5, ... (+1 more)",
    );
    expect(output).toContain("... (+1 more)");
  });

  it("rejects unknown filters and empty plans", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: [{ id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" }],
      defaults: {
        run: { models: ["gpt-5.5"] },
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: [{ id: "invoice", type: "implementation", task: ".shiptest/tasks/invoice.md" }],
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
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: [{ id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" }],
      defaults: {
        run: { models: ["gpt-5.5"] },
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: [{ id: "invoice", type: "implementation", task: ".shiptest/tasks/invoice.md" }],
    });
    const [benchmark] = config.benchmarks;
    if (!benchmark) {
      throw new Error("expected benchmark");
    }
    const uncheckedConfig = {
      ...config,
      benchmarks: [{ ...benchmark, models: ["missing"] }],
    };

    expect(() => createRunPlan({ config: uncheckedConfig })).toThrow(
      "Unknown model id for benchmark 'invoice': missing",
    );
  });

  it("throws when filters remove all benchmark/model pairs", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: [
        { id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" },
        { id: "sonnet", provider: "anthropic", model: "claude" },
      ],
      defaults: {
        run: { models: ["gpt-5.5"] },
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: [
        {
          id: "invoice",
          type: "implementation",
          task: ".shiptest/tasks/invoice.md",
          models: ["gpt-5.5"],
        },
      ],
    });

    expect(() => createRunPlan({ config, modelIds: ["sonnet"] })).toThrow(
      "Run plan did not select any benchmark/model pairs.",
    );
  });

  it("filters benchmarks and models", () => {
    const config = ShiptestConfigSchema.parse({
      version: 1,
      project: { name: "fixture", repo: "." },
      repository_environment: { validation_commands: { required: ["npm test"] } },
      models: [
        { id: "gpt-5.5", provider: "openai-codex", model: "gpt-5.5" },
        { id: "sonnet", provider: "anthropic", model: "claude" },
      ],
      defaults: {
        run: { models: ["gpt-5.5", "sonnet"] },
        limits: {},
        agent_context: {},
        evaluation: { scoring_command: "npm test" },
      },
      benchmarks: [
        { id: "invoice", type: "implementation", task: ".shiptest/tasks/invoice.md" },
        { id: "tax", type: "implementation", task: ".shiptest/tasks/tax.md" },
      ],
    });

    const plan = createRunPlan({ config, benchmarkIds: ["invoice"], modelIds: ["sonnet"] });

    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.benchmark.id).toBe("invoice");
    expect(plan.items[0]?.model.id).toBe("sonnet");
  });
});
