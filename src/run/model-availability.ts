import { spawn } from "node:child_process";

import { resolvePiCommand } from "../agent/pi-command.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";

export const ModelAvailabilityDefaults = {
  TimeoutMs: 30_000,
  MaxOutputBytes: 5 * 1024 * 1024,
} as const;

export interface PiListedModel {
  readonly provider: string;
  readonly model: string;
}

export interface ModelAvailabilityResult {
  readonly ok: boolean;
  readonly available_models: readonly PiListedModel[];
  readonly missing_models: readonly {
    readonly id: string;
    readonly provider: string;
    readonly model: string;
  }[];
}

export async function checkPiModelAvailability(options: {
  readonly models: readonly ResolvedShiptestConfig["models"][number][];
  readonly piExecutable: string;
  readonly piExecutableArgs: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}): Promise<ModelAvailabilityResult> {
  const piCommand = resolvePiCommand(options.piExecutable, options.piExecutableArgs);
  const output = await listPiModels({
    piExecutable: piCommand.executable,
    piExecutableArgs: piCommand.args,
    timeoutMs: options.timeoutMs ?? ModelAvailabilityDefaults.TimeoutMs,
    maxOutputBytes: options.maxOutputBytes ?? ModelAvailabilityDefaults.MaxOutputBytes,
  });
  const availableModels = parsePiListModelsOutput(`${output.stdout}\n${output.stderr}`);
  const availableKeys = new Set(
    availableModels.map((model) => modelAvailabilityKey(model.provider, model.model)),
  );
  const missingModels = options.models
    .filter((model) => !availableKeys.has(modelAvailabilityKey(model.provider, model.model)))
    .map((model) => ({ id: model.id, provider: model.provider, model: model.model }));

  return {
    ok: missingModels.length === 0,
    available_models: availableModels,
    missing_models: missingModels,
  };
}

export function formatMissingPiModelsMessage(result: ModelAvailabilityResult): string {
  const missing = result.missing_models
    .map((model) => `- ${model.id}: ${model.provider}/${model.model}`)
    .join("\n");
  return [
    "Configured model(s) were not listed by `pi --list-models`.",
    missing,
    "Run `pi --list-models` and update shiptest.yaml to use models available to this Pi account.",
  ].join("\n");
}

export function parsePiListModelsOutput(output: string): readonly PiListedModel[] {
  const models: PiListedModel[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("provider")) {
      continue;
    }
    const [provider, model] = trimmed.split(/\s+/);
    if (!provider || !model) {
      continue;
    }
    models.push({ provider, model });
  }
  return models;
}

function listPiModels(options: {
  readonly piExecutable: string;
  readonly piExecutableArgs: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.piExecutable, [...options.piExecutableArgs, "--list-models"], {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: "1",
      },
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      if (outputExceeded) {
        return;
      }
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) {
        outputExceeded = true;
        child.kill();
        return;
      }
      chunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk: Buffer) => capture(stderrChunks, chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (settled) {
        return;
      }
      settled = true;
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (timedOut) {
        reject(new Error("Timed out while running `pi --list-models`."));
        return;
      }
      if (outputExceeded) {
        reject(new Error("`pi --list-models` produced too much output."));
        return;
      }
      if (exitCode !== 0) {
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `pi --list-models exited with code ${exitCode}.`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function modelAvailabilityKey(provider: string, model: string): string {
  return `${provider}\0${model}`;
}
