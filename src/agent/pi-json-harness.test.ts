import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import type { ResolvedShiptestConfig } from "../config/schema.js";
import {
  benchmark as configBenchmark,
  createResolvedShiptestConfig,
} from "../test-support/shiptest-config-fixture.js";
import { PiJsonHarnessDefaults, runPiJsonAgentAttempt } from "./pi-json-harness.js";

interface Fixture {
  readonly root: string;
  readonly configDir: string;
  readonly preparedBaselinePath: string;
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly model: ResolvedShiptestConfig["models"][number];
  readonly limits: ResolvedShiptestConfig["benchmarks"][number]["limits"];
}

describe("Pi JSON harness", () => {
  it("runs a Pi JSON attempt, captures telemetry, and extracts a submission", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync("src/agent-output.txt", process.argv.at(-1));
console.log(JSON.stringify({ type: "session", version: 3, id: "fake-session", cwd: process.cwd() }));
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "turn_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "npm run test:run" } }));
console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: "secret output" }] }, isError: true }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.01 } } } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("completed");
    expect(result.ok).toBe(true);
    expect(result.telemetry.session).toMatchObject({ id: "fake-session" });
    expect(result.telemetry.tools.bash).toEqual({ calls: 1, failures: 1 });
    expect(result.telemetry.usage.total_tokens).toBe(3);
    expect(result.telemetry.usage.uncached_tokens).toBe(3);
    expect(result.submission?.changed_files).toEqual(["src/agent-output.txt"]);
    expect(result.tool_usage).toMatchObject({
      summary: { tool_calls: 1, failed_tool_calls: 1 },
      categories: [],
    });
    expect(result.artifacts.pi_events).toBeUndefined();
    expect(result.artifacts.tool_calls).toBeDefined();
    await expect(readFile(result.artifacts.tool_calls as string, "utf8")).resolves.toContain(
      "Tool output omitted by tool_usage policy.",
    );
    await expect(readFile(result.artifacts.tool_calls as string, "utf8")).resolves.not.toContain(
      "secret output",
    );
    expect(result.artifacts.prompt).toBeDefined();
    expect(result.artifacts.candidate_patch).toBeDefined();
    await expect(readFile(result.artifacts.prompt as string, "utf8")).resolves.toBe(
      "Write the answer.\n",
    );
    await expect(readFile(result.artifacts.candidate_patch as string, "utf8")).resolves.toContain(
      "agent-output.txt",
    );
  });

  it("skips oversized Pi JSON lines and continues parsing later events", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
process.stdout.write("{\\"type\\":\\"tool_execution_start\\",\\"toolName\\":\\"bash\\",\\"padding\\":\\"" + "x".repeat(${PiJsonHarnessDefaults.MaxPendingStdoutLineBytes + 1}) + "\\"}\\n");
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "after oversized" }], usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-oversized"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-oversized"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("completed");
    expect(result.telemetry.counts.oversized_events).toBe(1);
    expect(result.telemetry.final_response).toBe("after oversized");
    expect(result.telemetry.usage.total_tokens).toBe(2);
  });

  it("applies tool usage highlights and optional raw event/excerpt capture", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolCallId: "call-1", toolName: "bash", args: { command: "npm run typecheck" } }));
console.log(JSON.stringify({ type: "tool_execution_update", toolCallId: "call-1", toolName: "bash", partialResult: { content: [{ type: "text", text: "typecheck failed output" }] } }));
console.log(JSON.stringify({ type: "tool_execution_end", toolCallId: "call-1", toolName: "bash", result: { content: [{ type: "text", text: " final error" }] }, isError: true }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-tool-usage"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-tool-usage"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
      toolUsage: {
        record_tool_calls: true,
        tool_output: "excerpts",
        tool_output_excerpt_bytes: 1024,
        record_raw_events: true,
        final_response: "capped",
        final_response_max_bytes: 8192,
        stderr_max_bytes: 65536,
        categories: [
          {
            id: "verification",
            label: "Verification",
            highlights: [
              {
                id: "typecheck",
                label: "Typecheck",
                match: { tool: "bash", command_contains: "npm run typecheck" },
              },
            ],
          },
        ],
      },
    });

    expect(result.tool_usage?.categories).toEqual([
      expect.objectContaining({
        id: "verification",
        status: "failed",
        summary: { matched_tool_calls: 1, failed_tool_calls: 1 },
      }),
    ]);
    await expect(readFile(result.artifacts.tool_calls as string, "utf8")).resolves.toContain(
      "typecheck failed output",
    );
    await expect(readFile(result.artifacts.pi_events as string, "utf8")).resolves.toContain(
      "tool_execution_start",
    );
  });

  it("disables Pi context files by default and can include them when configured", async () => {
    const fixture = await createFixture();
    const argvPath = path.join(fixture.root, "argv.json");
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-no-context"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-no-context"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });
    expect(JSON.parse(await readFile(argvPath, "utf8"))).toContain("--no-context-files");

    await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-context"),
      configDir: fixture.configDir,
      benchmark: {
        ...fixture.benchmark,
        agent_context: { ...fixture.benchmark.agent_context, load_context_files: true },
      },
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-context"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });
    expect(JSON.parse(await readFile(argvPath, "utf8"))).not.toContain("--no-context-files");
  });

  it("writes final responses and classifies context exhaustion", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.error("provider error: maximum context reached");
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "partial final" }] } }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-context-exhausted"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-context-exhausted"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("context_exhausted");
    expect(result.ok).toBe(false);
    expect(result.signals.map((signal) => signal.id)).toContain("context_exhausted");
    expect(result.artifacts.final_response).toBeDefined();
    await expect(readFile(result.artifacts.final_response as string, "utf8")).resolves.toBe(
      "partial final",
    );
  });

  it("parses pending stdout that does not end in a newline", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "no newline" }] } }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-pending-stdout"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-pending-stdout"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("completed");
    expect(result.telemetry.final_response).toBe("no newline");
    expect(result.artifacts.final_response).toBeDefined();
  });

  it("classifies non-zero Pi exits as process failures", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.error("boom");
process.exit(7);
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-process-failed"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-process-failed"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("process_failed");
    expect(result.ok).toBe(false);
    expect(result.signals.map((signal) => signal.id)).toContain("agent_process_failed");
    await expect(readFile(result.artifacts.pi_stderr as string, "utf8")).resolves.toContain("boom");
  });

  it("fails before running Pi when the agent workspace exists and overwrite is false", async () => {
    const fixture = await createFixture();
    const workspace = path.join(fixture.root, "existing-agent-workspace");
    await mkdir(workspace, { recursive: true });
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
throw new Error("should not run");
`,
    );

    await expect(
      runPiJsonAgentAttempt({
        preparedBaselinePath: fixture.preparedBaselinePath,
        agentWorkspacePath: workspace,
        configDir: fixture.configDir,
        benchmark: fixture.benchmark,
        model: fixture.model,
        limits: fixture.limits,
        artifactsDir: path.join(fixture.root, "artifacts-existing-workspace"),
        piExecutable: fakePi.executable,
        piExecutableArgs: fakePi.args,
      }),
    ).rejects.toThrow("Agent workspace already exists");
  });

  it("overwrites an existing agent workspace when requested", async () => {
    const fixture = await createFixture();
    const workspace = path.join(fixture.root, "overwrite-agent-workspace");
    await mkdir(workspace, { recursive: true });
    await writeFile(path.join(workspace, "stale.txt"), "stale\n", "utf8");
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: workspace,
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-overwrite-workspace"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("completed");
    await expect(readFile(path.join(workspace, "stale.txt"), "utf8")).rejects.toThrow();
  });

  it("classifies tool-call and token budget exhaustion", async () => {
    const fixture = await createFixture();
    const toolBudgetPi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "read" }));
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "read" }));
`,
    );

    const toolBudgetResult = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-tool-budget"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: { ...fixture.limits, max_tool_calls: 1 },
      artifactsDir: path.join(fixture.root, "artifacts-tool-budget"),
      piExecutable: toolBudgetPi.executable,
      piExecutableArgs: toolBudgetPi.args,
      overwrite: true,
    });
    expect(toolBudgetResult.status).toBe("budget_exceeded");
    expect(toolBudgetResult.signals.map((signal) => signal.id)).toContain(
      "max_tool_calls_exceeded",
    );

    const tokenBudgetPi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20 } } }));
`,
    );
    const tokenBudgetResult = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-token-budget"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: { ...fixture.limits, max_total_tokens: 1 },
      artifactsDir: path.join(fixture.root, "artifacts-token-budget"),
      piExecutable: tokenBudgetPi.executable,
      piExecutableArgs: tokenBudgetPi.args,
      overwrite: true,
    });
    expect(tokenBudgetResult.status).toBe("budget_exceeded");
    expect(tokenBudgetResult.signals.map((signal) => signal.id)).toContain(
      "max_total_tokens_exceeded",
    );

    const uncachedBudgetPi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 10, output: 10, cacheRead: 1000, cacheWrite: 5, totalTokens: 1025 } } }));
`,
    );
    const uncachedBudgetResult = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-uncached-budget"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: { ...fixture.limits, max_total_tokens: 2000, max_uncached_tokens: 20 },
      artifactsDir: path.join(fixture.root, "artifacts-uncached-budget"),
      piExecutable: uncachedBudgetPi.executable,
      piExecutableArgs: uncachedBudgetPi.args,
      overwrite: true,
    });
    expect(uncachedBudgetResult.status).toBe("budget_exceeded");
    expect(uncachedBudgetResult.signals.map((signal) => signal.id)).toContain(
      "max_uncached_tokens_exceeded",
    );
  });

  it("returns extraction_failed when synthetic Git cannot produce a submission", async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.preparedBaselinePath, ".git"), { recursive: true, force: true });
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-extraction-failed"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: fixture.limits,
      artifactsDir: path.join(fixture.root, "artifacts-extraction-failed"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("extraction_failed");
    expect(result.ok).toBe(false);
    expect(result.signals.map((signal) => signal.id)).toContain("submission_extraction_failed");
  });

  it("stops attempts when event budgets are exceeded and still extracts partial submissions", async () => {
    const fixture = await createFixture();
    const fakePi = await createFakePi(
      fixture.root,
      `#!/usr/bin/env node
const fs = require("node:fs");
fs.writeFileSync("src/partial.txt", "partial\\n");
console.log(JSON.stringify({ type: "turn_start" }));
console.log(JSON.stringify({ type: "turn_start" }));
`,
    );

    const result = await runPiJsonAgentAttempt({
      preparedBaselinePath: fixture.preparedBaselinePath,
      agentWorkspacePath: path.join(fixture.root, "agent-workspace-budget"),
      configDir: fixture.configDir,
      benchmark: fixture.benchmark,
      model: fixture.model,
      limits: { ...fixture.limits, max_turns: 1, max_attempt_mins: 1 },
      artifactsDir: path.join(fixture.root, "artifacts-budget"),
      piExecutable: fakePi.executable,
      piExecutableArgs: fakePi.args,
      overwrite: true,
    });

    expect(result.status).toBe("budget_exceeded");
    expect(result.ok).toBe(false);
    expect(result.signals.map((signal) => signal.id)).toContain("max_turns_exceeded");
    expect(result.submission?.changed_files).toEqual(["src/partial.txt"]);
  });
});

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-pi-json-"));
  const configDir = path.join(root, "config");
  const preparedBaselinePath = path.join(root, "baseline");
  await mkdir(path.join(configDir, "tasks"), { recursive: true });
  await mkdir(path.join(preparedBaselinePath, "src"), { recursive: true });
  await writeFile(path.join(configDir, "tasks", "task.md"), "Write the answer.\n", "utf8");
  await writeFile(path.join(preparedBaselinePath, "src", "index.ts"), "export {};\n", "utf8");
  await initializeCleanGitRepo(preparedBaselinePath);

  const config = createResolvedShiptestConfig({
    benchmarks: [configBenchmark("bench", { task: "tasks/task.md" })],
  });
  const [benchmark] = config.benchmarks;
  const [model] = config.models;
  if (!benchmark || !model) {
    throw new Error("expected fixture config");
  }

  return { root, configDir, preparedBaselinePath, benchmark, model, limits: benchmark.limits };
}

async function createFakePi(
  root: string,
  script: string,
): Promise<{ readonly executable: string; readonly args: readonly string[] }> {
  const jsPath = path.join(root, `fake-pi-${crypto.randomUUID()}.js`);
  await writeFile(jsPath, script, "utf8");
  return { executable: process.execPath, args: [jsPath] };
}
