import { describe, expect, it } from "vitest";

import { RANGED_BUILDING_REACH_SCALE, buildingReachOf } from "./champions.js";
import { createBattle } from "./engine.js";
import { daveRange } from "./specialMoves.js";
import { championStat, monsterRange } from "./stats.js";
import type { EngineBuilding, EngineYard } from "./yard.js";
import { buildEngineYard, reachSquared, sightPointOf } from "./yard.js";

/**
 * The owner's pick C (24 Nov 2026): a ranged monster or Fomor reaches a
 * building from its range times 1/√2, in yard units from the nearest tile
 * ({@link RANGED_BUILDING_REACH_SCALE}, `buildingReachOf`).
 *
 * D.A.V.E. was seen firing from much farther than in Flash. Flash measured
 * his 140/180/220 in screen pixels to the building's top corner
 * (`CreepBase.as:735-741`); patch 7.9 made it 140/180/220 yard units from the
 * nearest tile, which on screen is √2 times that beside a building (303 px
 * off a Town Hall at rank 3, against Flash's ~80). Scaled, a ranged monster
 * beside a building fires from Flash's `range` pixels off the tiles, and head
 * on (in front or behind) from half of it.
 */

/** Screen point of a yard point (`x - y`, `(x + y) / 2`). */
const screen = (x: number, y: number): { x: number; y: number } => ({
  x: x - y,
  y: (x + y) / 2,
});

/** The footprint's least corner in yard units, as `yard.ts` places it. */
const originOf = (building: EngineBuilding): { x: number; y: number } => ({
  x: building.sx * 0.5 + building.sy,
  y: building.sy - building.sx * 0.5,
});

/**
 * Screen pixels from a yard point to the nearest drawn point of a building's
 * footprint (its four edges on screen), 0 on or inside it.
 */
const screenGap = (x: number, y: number, building: EngineBuilding): number => {
  const o = originOf(building);
  const u = x - o.x;
  const v = y - o.y;
  if (u >= 0 && u <= building.w && v >= 0 && v <= building.h) return 0;
  const at = screen(x, y);
  // Nearest point on each drawn edge, a straight segment on screen.
  const corners = [
    [0, 0],
    [building.w, 0],
    [building.w, building.h],
    [0, building.h],
  ].map(([a, b]) => screen(o.x + a!, o.y + b!));
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const p = corners[i]!;
    const q = corners[(i + 1) % 4]!;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const t = Math.max(
      0,
      Math.min(1, ((at.x - p.x) * dx + (at.y - p.y) * dy) / (dx * dx + dy * dy)),
    );
    best = Math.min(best, Math.hypot(at.x - (p.x + t * dx), at.y - (p.y + t * dy)));
  }
  return best;
};

/** One building alone in a yard: a Town Hall (130 x 130) or a Twig Snapper (70 x 70). */
const BUILDINGS = [
  ["Town Hall 130x130", 14, -65],
  ["Twig Snapper 70x70", 1, -35],
] as const;

const yardOf = (t: number, at: number): EngineYard =>
  buildEngineYard({ buildingdata: { "1": { id: 1, t, l: 1, X: at, Y: at } } });

/**
 * The four ways in, each a yard direction straight out of one corner of the
 * footprint: in front (bottom corner) and behind (top corner) are straight up
 * and down on screen, right and left are level with it.
 */
const SIDES = [
  ["in front", 1, 1, true, true],
  ["behind", -1, -1, false, false],
  ["right", 1, -1, true, false],
  ["left", -1, 1, false, true],
] as const;

type Drop =
  | { readonly monsters: Readonly<Record<string, number>>; readonly champion?: undefined }
  | {
      readonly monsters?: undefined;
      readonly champion: { readonly t: number; readonly l: number };
    };

/**
 * Drops one attacker 500 units out along a side's line from its corner and
 * returns where it stood when it first attacked the building, or null. The
 * drop scatters where a creep lands, so a first run reads how far it landed
 * off the drop point and a second, the same battle drawn the same way, drops
 * that much the other way to land it right on the line.
 */
const firstShot = (
  yard: EngineYard,
  side: (typeof SIDES)[number],
  drop: Drop,
  options: Parameters<typeof createBattle>[1],
): { yardGap: number; screenGap: number } | null => {
  const building = yard.buildings[0]!;
  const o = originOf(building);
  const [, dx, dy, farX, farY] = side;
  const cornerX = o.x + (farX ? building.w : 0);
  const cornerY = o.y + (farY ? building.h : 0);
  const want = { x: cornerX + dx * 500, y: cornerY + dy * 500 };
  const fling = (x: number, y: number) => {
    const battle = createBattle(yard, options);
    battle.apply({
      kind: "fling",
      t: 0,
      x,
      y,
      r: 1,
      monsters: drop.monsters ?? {},
      ...(drop.champion ? { champion: drop.champion } : {}),
    });
    return battle;
  };
  const probe = fling(want.x, want.y);
  probe.step();
  const landed = probe.creeps()[0]!;
  const battle = fling(2 * want.x - landed.ix, 2 * want.y - landed.iy);
  for (let tick = 0; tick < 12000; tick += 1) {
    battle.step();
    const creep = battle.creeps()[0];
    if (creep && creep.state === "attacking" && creep.targetBuilding === building.id) {
      return {
        yardGap: Math.sqrt(reachSquared(creep.ix, creep.iy, building)),
        screenGap: screenGap(creep.ix, creep.iy, building),
      };
    }
  }
  return null;
};

describe("ranged reach to a building (owner's pick C, 24 Nov 2026)", () => {
  it("scales every ranged monster's and Fomor's range by 1/√2", () => {
    expect(RANGED_BUILDING_REACH_SCALE).toBe(Math.SQRT1_2);
    expect(buildingReachOf("C12", false, 220)).toBeCloseTo(155.56, 2);
    expect(buildingReachOf("G3", true, championStat("G3", "range", 1))).toBe(
      championStat("G3", "range", 1) * Math.SQRT1_2,
    );
  });

  for (const [label, t, at] of BUILDINGS) {
    it(`stops D.A.V.E. (ranks 1-3) by a ${label}: Flash's range in pixels beside it, half of it head on`, () => {
      for (const rank of [1, 2, 3]) {
        const range = daveRange(rank);
        expect(range).toBe(100 + 40 * rank);
        for (const side of SIDES) {
          const name = `rank ${rank} ${side[0]}`;
          const shot = firstShot(
            yardOf(t, at),
            side,
            { monsters: { C12: 1 } },
            {
              seed: 3,
              levels: { C12: 1 },
              ranks: { C12: rank },
            },
          );
          expect(shot, name).not.toBeNull();
          // In yard units, range / √2 off the nearest tile on every side.
          expect(shot!.yardGap, name).toBeLessThanOrEqual(range * Math.SQRT1_2);
          expect(shot!.yardGap, name).toBeGreaterThan(range * Math.SQRT1_2 - 4);
          // On screen: level with a corner (right, left) that is Flash's
          // `range` pixels; straight up or down (in front, behind) half of it.
          const flat = side[0] === "right" || side[0] === "left";
          const want = flat ? range : range / 2;
          expect(shot!.screenGap, name).toBeLessThanOrEqual(want + 0.5);
          expect(shot!.screenGap, name).toBeGreaterThan(want - 6);
        }
      }
    });
  }

  it("stops a Sabnox, ranged, its range / √2 off a Town Hall from every side", () => {
    // A flyer (Teratorn, Zafreeti) is also at a building once within 170
    // screen px of its top corner when it sets off for it (`routeTo`,
    // `ChampionBase.as:662`), Flash's rule, which this change leaves alone.
    const range = monsterRange("IC7", 1);
    expect(range).toBe(240);
    for (const side of SIDES) {
      const shot = firstShot(
        yardOf(14, -65),
        side,
        { monsters: { IC7: 1 } },
        {
          seed: 3,
          levels: { IC7: 1 },
        },
      );
      expect(shot, side[0]).not.toBeNull();
      expect(shot!.yardGap, side[0]).toBeLessThanOrEqual(range * Math.SQRT1_2);
      expect(shot!.yardGap, side[0]).toBeGreaterThan(range * Math.SQRT1_2 - 6);
    }
  });

  it("draws D.A.V.E.'s rocket to the footprint point nearest him, not the building's middle", () => {
    const yard = yardOf(14, -65);
    const building = yard.buildings[0]!;
    const battle = createBattle(yard, { seed: 3, levels: { C12: 1 }, ranks: { C12: 3 } });
    battle.apply({ kind: "fling", t: 0, x: 565, y: -565, r: 1, monsters: { C12: 1 } });
    let hit: { ix: number; iy: number; targetIx: number; targetIy: number } | null = null;
    for (let tick = 0; tick < 12000 && !hit; tick += 1) {
      battle.step();
      for (const event of battle.recentEvents(tick)) {
        if (event.kind === "hit" && event.buildingId === building.id && event.ranged)
          hit = event;
      }
    }
    expect(hit).not.toBeNull();
    const nearest = sightPointOf(hit!.ix, hit!.iy, building);
    expect(hit!.targetIx).toBe(nearest.x);
    expect(hit!.targetIy).toBe(nearest.y);
    // On the footprint's edge, a reach away from where he fired.
    expect(reachSquared(hit!.targetIx, hit!.targetIy, building)).toBe(0);
    expect(Math.hypot(hit!.targetIx - hit!.ix, hit!.targetIy - hit!.iy)).toBeLessThanOrEqual(
      daveRange(3) * Math.SQRT1_2,
    );
  });

  it("stops Fomor (level 1) his range / √2 off a Town Hall from every side", () => {
    const range = championStat("G3", "range", 1);
    for (const side of SIDES) {
      const shot = firstShot(yardOf(14, -65), side, { champion: { t: 3, l: 1 } }, { seed: 3 });
      expect(shot, side[0]).not.toBeNull();
      expect(shot!.yardGap, side[0]).toBeLessThanOrEqual(range * Math.SQRT1_2);
      expect(shot!.yardGap, side[0]).toBeGreaterThan(range * Math.SQRT1_2 - 6);
    }
  });
});
