import { describe, expect, it } from "vitest";

import { MELEE_BUILDING_REACH, buildingReachOf } from "./champions.js";
import { createBattle } from "./engine.js";
import { championStat } from "./stats.js";
import { buildEngineYard, reachSquared, reachesBuilding } from "./yard.js";

/**
 * Patch 7.10 (owner, 19 Nov 2026; player arC's report): Gorgo hit a Town
 * Hall from about four tiles off. Patch 7.9 let a champion reach a building
 * its stat `range` in yard units from the nearest tile, and Gorgo's range,
 * 35 to 70, was Flash's stomp reach in screen pixels to the top corner. Gorgo
 * is melee, so he now hits a building only from beside it: one cell,
 * {@link MELEE_BUILDING_REACH}, from its nearest tile.
 */

/** arC's Town Hall: level 4, 130 x 130 yard units, footprint (-65..65, -65..65). */
const townHall = () =>
  buildEngineYard({ buildingdata: { "1": { id: 1, t: 14, l: 4, X: -65, Y: -65 } } });

/**
 * Yard points `off` units out from the middle of each side, and 0.99 of it out
 * from each corner (0.7 along both axes, clear of rounding at exactly `off`).
 */
const around = (off: number): readonly (readonly [string, number, number])[] => [
  ["back (-y side)", 0, -65 - off],
  ["front (+y side)", 0, 65 + off],
  ["left (-x side)", -65 - off, 0],
  ["right (+x side)", 65 + off, 0],
  ["top corner", -65 - off * 0.7, -65 - off * 0.7],
  ["bottom corner", 65 + off * 0.7, 65 + off * 0.7],
  ["left corner", -65 - off * 0.7, 65 + off * 0.7],
  ["right corner", 65 + off * 0.7, -65 - off * 0.7],
];

describe("Gorgo's melee reach to a building (patch 7.10)", () => {
  it("is one cell for Gorgo at every level, the stat range for the rest", () => {
    expect(MELEE_BUILDING_REACH).toBe(10);
    for (let level = 1; level <= 6; level += 1) {
      expect(buildingReachOf("G1", true, championStat("G1", "range", level))).toBe(10);
    }
    // Drull, Fomor, Korath and Krallen keep their range until the owner decides.
    for (const id of ["G2", "G3", "G4", "G5"]) {
      const range = championStat(id, "range", 2);
      expect(buildingReachOf(id, true, range), id).toBe(range);
    }
    // A ranged monster keeps its range; so would a monster sharing an id.
    expect(buildingReachOf("C19", false, 200)).toBe(200);
    expect(buildingReachOf("G1", false, 45)).toBe(45);
  });

  it("reaches from one tile off every side and corner, never from three", () => {
    const building = townHall().buildings[0]!;
    const reach = buildingReachOf("G1", true, championStat("G1", "range", 2));
    for (const [side, x, y] of around(10)) {
      expect(reachesBuilding(x, y, building, reach), side).toBe(true);
    }
    for (const [side, x, y] of around(30)) {
      expect(reachesBuilding(x, y, building, reach), side).toBe(false);
      // Patch 7.9 let him hit from here at range 45.
      expect(reachesBuilding(x, y, building, 45), side).toBe(true);
    }
  });

  it("walks Gorgo L2 up to the building from every side before he hits it", () => {
    for (let bearing = 0; bearing < 8; bearing += 1) {
      const angle = (bearing / 8) * Math.PI * 2;
      const yard = townHall();
      const target = yard.buildings[0]!;
      const battle = createBattle(yard, { seed: 3 });
      const x = Math.round(Math.cos(angle) * 400);
      const y = Math.round(Math.sin(angle) * 400);
      battle.apply({ kind: "fling", t: 0, x, y, r: 100, monsters: {}, champion: { t: 1, l: 2 } });
      let stoodOff = -1;
      let hp = target.hp;
      for (let tick = 0; tick < 6000 && stoodOff < 0; tick += 1) {
        battle.step();
        const gorgo = battle.creeps()[0]!;
        // Not a scratch on the building while he is still more than two tiles off.
        if (target.hp < hp) {
          expect(Math.sqrt(reachSquared(gorgo.ix, gorgo.iy, target)), `bearing ${bearing}`).toBeLessThan(30);
          hp = target.hp;
        }
        if (gorgo.state === "attacking" && gorgo.targetBuilding === target.id) {
          stoodOff = Math.sqrt(reachSquared(gorgo.ix, gorgo.iy, target));
        }
      }
      // Where a melee monster's route ends: in the cell beside the footprint,
      // up to 10 screen px short of its middle (at most ~27 units off a corner).
      expect(stoodOff, `bearing ${bearing}`).toBeGreaterThanOrEqual(0);
      expect(stoodOff, `bearing ${bearing}`).toBeLessThanOrEqual(30);
    }
  });
});
