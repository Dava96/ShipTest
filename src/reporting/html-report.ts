import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AttemptReport, RunResults } from "../run/types.js";
import {
  benchmarkDetailReportPath,
  modelDetailReportPath,
  modelsOverviewReportPath,
} from "./html-report-components.js";
import {
  renderBenchmarkReport,
  renderModelReport,
  renderModelsReport,
  renderReport,
} from "./html-report-renderer.js";

export async function writeHtmlReport(options: {
  readonly runRootPath: string;
  readonly reportPath: string;
}): Promise<void> {
  const results = JSON.parse(
    await readFile(path.join(options.runRootPath, "results.json"), "utf8"),
  ) as RunResults;
  const attempts: AttemptReport[] = [];
  for (const benchmark of results.benchmark_results) {
    for (const baseCommit of benchmark.base_commits) {
      for (const attemptPath of baseCommit.attempts) {
        attempts.push(
          JSON.parse(
            await readFile(path.join(options.runRootPath, attemptPath), "utf8"),
          ) as AttemptReport,
        );
      }
    }
  }

  const reportAttempts = await sanitizeAttemptArtifactLinks(options.runRootPath, attempts);

  await writeFile(options.reportPath, renderReport(results, reportAttempts), "utf8");
  await writeFile(
    path.join(options.runRootPath, modelsOverviewReportPath()),
    renderModelsReport({ results, attempts: reportAttempts }),
    "utf8",
  );
  await writeBenchmarkReports({
    runRootPath: options.runRootPath,
    results,
    attempts: reportAttempts,
  });
  await writeModelReports({ runRootPath: options.runRootPath, results, attempts: reportAttempts });
}

async function sanitizeAttemptArtifactLinks(
  runRootPath: string,
  attempts: readonly AttemptReport[],
): Promise<AttemptReport[]> {
  return Promise.all(attempts.map((attempt) => sanitizeAttemptArtifactLink(runRootPath, attempt)));
}

async function sanitizeAttemptArtifactLink(
  runRootPath: string,
  attempt: AttemptReport,
): Promise<AttemptReport> {
  const candidatePatch = await availableArtifactPath(
    runRootPath,
    attempt.artifacts.candidate_patch,
  );
  const attemptJson = await availableArtifactPath(runRootPath, attempt.artifacts.attempt_json);
  const toolCallsJsonl = await availableArtifactPath(
    runRootPath,
    attempt.tool_usage?.artifacts.tool_calls_jsonl,
  );
  const evaluationCommands =
    attempt.evaluation?.commands === undefined
      ? undefined
      : await Promise.all(
          attempt.evaluation.commands.map(async (command) => {
            const stdoutArtifact = await availableArtifactPath(
              runRootPath,
              command.stdout_artifact,
            );
            const stderrArtifact = await availableArtifactPath(
              runRootPath,
              command.stderr_artifact,
            );
            return {
              command: command.command,
              exit_code: command.exit_code,
              duration_ms: command.duration_ms,
              ...(stdoutArtifact === undefined ? {} : { stdout_artifact: stdoutArtifact }),
              ...(stderrArtifact === undefined ? {} : { stderr_artifact: stderrArtifact }),
            };
          }),
        );

  const artifacts = { ...attempt.artifacts };
  if (candidatePatch === undefined) {
    delete artifacts.candidate_patch;
  } else {
    artifacts.candidate_patch = candidatePatch;
  }
  if (attemptJson === undefined) {
    delete artifacts.attempt_json;
  } else {
    artifacts.attempt_json = attemptJson;
  }

  const toolUsage =
    attempt.tool_usage === undefined
      ? undefined
      : {
          ...attempt.tool_usage,
          artifacts: {
            ...(toolCallsJsonl === undefined ? {} : { tool_calls_jsonl: toolCallsJsonl }),
          },
        };

  return {
    ...attempt,
    artifacts,
    ...(toolUsage === undefined ? {} : { tool_usage: toolUsage }),
    ...(attempt.evaluation === undefined || evaluationCommands === undefined
      ? {}
      : {
          evaluation: {
            ...attempt.evaluation,
            commands: evaluationCommands,
          },
        }),
  };
}

async function availableArtifactPath(
  runRootPath: string,
  artifactPath: string | undefined,
): Promise<string | undefined> {
  if (!artifactPath) return undefined;
  const filesystemArtifactPath = artifactPath.split(/[?#]/, 1)[0] ?? artifactPath;
  const resolvedPath = path.isAbsolute(filesystemArtifactPath)
    ? filesystemArtifactPath
    : path.join(runRootPath, filesystemArtifactPath);
  try {
    const artifactStat = await stat(resolvedPath);
    return artifactStat.isFile() && artifactStat.size > 0 ? artifactPath : undefined;
  } catch {
    return undefined;
  }
}

async function writeModelReports(options: {
  readonly runRootPath: string;
  readonly results: RunResults;
  readonly attempts: readonly AttemptReport[];
}): Promise<void> {
  const attemptsByModel = new Map<string, AttemptReport[]>();
  for (const attempt of options.attempts) {
    const existing = attemptsByModel.get(attempt.model.id) ?? [];
    existing.push(attempt);
    attemptsByModel.set(attempt.model.id, existing);
  }
  for (const [modelId, modelAttempts] of attemptsByModel.entries()) {
    const reportPath = path.join(options.runRootPath, modelDetailReportPath(modelId));
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      renderModelReport({
        results: options.results,
        modelId,
        attempts: modelAttempts,
        allAttempts: options.attempts,
      }),
      "utf8",
    );
  }
}

async function writeBenchmarkReports(options: {
  readonly runRootPath: string;
  readonly results: RunResults;
  readonly attempts: readonly AttemptReport[];
}): Promise<void> {
  const attemptsByBenchmark = new Map<string, AttemptReport[]>();
  for (const attempt of options.attempts) {
    const existing = attemptsByBenchmark.get(attempt.benchmark_id) ?? [];
    existing.push(attempt);
    attemptsByBenchmark.set(attempt.benchmark_id, existing);
  }
  for (const benchmark of options.results.benchmark_results) {
    const benchmarkAttempts = attemptsByBenchmark.get(benchmark.benchmark_id) ?? [];
    const reportPath = path.join(
      options.runRootPath,
      benchmarkDetailReportPath(benchmark.benchmark_id),
    );
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(
      reportPath,
      renderBenchmarkReport({
        results: options.results,
        benchmarkId: benchmark.benchmark_id,
        attempts: benchmarkAttempts,
      }),
      "utf8",
    );
  }
}
