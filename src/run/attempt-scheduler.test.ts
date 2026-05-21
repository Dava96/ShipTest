import { describe, expect, it } from "vitest";

import { BenchmarkFairAttemptScheduler, createAttemptJobs } from "./attempt-scheduler.js";
import type { RunPlanItem } from "./types.js";

function item(benchmarkId: string, modelId: string): RunPlanItem {
  return {
    benchmark: { id: benchmarkId } as RunPlanItem["benchmark"],
    model: { id: modelId } as RunPlanItem["model"],
  };
}

describe("BenchmarkFairAttemptScheduler", () => {
  it("spreads initial work across benchmarks before stacking models", () => {
    const scheduler = new BenchmarkFairAttemptScheduler(
      createAttemptJobs(
        [item("b1", "m1"), item("b1", "m2"), item("b2", "m1"), item("b2", "m2"), item("b3", "m1")],
        1,
      ),
    );

    expect(scheduler.next()?.planItem.benchmark.id).toBe("b1");
    expect(scheduler.next()?.planItem.benchmark.id).toBe("b2");
    expect(scheduler.next()?.planItem.benchmark.id).toBe("b3");
    expect(scheduler.next()?.planItem.benchmark.id).toBe("b1");
    expect(scheduler.next()?.planItem.benchmark.id).toBe("b2");
  });

  it("stacks attempts on one benchmark when it is the only pending benchmark", () => {
    const scheduler = new BenchmarkFairAttemptScheduler(createAttemptJobs([item("b1", "m1")], 3));

    expect(scheduler.next()?.attempt).toBe(1);
    expect(scheduler.next()?.attempt).toBe(2);
    expect(scheduler.next()?.attempt).toBe(3);
    expect(scheduler.next()).toBeUndefined();
  });
});
