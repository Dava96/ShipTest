import type { RunPlanItem } from "./types.js";

export interface AttemptJob {
  readonly planItem: RunPlanItem;
  readonly attempt: number;
}

interface QueuedBenchmark {
  readonly benchmarkId: string;
  readonly items: AttemptJob[];
  running: number;
  lastScheduledOrder: number;
}

export function createAttemptJobs(
  items: readonly RunPlanItem[],
  modelAttempts: number,
): AttemptJob[] {
  return items.flatMap((item) =>
    Array.from({ length: modelAttempts }, (_, index) => ({ planItem: item, attempt: index + 1 })),
  );
}

export class BenchmarkFairAttemptScheduler {
  private readonly queues: QueuedBenchmark[];
  private scheduleOrder = 0;

  constructor(items: readonly AttemptJob[]) {
    const byBenchmark = new Map<string, AttemptJob[]>();
    for (const item of items) {
      const existing = byBenchmark.get(item.planItem.benchmark.id) ?? [];
      existing.push(item);
      byBenchmark.set(item.planItem.benchmark.id, existing);
    }
    this.queues = [...byBenchmark.entries()].map(([benchmarkId, benchmarkItems]) => ({
      benchmarkId,
      items: [...benchmarkItems],
      running: 0,
      lastScheduledOrder: -1,
    }));
  }

  next(): AttemptJob | undefined {
    const queue = this.queues
      .filter((candidate) => candidate.items.length > 0)
      .sort(
        (left, right) =>
          left.running - right.running ||
          left.lastScheduledOrder - right.lastScheduledOrder ||
          left.benchmarkId.localeCompare(right.benchmarkId),
      )[0];
    if (!queue) return undefined;

    const item = queue.items.shift();
    if (!item) return undefined;
    queue.running += 1;
    queue.lastScheduledOrder = this.scheduleOrder;
    this.scheduleOrder += 1;
    return item;
  }

  complete(item: AttemptJob): void {
    const queue = this.queues.find(
      (candidate) => candidate.benchmarkId === item.planItem.benchmark.id,
    );
    if (!queue) return;
    queue.running = Math.max(0, queue.running - 1);
  }
}

export async function runBenchmarkFairQueue<T>(options: {
  readonly items: readonly AttemptJob[];
  readonly concurrency: number;
  readonly worker: (item: AttemptJob) => Promise<T>;
}): Promise<T[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency));
  const scheduler = new BenchmarkFairAttemptScheduler(options.items);
  const results: T[] = [];
  let firstError: unknown;

  async function runWorker(): Promise<void> {
    while (firstError === undefined) {
      const item = scheduler.next();
      if (!item) return;
      try {
        results.push(await options.worker(item));
      } catch (error) {
        firstError = error;
      } finally {
        scheduler.complete(item);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, options.items.length) }, () =>
    runWorker(),
  );
  await Promise.all(workers);
  if (firstError !== undefined) throw firstError;
  return results;
}
