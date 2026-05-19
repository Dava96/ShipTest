import { escapeAttribute, escapeHtml } from "./html.js";

export interface NavPill {
  readonly label: string;
  readonly href: string;
  readonly active?: boolean;
}

export function renderTopbar(options: {
  readonly ariaLabel: string;
  readonly nav: readonly NavPill[];
}): string {
  return `<header class="topbar">
    <div class="brand"><span class="brand-mark"></span> ShipTest Analysis</div>
    <nav class="nav-pills" aria-label="${escapeAttribute(options.ariaLabel)}">
      ${options.nav.map((item) => `<a class="pill${item.active ? " dark" : ""}" href="${escapeAttribute(item.href)}">${escapeHtml(item.label)}</a>`).join("\n      ")}
    </nav>
    ${renderThemeSelect()}
  </header>`;
}

export function renderThemeSelect(): string {
  return `<select class="theme-select" data-theme-select aria-label="Report theme">
      <option value="shiptest">ShipTest theme</option>
      <option value="boring">Boring theme</option>
    </select>`;
}

export function renderReportFooter(message: string): string {
  return `<footer class="report-footer"><span>${escapeHtml(message)}</span><a href="#top" class="back-to-top">Back to top ↑</a></footer>`;
}
