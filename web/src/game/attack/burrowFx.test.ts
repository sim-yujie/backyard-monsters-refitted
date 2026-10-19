import { describe, expect, it } from "vitest";
import {
  BURROW_TRAIL_TICKS,
  SURFACE_FALL_TICKS,
  SURFACE_HOP_PX,
  SURFACE_RISE_TICKS,
  bounceOut,
  dirtFor,
  surfaceHop,
} from "./burrowFx";

describe("the Wormzer's hop out of its hole (MonsterBase.jump)", () => {
  it("rises 15 px over 0.3 s and is back down after 0.6 s more", () => {
    expect(SURFACE_RISE_TICKS).toBe(24);
    expect(SURFACE_FALL_TICKS).toBe(48);
    expect(surfaceHop(0)).toBe(0);
    expect(surfaceHop(SURFACE_RISE_TICKS)).toBeCloseTo(SURFACE_HOP_PX, 6);
    expect(surfaceHop(SURFACE_RISE_TICKS + SURFACE_FALL_TICKS)).toBe(0);
    expect(surfaceHop(-1)).toBe(0);
    expect(surfaceHop(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("eases in on the way up: slow off the ground, fast at the top", () => {
    const quarter = surfaceHop(SURFACE_RISE_TICKS / 4);
    const threeQuarters = surfaceHop((SURFACE_RISE_TICKS * 3) / 4);
    expect(quarter).toBeLessThan(SURFACE_HOP_PX / 4);
    expect(threeQuarters - quarter).toBeGreaterThan(SURFACE_HOP_PX / 2);
  });

  it("bounces on the way down and never goes below the ground", () => {
    expect(bounceOut(0)).toBe(0);
    expect(bounceOut(1)).toBeCloseTo(1, 6);
    let rose = false;
    let last = surfaceHop(SURFACE_RISE_TICKS);
    for (let age = SURFACE_RISE_TICKS; age < SURFACE_RISE_TICKS + SURFACE_FALL_TICKS; age += 1) {
      const now = surfaceHop(age);
      expect(now).toBeGreaterThanOrEqual(-1e-9);
      if (now > last + 1e-9) rose = true;
      last = now;
    }
    expect(rose).toBe(true);
  });
});

describe("the dirt a burrower throws (EFFECTS.Dig and EFFECTS.Burrow)", () => {
  it("digs as it goes down and as it comes up", () => {
    expect(dirtFor(false, true, 10, 0)).toBe("dig");
    expect(dirtFor(true, false, 10, 9)).toBe("dig");
  });

  it("leaves a clod every fifth Flash frame while under, nothing above", () => {
    expect(BURROW_TRAIL_TICKS).toBe(10);
    expect(dirtFor(true, true, 19, 10)).toBeNull();
    expect(dirtFor(true, true, 20, 10)).toBe("trail");
    expect(dirtFor(false, false, 100, 0)).toBeNull();
  });
});
