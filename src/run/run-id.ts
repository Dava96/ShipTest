import { randomBytes } from "node:crypto";

export function createRunId(date = new Date()): string {
  const timestamp = date
    .toISOString()
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z")
    .replace("T", "-")
    .replace("Z", "");
  return `${timestamp}-${randomBytes(3).toString("hex")}`;
}
