import { describe, expect, it } from "vitest";
import {
  FRAME,
  holdTurkey,
  isFree,
  newTurkey,
  pathFree,
  pickTarget,
  stepTurkey,
  TURKEY_SPEED,
  turkeyFrame,
  WANDER_RADIUS,
  type TurkeyArea,
} from "./turkeyWalk";

/** A seeded generator, so a walk is the same every run. */
const seededRandom = (seed = 7) => {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
};

/** An 800 x 800 plot with one big building just east of home. */
const AREA: TurkeyArea = {
  halfW: 400,
  halfH: 400,
  obstacles: [{ x0: 40, y0: -60, x1: 160, y1: 60 }],
};

describe("turkeyWalk: roaming turkeys (Thanksgiving)", () => {
  it("free means inside the plot and outside every building", () => {
    expect(isFree(AREA, 0, 0)).toBe(true);
    expect(isFree(AREA, 100, 0)).toBe(false);
    expect(isFree(AREA, 395, 0)).toBe(false);
    expect(pathFree(AREA, 0, 0, 0, 100)).toBe(true);
    // Straight through the building is not a path.
    expect(pathFree(AREA, 0, 0, 200, 0)).toBe(false);
  });

  it("a target is free, near home, with a free straight path", () => {
    const random = seededRandom(3);
    for (let i = 0; i < 50; i++) {
      const target = pickTarget({ homeX: 0, homeY: 0, x: 0, y: 0 }, AREA, random);
      if (!target) continue;
      expect(isFree(AREA, target.x, target.y)).toBe(true);
      expect(Math.hypot(target.x, target.y)).toBeLessThanOrEqual(WANDER_RADIUS + 0.001);
      expect(pathFree(AREA, 0, 0, target.x, target.y)).toBe(true);
    }
  });

  it("over ten minutes it walks about, never into a building, never far from home", () => {
    const random = seededRandom(11);
    const turkey = newTurkey(0, 0, random);
    let moved = 0;
    let lastX = turkey.x;
    let lastY = turkey.y;
    for (let tick = 0; tick < 600 * 30; tick++) {
      stepTurkey(turkey, 1 / 30, AREA, random);
      expect(isFree(AREA, turkey.x, turkey.y)).toBe(true);
      expect(Math.hypot(turkey.x, turkey.y)).toBeLessThanOrEqual(WANDER_RADIUS + 0.001);
      const step = Math.hypot(turkey.x - lastX, turkey.y - lastY);
      // Slowly: never faster than its amble.
      expect(step).toBeLessThanOrEqual(TURKEY_SPEED / 30 + 1e-9);
      moved += step;
      lastX = turkey.x;
      lastY = turkey.y;
    }
    expect(moved).toBeGreaterThan(500);
  });

  it("held while picked, it stays put and flaps; let go, it stands about again", () => {
    const random = seededRandom(5);
    const turkey = newTurkey(0, 0, random);
    for (let tick = 0; tick < 200; tick++) stepTurkey(turkey, 1 / 30, AREA, random);
    holdTurkey(turkey, true);
    const [x, y] = [turkey.x, turkey.y];
    const frames = new Set<number>();
    for (let tick = 0; tick < 60; tick++) {
      stepTurkey(turkey, 1 / 30, AREA, random);
      frames.add(turkeyFrame(turkey));
    }
    expect([turkey.x, turkey.y]).toEqual([x, y]);
    expect(frames).toEqual(new Set([FRAME.hop, FRAME.stand]));
    holdTurkey(turkey, false);
    expect(turkey.mode).toBe("idle");
  });

  it("walking cycles the four walk frames; facing follows the screen direction", () => {
    const turkey = { ...newTurkey(0, 0, () => 0.5), mode: "walk" as const };
    const seen = new Set<number>();
    for (let clock = 0; clock < 1; clock += 0.05) seen.add(turkeyFrame({ ...turkey, clock }));
    expect(seen).toEqual(new Set(FRAME.walk));

    // Heading to +x (screen right) faces right; to +y (screen left) faces left.
    const random = seededRandom(2);
    const right = newTurkey(0, 0, random);
    right.wait = 0;
    stepTurkey(right, 0.01, { halfW: 400, halfH: 400, obstacles: [] }, random);
    expect(right.mode).toBe("walk");
    expect(right.facing).toBe(right.targetX - right.targetY > 0 ? 1 : -1);
  });
});
