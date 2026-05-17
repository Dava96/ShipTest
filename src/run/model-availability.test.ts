import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { ResolvedShiptestConfig } from "../config/schema.js";
import {
  checkPiModelAvailability,
  formatMissingPiModelsMessage,
  parsePiListModelsOutput,
} from "./model-availability.js";

describe("Pi model availability", () => {
  it("parses pi --list-models table output", () => {
    expect(
      parsePiListModelsOutput(`provider      model                context  max-out  thinking  images
openai-codex  gpt-5.4-mini         272K     128K     yes       yes
openai-codex  gpt-5.3-codex-spark  128K     128K     yes       no
`),
    ).toEqual([
      { provider: "openai-codex", model: "gpt-5.4-mini" },
      { provider: "openai-codex", model: "gpt-5.3-codex-spark" },
    ]);
  });

  it("ignores blank/header/malformed lines while parsing list-models output", () => {
    expect(
      parsePiListModelsOutput(`
provider      model

openai-codex  gpt-5.4-mini
only-one-column
anthropic     claude-sonnet-4.5    200K
`),
    ).toEqual([
      { provider: "openai-codex", model: "gpt-5.4-mini" },
      { provider: "anthropic", model: "claude-sonnet-4.5" },
    ]);
  });

  it("reports ok when every configured model is listed by Pi", async () => {
    const fakePi = await createFakePi(`
if (!process.argv.includes("--list-models")) process.exit(9);
console.log("provider      model");
console.log("openai-codex  gpt-5.4-mini");
console.error("openai-codex  gpt-5.5");
`);

    await expect(
      checkPiModelAvailability({
        models: [
          model("mini", "openai-codex", "gpt-5.4-mini"),
          model("full", "openai-codex", "gpt-5.5"),
        ],
        piExecutable: process.execPath,
        piExecutableArgs: [fakePi],
      }),
    ).resolves.toEqual({
      ok: true,
      available_models: [
        { provider: "openai-codex", model: "gpt-5.4-mini" },
        { provider: "openai-codex", model: "gpt-5.5" },
      ],
      missing_models: [],
    });
  });

  it("reports missing configured models by provider and model", async () => {
    const fakePi = await createFakePi(`
console.log("provider      model");
console.log("openai-codex  gpt-5.4-mini");
`);

    const result = await checkPiModelAvailability({
      models: [
        model("available", "openai-codex", "gpt-5.4-mini"),
        model("wrong-provider", "anthropic", "gpt-5.4-mini"),
        model("missing", "openai-codex", "gpt-5.5"),
      ],
      piExecutable: process.execPath,
      piExecutableArgs: [fakePi],
    });

    expect(result.ok).toBe(false);
    expect(result.missing_models).toEqual([
      { id: "wrong-provider", provider: "anthropic", model: "gpt-5.4-mini" },
      { id: "missing", provider: "openai-codex", model: "gpt-5.5" },
    ]);
  });

  it("formats a user-facing missing model warning", () => {
    expect(
      formatMissingPiModelsMessage({
        ok: false,
        available_models: [],
        missing_models: [{ id: "mini", provider: "openai-codex", model: "gpt-5.4-mini" }],
      }),
    ).toBe(`Configured model(s) were not listed by \`pi --list-models\`.
- mini: openai-codex/gpt-5.4-mini
Run \`pi --list-models\` and update shiptest.yaml to use models available to this Pi account.`);
  });

  it("rejects when pi --list-models exits non-zero", async () => {
    const fakePi = await createFakePi(`
console.error("list failed");
process.exit(3);
`);

    await expect(
      checkPiModelAvailability({
        models: [model("mini", "openai-codex", "gpt-5.4-mini")],
        piExecutable: process.execPath,
        piExecutableArgs: [fakePi],
      }),
    ).rejects.toThrow("list failed");
  });

  it("rejects when pi --list-models times out", async () => {
    const fakePi = await createFakePi(`setTimeout(() => {}, 10_000);`);

    await expect(
      checkPiModelAvailability({
        models: [model("mini", "openai-codex", "gpt-5.4-mini")],
        piExecutable: process.execPath,
        piExecutableArgs: [fakePi],
        timeoutMs: 50,
      }),
    ).rejects.toThrow("Timed out while running `pi --list-models`.");
  });

  it("rejects when pi --list-models produces too much output", async () => {
    const fakePi = await createFakePi(`process.stdout.write("x".repeat(1024));`);

    await expect(
      checkPiModelAvailability({
        models: [model("mini", "openai-codex", "gpt-5.4-mini")],
        piExecutable: process.execPath,
        piExecutableArgs: [fakePi],
        maxOutputBytes: 10,
      }),
    ).rejects.toThrow("`pi --list-models` produced too much output.");
  });
});

async function createFakePi(source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shiptest-model-availability-"));
  const scriptPath = path.join(root, "fake-pi.cjs");
  await writeFile(scriptPath, source, "utf8");
  return scriptPath;
}

function model(
  id: string,
  provider: string,
  modelName: string,
): ResolvedShiptestConfig["models"][number] {
  return { id, provider, model: modelName } as ResolvedShiptestConfig["models"][number];
}
