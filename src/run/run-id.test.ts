import { describe, expect, it } from "vitest";

import { createRunId } from "./run-id.js";

describe("run id", () => {
  it("creates sortable timestamp-prefixed ids", () => {
    const id = createRunId(new Date("2026-05-11T09:12:13.456Z"));

    expect(id).toMatch(/^20260511-091213-[a-f0-9]{6}$/);
  });
});
