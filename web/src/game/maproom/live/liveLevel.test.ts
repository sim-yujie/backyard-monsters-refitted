import { describe, expect, it } from "vitest";
import { liveLevelFor, planFor } from "./liveLevel";

describe("liveLevelFor", () => {
  it("keeps Classic still on Low", () => {
    expect(liveLevelFor(true, "low")).toBe("off");
  });

  it("gives Classic the gulls on Medium and everything on High", () => {
    expect(liveLevelFor(true, "medium")).toBe("classic-reduced");
    expect(liveLevelFor(true, "high")).toBe("full");
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
    expect([plan.water, plan.foam, plan.clouds, plan.birds]).toEqual([false, false, false, false]);
    expect(plan.stepSeconds).toBe(Number.POSITIVE_INFINITY);
  });

  it("on Medium moves the water at half rate from the small art, with no clouds or birds", () => {
    const plan = planFor("reduced");
    expect([plan.water, plan.foam]).toEqual([true, true]);
    expect([plan.clouds, plan.birds]).toEqual([false, false]);
    expect(plan.stepSeconds).toBeCloseTo(2 * planFor("full").stepSeconds);
    expect(plan.artSuffix).toBe("");
  });

  it("on Classic Medium draws the water and gulls at half rate from the small art, with no clouds", () => {
    const plan = planFor("classic-reduced");
    expect([plan.water, plan.foam, plan.birds]).toEqual([true, true, true]);
    expect(plan.clouds).toBe(false);
    expect(plan.stepSeconds).toBeCloseTo(2 * planFor("full").stepSeconds);
    expect(plan.artSuffix).toBe("");
  });

  it("on High draws everything from the sharp art", () => {
    const plan = planFor("full");
    expect([plan.water, plan.foam, plan.clouds, plan.birds]).toEqual([true, true, true, true]);
    expect(plan.artSuffix).toBe("@2x");
  });
});
