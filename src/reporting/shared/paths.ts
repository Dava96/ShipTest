export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function benchmarkDetailReportPath(benchmarkId: string): string {
  return `benchmark-${slugify(benchmarkId)}.html`;
}

export function modelDetailReportPath(modelId: string): string {
  return `model-${slugify(modelId)}.html`;
}

export function modelsOverviewReportPath(): string {
  return "models.html";
}
