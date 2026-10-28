import { describe, expect, it } from "vitest";

import {
  angleGap,
  arcLift,
  bearingCell,
  cellBearing,
  muzzleOffset,
  shellArc,
  type TurretAim,
} from "./turretAim";

const flat = (headings: number): TurretAim => ({
  headings,
  aim: Array.from({ length: headings }, (_, cell) => (cell * 360) / headings),
});

describe("turretAim", () => {
  it("measures the gap between two angles the short way round", () => {
    expect(angleGap(10, 350)).toBe(20);
    expect(angleGap(350, 10)).toBe(20);
    expect(angleGap(0, 180)).toBe(180);
    expect(angleGap(-90, 270)).toBe(0);
  });

  it("faces the cell nearest a ground bearing, round the compass", () => {
    const aim = flat(32);
    expect(bearingCell(aim, 0)).toBe(0);
    expect(bearingCell(aim, 5)).toBe(0);
    expect(bearingCell(aim, 6)).toBe(1);
    expect(bearingCell(aim, 355)).toBe(0);
    expect(bearingCell(aim, -11.25)).toBe(31);
    expect(bearingCell(aim, 720 + 90)).toBe(8);
    for (let bearing = 0; bearing < 360; bearing += 7) {
      expect(
        angleGap(cellBearing(aim, bearingCell(aim, bearing)), bearing),
      ).toBeLessThanOrEqual(360 / 64);
    }
  });

  it("has no muzzle until the art measures one", () => {
    expect(muzzleOffset(flat(4), 1)).toBeNull();
    expect(muzzleOffset({ ...flat(2), muzzle: [1, 2, 3, 4] }, 1)).toEqual([3, 4]);
    expect(muzzleOffset({ ...flat(2), muzzle: [1, 2] }, 1)).toBeNull();
  });

  it("lobs a shell from a raised barrel so it leaves along the barrel and lands on its target", () => {
    const cos30 = Math.cos(Math.PI / 6);
    // Level ground, no drop: the peak is a quarter of d tan a, seen cos 30 as tall.
    const arc = shellArc(-22, 200, 0);
    expect(arc).toBeCloseTo(200 * Math.tan((22 * Math.PI) / 180) * cos30);
    expect(arcLift(arc, 0.5)).toBeCloseTo(arc / 4);
    // On the straight line at both ends.
    expect(arcLift(arc, 0)).toBe(0);
    expect(arcLift(arc, 1)).toBe(0);
    expect(arcLift(arc, -0.5)).toBe(0);
    expect(arcLift(arc, 1.5)).toBe(0);
    // It leaves along the barrel: the slope over the ground at the muzzle is tan a.
    const step = 1e-4;
    const rise = arcLift(arc, step) / cos30 / (200 * step);
    expect(rise).toBeCloseTo(Math.tan((22 * Math.PI) / 180), 3);
    // A muzzle high over its target climbs more over the line falling to it, and still leaves along the barrel.
    const high = shellArc(-22, 200, 60);
    expect(high).toBeCloseTo(arc + 60);
    const slope = (arcLift(high, step) - 60 * step) / cos30 / (200 * step);
    expect(slope).toBeCloseTo(Math.tan((22 * Math.PI) / 180), 3);
    // A farther target is lobbed higher.
    expect(shellArc(-22, 400, 0)).toBeGreaterThan(arc);
  });

  it("fires straight from a barrel that is level or tilted down", () => {
    expect(shellArc(0, 200, 40)).toBe(0);
    expect(shellArc(36, 200, 40)).toBe(0);
  });
});
