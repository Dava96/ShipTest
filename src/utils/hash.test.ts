import { describe, expect, it } from "vitest";

import { sha256Json, stableJsonStringify } from "./hash.js";

describe("hash utilities", () => {
  it("stable stringifies object keys regardless of insertion order", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(stableJsonStringify(left)).toBe(stableJsonStringify(right));
    expect(sha256Json(left)).toBe(sha256Json(right));
  });
});
