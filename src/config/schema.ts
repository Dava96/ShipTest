import { z } from "zod";

import { hasBenchmarkLocalHiddenVerifier } from "../benchmark/policy.js";
import {
  BenchmarkType,
  CommandsRunIn,
  DependencyChangePolicy,
  EvaluationPolicyPreset,
  GitLfsHandling,
  HiddenEvaluationDirectoryWriteMode,
  HiddenEvaluationFileWriteMode,
  HiddenEvaluationPatchPolicy,
  ModelProvider,
  RepositoryEnvironmentSource,
  SchemaLimits,
  SnapshotStrategy,
  SubmoduleHandling,
  VerificationCheckKind,
} from "./schema-values.js";

const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const positiveInteger = z.number().int().positive();
const nonEmptyString = z.string().min(1);
const id = nonEmptyString.regex(idPattern, {
  message:
    "IDs must start with a letter or number and only contain letters, numbers, dots, underscores, and hyphens",
});

const ValidationCommandsSchema = z
  .object({
    required: z.array(nonEmptyString).min(1),
    advisory: z.array(nonEmptyString).default([]),
  })
  .strict();

export const EnvironmentSchema = z
  .object({
    setup: z.array(nonEmptyString).default([]),
    validate: z.union([z.array(nonEmptyString).min(1), ValidationCommandsSchema]),
  })
  .strict();

export const RepositoryEnvironmentSchema = z
  .object({
    commands_run_in: z.literal(CommandsRunIn.ShiptestEnvironment),
    source: z.literal(RepositoryEnvironmentSource.Local),
    setup_commands: z.array(nonEmptyString),
    validation_commands: ValidationCommandsSchema,
    teardown_commands: z.array(nonEmptyString),
    required_secrets: z
      .object({
        setup: z.array(nonEmptyString).default([]),
        evaluation: z.array(nonEmptyString).default([]),
      })
      .strict(),
  })
  .strict();

export const WorkspaceSchema = z
  .object({
    lfs: z
      .enum([
        GitLfsHandling.FailOnPointers,
        GitLfsHandling.DownloadLfsFiles,
        GitLfsHandling.AllowPointerFiles,
      ])
      .default(GitLfsHandling.FailOnPointers),
    submodules: z
      .enum([
        SubmoduleHandling.FailIfDetected,
        SubmoduleHandling.CheckoutRecursive,
        SubmoduleHandling.LeaveUncheckedOut,
      ])
      .default(SubmoduleHandling.FailIfDetected),
  })
  .strict()
  .prefault({});

export const SnapshotSchema = z
  .object({
    strategy: z.literal(SnapshotStrategy.SanitizedCopy).default(SnapshotStrategy.SanitizedCopy),
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
  .strict();

export const RunnerSchema = z
  .object({
    concurrency: positiveInteger.default(1),
    model_attempts: positiveInteger.default(1),
  })
  .strict()
  .prefault({});

export const BaselinesSchema = z
  .object({
    cache: z.boolean().default(true),
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
  .strict();

const LimitsShape = {
  max_attempt_mins: positiveInteger
    .max(SchemaLimits.MaxAttemptMinsMax)
    .default(SchemaLimits.MaxAttemptMinsDefault),
  max_turns: positiveInteger.max(SchemaLimits.MaxTurnsMax).default(SchemaLimits.MaxTurnsDefault),
  max_tool_calls: positiveInteger
    .max(SchemaLimits.MaxToolCallsMax)
    .default(SchemaLimits.MaxToolCallsDefault),
  max_total_tokens: positiveInteger
    .max(SchemaLimits.MaxTotalTokensMax)
    .default(SchemaLimits.MaxTotalTokensDefault),
  max_uncached_tokens: positiveInteger.max(SchemaLimits.MaxTotalTokensMax).optional(),
  max_output_tokens: positiveInteger.max(SchemaLimits.MaxTotalTokensMax).optional(),
  max_cache_read_tokens: positiveInteger.max(SchemaLimits.MaxTotalTokensMax).optional(),
  max_estimated_cost_usd: z.number().positive().optional(),
} as const;

export const LimitsSchema = z.object(LimitsShape).strict().prefault({});

export const ModelSchema = z
  .object({
    id,
    provider: nonEmptyString,
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

const ModelListSchema = z.array(ModelSchema).min(1);

const SimpleModelsSchema = z
  .object({
    provider: nonEmptyString,
    include: z.array(nonEmptyString).min(1),
    base_url: z.url().optional(),
  })
  .strict()
  .superRefine((models, context) => {
    if (models.provider === ModelProvider.OpenAiCompatible && !models.base_url) {
      context.addIssue({
        code: "custom",
        path: ["base_url"],
        message: "openai_compatible models must define base_url",
      });
    }
  });

const ModelsSchema = z.union([ModelListSchema, SimpleModelsSchema]);

const AgentContextShape = {
  exclude_paths: z.array(nonEmptyString).default([]),
  instruction_files: z.array(nonEmptyString).default([]),
  load_context_files: z.boolean().default(false),
} as const;

export const AgentContextSchema = z.object(AgentContextShape).strict().prefault({});
export const AgentViewSchema = z.object(AgentContextShape).strict().prefault({});

const PartialLimitsSchema = z.object(LimitsShape).partial().strict();
const PartialAgentViewSchema = z.object(AgentContextShape).partial().strict();

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
    reset_touched_paths_before_apply: z.boolean().default(false),
  })
  .strict();

const EvaluationShape = {
  clean_room: z.literal(true).default(true),
  hidden_evaluation_files: z.array(HiddenEvaluationFileSchema).default([]),
  hidden_evaluation_directories: z.array(HiddenEvaluationDirectorySchema).default([]),
  hidden_evaluation_patches: z.array(HiddenEvaluationPatchSchema).default([]),
  hidden_evaluation_patch_policy: z
    .literal(HiddenEvaluationPatchPolicy.AdvancedAllowCollisionRisk)
    .optional(),
  policy_preset: z
    .enum([
      EvaluationPolicyPreset.ReviewFirst,
      EvaluationPolicyPreset.RiskAverse,
      EvaluationPolicyPreset.TestGate,
    ])
    .default(EvaluationPolicyPreset.ReviewFirst),
  protected_paths: z.array(nonEmptyString).default([]),
  scoring_command: nonEmptyString,
  dependency_changes: z
    .enum([DependencyChangePolicy.Allow, DependencyChangePolicy.Warn, DependencyChangePolicy.Fail])
    .default(DependencyChangePolicy.Warn),
  rerun_setup_on_dependency_change: z.boolean().default(false),
} as const;

const EvaluationInputShape = {
  command: nonEmptyString,
  hidden_files: z.array(HiddenEvaluationFileSchema).default([]),
  hidden_directories: z.array(HiddenEvaluationDirectorySchema).default([]),
  hidden_patches: z.array(HiddenEvaluationPatchSchema).default([]),
  hidden_patch_policy: z.literal(HiddenEvaluationPatchPolicy.AdvancedAllowCollisionRisk).optional(),
  policy_preset: z
    .enum([
      EvaluationPolicyPreset.ReviewFirst,
      EvaluationPolicyPreset.RiskAverse,
      EvaluationPolicyPreset.TestGate,
    ])
    .default(EvaluationPolicyPreset.ReviewFirst),
  protected_paths: z.array(nonEmptyString).default([]),
  dependency_changes: z
    .enum([DependencyChangePolicy.Allow, DependencyChangePolicy.Warn, DependencyChangePolicy.Fail])
    .default(DependencyChangePolicy.Warn),
  rerun_setup_on_dependency_change: z.boolean().default(false),
} as const;

export const EvaluationSchema = z
  .object(EvaluationShape)
  .strict()
  .superRefine((evaluation, context) => {
    addHiddenPatchPolicyIssue(evaluation, context);
  });

const EvaluationInputSchema = z
  .object(EvaluationInputShape)
  .strict()
  .superRefine((evaluation, context) => {
    addHiddenPatchPolicyIssue(
      {
        hidden_evaluation_patches: evaluation.hidden_patches,
        hidden_evaluation_patch_policy: evaluation.hidden_patch_policy,
      },
      context,
    );
  });

const PartialEvaluationInputSchema = z
  .object(EvaluationInputShape)
  .partial()
  .strict()
  .superRefine((evaluation, context) => {
    addHiddenPatchPolicyIssue(
      {
        hidden_evaluation_patches: evaluation.hidden_patches,
        hidden_evaluation_patch_policy: evaluation.hidden_patch_policy,
      },
      context,
    );
  });

const ReplayChangeEvaluationInputSchema = z
  .object(EvaluationInputShape)
  .strict()
  .superRefine((evaluation, context) => {
    addHiddenPatchPolicyIssue(
      {
        hidden_evaluation_patches: evaluation.hidden_patches,
        hidden_evaluation_patch_policy: evaluation.hidden_patch_policy,
      },
      context,
    );
    if (!hasBenchmarkLocalHiddenVerifier(evaluation)) {
      context.addIssue({
        code: "custom",
        path: ["hidden_files"],
        message:
          "replay_change evaluation must define benchmark-local hidden_files, hidden_directories, or hidden_patches",
      });
    }
  });

const ToolUsageHighlightMatchSchema = z
  .object({
    tool: nonEmptyString.optional(),
    command_contains: nonEmptyString.optional(),
    command_equals: nonEmptyString.optional(),
  })
  .strict()
  .refine(
    (match) => Boolean(match.tool || match.command_contains || match.command_equals),
    "Tool usage highlight match must define tool, command_contains, or command_equals.",
  );

const ToolUsageHighlightSchema = z
  .object({
    id,
    label: nonEmptyString,
    match: ToolUsageHighlightMatchSchema,
  })
  .strict();

const VerificationCheckSchema = z
  .object({
    id,
    kind: z.enum([
      VerificationCheckKind.Build,
      VerificationCheckKind.Custom,
      VerificationCheckKind.Lint,
      VerificationCheckKind.Repro,
      VerificationCheckKind.Tests,
      VerificationCheckKind.Typecheck,
    ]),
    label: nonEmptyString.optional(),
    match: ToolUsageHighlightMatchSchema,
    baseline_command: nonEmptyString.optional(),
  })
  .strict();

export const VerificationSchema = z
  .object({
    checks: z.array(VerificationCheckSchema).default([]),
  })
  .strict()
  .prefault({});

const ToolUsageCategorySchema = z
  .object({
    id,
    label: nonEmptyString,
    highlights: z.array(ToolUsageHighlightSchema).default([]),
  })
  .strict();

export const ArtifactsSchema = z
  .object({
    tool_calls: z.boolean().default(true),
    tool_output: z.enum(["none", "excerpts"]).default("none"),
    tool_output_excerpt_bytes: positiveInteger.default(8192),
    raw_events: z.boolean().default(false),
    final_response: z.enum(["none", "capped"]).default("capped"),
    final_response_max_bytes: positiveInteger.default(8192),
    stderr_max_bytes: positiveInteger.default(65536),
  })
  .strict()
  .prefault({});

export const ReportingSchema = z
  .object({
    tool_categories: z.array(ToolUsageCategorySchema).default([]),
  })
  .strict()
  .prefault({});

export const ToolUsageSchema = z
  .object({
    record_tool_calls: z.boolean().default(true),
    tool_output: z.enum(["none", "excerpts"]).default("none"),
    tool_output_excerpt_bytes: positiveInteger.default(8192),
    record_raw_events: z.boolean().default(false),
    final_response: z.enum(["none", "capped"]).default("capped"),
    final_response_max_bytes: positiveInteger.default(8192),
    stderr_max_bytes: positiveInteger.default(65536),
    categories: z.array(ToolUsageCategorySchema).default([]),
  })
  .strict();

export const DefaultsSchema = z
  .object({
    models: z.array(id).optional(),
    limits: LimitsSchema,
    agent_view: AgentViewSchema,
    evaluation: EvaluationInputSchema,
  })
  .strict();

const BenchmarkCommonShape = {
  id,
  task: nonEmptyString,
  models: z.array(id).optional(),
  limits: PartialLimitsSchema.optional(),
  agent_view: PartialAgentViewSchema.optional(),
} as const;

export const ReferenceSolutionSchema = z
  .union([
    z.object({ commit: nonEmptyString }).strict(),
    z.object({ patch: nonEmptyString }).strict(),
  ])
  .refine(
    (referenceSolution) => "commit" in referenceSolution !== "patch" in referenceSolution,
    "reference_solution must define exactly one of commit or patch",
  );

export const ReplayValidationSchema = z
  .object({
    flakiness_runs: positiveInteger.default(1),
  })
  .strict()
  .prefault({});

const ImplementationBenchmarkCaseSchema = z
  .object({
    ...BenchmarkCommonShape,
    base_commit: nonEmptyString.optional(),
    evaluation: PartialEvaluationInputSchema.optional(),
  })
  .strict();

const ReplayChangeBenchmarkCaseSchema = z
  .object({
    ...BenchmarkCommonShape,
    base_commit: nonEmptyString,
    reference_solution: ReferenceSolutionSchema,
    replay_validation: ReplayValidationSchema,
    evaluation: ReplayChangeEvaluationInputSchema,
  })
  .strict();

const ImplementationBenchmarkInputSchema = ImplementationBenchmarkCaseSchema.extend({
  type: z.literal(BenchmarkType.Implementation),
});

const ReplayChangeBenchmarkInputSchema = ReplayChangeBenchmarkCaseSchema.extend({
  type: z.literal(BenchmarkType.ReplayChange),
});

const BenchmarkInputSchema = z.discriminatedUnion("type", [
  ImplementationBenchmarkInputSchema,
  ReplayChangeBenchmarkInputSchema,
]);

const GroupedBenchmarksSchema = z
  .object({
    implementation: z.array(ImplementationBenchmarkCaseSchema).default([]),
    replay_change: z.array(ReplayChangeBenchmarkCaseSchema).default([]),
  })
  .strict()
  .refine(
    (benchmarks) => benchmarks.implementation.length + benchmarks.replay_change.length > 0,
    "At least one benchmark is required.",
  );

const BenchmarksSchema = z.union([z.array(BenchmarkInputSchema).min(1), GroupedBenchmarksSchema]);

export const BenchmarkSchema = BenchmarkInputSchema;

const RawShiptestConfigSchema = z
  .object({
    version: z.literal(SchemaLimits.ConfigSchemaVersion),
    project: z
      .object({
        name: nonEmptyString.optional(),
        repo: nonEmptyString.optional(),
      })
      .strict(),
    environment: EnvironmentSchema,
    workspace: WorkspaceSchema,
    runner: RunnerSchema,
    baselines: BaselinesSchema,
    artifacts: ArtifactsSchema,
    reporting: ReportingSchema,
    verification: VerificationSchema,
    defaults: DefaultsSchema,
    models: ModelsSchema,
    benchmarks: BenchmarksSchema,
  })
  .strict();

export const ShiptestConfigSchema = RawShiptestConfigSchema.transform((config) => {
  const validationCommands = Array.isArray(config.environment.validate)
    ? { required: config.environment.validate, advisory: [] }
    : config.environment.validate;
  const models = normalizeModels(config.models);
  return {
    ...config,
    models,
    tool_usage: ToolUsageSchema.parse({
      record_tool_calls: config.artifacts.tool_calls,
      tool_output: config.artifacts.tool_output,
      tool_output_excerpt_bytes: config.artifacts.tool_output_excerpt_bytes,
      record_raw_events: config.artifacts.raw_events,
      final_response: config.artifacts.final_response,
      final_response_max_bytes: config.artifacts.final_response_max_bytes,
      stderr_max_bytes: config.artifacts.stderr_max_bytes,
      categories: config.reporting.tool_categories,
    }),
    shiptest_runner: ShiptestRunnerSchema.parse({
      clean_git_repo: { enabled: true },
      prepared_baseline: { enabled: true, cache: config.baselines.cache },
    }),
    snapshot: SnapshotSchema.parse({
      strategy: SnapshotStrategy.SanitizedCopy,
      git_lfs_handling: config.workspace.lfs,
      submodule_handling: config.workspace.submodules,
      strip_real_git_metadata: true,
    }),
    repository_environment: RepositoryEnvironmentSchema.parse({
      commands_run_in: CommandsRunIn.ShiptestEnvironment,
      source: RepositoryEnvironmentSource.Local,
      setup_commands: config.environment.setup,
      validation_commands: validationCommands,
      teardown_commands: [],
      required_secrets: {},
    }),
    project: {
      ...config.project,
      repo: config.project.repo ?? ".",
      name: config.project.name ?? "",
    },
    defaults: {
      ...config.defaults,
      run: { models: config.defaults.models },
      agent_context: AgentContextSchema.parse(config.defaults.agent_view),
      evaluation: normalizeEvaluation(config.defaults.evaluation),
    },
    benchmarks: normalizeBenchmarks(config.benchmarks).map((benchmark) => ({
      ...benchmark,
      models: benchmark.models ?? config.defaults.models,
      limits: LimitsSchema.parse({ ...config.defaults.limits, ...benchmark.limits }),
      agent_context: AgentContextSchema.parse({
        ...config.defaults.agent_view,
        ...benchmark.agent_view,
      }),
      evaluation: EvaluationSchema.parse({
        ...normalizeEvaluation(config.defaults.evaluation),
        ...normalizePartialEvaluation(benchmark.evaluation),
      }),
    })),
  };
}).superRefine((config, context) => {
  addDuplicateIdIssues(config.models, "models", context);
  addDuplicateIdIssues(config.benchmarks, "benchmarks", context);
  addDuplicateIdIssues(config.verification.checks, "verification.checks", context);

  const modelIds = new Set(config.models.map((model) => model.id));
  for (const [modelIndex, modelId] of (config.defaults.models ?? []).entries()) {
    if (!modelIds.has(modelId)) {
      context.addIssue({
        code: "custom",
        path: ["defaults", "models", modelIndex],
        message: `Unknown model reference: ${modelId}`,
      });
    }
  }

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

    if (benchmark.type === BenchmarkType.ReplayChange) {
      if (!benchmark.base_commit) {
        context.addIssue({
          code: "custom",
          path: ["benchmarks", benchmarkIndex, "base_commit"],
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
          path: ["benchmarks", benchmarkIndex, "evaluation"],
          message:
            "replay_change benchmarks must define hidden_evaluation_files, hidden_evaluation_directories, or hidden_evaluation_patches",
        });
      }
    }
  }
});

function normalizeBenchmarks(
  benchmarks: z.infer<typeof BenchmarksSchema>,
): z.infer<typeof BenchmarkInputSchema>[] {
  if (Array.isArray(benchmarks)) {
    return benchmarks;
  }
  return [
    ...benchmarks.implementation.map((benchmark) => ({
      ...benchmark,
      type: BenchmarkType.Implementation,
    })),
    ...benchmarks.replay_change.map((benchmark) => ({
      ...benchmark,
      type: BenchmarkType.ReplayChange,
    })),
  ];
}

function normalizeEvaluation(evaluation: z.infer<typeof EvaluationInputSchema>) {
  return {
    clean_room: true,
    hidden_evaluation_files: evaluation.hidden_files,
    hidden_evaluation_directories: evaluation.hidden_directories,
    hidden_evaluation_patches: evaluation.hidden_patches,
    ...(evaluation.hidden_patch_policy
      ? { hidden_evaluation_patch_policy: evaluation.hidden_patch_policy }
      : {}),
    policy_preset: evaluation.policy_preset,
    protected_paths: evaluation.protected_paths,
    scoring_command: evaluation.command,
    dependency_changes: evaluation.dependency_changes,
    rerun_setup_on_dependency_change: evaluation.rerun_setup_on_dependency_change,
  };
}

function normalizePartialEvaluation(
  evaluation: z.infer<typeof PartialEvaluationInputSchema> | undefined,
) {
  if (!evaluation) {
    return {};
  }
  return {
    ...(evaluation.command ? { scoring_command: evaluation.command } : {}),
    ...(evaluation.hidden_files ? { hidden_evaluation_files: evaluation.hidden_files } : {}),
    ...(evaluation.hidden_directories
      ? { hidden_evaluation_directories: evaluation.hidden_directories }
      : {}),
    ...(evaluation.hidden_patches ? { hidden_evaluation_patches: evaluation.hidden_patches } : {}),
    ...(evaluation.hidden_patch_policy
      ? { hidden_evaluation_patch_policy: evaluation.hidden_patch_policy }
      : {}),
    ...(evaluation.policy_preset ? { policy_preset: evaluation.policy_preset } : {}),
    ...(evaluation.protected_paths ? { protected_paths: evaluation.protected_paths } : {}),
    ...(evaluation.dependency_changes ? { dependency_changes: evaluation.dependency_changes } : {}),
    ...(evaluation.rerun_setup_on_dependency_change === undefined
      ? {}
      : { rerun_setup_on_dependency_change: evaluation.rerun_setup_on_dependency_change }),
  };
}

function normalizeModels(models: z.infer<typeof ModelsSchema>): z.infer<typeof ModelListSchema> {
  if (Array.isArray(models)) {
    return models;
  }
  return models.include.map((modelName) => ({
    id: modelName,
    provider: models.provider,
    model: modelName,
    ...(models.base_url ? { base_url: models.base_url } : {}),
  }));
}

function addHiddenPatchPolicyIssue(
  evaluation: {
    readonly hidden_evaluation_patches?: readonly unknown[] | undefined;
    readonly hidden_evaluation_patch_policy?: unknown;
  },
  context: z.RefinementCtx,
): void {
  if (
    evaluation.hidden_evaluation_patches &&
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
}

function addDuplicateIdIssues(
  items: readonly { readonly id: string }[],
  path: "models" | "benchmarks" | "verification.checks",
  context: z.RefinementCtx,
): void {
  const seen = new Map<string, number>();
  for (const [index, item] of items.entries()) {
    const firstIndex = seen.get(item.id);
    if (firstIndex !== undefined) {
      context.addIssue({
        code: "custom",
        path: duplicateIdPath(path, index),
        message: `Duplicate ${singularLabel(path)} id '${item.id}' already used at ${path}[${firstIndex}]`,
      });
    } else {
      seen.set(item.id, index);
    }
  }
}

function duplicateIdPath(
  pathName: "models" | "benchmarks" | "verification.checks",
  index: number,
): (string | number)[] {
  return pathName === "verification.checks"
    ? ["verification", "checks", index, "id"]
    : [pathName, index, "id"];
}

function singularLabel(pathName: "models" | "benchmarks" | "verification.checks"): string {
  if (pathName === "models") return "model";
  if (pathName === "benchmarks") return "benchmark";
  return "verification check";
}

export type ShiptestConfig = z.input<typeof ShiptestConfigSchema>;
export type ResolvedShiptestConfig = z.output<typeof ShiptestConfigSchema>;
