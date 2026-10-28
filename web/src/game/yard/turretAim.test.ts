import { describe, expect, it } from "vitest";

import {
  angleGap,
  bearingCell,
  cellBearing,
  muzzleOffset,
  pitchDown,
  rowOf,
  tiltRow,
  tiltRows,
  type TurretAim,
} from "./turretAim";

const flat = (headings: number): TurretAim => ({
  headings,
  aim: Array.from({ length: headings }, (_, cell) => (cell * 360) / headings),
});

const laser: TurretAim = {
  headings: 32,
  aim: Array.from({ length: 160 }, () => 0),
  pitch: [12, 24, 36, 48, 60],
  lensHeight: 83.1,
  ground: 56.1,
};

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

  it("keeps a heading in the tilt row asked for", () => {
    expect(tiltRows(laser)).toBe(5);
    expect(bearingCell(laser, 90, 2)).toBe(2 * 32 + 8);
    expect(rowOf(laser, 2 * 32 + 8)).toBe(2);
    expect(cellBearing(laser, 2 * 32 + 8)).toBe(90);
    // A row past the last is the last.
    expect(rowOf(laser, bearingCell(laser, 0, 9))).toBe(4);
  });

  it("has no muzzle until the art measures one", () => {
    expect(muzzleOffset(flat(4), 1)).toBeNull();
    expect(muzzleOffset({ ...flat(2), muzzle: [1, 2, 3, 4] }, 1)).toEqual([3, 4]);
    expect(muzzleOffset({ ...flat(2), muzzle: [1, 2] }, 1)).toBeNull();
  });

  it("looks 45 degrees down at a spot as far away on the ground as the lens is high", () => {
    // 2:1 ground: 100 px across the screen is 100 long, 50 px down it is 100 long.
    expect(pitchDown(100, 0, 100, 0)).toBeCloseTo(45);
    expect(pitchDown(100, 0, 0, 50)).toBeCloseTo(45);
    expect(pitchDown(100, 0, 100000, 0)).toBeLessThan(0.1);
  });

  it("tilts a head further down the nearer the spot", () => {
    const near = tiltRow(laser, 0, 25);
    const middle = tiltRow(laser, 0, 60);
    const far = tiltRow(laser, 0, 400);
    expect(near).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(far);
    expect(far).toBe(0);
    // A strip of one row never tilts.
    expect(tiltRow(flat(32), 0, 10)).toBe(0);
  });
});
