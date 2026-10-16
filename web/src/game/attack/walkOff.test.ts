import { describe, expect, it } from "vitest";
import { FLY_CLIMB, WALK_OFF_TICKS, planWalkOff, walkOffAt } from "./walkOff";

describe("planWalkOff", () => {
  it("heads for the nearest edge of the yard, straight out along one axis", () => {
    // 100 short of the right edge, 400 short of the bottom: out to the right.
    const right = planWalkOff(400, 100, false, 0, 500, 500);
    expect([right.dirX, right.dirY]).toEqual([1, 0]);
    // Near the top: up.
    const top = planWalkOff(50, -450, false, 0, 500, 500);
    expect([top.dirX, top.dirY]).toEqual([0, -1]);
  });

  it("keeps going out over the edge for a creep already at or past it", () => {
    const past = planWalkOff(-700, 0, false, 0, 500, 500);
    expect([past.dirX, past.dirY]).toEqual([-1, 0]);
  });

  it("takes the near side for a creep dead in the middle", () => {
    const middle = planWalkOff(0, 0, false, 0, 500, 500);
    expect(Math.abs(middle.dirX) + Math.abs(middle.dirY)).toBe(1);
  });
});

describe("walkOffAt", () => {
  it("walks out at full strength, then fades to nothing and is done", () => {
    const plan = planWalkOff(400, 0, false, 1000, 500, 500);
    const start = walkOffAt(plan, 1000, false);
    expect(start).toMatchObject({ ix: 400, iy: 0, alpha: 1, climb: 0, done: false });

    const early = walkOffAt(plan, 1000 + WALK_OFF_TICKS * 0.25, false);
    expect(early.ix).toBeGreaterThan(400);
    expect(early.iy).toBe(0);
    expect(early.alpha).toBe(1);

    const late = walkOffAt(plan, 1000 + WALK_OFF_TICKS * 0.8, false);
    expect(late.ix).toBeGreaterThan(early.ix);
    expect(late.alpha).toBeGreaterThan(0);
    expect(late.alpha).toBeLessThan(1);

    const end = walkOffAt(plan, 1000 + WALK_OFF_TICKS, false);
    expect(end.alpha).toBe(0);
    expect(end.done).toBe(true);
  });

  it("walks a short way, not across the map", () => {
    const plan = planWalkOff(0, 0, false, 0, 500, 500);
    const end = walkOffAt(plan, WALK_OFF_TICKS, false);
    const distance = Math.hypot(end.ix, end.iy);
    expect(distance).toBeGreaterThan(50);
    expect(distance).toBeLessThan(200);
  });

  it("flies a flyer off faster than a walker, climbing as it goes", () => {
    const walker = planWalkOff(0, 300, false, 0, 500, 500);
    const flyer = planWalkOff(0, 300, true, 0, 500, 500);
    const half = WALK_OFF_TICKS / 2;
    expect(walkOffAt(flyer, half, false).iy).toBeGreaterThan(walkOffAt(walker, half, false).iy);
    expect(walkOffAt(walker, half, false).climb).toBe(0);
    expect(walkOffAt(flyer, half, false).climb).toBeCloseTo(FLY_CLIMB / 2);
  });

  it("fades in place under reduced motion", () => {
    const plan = planWalkOff(0, 300, true, 0, 500, 500);
    const late = walkOffAt(plan, WALK_OFF_TICKS * 0.8, true);
    expect(late).toMatchObject({ ix: 0, iy: 300, climb: 0 });
    expect(late.alpha).toBeLessThan(1);
  });

  it("holds still before its start, whatever the clock says", () => {
    const plan = planWalkOff(100, 100, false, 500, 500, 500);
    expect(walkOffAt(plan, 400, false)).toMatchObject({ ix: 100, iy: 100, alpha: 1, done: false });
  });
});
