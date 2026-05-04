import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { pathExists } from "../utils/filesystem.js";
import { ShiptestConfigError, type ValidationIssue } from "./errors.js";
import { ConfigIssueCode } from "./issue-codes.js";
import { resolveConfigRelativePath, zodIssuePathToConfigPath } from "./paths.js";
import { type ResolvedShiptestConfig, ShiptestConfigSchema } from "./schema.js";
import { validateConfigReferences } from "./validate-config.js";

const defaultConfigNames = [
  "shiptest.yaml",
  "shiptest.yml",
  path.join(".shiptest", "shiptest.yaml"),
  path.join(".shiptest", "shiptest.yml"),
] as const;

export interface ShiptestConfigContext {
  readonly config: ResolvedShiptestConfig;
  readonly configPath: string;
  readonly configDir: string;
}

export async function loadShiptestConfig(configPath?: string): Promise<ResolvedShiptestConfig> {
  return (await loadShiptestConfigContext(configPath)).config;
}

export async function loadShiptestConfigContext(
  configPath?: string,
): Promise<ShiptestConfigContext> {
  const resolvedConfigPath = await resolveConfigPath(configPath);
  const configDir = path.dirname(resolvedConfigPath);
  const configText = await readFile(resolvedConfigPath, "utf8");
  const rawConfig = parseYaml(configText);
  const parsed = ShiptestConfigSchema.safeParse(rawConfig);

  if (!parsed.success) {
    throw new ShiptestConfigError(
      "ShipTest config schema validation failed",
      zodIssues(parsed.error),
    );
  }

  const context = {
    config: parsed.data,
    configPath: resolvedConfigPath,
    configDir,
  } satisfies ShiptestConfigContext;

  const referenceIssues = await validateConfigReferences(context);
  if (referenceIssues.length > 0) {
    throw new ShiptestConfigError("ShipTest config validation failed", referenceIssues);
  }

  return context;
}

async function resolveConfigPath(configPath?: string): Promise<string> {
  if (configPath) {
    const resolved = path.resolve(configPath);
    await assertFileExists(resolved, "config");
    return resolved;
  }

  for (const candidate of defaultConfigNames) {
    const resolved = path.resolve(candidate);
    if (await pathExists(resolved)) {
      return resolved;
    }
  }

  throw new ShiptestConfigError("ShipTest config file not found", [
    {
      code: ConfigIssueCode.ConfigFileNotFound,
      path: "config",
      message: `Could not find ${defaultConfigNames.join(", ")}`,
    },
  ]);
}

async function assertFileExists(filePath: string, pathName: string): Promise<void> {
  if (!(await pathExists(filePath))) {
    throw new ShiptestConfigError("Referenced file does not exist", [
      {
        code: ConfigIssueCode.ConfigFileNotFound,
        path: pathName,
        message: `File does not exist: ${filePath}`,
      },
    ]);
  }
}

function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: ConfigIssueCode.ConfigSchemaInvalid,
    path: zodIssuePathToConfigPath(issue.path),
    message: issue.message,
  }));
}

export function resolveHostAssetPath(configDir: string, assetPath: string): string {
  return resolveConfigRelativePath(configDir, assetPath);
}
