import path from "node:path";

export function resolveConfigRelativePath(configDir: string, value: string): string {
  return path.resolve(configDir, value);
}

export function resolveRepoRelativePath(repoDir: string, value: string): string {
  return path.resolve(repoDir, value);
}

export function isSafeWorkspacePath(value: string): boolean {
  if (path.isAbsolute(value)) {
    return false;
  }

  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    return false;
  }

  return !normalized.split("/").includes("..");
}

export function pathToConfigPath(pathSegments: readonly (string | number)[]): string {
  return pathSegments.reduce<string>((current, segment) => {
    if (typeof segment === "number") {
      return `${current}[${segment}]`;
    }
    return current ? `${current}.${segment}` : segment;
  }, "");
}
