import { describe, expect, it } from "vitest";
import { cloudTime } from "./painted/clouds";
import { pulseAt } from "./painted/BorderLayer";
import { waterTime } from "./painted/PaintedGround";
import { idleTime, stepAt, steppedSeconds, tickAt, TICKS_PER_SECOND } from "./animationClock";

describe("the map's shared animation clock (still-map redraws, MR2 step 10)", () => {
  it("counts whole ticks from the page's time origin", () => {
    expect(TICKS_PER_SECOND).toBe(30);
    expect(tickAt(0)).toBe(0);
    expect(tickAt(33)).toBe(0);
    expect(tickAt(34)).toBe(1);
    expect(tickAt(1000)).toBe(30);
    expect(stepAt(99, 3)).toBe(0);
    expect(stepAt(100, 3)).toBe(1);
  });

  it("measures time in whole steps, on the clock's steps rather than the layer's own start", () => {
    // A layer that started mid-step still steps on the shared boundaries.
    expect(steppedSeconds(1050, 1020, 3)).toBe(0);
    expect(steppedSeconds(1100, 1020, 3)).toBeCloseTo(0.1);
    expect(steppedSeconds(2000, 1000, 3)).toBeCloseTo(1);
  });

  it("makes the water, the pulse and the fog change on the same frames, so a still map redraws once", () => {
    const changes = (value: (ms: number) => number): Set<number> => {
      const at = new Set<number>();
      let last = value(0);
      for (let ms = 1; ms <= 5000; ms += 1) {
        const next = value(ms);
        if (next !== last) at.add(ms);
        last = next;
      }
      return at;
    };
    for (const level of ["high", "medium"] as const) {
      const water = changes((ms) => waterTime(ms, 17, level));
      const fog = changes((ms) => cloudTime(ms, 523, level));
      const union = new Set([...water, ...fog, ...(level === "high" ? changes((ms) => pulseAt(ms, 311, "high")) : [])]);
      // Every change lands on a frame the water also changes on: no extra redraws.
      expect(union.size).toBe(water.size);
      expect(water.size).toBe(level === "high" ? 50 : 25);
    }
  });

  it("while the map stands still, steps at most 10 times a second and leaves water, pulse and fog as they were", () => {
    let changes = 0;
    let last = idleTime(0);
    for (let ms = 0; ms <= 10_000; ms += 1) {
      const now = idleTime(ms);
      expect(now).toBeLessThanOrEqual(ms);
      expect(ms - now).toBeLessThan(100);
      if (now !== last) changes += 1;
      last = now;
      for (const level of ["high", "medium"] as const) {
        expect(waterTime(now, 17, level)).toBe(waterTime(ms, 17, level));
        expect(cloudTime(now, 523, level)).toBe(cloudTime(ms, 523, level));
      }
      expect(pulseAt(now, 311, "high")).toBe(pulseAt(ms, 311, "high"));
    }
    expect(changes).toBe(100);
    // The gulls' and cloud shadows' every-tick timer then steps 10 times a second, not 30.
    const steps = new Set<number>();
    for (let ms = 0; ms < 1000; ms += 1) steps.add(stepAt(idleTime(ms), 1));
    expect(steps.size).toBe(10);
  });
});
