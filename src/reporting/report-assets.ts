import { readFileSync } from "node:fs";

export function readReportAsset(fileName: "report.css" | "report.js"): string {
  return readFileSync(new URL(`./assets/${fileName}`, import.meta.url), "utf8");
}
