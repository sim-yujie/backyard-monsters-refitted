import { describe, expect, it } from "vitest";

import { championStat, monsterRange } from "./stats.js";
import { createBattle } from "./engine.js";
import { buildEngineYard, reachSquared, reachesBuilding, screenDistanceSquared } from "./yard.js";

/**
 * Player arC's report (18 Nov 2026): Gorgo hit his Town Hall from behind it.
 * Under Flash's rule a champion's reach ran to the building's top corner on
 * screen, so from the back it stood up to 64 units off the tiles at range 45,
 * hidden behind the funnel, while from the front it had to walk right up to
 * them. Since patch 7.9 reach is `range` yard units from the nearest tile on
 * every side (`reachSquared`). Since patch 7.10 Gorgo himself and the other
 * melee champions hit a building only from beside it (`meleeReach.test.ts`).
 */

/** arC's Town Hall: level 4, 130 x 130, top corner drawn at screen (0, -65). */
const townHall = () =>
  buildEngineYard({ buildingdata: { "1": { id: 1, t: 14, l: 4, X: -65, Y: -65 } } });

describe("Gorgo behind arC's Town Hall (patch 7.9)", () => {
  it("no longer reaches it from the spot behind the funnel at range 45", () => {
    const building = townHall().buildings[0]!;
    expect(championStat("G1", "range", 2)).toBe(45);
    // Where Gorgo L2 stood in arC's attack: 44.7 px from the top corner on
    // screen, which Flash's rule let it hit from.
    const spot = { x: -95, y: -115 };
    const onScreen = { x: spot.x - spot.y, y: (spot.x + spot.y) / 2 };
    expect(Math.hypot(onScreen.x - building.sx, onScreen.y - building.sy)).toBeLessThan(45);
    // Now it is 58 units off the nearest tile, out of reach.
    expect(Math.sqrt(reachSquared(spot.x, spot.y, building))).toBeCloseTo(Math.hypot(30, 50), 6);
    expect(reachesBuilding(spot.x, spot.y, building, 45)).toBe(false);
  });

  it("reaches it from the front 45 units off the tiles, where Flash's rule needed none", () => {
    const building = townHall().buildings[0]!;
    // 30 and 28 units past the bottom corner (65, 65): 41 units off the tiles.
    const front = { x: 95, y: 93 };
    expect(reachesBuilding(front.x, front.y, building, 45)).toBe(true);
    const anchorX = building.sx * 0.5 + building.sy;
    const anchorY = building.sy - building.sx * 0.5;
    expect(screenDistanceSquared(front.x, front.y, anchorX, anchorY)).toBeGreaterThan(45 * 45);
  });

  it("stops a Rezghul, ranged, the same 141 units off the tiles walking in from behind or in front", () => {
    // The melee champions walk up to the building since patch 7.10
    // (meleeReach.test.ts); a ranged monster keeps patch 7.9's nearest-tile
    // reach, its range scaled by 1/√2 since pick C (rangedReach.test.ts).
    expect(monsterRange("C19", 1)).toBe(200);
    for (const [side, x, y] of [
      ["behind", -500, -500],
      ["in front", 500, 500],
    ] as const) {
      const yard = townHall();
      const building = yard.buildings[0]!;
      const battle = createBattle(yard, { seed: 3, levels: { C19: 1 } });
      battle.apply({ kind: "fling", t: 0, x, y, r: 100, monsters: { C19: 1 } });
      let stoodOff = -1;
      for (let tick = 0; tick < 8000 && stoodOff < 0; tick += 1) {
        battle.step();
        const rezghul = battle.creeps()[0]!;
        if (rezghul.state === "attacking" && rezghul.targetBuilding === building.id) {
          stoodOff = Math.sqrt(reachSquared(rezghul.ix, rezghul.iy, building));
        }
      }
      expect(stoodOff, side).toBeLessThanOrEqual(200 * Math.SQRT1_2);
      expect(stoodOff, side).toBeGreaterThan(200 * Math.SQRT1_2 - 5);
    }
  });
});
