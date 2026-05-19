import { describe, expect, it } from "vitest";

import { artifactLink } from "./artifacts.js";
import { formatCompact, formatDuration, formatUsd } from "./format.js";
import { average, clamp, median, round } from "./math.js";
import { benchmarkDetailReportPath, modelDetailReportPath, slugify } from "./paths.js";

function stripWhitespace(value: string): string {
  return value.replaceAll(/\s+/g, " ");
}

describe("report shared helpers", () => {
  it("formats numeric report values", () => {
    expect(formatCompact(9_700_000)).toBe("9.7M");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatUsd(0.123456)).toBe("$0.1235");
  });

  it("computes small math helpers used by report metrics", () => {
    expect(average([2, 4, 6])).toBe(4);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 9, 3, 5])).toBe(4);
    expect(clamp(120)).toBe(100);
    expect(round(1.234)).toBe(1.23);
  });

  it("generates stable report paths", () => {
    expect(slugify('Model With Spaces & Symbols <> "quoted"')).toBe(
      "model-with-spaces-symbols-quoted",
    );
    expect(benchmarkDetailReportPath("Very Long Benchmark!")).toBe(
      "benchmark-very-long-benchmark.html",
    );
    expect(modelDetailReportPath("gpt-5.4-mini")).toBe("model-gpt-5-4-mini.html");
  });

  it("renders enabled and disabled artifact controls", () => {
    expect(artifactLink("candidate.patch?x=<y>", "patch")).toContain("candidate.patch?x=&lt;y&gt;");
    expect(stripWhitespace(artifactLink(undefined, "patch"))).toContain(
      'class="artifact-link-disabled" aria-disabled="true"',
    );
  });
});
