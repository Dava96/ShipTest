import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { initializeCleanGitRepo } from "../baseline/clean-git-repo.js";
import {
  benchmark,
  createShiptestConfigFixture,
  model,
} from "../test-support/shiptest-config-fixture.js";
import { runShiptest } from "./run.js";

describe("draft run mode", () => {
  it("blocks dirty default runs and allows explicit draft runs", async () => {
    const fixture = await createDraftFixture();
    await writeFile(path.join(fixture.repoPath, "local-only.txt"), "draft input\n", "utf8");

    await expect(
      runShiptest({
        configPath: fixture.configPath,
        runRootPath: path.join(fixture.root, "default-run"),
        piExecutable: process.execPath,
        piExecutableArgs: [fixture.fakePiPath],
      }),
    ).rejects.toThrow(
      "Cannot run reproducible benchmark because the repository has uncommitted changes.",
    );

    const result = await runShiptest({
      configPath: fixture.configPath,
      runRootPath: path.join(fixture.root, "draft-run"),
      draft: true,
      piExecutable: process.execPath,
      piExecutableArgs: [fixture.fakePiPath],
    });

    expect(result.status).toBe("completed");
    expect(result.run_mode).toBe("draft");
    expect(result.snapshot_source).toBe("working_tree");

    const resultsJson = JSON.parse(
      await readFile(path.join(fixture.root, "draft-run", "results.json"), "utf8"),
    ) as typeof result;
    expect(resultsJson.run_mode).toBe("draft");
    expect(resultsJson.snapshot_source).toBe("working_tree");
    await expect(
      readFile(path.join(fixture.root, "draft-run", "report.html"), "utf8"),
    ).resolves.toContain("Draft / working tree");
  });
});

async function createDraftFixture(): Promise<{
  readonly root: string;
  readonly repoPath: string;
  readonly configPath: string;
  readonly fakePiPath: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-draft-mode-"));
  const repoPath = path.join(root, "repo");
  await mkdir(path.join(repoPath, "src"), { recursive: true });
  await writeFile(path.join(repoPath, "src", "index.txt"), "baseline\n", "utf8");
  await initializeCleanGitRepo(repoPath);

  const fakePiPath = path.join(root, "fake-pi.cjs");
  await writeFile(
    fakePiPath,
    `const fs = require("node:fs");
fs.mkdirSync("src", { recursive: true });
fs.writeFileSync("src/generated.txt", "generated\\n");
console.log(JSON.stringify({ type: "agent_start" }));
console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3, cost: { total: 0.01 } } } }));
console.log(JSON.stringify({ type: "agent_end", messages: [] }));
`,
    "utf8",
  );

  const configFixture = await createShiptestConfigFixture({
    root,
    configSubdir: "config",
    projectRepo: repoPath,
    environment: { validate: ["node --version"] },
    models: [model("fake")],
    defaultModels: ["fake"],
    scoringCommand: `node -e "process.exit(0)"`,
    benchmarks: [benchmark("bench", { task: "tasks/task.md" })],
    files: { "tasks/task.md": "Create generated file.\n" },
  });

  return { root, repoPath, configPath: configFixture.configPath, fakePiPath };
}
