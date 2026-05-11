import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function writeRunEvent(
  eventsPath: string,
  event: Record<string, unknown>,
): Promise<void> {
  await mkdir(path.dirname(eventsPath), { recursive: true });
  await appendFile(
    eventsPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
    "utf8",
  );
}
