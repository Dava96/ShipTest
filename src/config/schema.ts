import { z } from "zod";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const positiveInteger = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const id = nonEmptyString.regex(idPattern, {
  message:
    "IDs must start with a letter or number and only contain letters, numbers, dots, underscores, and hyphens",
});

export const RepositoryEnvironmentSchema = z
  .object({
    execution_mode: z.enum(["single_container", "workload_container"]).default("single_container"),
    source: z
      .enum(["local", "dockerfile_target", "docker_image", "devcontainer", "compose"])
      .default("local"),
    dockerfile_path: nonEmptyString.optional(),
    dockerfile_target: nonEmptyString.optional(),
    image: nonEmptyString.optional(),
    compose_file: nonEmptyString.optional(),
    service: nonEmptyString.optional(),
    setup_commands: z.array(nonEmptyString).default([]),
    validation_commands: z.array(nonEmptyString).min(1),
    required_secrets: z
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
    strategy: z.enum(["sanitized_copy", "git_archive"]).default("sanitized_copy"),
    git_lfs_handling: z
      .enum(["fail_on_pointers", "download_lfs_files", "allow_pointer_files"])
      .default("fail_on_pointers"),
    submodule_handling: z
      .enum(["fail_if_detected", "checkout_recursive", "leave_unchecked_out"])
      .default("fail_if_detected"),
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
    shiptest_path: nonEmptyString,
    repository_path: nonEmptyString,
    write_mode: z.enum(["create_new", "replace_existing", "create_or_replace"]),
  })
  .strict();

export const HiddenEvaluationDirectorySchema = z
  .object({
    shiptest_path: nonEmptyString,
    repository_path: nonEmptyString,
    write_mode: z.enum([
      "create_new",
      "replace_existing",
      "merge_without_overwrite",
      "merge_and_replace",
    ]),
  })
  .strict();

export const HiddenEvaluationPatchSchema = z
  .object({
    shiptest_path: nonEmptyString,
  })
  .strict();

export const EvaluationSchema = z
  .object({
    clean_room: z.literal(true).default(true),
    hidden_evaluation_files: z.array(HiddenEvaluationFileSchema).default([]),
    hidden_evaluation_directories: z.array(HiddenEvaluationDirectorySchema).default([]),
    hidden_evaluation_patches: z.array(HiddenEvaluationPatchSchema).default([]),
    hidden_evaluation_patch_policy: z.literal("advanced_allow_collision_risk").optional(),
    scoring_command: nonEmptyString,
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
        benchmark.evaluation.hidden_evaluation_directories.length === 0 &&
        benchmark.evaluation.hidden_evaluation_patches.length === 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["evaluation"],
          message:
            "replay_change benchmarks must define hidden_evaluation_files, hidden_evaluation_directories, or hidden_evaluation_patches",
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
    repository_environment: RepositoryEnvironmentSchema,
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
