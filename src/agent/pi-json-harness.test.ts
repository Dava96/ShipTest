import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import { type ResolvedShiptestConfig, ShiptestConfigSchema } from "../config/schema.js";
import { runPiJsonAgentAttempt } from "./pi-json-harness.js";

interface Fixture {
  readonly root: string;
  readonly configDir: string;
  readonly preparedBaselinePath: string;
  readonly benchmark: ResolvedShiptestConfig["benchmarks"][number];
  readonly model: ResolvedShiptestConfig["models"][number];
  readonly limits: ResolvedShiptestConfig["limits"];
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
console.log(JSON.stringify({ type: "tool_execution_start", toolName: "write" }));
console.log(JSON.stringify({ type: "tool_execution_end", toolName: "write", isError: false }));
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
    expect(result.telemetry.tools.write).toEqual({ calls: 1, failures: 0 });
    expect(result.telemetry.usage.total_tokens).toBe(3);
    expect(result.submission?.changed_files).toEqual(["src/agent-output.txt"]);
    expect(result.artifacts.prompt).toBeDefined();
    expect(result.artifacts.candidate_patch).toBeDefined();
    await expect(readFile(result.artifacts.prompt as string, "utf8")).resolves.toBe(
      "Write the answer.\n",
    );
    await expect(readFile(result.artifacts.candidate_patch as string, "utf8")).resolves.toContain(
      "agent-output.txt",
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

  const config = ShiptestConfigSchema.parse({
    version: 1,
    project: { name: "fixture", repo: "." },
    repository_environment: { validation_commands: { required: ["node --version"] } },
    models: [{ id: "fake", provider: "openai", model: "fake-model" }],
    benchmarks: [
      {
        id: "bench",
        type: "implementation",
        task: "tasks/task.md",
        evaluation: { scoring_command: "node --version" },
      },
    ],
  });
  const [benchmark] = config.benchmarks;
  const [model] = config.models;
  if (!benchmark || !model) {
    throw new Error("expected fixture config");
  }

  return { root, configDir, preparedBaselinePath, benchmark, model, limits: config.limits };
}

async function createFakePi(
  root: string,
  script: string,
): Promise<{ readonly executable: string; readonly args: readonly string[] }> {
  const jsPath = path.join(root, `fake-pi-${crypto.randomUUID()}.js`);
  await writeFile(jsPath, script, "utf8");
  return { executable: process.execPath, args: [jsPath] };
}
