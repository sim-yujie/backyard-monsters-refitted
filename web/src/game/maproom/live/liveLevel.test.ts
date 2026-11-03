import { describe, expect, it } from "vitest";
import { liveLevelFor, planFor } from "./liveLevel";

describe("liveLevelFor", () => {
  it("keeps Classic still at every Quality, as Flash's map was", () => {
    expect(liveLevelFor(true, "high")).toBe("off");
    expect(liveLevelFor(true, "medium")).toBe("off");
    expect(liveLevelFor(true, "low")).toBe("off");
  });

  it("follows the Quality setting in Modern", () => {
    expect(liveLevelFor(false, "low")).toBe("off");
    expect(liveLevelFor(false, "medium")).toBe("reduced");
    expect(liveLevelFor(false, "high")).toBe("full");
  });
});

describe("planFor", () => {
  it("draws nothing and never steps when off", () => {
    const plan = planFor("off");
    expect([plan.water, plan.foam, plan.smoke, plan.clouds, plan.birds]).toEqual([false, false, false, false, false]);
    expect(plan.stepSeconds).toBe(Number.POSITIVE_INFINITY);
  });

  it("on Medium moves the water and smoke at half rate from the small art, with no clouds or birds", () => {
    const plan = planFor("reduced");
    expect([plan.water, plan.foam, plan.smoke]).toEqual([true, true, true]);
    expect([plan.clouds, plan.birds]).toEqual([false, false]);
    expect(plan.stepSeconds).toBeCloseTo(2 * planFor("full").stepSeconds);
    expect(plan.artSuffix).toBe("");
  });

  it("on High draws everything from the sharp art", () => {
    const plan = planFor("full");
    expect([plan.water, plan.foam, plan.smoke, plan.clouds, plan.birds]).toEqual([true, true, true, true, true]);
    expect(plan.artSuffix).toBe("@2x");
  });
});
