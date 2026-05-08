import { z } from "zod";

import {
  BenchmarkType,
  CommandsRunIn,
  DependencyChangePolicy,
  GitLfsHandling,
  HiddenEvaluationDirectoryWriteMode,
  HiddenEvaluationFileWriteMode,
  HiddenEvaluationPatchPolicy,
  ModelProvider,
  RepositoryEnvironmentSource,
  SchemaLimits,
  SnapshotStrategy,
  SubmoduleHandling,
} from "./schema-values.js";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const positiveInteger = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const id = nonEmptyString.regex(idPattern, {
  message:
    "IDs must start with a letter or number and only contain letters, numbers, dots, underscores, and hyphens",
});

export const RepositoryEnvironmentSchema = z
  .object({
    commands_run_in: z
      .enum([CommandsRunIn.ShiptestEnvironment, CommandsRunIn.RepositoryEnvironment])
      .default(CommandsRunIn.ShiptestEnvironment),
    source: z
      .enum([
        RepositoryEnvironmentSource.Local,
        RepositoryEnvironmentSource.DockerfileTarget,
        RepositoryEnvironmentSource.DockerImage,
        RepositoryEnvironmentSource.Devcontainer,
        RepositoryEnvironmentSource.Compose,
        RepositoryEnvironmentSource.Scripts,
      ])
      .default(RepositoryEnvironmentSource.Local),
    dockerfile_path: nonEmptyString.optional(),
    dockerfile_target: nonEmptyString.optional(),
    image: nonEmptyString.optional(),
    compose_file: nonEmptyString.optional(),
    service: nonEmptyString.optional(),
    devcontainer_path: nonEmptyString.optional(),
    setup_commands: z.array(nonEmptyString).default([]),
    validation_commands: z
      .object({
        required: z.array(nonEmptyString).min(1),
        advisory: z.array(nonEmptyString).default([]),
      })
      .strict(),
    teardown_commands: z.array(nonEmptyString).default([]),
    required_secrets: z
      .object({
        setup: z.array(nonEmptyString).default([]),
        evaluation: z.array(nonEmptyString).default([]),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .superRefine((environment, context) => {
    requireFieldsForSource(environment, context);
  });

export const SnapshotSchema = z
  .object({
    strategy: z
      .enum([SnapshotStrategy.SanitizedCopy, SnapshotStrategy.GitArchive])
      .default(SnapshotStrategy.SanitizedCopy),
    git_lfs_handling: z
      .enum([
        GitLfsHandling.FailOnPointers,
        GitLfsHandling.DownloadLfsFiles,
        GitLfsHandling.AllowPointerFiles,
      ])
      .default(GitLfsHandling.FailOnPointers),
    submodule_handling: z
      .enum([
        SubmoduleHandling.FailIfDetected,
        SubmoduleHandling.CheckoutRecursive,
        SubmoduleHandling.LeaveUncheckedOut,
      ])
      .default(SubmoduleHandling.FailIfDetected),
    strip_real_git_metadata: z.literal(true).default(true),
  })
  .strict()
  .prefault({});

export const ShiptestRunnerSchema = z
  .object({
    clean_git_repo: z
      .object({
        enabled: z.literal(true).default(true),
      })
      .strict()
      .prefault({}),
    prepared_baseline: z
      .object({
        enabled: z.literal(true).default(true),
        cache: z.boolean().default(true),
      })
      .strict()
      .prefault({}),
  })
  .strict()
  .prefault({});

export const LimitsSchema = z
  .object({
    max_runtime_minutes: positiveInteger
      .max(SchemaLimits.MaxRuntimeMinutesMax)
      .default(SchemaLimits.MaxRuntimeMinutesDefault),
    max_turns: positiveInteger.max(SchemaLimits.MaxTurnsMax).default(SchemaLimits.MaxTurnsDefault),
    max_tool_calls: positiveInteger
      .max(SchemaLimits.MaxToolCallsMax)
      .default(SchemaLimits.MaxToolCallsDefault),
    max_total_tokens: positiveInteger
      .max(SchemaLimits.MaxTotalTokensMax)
      .default(SchemaLimits.MaxTotalTokensDefault),
    max_estimated_cost_usd: z.number().positive().optional(),
  })
  .strict()
  .prefault({});

export const ModelSchema = z
  .object({
    id,
    provider: z.enum([
      ModelProvider.OpenAi,
      ModelProvider.Anthropic,
      ModelProvider.OpenAiCompatible,
    ]),
    model: nonEmptyString,
    base_url: z.url().optional(),
  })
  .strict()
  .superRefine((model, context) => {
    if (model.provider === ModelProvider.OpenAiCompatible && !model.base_url) {
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
    write_mode: z.enum([
      HiddenEvaluationFileWriteMode.CreateNew,
      HiddenEvaluationFileWriteMode.ReplaceExisting,
      HiddenEvaluationFileWriteMode.CreateOrReplace,
    ]),
  })
  .strict();

export const HiddenEvaluationDirectorySchema = z
  .object({
    shiptest_path: nonEmptyString,
    repository_path: nonEmptyString,
    write_mode: z.enum([
      HiddenEvaluationDirectoryWriteMode.CreateNew,
      HiddenEvaluationDirectoryWriteMode.ReplaceExisting,
      HiddenEvaluationDirectoryWriteMode.MergeWithoutOverwrite,
      HiddenEvaluationDirectoryWriteMode.MergeAndReplace,
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
    hidden_evaluation_patch_policy: z
      .literal(HiddenEvaluationPatchPolicy.AdvancedAllowCollisionRisk)
      .optional(),
    scoring_command: nonEmptyString,
    dependency_changes: z
      .enum([
        DependencyChangePolicy.Allow,
        DependencyChangePolicy.Warn,
        DependencyChangePolicy.Fail,
      ])
      .default(DependencyChangePolicy.Warn),
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
    type: z.enum([BenchmarkType.ReplayChange, BenchmarkType.Implementation]),
    base_commit: nonEmptyString.optional(),
    task: nonEmptyString,
    attempts: positiveInteger.max(SchemaLimits.BenchmarkAttemptsMax).default(1),
    models: z.array(id).optional(),
    agent_context: AgentContextSchema,
    evaluation: EvaluationSchema,
  })
  .strict()
  .superRefine((benchmark, context) => {
    if (benchmark.type === BenchmarkType.ReplayChange) {
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
    version: z.literal(SchemaLimits.ConfigSchemaVersion),
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

function requireFieldsForSource(
  environment: {
    readonly source: RepositoryEnvironmentSource;
    readonly compose_file?: string | undefined;
    readonly devcontainer_path?: string | undefined;
    readonly dockerfile_path?: string | undefined;
    readonly dockerfile_target?: string | undefined;
    readonly image?: string | undefined;
    readonly service?: string | undefined;
  },
  context: z.RefinementCtx,
): void {
  const requiredFieldsBySource = {
    [RepositoryEnvironmentSource.Compose]: ["compose_file", "service"],
    [RepositoryEnvironmentSource.Devcontainer]: ["devcontainer_path"],
    [RepositoryEnvironmentSource.DockerImage]: ["image"],
    [RepositoryEnvironmentSource.DockerfileTarget]: ["dockerfile_path", "dockerfile_target"],
    [RepositoryEnvironmentSource.Local]: [],
    [RepositoryEnvironmentSource.Scripts]: [],
  } as const;

  for (const field of requiredFieldsBySource[environment.source]) {
    if (!environment[field]) {
      context.addIssue({
        code: "custom",
        path: [field],
        message: `source ${environment.source} requires ${field}`,
      });
    }
  }
}

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
