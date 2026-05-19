import { formatStatus } from "./format.js";
import { escapeAttribute, escapeHtml } from "./html.js";

export function statusBadge(value: string): string {
  const normalized = value === "needs_review" ? "review" : value;
  return `<span class="badge ${escapeAttribute(normalized)}">${escapeHtml(formatStatus(value))}</span>`;
}
