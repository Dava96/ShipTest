import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createSnapshotManifest } from "../snapshot/manifest.js";
import { extractSubmission } from "../submission/extract.js";
import { pathExists } from "../utils/filesystem.js";
import {
  prepareCopiedWorkspace,
  prepareResettableGitWorkspace,
} from "../workspace/resettable-workspace.js";
import {
  createEmptyAgentTelemetry,
  parsePiJsonLineIntoTelemetry,
  telemetryHasContextExhaustion,
} from "./pi-events.js";
import type {
  AgentHarness,
  AgentRunOptions,
  AgentRunResult,
  AgentSignal,
  AgentTelemetry,
} from "./types.js";

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

  const piEventsPath = path.join(options.artifactsDir, "pi-events.jsonl");
  const stderrPath = path.join(options.artifactsDir, "pi.stderr.txt");
  artifacts.pi_events = piEventsPath;
  artifacts.pi_stderr = stderrPath;

  const processStartedAt = Date.now();
  const runResult = await runPiProcess({
    cwd: options.agentWorkspacePath,
    prompt,
    model: options.model,
    loadContextFiles: options.benchmark.agent_context.load_context_files,
    limits: options.limits,
    piExecutable: options.piExecutable ?? "pi",
    piExecutableArgs: options.piExecutableArgs ?? [],
    piEventsPath,
    stderrPath,
  });
  const processMs = Date.now() - processStartedAt;

  signals.push(...runResult.signals);
  const telemetry = runResult.telemetry;
  const statusFromProcess = runResult.status;

  await writeArtifact(
    options.artifactsDir,
    artifacts,
    "telemetry",
    "telemetry.json",
    `${JSON.stringify(telemetry, null, 2)}\n`,
  );
  if (telemetry.final_response) {
    await writeArtifact(
      options.artifactsDir,
      artifacts,
      "final_response",
      "final-response.md",
      telemetry.final_response,
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
}): Promise<Pick<AgentRunResult, "status" | "signals" | "telemetry">> {
  const signals: AgentSignal[] = [];
  const telemetry = createEmptyAgentTelemetry();
  const args = [
    ...options.piExecutableArgs,
    ...createPiArgs(options.model, options.loadContextFiles, options.prompt),
  ];
  const startedAt = Date.now();
  let status: AgentRunResult["status"] = "completed";
  let stoppedForBudget = false;

  const child = spawn(options.piExecutable, args, {
    cwd: options.cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PI_SKIP_VERSION_CHECK: "1",
    },
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let pendingStdout = "";

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

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
    pendingStdout += chunk.toString("utf8");
    const lines = pendingStdout.split("\n");
    pendingStdout = lines.pop() ?? "";
    for (const line of lines) {
      parsePiJsonLineIntoTelemetry(telemetry, line);
      enforceEventBudgets(telemetry, options.limits, stopForBudget);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
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

  if (pendingStdout.trim()) {
    parsePiJsonLineIntoTelemetry(telemetry, pendingStdout);
    enforceEventBudgets(telemetry, options.limits, stopForBudget);
  }
  (telemetry.lifecycle as { process_exit_code: number | null }).process_exit_code = exitCode;
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  await mkdir(path.dirname(options.piEventsPath), { recursive: true });
  await writeFile(options.piEventsPath, stdout, "utf8");
  await writeFile(options.stderrPath, stderr, "utf8");

  if (status === "completed" && telemetryHasContextExhaustion(telemetry, stderr)) {
    status = "context_exhausted";
    signals.push({
      id: "context_exhausted",
      severity: "error",
      message: "Agent output indicates context exhaustion.",
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

  return { status, signals, telemetry };
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
