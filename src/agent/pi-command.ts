import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PiCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export function resolvePiCommand(
  executable: string | undefined,
  args: readonly string[] | undefined = [],
): PiCommand {
  if (executable && executable !== "pi") {
    return { executable, args };
  }

  return {
    executable: process.execPath,
    args: [resolveBundledPiCliPath(), ...args],
  };
}

function resolveBundledPiCliPath(): string {
  const packageEntryPoint = fileURLToPath(import.meta.resolve("@mariozechner/pi-coding-agent"));
  return path.join(path.dirname(packageEntryPoint), "cli.js");
}
