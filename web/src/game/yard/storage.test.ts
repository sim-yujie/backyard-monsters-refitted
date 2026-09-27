import { describe, expect, it } from "vitest";
import { NEED_MORE_SILOS, NEED_MORE_SILOS_PHRASE, overCap } from "./storage";

describe("overCap", () => {
  it("is a price above the cap, never an unknown cap", () => {
    expect(overCap(10_001, 10_000)).toBe(true);
    expect(overCap(10_000, 10_000)).toBe(false);
    expect(overCap(10_001, null)).toBe(false);
    expect(overCap(10_001, undefined)).toBe(false);
    expect(overCap(10_001, 0)).toBe(false);
  });

  it("spells the reason once, as a phrase and as a sentence", () => {
    expect(NEED_MORE_SILOS).toBe(`${NEED_MORE_SILOS_PHRASE}.`);
  });
});
