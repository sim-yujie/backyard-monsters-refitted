import { describe, expect, test } from "bun:test";
import { footprintOf } from "../../game-data/buildingFootprints.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { placementProblem } from "../yard/build.js";
import { MAX_EXPANSIONS, rectOf, withinBounds } from "../yardplanner/layoutGeometry.js";
import { checkNodePlacement } from "../yardplanner/validateLayout.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import {
  DECORATION_ID_BASE,
  DECORATION_TYPES,
  expansionFor,
  GRID,
  layoutBotYard,
  MAX_DECORATIONS,
  TRAP_TYPES,
  WALL_TYPE,
  type BotLayout,
  type PlacedSpot,
} from "./layout.js";
import { PERSONAS, targetInBand, yardAtPoints, type Persona, type ProgressionYard } from "./progression.js";

/** The bot yard layout (issue #238, `docs/design/bot-neighbours.md` §4.2 step 2). */

interface Laid {
  seed: number;
  yard: ProgressionYard;
  layout: BotLayout;
}

const laidOut = (seed: number, persona: Persona, level: number, fraction = 0.5): Laid => {
  const yard = yardAtPoints(seed, persona, targetInBand(level, fraction));
  const entries = yard.buildings.map((building) => ({
    id: building.id,
    t: building.t,
    level: yard.builtAtLevel[building.id]!,
  }));
  return { seed, yard, layout: layoutBotYard(seed, persona, entries, yard.level) };
};

const HARVESTERS = new Set([1, 2, 3, 4]);
const TOWERS = new Set([20, 21, 23, 25, 115, 118]);
const SILO = 6;

/**
 * The server's own rules, as a player building the yard one piece at a time
 * would meet them: each building passes the build route's placement gate
 * (`placementProblem`) on the plot it was built on, each decoration the same
 * gate on today's plot (as `decor/place`), and the whole yard passes the Yard
 * Planner's Apply check (`checkNodePlacement`).
 */
const expectBuildable = ({ seed, yard, layout }: Laid) => {
  expect(layout.buildings.map((spot) => spot.id)).toEqual(yard.buildings.map((building) => building.id));
  const buildingdata: BuildingDataMap = {};
  const place = (spot: PlacedSpot, expansion: number) => {
    expect(Number.isInteger(spot.X) && Number.isInteger(spot.Y)).toBe(true);
    expect(Math.abs(spot.X % GRID)).toBe(0);
    expect(Math.abs(spot.Y % GRID)).toBe(0);
    const save = { buildingdata, storedata: { ENL: { q: expansion } } };
    const problem = placementProblem(save, { type: spot.t, x: spot.X, y: spot.Y });
    expect({ id: spot.id, problem }).toEqual({ id: spot.id, problem: null });
    buildingdata[String(spot.id)] = { id: spot.id, t: spot.t, X: spot.X, Y: spot.Y } as never;
  };
  for (const spot of layout.buildings) place(spot, expansionFor(seed, yard.builtAtLevel[spot.id]!));
  for (const spot of layout.decorations) place(spot, layout.expansion);

  const nodes = [...layout.buildings, ...layout.decorations].map((spot) => ({
    id: spot.id,
    t: spot.t,
    x: spot.X,
    y: spot.Y,
  }));
  expect(() => checkNodePlacement(nodes, layout.expansion)).not.toThrow();
};

describe("layoutBotYard", () => {
  test(
    "every level 1-40, each persona: legal on the plot of the day, Apply accepts the yard",
    () => {
      for (let level = 1; level <= 40; level++) {
        PERSONAS.forEach((persona, index) => {
          expectBuildable(laidOut(level * 7919 + index * 104729, persona, level, (index + 0.5) / 3));
        });
      }
    },
    { timeout: 60_000 }
  );

  test(
    "40 seeds grown to level 40 are legal at every step on the way",
    () => {
      for (let seed = 0; seed < 40; seed++) {
        expectBuildable(laidOut(seed * 15485863 + 11, PERSONAS[seed % PERSONAS.length]!, 40, 0.9));
      }
    },
    { timeout: 60_000 }
  );

  test("growth never moves a building or a decoration", () => {
    const levels = [3, 8, 14, 20, 27, 33, 38, 40];
    for (let seed = 0; seed < 8; seed++) {
      const persona = PERSONAS[seed % PERSONAS.length]!;
      const yards = levels.map((level) => laidOut(seed + 500, persona, level).layout);
      for (let i = 1; i < yards.length; i++) {
        const before = yards[i - 1]!;
        const after = yards[i]!;
        expect(after.expansion).toBeGreaterThanOrEqual(before.expansion);
        expect(after.buildings.slice(0, before.buildings.length)).toEqual(before.buildings);
        expect(after.decorations.slice(0, before.decorations.length)).toEqual(before.decorations);
      }
    }
  });

  test("the same seed and buildings give the same layout", () => {
    expect(laidOut(31337, "economy", 33).layout).toEqual(laidOut(31337, "economy", 33).layout);
  });

  test("two seeds of one level do not share a layout", () => {
    const a = laidOut(1, "towers", 30).layout.buildings.slice(0, 20);
    const b = laidOut(2, "towers", 30).layout.buildings.slice(0, 20);
    expect(a).not.toEqual(b);
  });

  test("zones: the Town Hall in the middle, storage inside, harvesters outside, towers spread, walls in runs", () => {
    for (let seed = 0; seed < 10; seed++) {
      const { layout } = laidOut(seed * 92821 + 7, PERSONAS[seed % PERSONAS.length]!, 40, 0.5);
      const centre = (spot: PlacedSpot) => {
        const { w, h } = footprintOf(spot.t);
        return { x: spot.X + w / 2, y: spot.Y + h / 2 };
      };
      const hall = centre(layout.buildings.find((spot) => spot.t === TOWN_HALL_TYPE)!);
      expect(Math.abs(hall.x)).toBeLessThanOrEqual(50);
      expect(Math.abs(hall.y)).toBeLessThanOrEqual(50);

      const median = (types: ReadonlySet<number>) => {
        const out = layout.buildings
          .filter((spot) => types.has(spot.t))
          .map((spot) => {
            const at = centre(spot);
            return Math.hypot(at.x - hall.x, at.y - hall.y);
          })
          .sort((a, b) => a - b);
        return out[Math.floor(out.length / 2)]!;
      };
      expect(median(HARVESTERS)).toBeGreaterThan(median(new Set([SILO])) + 150);

      const towers = layout.buildings.filter((spot) => TOWERS.has(spot.t)).map(centre);
      const spacing =
        towers.reduce((sum, tower) => {
          let nearest = Number.POSITIVE_INFINITY;
          for (const other of towers) if (other !== tower) nearest = Math.min(nearest, Math.hypot(other.x - tower.x, other.y - tower.y));
          return sum + nearest;
        }, 0) / towers.length;
      expect(spacing).toBeGreaterThan(110);

      const walls = layout.buildings.filter((spot) => spot.t === WALL_TYPE);
      const at = new Set(walls.map((spot) => `${spot.X},${spot.Y}`));
      const joined = walls.filter((spot) =>
        [
          [20, 0],
          [-20, 0],
          [0, 20],
          [0, -20],
        ].some(([dx, dy]) => at.has(`${spot.X + dx!},${spot.Y + dy!}`))
      ).length;
      expect(joined / walls.length).toBeGreaterThan(0.9);

      // Traps sit in a ring opening or near a tower, never out on their own.
      for (const trap of layout.buildings.filter((spot) => TRAP_TYPES.has(spot.t))) {
        const c = centre(trap);
        const nearestTower = Math.min(...towers.map((tower) => Math.hypot(tower.x - c.x, tower.y - c.y)));
        const nearestWall = Math.min(...walls.map((wall) => Math.hypot(wall.X - trap.X, wall.Y - trap.Y)));
        expect(Math.min(nearestTower, nearestWall)).toBeLessThan(160);
      }
    }
  });

  test("a few decorations from the list, with ids above anything the progression builds", () => {
    let seen = 0;
    for (let seed = 0; seed < 20; seed++) {
      const { layout, yard } = laidOut(seed, PERSONAS[seed % PERSONAS.length]!, 40, 0.5);
      expect(layout.decorations.length).toBeGreaterThan(0);
      expect(layout.decorations.length).toBeLessThanOrEqual(MAX_DECORATIONS);
      const top = Math.max(...yard.buildings.map((building) => building.id));
      layout.decorations.forEach((spot, index) => {
        expect(spot.id).toBe(DECORATION_ID_BASE + index);
        expect(spot.id).toBeGreaterThan(top);
        expect(DECORATION_TYPES).toContain(spot.t);
        expect(footprintOf(spot.t).decoration).toBe(true);
        expect(withinBounds(rectOf(spot.t, spot.X, spot.Y), layout.expansion)).toBe(true);
      });
      seen += layout.decorations.length;
    }
    expect(seen).toBeGreaterThan(20);
    expect(laidOut(3, "army", 2).layout.decorations).toEqual([]);
  });
});

describe("expansionFor", () => {
  test("none at the start, all six by level 40, never fewer as the level grows", () => {
    for (let seed = 0; seed < 200; seed++) {
      expect(expansionFor(seed, 1)).toBe(0);
      expect(expansionFor(seed, 40)).toBe(MAX_EXPANSIONS);
      for (let level = 2; level <= 40; level++) {
        expect(expansionFor(seed, level)).toBeGreaterThanOrEqual(expansionFor(seed, level - 1));
      }
    }
  });

  test("seeds differ in when they buy", () => {
    const at23 = new Set(Array.from({ length: 50 }, (_, seed) => expansionFor(seed, 23)));
    expect(at23.size).toBeGreaterThan(1);
  });
});
