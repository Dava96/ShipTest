import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { writeHtmlReport } from "./html-report.js";

describe("HTML report", () => {
  it("renders run summary, attempts, links, and escaped content", async () => {
    const root = await mkdtempPath();
    const attemptPath = path.join(root, "benchmarks", "invoice", "attempts", "001", "attempt.json");
    await mkdir(path.dirname(attemptPath), { recursive: true });
    await writeFile(
      attemptPath,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-<1>",
        benchmark_id: "invoice<script>",
        base_commit: { commit: "abc123", label: "abc123", slug: "abc123", index: 1 },
        benchmark_type: "implementation",
        task: ".shiptest/tasks/invoice.md",
        attempt: 1,
        status: "completed",
        model: { id: "gpt-5.5&test", provider: "openai-codex", model: "gpt-5.5" },
        agent: {
          ok: true,
          status: "completed",
          signals: [],
          telemetry: {
            lifecycle: { agent_started: true, agent_ended: true, process_exit_code: 0 },
            counts: {
              events: 1,
              turns: 1,
              messages_started: 0,
              messages_completed: 1,
              tool_calls: 0,
              failed_tool_calls: 0,
              compactions: 0,
              auto_retries: 0,
              malformed_events: 0,
            },
            tools: {},
            usage: {
              input_tokens: 1,
              output_tokens: 2,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              total_tokens: 3,
              uncached_tokens: 3,
              estimated_cost_usd: { total: 0.123456 },
              source: "pi",
            },
            error_messages: [],
            compactions: [],
            auto_retries: [],
          },
        },
        evaluation: {
          ok: true,
          status: "EVALUATED",
          verdict: "passed",
          score: 100,
          evaluation_workspace_path: "workspace",
          checks: [],
          signals: [],
          commands: [],
          artifacts: {},
        },
        human_review: { status: "pending" },
        artifacts: {
          attempt_json: "benchmarks/invoice/attempts/001/attempt.json",
          candidate_patch: "benchmarks/invoice/attempts/001/candidate.patch?x=<y>",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(root, "benchmarks", "invoice", "attempts", "001", "candidate.patch"),
      "diff --git a/invoice.ts b/invoice.ts\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "results.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: "run-<1>",
        created_at: "2026-05-11T00:00:00.000Z",
        status: "completed",
        project: { name: "fixture" },
        summary: {
          benchmarks: 1,
          agent_runs: 1,
          completed: 1,
          completed_with_issues: 0,
          agent_failed: 0,
          evaluation_failed: 0,
          passed: 1,
          needs_review: 0,
          failed: 0,
          total_tokens: 3,
          input_tokens: 1,
          output_tokens: 2,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          uncached_tokens: 3,
          estimated_cost_usd: 0.123456,
        },
        benchmark_results: [
          {
            benchmark_id: "invoice",
            base_commits: [
              {
                commit: "abc123",
                label: "abc123",
                slug: "abc123",
                index: 1,
                attempts: ["benchmarks/invoice/attempts/001/attempt.json"],
              },
            ],
          },
        ],
        artifacts: { report_html: "report.html", events_jsonl: "events.jsonl" },
      }),
      "utf8",
    );

    const reportPath = path.join(root, "report.html");
    await writeHtmlReport({ runRootPath: root, reportPath });

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("ShipTest report");
    expect(html).toContain("run-&lt;1&gt;");
    expect(html).toContain("invoice&lt;script&gt;");
    expect(html).toContain("gpt-5.5&amp;test");
    expect(html).toContain("passed");
    expect(html).toContain("Total estimated cost");
    expect(html).toContain("$0.12");
    expect(html).toContain('title="$0.1235"');
    expect(html).toContain("benchmarks/invoice/attempts/001/candidate.patch?x=&lt;y&gt;");
    expect(await readFile(path.join(root, "models.html"), "utf8")).toContain(
      "Model capability comparison",
    );
    expect(await readFile(path.join(root, "model-gpt-5-5-test.html"), "utf8")).toContain(
      "Strengths radar",
    );
    expect(await readFile(path.join(root, "benchmark-invoice.html"), "utf8")).toContain(
      "Quality details",
    );
  });

  it("renders attempts without evaluation or patch artifacts", async () => {
    const root = await mkdtempPath();
    const attemptPath = path.join(root, "attempt.json");
    await writeFile(
      attemptPath,
      JSON.stringify({
        schema_version: 1,
        run_id: "run-1",
        benchmark_id: "invoice",
        base_commit: { commit: "abc123", label: "abc123", slug: "abc123", index: 1 },
        benchmark_type: "implementation",
        task: "task.md",
        attempt: 1,
        status: "agent_failed",
        model: { id: "gpt", provider: "openai", model: "gpt" },
        agent: {
          ok: false,
          status: "process_failed",
          signals: [],
          telemetry: {
            lifecycle: { agent_started: false, agent_ended: false, process_exit_code: 1 },
            counts: {
              events: 0,
              turns: 0,
              messages_started: 0,
              messages_completed: 0,
              tool_calls: 0,
              failed_tool_calls: 0,
              compactions: 0,
              auto_retries: 0,
              malformed_events: 0,
            },
            tools: {},
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cache_read_tokens: 0,
              cache_write_tokens: 0,
              total_tokens: 0,
              uncached_tokens: 0,
              source: "pi",
            },
            error_messages: [],
            compactions: [],
            auto_retries: [],
          },
        },
        quality_signals: [
          {
            id: "agent_no_token_usage",
            severity: "error",
            message: "Agent attempt reported zero token usage.",
          },
        ],
        tool_usage: {
          summary: { tool_calls: 1, failed_tool_calls: 0 },
          categories: [],
          artifacts: { tool_calls_jsonl: "empty-tool-calls.jsonl" },
        },
        human_review: { status: "pending" },
        artifacts: { attempt_json: "attempt.json", candidate_patch: "empty.patch" },
      }),
      "utf8",
    );
    await writeFile(path.join(root, "empty.patch"), "", "utf8");
    await writeFile(path.join(root, "empty-tool-calls.jsonl"), "", "utf8");
    await writeFile(
      path.join(root, "results.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: "run-1",
        created_at: "2026-05-11T00:00:00.000Z",
        status: "completed_with_issues",
        project: { name: "fixture" },
        summary: {
          benchmarks: 1,
          agent_runs: 1,
          completed: 0,
          completed_with_issues: 0,
          agent_failed: 1,
          evaluation_failed: 0,
          passed: 0,
          needs_review: 0,
          failed: 0,
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          uncached_tokens: 0,
        },
        benchmark_results: [
          {
            benchmark_id: "invoice",
            base_commits: [
              {
                commit: "abc123",
                label: "abc123",
                slug: "abc123",
                index: 1,
                attempts: ["attempt.json"],
              },
            ],
          },
        ],
        artifacts: { report_html: "report.html", events_jsonl: "events.jsonl" },
      }),
      "utf8",
    );

    const reportPath = path.join(root, "report.html");
    await writeHtmlReport({ runRootPath: root, reportPath });

    const html = await readFile(reportPath, "utf8");
    expect(html).toContain("not_run");
    expect(html).toContain("process_failed");
    expect(html).toContain("not available");
    expect(html).toContain("artifact-link-disabled");
    const benchmarkHtml = await readFile(path.join(root, "benchmark-invoice.html"), "utf8");
    expect(benchmarkHtml).toContain("Artifact was not generated");
    expect(benchmarkHtml).toContain("agent_no_token_usage");
    expect(benchmarkHtml).not.toContain("empty-tool-calls.jsonl");
    const modelHtml = await readFile(path.join(root, "model-gpt.html"), "utf8");
    expect(modelHtml).toContain('Tool reliability</span><span class="rank">0/100');
    expect(modelHtml).toContain('Patch focus</span><span class="rank">0/100');
  });
});

async function mkdtempPath(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), "shiptest-html-report-"));
}
