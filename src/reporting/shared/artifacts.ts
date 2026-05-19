import { escapeAttribute, escapeHtml } from "./html.js";

export function artifactLink(artifactPath: string | undefined, label: string): string {
  return artifactPath
    ? `<a href="${escapeAttribute(artifactPath)}">${escapeHtml(label)}</a>`
    : `<span class="artifact-link-disabled" aria-disabled="true" title="Artifact was not generated">${escapeHtml(label)}</span>`;
}
