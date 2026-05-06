import { createHash } from "node:crypto";

export function sha256Text(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function sha256Json(value: unknown): string {
  return sha256Text(stableJsonStringify(value));
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`)
    .join(",")}}`;
}
