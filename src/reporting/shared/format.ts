import type { RunResults } from "../../run/types.js";

export function formatRunMode(results: RunResults): string {
  if (results.run_mode === "draft") {
    return "Draft / working tree";
  }
  return "Reproducible / git commit";
}

export function formatStatus(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatUsd(value: number | undefined): string {
  if (value === undefined) {
    return "not available";
  }
  if (value >= 100) {
    return `$${value.toFixed(0)}`;
  }
  if (value >= 10) {
    return `$${value.toFixed(2)}`;
  }
  return `$${value.toFixed(4)}`;
}

export function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000) {
    return `${formatNumber(value / 1_000_000, value >= 10_000_000 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${formatNumber(value / 1_000, value >= 10_000 ? 0 : 1)}k`;
  }
  return String(value);
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}
