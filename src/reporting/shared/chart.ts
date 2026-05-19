import { escapeAttribute, escapeHtml, safeJsonForScript } from "./html.js";
import { slugify } from "./paths.js";

export interface BarDatum {
  readonly label: string;
  readonly value?: number;
  readonly display: string;
  readonly color: string;
  readonly pending?: boolean;
  readonly higherIsBetter: boolean;
  readonly scaleMode?: "absolute" | "relative";
  readonly href?: string;
  readonly detail: string;
}

export interface ChartSeries {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly subtitle: string;
  readonly color: string;
  readonly bars: readonly BarDatum[];
}

export function renderBarChart(
  id: string,
  title: string,
  subtitle: string,
  color: string,
  bars: readonly BarDatum[],
  series?: readonly ChartSeries[],
): string {
  const numericValues = bars
    .map((bar) => bar.value)
    .filter((value): value is number => value !== undefined);
  const max = Math.max(...numericValues, 1);
  const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
  const allSeries = series ?? [{ id: "default", label: title, title, subtitle, color, bars }];
  const controls =
    allSeries.length > 1
      ? `<select class="chart-metric-select" data-chart-select aria-label="Select chart metric">${allSeries.map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHtml(item.label)}</option>`).join("")}</select>`
      : "";
  return `<div class="chart-card" id="${escapeAttribute(id)}" data-metric-chart data-chart-group="${escapeAttribute(chartGroupForId(id))}">
    <div class="chart-head"><div><div class="chart-title"><span class="legend-square" style="background:${escapeAttribute(color)}"></span><span data-chart-title>${escapeHtml(title)}</span></div>
    <div class="chart-subtitle" data-chart-subtitle>${escapeHtml(subtitle)}</div></div>${controls}</div>
    <script type="application/json" data-chart-series>${safeJsonForScript(allSeries)}</script>
    <div class="bars" data-chart-bars>
      ${bars.length > 0 ? bars.map((bar) => renderBar(bar, max, min)).join("") : `<div class="muted">No attempts yet.</div>`}
    </div>
  </div>`;
}

export function sortBars(bars: readonly BarDatum[], higherIsBetter: boolean): BarDatum[] {
  return [...bars].sort((left, right) => {
    if (left.value === undefined && right.value === undefined) return 0;
    if (left.value === undefined) return 1;
    if (right.value === undefined) return -1;
    return higherIsBetter ? right.value - left.value : left.value - right.value;
  });
}

function chartGroupForId(id: string): string {
  if (id.includes("quality")) return "quality";
  if (id.includes("speed")) return "speed";
  if (id.includes("cost")) return "cost";
  return id;
}

function renderBar(bar: BarDatum, max: number, min: number): string {
  const scaleMin = bar.scaleMode === "relative" ? min : 0;
  const height =
    bar.pending || bar.value === undefined
      ? 35
      : bar.higherIsBetter
        ? scale(bar.value, scaleMin, max, 18, 100)
        : scale(max - bar.value + scaleMin, scaleMin, max, 18, 100);
  return `<a class="bar-wrap" href="${escapeAttribute(bar.href ?? "#artifacts")}" data-model-bar="${escapeAttribute(slugify(bar.label))}" data-detail="${escapeAttribute(bar.detail)}" style="--bar-height:${height}%">
    <span class="bar" style="background:${escapeAttribute(bar.color)}"><span class="bar-chip">${escapeHtml(shortValue(bar.display))}</span></span>
    <span class="bar-label">${escapeHtml(bar.label)}</span>
  </a>`;
}

function scale(value: number, min: number, max: number, outMin: number, outMax: number): number {
  if (max <= min) return outMax;
  return Math.max(
    outMin,
    Math.min(outMax, outMin + ((value - min) / (max - min)) * (outMax - outMin)),
  );
}

function shortValue(value: string): string {
  return value.length > 8 ? `${value.slice(0, 7)}…` : value;
}
