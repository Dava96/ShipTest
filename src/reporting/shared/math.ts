export function average(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const middleValue = sorted[middle];
  if (middleValue === undefined) return undefined;
  if (sorted.length % 2 === 1) return middleValue;
  const previousValue = sorted[middle - 1];
  return previousValue === undefined ? middleValue : (previousValue + middleValue) / 2;
}

export function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

export function round(value: number): number {
  return Math.round(value * 100) / 100;
}
