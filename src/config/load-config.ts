import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { z } from "zod";

import { ShiptestConfigError, type ValidationIssue } from "./errors.js";
import { pathToConfigPath, resolveConfigRelativePath } from "./paths.js";
import { type ResolvedShiptestConfig, ShiptestConfigSchema } from "./schema.js";
import { validateResolvedConfig } from "./validate-config.js";

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

  const semanticIssues = await validateResolvedConfig(context);
  if (semanticIssues.length > 0) {
    throw new ShiptestConfigError("ShipTest config validation failed", semanticIssues);
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
    if (await fileExists(resolved)) {
      return resolved;
    }
  }

  throw new ShiptestConfigError("ShipTest config file not found", [
    {
      code: "CONFIG_FILE_NOT_FOUND",
      path: "config",
      message: `Could not find ${defaultConfigNames.join(", ")}`,
    },
  ]);
}

async function assertFileExists(filePath: string, pathName: string): Promise<void> {
  if (!(await fileExists(filePath))) {
    throw new ShiptestConfigError("Referenced file does not exist", [
      {
        code: "CONFIG_FILE_NOT_FOUND",
        path: pathName,
        message: `File does not exist: ${filePath}`,
      },
    ]);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    code: "CONFIG_SCHEMA_INVALID",
    path: pathToConfigPath(issue.path.filter((segment) => typeof segment !== "symbol")),
    message: issue.message,
  }));
}

export function resolveHostAssetPath(configDir: string, assetPath: string): string {
  return resolveConfigRelativePath(configDir, assetPath);
}
