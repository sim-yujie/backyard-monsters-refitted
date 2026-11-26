import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { towerAcquires, towerHolds } from "./reach.js";
import { LASER_TYPE } from "./stats.js";
import { buildEngineYard } from "./yard.js";

/**
 * A tower holds a target from the middle of its footprint, where it found it
 * (`towerHolds`), deliberately not from its anchor as Flash's `targetInRange`
 * ends up measuring (`BTOWER.as:234-249`, whose `.add` at `:238` is thrown
 * away). The reach audit proposed Flash's anchor; the owner kept towers as they
 * are (pick B, reach-merge, 25 Nov 2026). So a creep in front of a tower, in
 * range of its middle but not of its anchor, is shot.
 */

/** Flash's hold, written out apart from the engine: yard units to the anchor, `GRID.FromISO` rounding up. */
const flashHolds = (at: { ix: number; iy: number }, anchor: { cx: number; cy: number }, range: number) =>
  (Math.ceil(at.ix) - anchor.cx) ** 2 + (Math.ceil(at.iy) - anchor.cy) ** 2 < range * range;

const RESOURCES = { r1: 100000, r2: 100000, r3: 100000, r4: 100000 };

/** A level 1 Laser (range 160) at the origin, a Town Hall at `hallX`, a Brain flung south-west. */
const laserOn = (hallX: number) => {
  const yard = buildEngineYard({
    buildingdata: {
      "1": { id: 1, t: LASER_TYPE, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 14, l: 10, X: hallX, Y: 0 },
    },
    resources: RESOURCES,
  });
  const battle = createBattle(yard, { seed: 1, levels: { C12: 6 } });
  battle.apply({ kind: "fling", t: 0, x: 40, y: 200, r: 0, monsters: { C12: 1 } });
  for (let step = 0; step < 2400 && !battle.over(); step += 1) battle.step();
  const laser = yard.buildings.find((building) => building.id === 1)!;
  const creep = battle.creeps()[0]!;
  return { battle, laser, creep, shots: battle.state().towers[0]?.shots ?? 0 };
};

describe("a tower keeps shooting a target in range of its middle, not only of its anchor", () => {
  it("shoots a Brain in front of it, in range of its middle but not its anchor (where Flash would not)", () => {
    const { laser, creep, shots } = laserOn(120);
    const at = { ix: creep.ix, iy: creep.iy, x: Math.trunc(creep.ix), y: Math.trunc(creep.iy) };
    expect(towerAcquires(at, laser, 160)).toBe(true);
    expect(towerHolds(at, laser, 160)).toBe(true);
    expect(flashHolds(at, laser, 160)).toBe(false);
    expect(shots).toBeGreaterThan(0);
  });

  it("shoots one a little nearer, in range of both", () => {
    const { laser, creep, shots } = laserOn(90);
    const at = { ix: creep.ix, iy: creep.iy, x: Math.trunc(creep.ix), y: Math.trunc(creep.iy) };
    expect(towerAcquires(at, laser, 160)).toBe(true);
    expect(towerHolds(at, laser, 160)).toBe(true);
    expect(flashHolds(at, laser, 160)).toBe(true);
    expect(shots).toBeGreaterThan(0);
  });
});
