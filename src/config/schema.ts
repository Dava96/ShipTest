import { z } from "zod";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const positiveInteger = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const id = nonEmptyString.regex(idPattern, {
  message:
    "IDs must start with a letter or number and only contain letters, numbers, dots, underscores, and hyphens",
});

export const EnvironmentSchema = z
  .object({
    mode: z.enum(["single", "workload"]),
    source: z.enum(["local", "dockerfile_target", "docker_image", "devcontainer", "compose"]),
    dockerfile: nonEmptyString.optional(),
    target: nonEmptyString.optional(),
    image: nonEmptyString.optional(),
    compose_file: nonEmptyString.optional(),
    service: nonEmptyString.optional(),
    setup: z.array(nonEmptyString).default([]),
    test: z.array(nonEmptyString).min(1),
    secrets: z
      .object({
        setup: z.array(nonEmptyString).default([]),
        evaluation: z.array(nonEmptyString).default([]),
      })
      .strict()
      .prefault({}),
  })
  .strict();

export const SnapshotSchema = z
  .object({
    strategy: z.enum(["materialized_checkout", "git_archive"]).default("materialized_checkout"),
    lfs: z.enum(["detect", "required", "ignore"]).default("detect"),
    submodules: z.enum(["fail_if_present", "recursive", "ignore"]).default("fail_if_present"),
    strip_real_git_metadata: z.literal(true).default(true),
  })
  .strict()
  .prefault({});

export const ShiptestRunnerSchema = z
  .object({
    synthetic_git: z.boolean().default(true),
    validated_baseline: z
      .object({
        enabled: z.literal(true).default(true),
        cache: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
    command_output: z
      .object({
        head_lines: positiveInteger.max(10_000).default(120),
        tail_lines: positiveInteger.max(10_000).default(120),
        max_artifact_bytes: positiveInteger.max(1_000_000_000).default(10_000_000),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({});

export const LimitsSchema = z
  .object({
    max_runtime_minutes: positiveInteger.max(24 * 60).default(30),
    max_turns: positiveInteger.max(10_000).default(40),
    max_tool_calls: positiveInteger.max(100_000).default(200),
    max_total_tokens: positiveInteger.max(100_000_000).default(350_000),
    max_estimated_cost_usd: z.number().positive().optional(),
  })
  .strict()
  .prefault({});

export const ModelSchema = z
  .object({
    id,
    provider: z.enum(["openai", "anthropic", "openai_compatible"]),
    model: nonEmptyString,
    base_url: z.url().optional(),
  })
  .strict()
  .superRefine((model, context) => {
    if (model.provider === "openai_compatible" && !model.base_url) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "openai_compatible models must define base_url",
      });
    }
  });

export const AgentContextSchema = z
  .object({
    exclude_paths: z.array(nonEmptyString).default([]),
    instruction_files: z.array(nonEmptyString).default([]),
  })
  .strict()
  .prefault({});

export const HiddenEvaluationFileSchema = z
  .object({
    from: nonEmptyString,
    to: nonEmptyString,
  })
  .strict();

export const EvaluationSchema = z
  .object({
    clean_room: z.literal(true).default(true),
    hidden_evaluation_files: z.array(HiddenEvaluationFileSchema).default([]),
    hidden_evaluation_patches: z.array(nonEmptyString).default([]),
    hidden_evaluation_patch_policy: z.literal("advanced_allow_collision_risk").optional(),
    command: nonEmptyString,
    dependency_changes: z.enum(["allow", "warn", "fail"]).default("warn"),
    rerun_setup_on_dependency_change: z.boolean().default(true),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (
      evaluation.hidden_evaluation_patches.length > 0 &&
      !evaluation.hidden_evaluation_patch_policy
    ) {
      context.addIssue({
        code: "custom",
        path: ["hidden_evaluation_patch_policy"],
        message:
          "hidden_evaluation_patches require hidden_evaluation_patch_policy: advanced_allow_collision_risk",
      });
    }
  });

export const BenchmarkSchema = z
  .object({
    id,
    type: z.enum(["replay_change", "implementation"]),
    base_commit: nonEmptyString.optional(),
    task: nonEmptyString,
    attempts: positiveInteger.max(1_000).default(1),
    models: z.array(id).optional(),
    agent_context: AgentContextSchema,
    evaluation: EvaluationSchema,
  })
  .strict()
  .superRefine((benchmark, context) => {
    if (benchmark.type === "replay_change") {
      if (!benchmark.base_commit) {
        context.addIssue({
          code: "custom",
          path: ["base_commit"],
          message: "replay_change benchmarks must define base_commit",
        });
      }
      if (
        benchmark.evaluation.hidden_evaluation_files.length === 0 &&
        benchmark.evaluation.hidden_evaluation_patches.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["evaluation"],
          message:
            "replay_change benchmarks must define hidden_evaluation_files or hidden_evaluation_patches",
        });
      }
    }
  });

export const ShiptestConfigSchema = z
  .object({
    version: z.literal(1),
    project: z
      .object({
        name: nonEmptyString,
        repo: nonEmptyString,
      })
      .strict(),
    environment: EnvironmentSchema,
    snapshot: SnapshotSchema,
    shiptest_runner: ShiptestRunnerSchema,
    limits: LimitsSchema,
    models: z.array(ModelSchema).min(1),
    benchmarks: z.array(BenchmarkSchema).min(1),
  })
  .strict()
  .superRefine((config, context) => {
    addDuplicateIdIssues(config.models, "models", context);
    addDuplicateIdIssues(config.benchmarks, "benchmarks", context);

    const modelIds = new Set(config.models.map((model) => model.id));
    for (const [benchmarkIndex, benchmark] of config.benchmarks.entries()) {
      for (const [modelIndex, modelId] of (benchmark.models ?? []).entries()) {
        if (!modelIds.has(modelId)) {
          context.addIssue({
            code: "custom",
            path: ["benchmarks", benchmarkIndex, "models", modelIndex],
            message: `Unknown model reference: ${modelId}`,
          });
        }
      }
    }
  });

function addDuplicateIdIssues(
  items: readonly { readonly id: string }[],
  path: "models" | "benchmarks",
  context: z.RefinementCtx,
): void {
  const seen = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const firstIndex = seen.get(item.id);
    if (firstIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: [path, index, "id"],
        message: `Duplicate ${path.slice(0, -1)} id '${item.id}' already used at ${path}[${firstIndex}]`,
      });
    } else {
      seen.set(item.id, index);
    }
  }
}

export type ShiptestConfig = z.input<typeof ShiptestConfigSchema>;
export type ResolvedShiptestConfig = z.output<typeof ShiptestConfigSchema>;
export type BenchmarkType = ResolvedShiptestConfig["benchmarks"][number]["type"];
