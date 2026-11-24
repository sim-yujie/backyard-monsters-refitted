import { describe, expect, it } from "vitest";

import { createBattle } from "./engine.js";
import { towerAcquires, towerHoldsFromAnchor } from "./reach.js";
import { LASER_TYPE } from "./stats.js";
import { buildEngineYard } from "./yard.js";

/**
 * A tower holds a target from its anchor (beta 9, the reach audit, owner's
 * pick A): it finds a creep from the middle of its footprint (`FindTargets`,
 * `BTOWER.as:394`) but, before each shot, `targetInRange` asks whether one is
 * in range of its anchor (`BTOWER.as:234-249`). A creep in front of it, in
 * range of the middle but not of the anchor, is found every round and never
 * shot. Until beta 9 the engine asked the middle only.
 */

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

describe("a tower keeps shooting only a target in range of its anchor", () => {
  it("never shoots a Brain in front of it, in range of its middle but not its anchor", () => {
    const { laser, creep, shots } = laserOn(120);
    const at = { ix: creep.ix, iy: creep.iy, x: Math.trunc(creep.ix), y: Math.trunc(creep.iy) };
    expect(towerAcquires(at, laser, 160)).toBe(true);
    expect(towerHoldsFromAnchor(at, laser, 160)).toBe(false);
    expect(shots).toBe(0);
  });

  it("shoots one a little nearer, in range of both", () => {
    const { laser, creep, shots } = laserOn(90);
    const at = { ix: creep.ix, iy: creep.iy, x: Math.trunc(creep.ix), y: Math.trunc(creep.iy) };
    expect(towerAcquires(at, laser, 160)).toBe(true);
    expect(towerHoldsFromAnchor(at, laser, 160)).toBe(true);
    expect(shots).toBeGreaterThan(0);
  });
});
