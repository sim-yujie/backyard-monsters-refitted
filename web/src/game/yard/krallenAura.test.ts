import { describe, expect, it } from "vitest";
import { krallenAuraActive, krallenAuraRuns, krallenAuraTimes, krallenAuraTimesLooter, krallenAuraUntil } from "./krallenAura";

describe("Krallen's loot aura (Krallen Hunt 3x mark, owner 13 Nov 2026)", () => {
  it("reads when it runs out off Krallen's entry only", () => {
    expect(krallenAuraUntil({ t: 5, l: 3, la: 1000 })).toBe(1000);
    expect(krallenAuraUntil({ t: 5, l: 3 })).toBe(0);
    expect(krallenAuraUntil({ t: 1, l: 3, la: 1000 })).toBe(0);
    expect(krallenAuraUntil(null)).toBe(0);
  });

  it("is running until its end, and active at every level (levels 1-2 added 15 Nov 2026)", () => {
    expect(krallenAuraRuns({ t: 5, l: 1, la: 1000 }, 999)).toBe(true);
    expect(krallenAuraRuns({ t: 5, l: 1, la: 1000 }, 1000)).toBe(false);
    expect(krallenAuraActive({ t: 5, l: 1, la: 1000 }, 999)).toBe(true);
    expect(krallenAuraActive({ t: 5, l: 2, la: 1000 }, 999)).toBe(true);
    expect(krallenAuraActive({ t: 5, l: 1, la: 1000 }, 1000)).toBe(false);
    expect(krallenAuraActive({ t: 5, l: 3, la: 1000 }, 999)).toBe(true);
    expect(krallenAuraActive({ t: 5, l: 5 }, 999)).toBe(false);
    expect(krallenAuraActive({ t: 5, l: 5, la: 1000 }, undefined)).toBe(false);
  });

  it("makes an ordinary monster near her loot 1.4, 1.7, 2, 2.8 and 3.6 times at levels 1 to 5", () => {
    expect([0, 1, 2, 3, 4, 5].map(krallenAuraTimes)).toEqual([1, 1.4, 1.7, 2, 2.8, 3.6]);
  });

  it("makes a resource hunter or champion (looting value 2.0) loot 1.1, 1.18, 1.25, 1.45 and 1.65 times", () => {
    expect([0, 1, 2, 3, 4, 5].map(krallenAuraTimesLooter)).toEqual([1, 1.1, 1.18, 1.25, 1.45, 1.65]);
  });
});
