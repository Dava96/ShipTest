import { spawn } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSnapshotManifest } from "../snapshot/manifest.js";
import { extractSubmission } from "../submission/extract.js";
import { pathExists } from "../utils/filesystem.js";
import {
  prepareCopiedWorkspace,
  prepareResettableGitWorkspace,
} from "../workspace/resettable-workspace.js";
import { resolvePiCommand } from "./pi-command.js";
import {
  createEmptyAgentTelemetry,
  parsePiJsonLine,
  parsePiJsonLineIntoTelemetry,
  telemetryHasContextExhaustion,
} from "./pi-events.js";
import { ToolUsageRecorder } from "./tool-usage.js";
import type {
  AgentHarness,
  AgentRunOptions,
  AgentRunResult,
  AgentSignal,
  AgentTelemetry,
} from "./types.js";

export const PiJsonHarnessDefaults = {
  MaxPendingStdoutLineBytes: 10 * 1024 * 1024,
} as const;

export class PiJsonHarness implements AgentHarness {
  readonly id = "pi-json";

  async runAttempt(options: AgentRunOptions): Promise<AgentRunResult> {
    return runPiJsonAgentAttempt(options);
  }
}

export async function runPiJsonAgentAttempt(options: AgentRunOptions): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const artifacts: Record<string, string> = {};
  const signals: AgentSignal[] = [];
  await mkdir(options.artifactsDir, { recursive: true });
  const workspacePrepareStartedAt = Date.now();
  const workspacePrepareResult = await createAgentWorkspace(
    options.preparedBaselinePath,
    options.agentWorkspacePath,
    options.overwrite ?? false,
    options.preparedBaselineCommit,
  );
  const workspacePrepareMs = Date.now() - workspacePrepareStartedAt;

  const taskPath = path.resolve(options.configDir, options.benchmark.task);
  const prompt = await readFile(taskPath, "utf8");
  await writeArtifact(options.artifactsDir, artifacts, "prompt", "prompt.md", prompt);
  await writeArtifact(options.artifactsDir, artifacts, "task", "task.md", prompt);

  const baselineManifest = await createSnapshotManifest({
    snapshotPath: options.agentWorkspacePath,
    sourceCommit: options.benchmark.base_commit ?? "manual",
    sourceTree: "manual",
  });

  const toolUsageConfig = options.toolUsage ?? defaultToolUsageConfig();
  const piEventsPath = path.join(options.artifactsDir, "pi-events.jsonl");
  const stderrPath = path.join(options.artifactsDir, "pi.stderr.txt");
  if (toolUsageConfig.record_raw_events) {
    artifacts.pi_events = piEventsPath;
  }
  artifacts.pi_stderr = stderrPath;

  const piCommand = resolvePiCommand(options.piExecutable, options.piExecutableArgs);
  const processStartedAt = Date.now();
  const runResult = await runPiProcess({
    cwd: options.agentWorkspacePath,
    prompt,
    model: options.model,
    loadContextFiles: options.benchmark.agent_context.load_context_files,
    limits: options.limits,
    piExecutable: piCommand.executable,
    piExecutableArgs: piCommand.args,
    piEventsPath,
    stderrPath,
    toolUsage: toolUsageConfig,
  });
  const processMs = Date.now() - processStartedAt;

  signals.push(...runResult.signals);
  const telemetry = runResult.telemetry;
  if (runResult.tool_usage?.artifacts.tool_calls_jsonl) {
    artifacts.tool_calls = runResult.tool_usage.artifacts.tool_calls_jsonl;
  }
  const statusFromProcess = runResult.status;

  await writeArtifact(
    options.artifactsDir,
    artifacts,
    "telemetry",
    "telemetry.json",
    `${JSON.stringify(telemetry, null, 2)}\n`,
  );
  if (telemetry.final_response && toolUsageConfig.final_response !== "none") {
    await writeArtifact(
      options.artifactsDir,
      artifacts,
      "final_response",
      "final-response.md",
      capText(telemetry.final_response, toolUsageConfig.final_response_max_bytes),
    );
  }

  const submissionExtractStartedAt = Date.now();
  const extraction = await extractSubmission({
    workspacePath: options.agentWorkspacePath,
    baselineManifest,
  });
  const submissionExtractMs = Date.now() - submissionExtractStartedAt;

  if (!extraction.ok) {
    signals.push({
      id: "submission_extraction_failed",
      severity: "error",
      message: "Failed to extract candidate patch from agent workspace.",
    });
    return {
      ok: false,
      status: "extraction_failed",
      signals,
      telemetry,
      ...(runResult.tool_usage ? { tool_usage: runResult.tool_usage } : {}),
      agent_workspace_path: options.agentWorkspacePath,
      timings_ms: createAgentTimings(
        startedAt,
        workspacePrepareMs,
        workspacePrepareResult,
        processMs,
        submissionExtractMs,
      ),
      artifacts,
    };
  }

  signals.push({
    id: "submission_extracted",
    severity: "info",
    message: `Extracted candidate patch with ${extraction.submission.changed_files.length} changed file(s).`,
  });
  await writeArtifact(
    options.artifactsDir,
    artifacts,
    "candidate_patch",
    path.join("submission", "candidate.patch"),
    extraction.submission.diff,
  );
  await writeArtifact(
    options.artifactsDir,
    artifacts,
    "changed_files",
    path.join("submission", "changed-files.json"),
    `${JSON.stringify(extraction.submission.changed_files, null, 2)}\n`,
  );

  return {
    ok: statusFromProcess === "completed",
    status: statusFromProcess,
    signals,
    telemetry,
    ...(runResult.tool_usage ? { tool_usage: runResult.tool_usage } : {}),
    submission: extraction.submission,
    agent_workspace_path: options.agentWorkspacePath,
    timings_ms: createAgentTimings(
      startedAt,
      workspacePrepareMs,
      workspacePrepareResult,
      processMs,
      submissionExtractMs,
    ),
    artifacts,
  };
}

function createAgentTimings(
  startedAt: number,
  workspacePrepareMs: number,
  workspacePrepareResult: Awaited<ReturnType<typeof createAgentWorkspace>>,
  processMs: number,
  submissionExtractMs: number,
): AgentRunResult["timings_ms"] {
  return {
    total_ms: Date.now() - startedAt,
    workspace_prepare_ms: workspacePrepareMs,
    workspace_prepare_strategy: workspacePrepareResult.strategy,
    workspace_prepare_reused: workspacePrepareResult.reused,
    workspace_prepare_fallback_used: workspacePrepareResult.fallback_used,
    process_ms: processMs,
    submission_extract_ms: submissionExtractMs,
  };
}

async function runPiProcess(options: {
  readonly cwd: string;
  readonly prompt: string;
  readonly model: AgentRunOptions["model"];
  readonly loadContextFiles: boolean;
  readonly limits: AgentRunOptions["limits"];
  readonly piExecutable: string;
  readonly piExecutableArgs: readonly string[];
  readonly piEventsPath: string;
  readonly stderrPath: string;
  readonly toolUsage: NonNullable<AgentRunOptions["toolUsage"]>;
}): Promise<Pick<AgentRunResult, "status" | "signals" | "telemetry" | "tool_usage">> {
  const signals: AgentSignal[] = [];
  const telemetry = createEmptyAgentTelemetry();
  const args = [
    ...options.piExecutableArgs,
    ...createPiArgs(options.model, options.loadContextFiles, options.prompt),
  ];
  const startedAt = Date.now();
  let status: AgentRunResult["status"] = "completed";
  let stoppedForBudget = false;
  const toolUsageRecorder = await ToolUsageRecorder.create({
    config: options.toolUsage,
    artifactsDir: path.dirname(options.stderrPath),
  });

  const child = spawn(options.piExecutable, args, {
    cwd: options.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "1",
    },
  });

  await mkdir(path.dirname(options.stderrPath), { recursive: true });
  const rawEventsStream = options.toolUsage.record_raw_events
    ? createWriteStream(options.piEventsPath, { flags: "w", encoding: "utf8" })
    : undefined;
  let stderrTail = "";
  let stdoutProcessing = Promise.resolve();

  const stopForBudget = (signal: AgentSignal, nextStatus: AgentRunResult["status"]): void => {
    if (stoppedForBudget) {
      return;
    }
    stoppedForBudget = true;
    status = nextStatus;
    signals.push(signal);
    child.kill();
  };

  const attemptTimer = setTimeout(() => {
    stopForBudget(
      {
        id: "max_attempt_mins_exceeded",
        severity: "error",
        message: `Agent exceeded max_attempt_mins (${options.limits.max_attempt_mins}).`,
      },
      "timeout",
    );
  }, options.limits.max_attempt_mins * 60_000);

  const stdoutParser = createStdoutParser({
    telemetry,
    toolUsageRecorder,
    limits: options.limits,
    stopForBudget,
  });

  child.stdout.on("data", (chunk: Buffer) => {
    child.stdout.pause();
    stdoutProcessing = stdoutProcessing
      .then(async () => {
        if (rawEventsStream) {
          await writeStreamChunk(rawEventsStream, chunk);
        }
        stdoutParser.processChunk(chunk.toString("utf8"));
      })
      .finally(() => child.stdout.resume());
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    stderrTail = capTail(`${stderrTail}${text}`, options.toolUsage.stderr_max_bytes);
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  }).catch((error: unknown) => {
    signals.push({
      id: "agent_process_failed",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  clearTimeout(attemptTimer);
  await stdoutProcessing;
  stdoutParser.finish();
  await closeStream(rawEventsStream);
  await writeFile(options.stderrPath, stderrTail, "utf8");
  const toolUsage = await toolUsageRecorder.finish();
  (telemetry.lifecycle as { process_exit_code: number | null }).process_exit_code = exitCode;
  const stderr = stderrTail;

  if (status === "completed" && telemetryHasContextExhaustion(telemetry, stderr)) {
    status = "context_exhausted";
    signals.push({
      id: "context_exhausted",
      severity: "error",
      message: "Agent output indicates context exhaustion.",
    });
  }

  if (
    status === "completed" &&
    telemetry.error_messages.length > 0 &&
    telemetry.usage.total_tokens === 0
  ) {
    status = "process_failed";
    signals.push({
      id: "agent_reported_errors",
      severity: "error",
      message: `Agent reported ${telemetry.error_messages.length} error message(s) without any token usage.`,
    });
  }

  if (status === "completed" && exitCode !== 0) {
    status = "process_failed";
    signals.push({
      id: "agent_process_failed",
      severity: "error",
      message: `Agent process exited with code ${exitCode ?? "null"}.`,
    });
  }

  if (status === "completed") {
    signals.push({
      id: "agent_completed",
      severity: "info",
      message: `Agent completed in ${Date.now() - startedAt}ms.`,
    });
  }

  return { status, signals, telemetry, tool_usage: toolUsage };
}

function createStdoutParser(options: {
  readonly telemetry: AgentTelemetry;
  readonly toolUsageRecorder: ToolUsageRecorder;
  readonly limits: AgentRunOptions["limits"];
  readonly stopForBudget: (signal: AgentSignal, status: AgentRunResult["status"]) => void;
}): { readonly processChunk: (text: string) => void; readonly finish: () => void } {
  let pendingLine = "";
  let skippingOversizedLine = false;

  const processLine = (line: string): void => {
    parsePiJsonLineIntoTelemetry(options.telemetry, line);
    const event = parsePiJsonLine(line);
    if (event && event !== "empty" && event !== "malformed") {
      options.toolUsageRecorder.handlePiEvent(event);
    }
    enforceEventBudgets(options.telemetry, options.limits, options.stopForBudget);
  };

  return {
    processChunk: (text: string): void => {
      let remaining = text;
      while (remaining.length > 0) {
        if (skippingOversizedLine) {
          const newlineIndex = remaining.indexOf("\n");
          if (newlineIndex === -1) {
            return;
          }
          remaining = remaining.slice(newlineIndex + 1);
          skippingOversizedLine = false;
          continue;
        }

        const newlineIndex = remaining.indexOf("\n");
        const segment = newlineIndex === -1 ? remaining : remaining.slice(0, newlineIndex);
        const candidateBytes =
          Buffer.byteLength(pendingLine, "utf8") + Buffer.byteLength(segment, "utf8");
        if (candidateBytes > PiJsonHarnessDefaults.MaxPendingStdoutLineBytes) {
          incrementOversizedEvent(options.telemetry);
          pendingLine = "";
          if (newlineIndex === -1) {
            skippingOversizedLine = true;
            return;
          }
          remaining = remaining.slice(newlineIndex + 1);
          continue;
        }

        if (newlineIndex === -1) {
          pendingLine += segment;
          return;
        }

        const line = `${pendingLine}${segment}`;
        pendingLine = "";
        processLine(line);
        remaining = remaining.slice(newlineIndex + 1);
      }
    },
    finish: (): void => {
      if (!skippingOversizedLine && pendingLine.trim()) {
        processLine(pendingLine);
      }
      pendingLine = "";
    },
  };
}

function incrementOversizedEvent(telemetry: AgentTelemetry): void {
  (telemetry.counts as { oversized_events: number }).oversized_events += 1;
}

async function writeStreamChunk(stream: WriteStream, chunk: Buffer): Promise<void> {
  if (!stream.write(chunk)) {
    await once(stream, "drain");
  }
}

async function closeStream(
  stream: ReturnType<typeof createWriteStream> | undefined,
): Promise<void> {
  if (!stream) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    stream.on("error", reject);
    stream.end(resolve);
  });
}

function capTail(value: string, maxBytes: number): string {
  return capTextFromStart(value, maxBytes, true);
}

function capText(value: string, maxBytes: number): string {
  return capTextFromStart(value, maxBytes, false);
}

function capTextFromStart(value: string, maxBytes: number, fromTail: boolean): string {
  let text = value;
  while (Buffer.byteLength(text, "utf8") > maxBytes) {
    text = fromTail
      ? text.slice(Math.max(1, Math.floor(text.length / 4)))
      : text.slice(0, Math.floor(text.length * 0.75));
  }
  return text;
}

function defaultToolUsageConfig(): NonNullable<AgentRunOptions["toolUsage"]> {
  return {
    record_tool_calls: true,
    tool_output: "none",
    tool_output_excerpt_bytes: 8192,
    record_raw_events: false,
    final_response: "capped",
    final_response_max_bytes: 8192,
    stderr_max_bytes: 65536,
    categories: [],
  };
}

function enforceEventBudgets(
  telemetry: AgentTelemetry,
  limits: AgentRunOptions["limits"],
  stopForBudget: (signal: AgentSignal, status: AgentRunResult["status"]) => void,
): void {
  if (telemetry.counts.turns > limits.max_turns) {
    stopForBudget(
      {
        id: "max_turns_exceeded",
        severity: "error",
        message: `Agent exceeded max_turns (${limits.max_turns}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (telemetry.counts.tool_calls > limits.max_tool_calls) {
    stopForBudget(
      {
        id: "max_tool_calls_exceeded",
        severity: "error",
        message: `Agent exceeded max_tool_calls (${limits.max_tool_calls}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (
    limits.max_estimated_cost_usd !== undefined &&
    (telemetry.usage.estimated_cost_usd?.total ?? 0) > limits.max_estimated_cost_usd
  ) {
    stopForBudget(
      {
        id: "max_estimated_cost_usd_exceeded",
        severity: "error",
        message: `Agent exceeded max_estimated_cost_usd (${limits.max_estimated_cost_usd}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (
    limits.max_output_tokens !== undefined &&
    telemetry.usage.output_tokens > limits.max_output_tokens
  ) {
    stopForBudget(
      {
        id: "max_output_tokens_exceeded",
        severity: "error",
        message: `Agent exceeded max_output_tokens (${limits.max_output_tokens}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (
    limits.max_uncached_tokens !== undefined &&
    telemetry.usage.uncached_tokens > limits.max_uncached_tokens
  ) {
    stopForBudget(
      {
        id: "max_uncached_tokens_exceeded",
        severity: "error",
        message: `Agent exceeded max_uncached_tokens (${limits.max_uncached_tokens}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (
    limits.max_cache_read_tokens !== undefined &&
    telemetry.usage.cache_read_tokens > limits.max_cache_read_tokens
  ) {
    stopForBudget(
      {
        id: "max_cache_read_tokens_exceeded",
        severity: "error",
        message: `Agent exceeded max_cache_read_tokens (${limits.max_cache_read_tokens}).`,
      },
      "budget_exceeded",
    );
    return;
  }
  if (telemetry.usage.total_tokens > limits.max_total_tokens) {
    stopForBudget(
      {
        id: "max_total_tokens_exceeded",
        severity: "error",
        message: `Agent exceeded max_total_tokens (${limits.max_total_tokens}).`,
      },
      "budget_exceeded",
    );
  }
}

function createPiArgs(
  model: AgentRunOptions["model"],
  loadContextFiles: boolean,
  prompt: string,
): string[] {
  return [
    "--mode",
    "json",
    "--provider",
    model.provider,
    "--model",
    model.model,
    "--no-session",
    ...(loadContextFiles ? [] : ["--no-context-files"]),
    prompt,
  ];
}

async function createAgentWorkspace(
  preparedBaselinePath: string,
  agentWorkspacePath: string,
  overwrite: boolean,
  preparedBaselineCommit: string | undefined,
) {
  if (preparedBaselineCommit) {
    return prepareResettableGitWorkspace({
      preparedBaselinePath,
      workspacePath: agentWorkspacePath,
      baselineCommit: preparedBaselineCommit,
    });
  }
  if (!overwrite && (await pathExists(agentWorkspacePath))) {
    throw new Error(`Agent workspace already exists: ${agentWorkspacePath}`);
  }
  return prepareCopiedWorkspace({
    preparedBaselinePath,
    workspacePath: agentWorkspacePath,
    overwrite,
  });
}

async function writeArtifact(
  artifactsDir: string,
  artifacts: Record<string, string>,
  key: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const artifactPath = path.join(artifactsDir, relativePath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, content, "utf8");
  artifacts[key] = artifactPath;
}
