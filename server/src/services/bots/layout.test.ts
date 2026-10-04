import { describe, expect, test } from "bun:test";
import { footprintOf } from "../../game-data/buildingFootprints.js";
import { TOWER_STATS } from "../../game-rules/combat/combatStatsData.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { nextBuildingId, placementProblem } from "../yard/build.js";
import { MAX_EXPANSIONS, rectOf, withinBounds, yardSize } from "../yardplanner/layoutGeometry.js";
import { checkNodePlacement } from "../yardplanner/validateLayout.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import {
  DECORATED_SHARE,
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
 * would meet them, in id order: each building and decoration takes the id the
 * server would give it (`nextBuildingId`) and passes the build route's
 * placement gate (`placementProblem`) on the plot the yard had then, and the
 * whole yard passes the Yard Planner's Apply check (`checkNodePlacement`).
 * The plot is the level's, or the one a cramped bot bought early and kept.
 */
const expectBuildable = ({ seed, yard, layout }: Laid) => {
  expect(layout.buildings.map((spot) => spot.t)).toEqual(yard.buildings.map((building) => building.t));
  const builtAt = new Map(layout.buildings.map((spot, index) => [spot.id, yard.builtAtLevel[yard.buildings[index]!.id]!]));
  const inOrder = [...layout.buildings, ...layout.decorations].sort((a, b) => a.id - b.id);
  const buildingdata: BuildingDataMap = {};
  let level = 1;
  let bought = 0;
  for (const spot of inOrder) {
    // A decoration goes up at the level of the building before it.
    level = builtAt.get(spot.id) ?? level;
    let plot = Math.max(expansionFor(seed, level), bought);
    while (!withinBounds(rectOf(spot.t, spot.X, spot.Y), plot)) plot++;
    bought = Math.max(bought, plot === expansionFor(seed, level) ? 0 : plot);
    expect(plot).toBeLessThanOrEqual(layout.expansion);
    expect(Number.isInteger(spot.X) && Number.isInteger(spot.Y)).toBe(true);
    expect(Math.abs(spot.X % GRID)).toBe(0);
    expect(Math.abs(spot.Y % GRID)).toBe(0);
    const save = { buildingdata, storedata: { ENL: { q: plot } } };
    expect(spot.id).toBe(nextBuildingId(save));
    const problem = placementProblem(save, { type: spot.t, x: spot.X, y: spot.Y });
    expect({ id: spot.id, problem }).toEqual({ id: spot.id, problem: null });
    buildingdata[String(spot.id)] = { id: spot.id, t: spot.t, X: spot.X, Y: spot.Y } as never;
  }

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

  test("a yard too broken up for its next Housing buys its next expansion early, and stays legal", () => {
    // This seed's second Housing finds no room on the plot of its level (found by a 60-yard run).
    const laid = laidOut(1356739, "economy", 30, 0.5);
    const early = laid.layout.buildings.find((spot, index) => {
      const level = laid.yard.builtAtLevel[laid.yard.buildings[index]!.id]!;
      return !withinBounds(rectOf(spot.t, spot.X, spot.Y), expansionFor(1356739, level));
    });
    expect(early?.t).toBe(15);
    expectBuildable(laid);
  });

  test("growth never moves a building or a decoration", () => {
    const levels = [3, 8, 14, 20, 27, 33, 38, 40];
    for (let seed = 0; seed < 8; seed++) {
      const persona = PERSONAS[seed % PERSONAS.length]!;
      const yards = levels.map((level) => laidOut(seed + 500, persona, level).layout);
      for (let i = 1; i < yards.length; i++) {
        const before = yards[i - 1]!;
        const after = yards[i]!;
        expect(after.expansion).toBeGreaterThanOrEqual(before.expansion);
        expect(after.expansion).toBeGreaterThanOrEqual(expansionFor(seed + 500, levels[i]!));
        expect(after.buildings.slice(0, before.buildings.length)).toEqual(before.buildings);
        expect(after.decorations.slice(0, before.decorations.length)).toEqual(before.decorations);
      }
    }
  });

  test("the same seed and buildings give the same layout", () => {
    expect(laidOut(31337, "economy", 33).layout).toEqual(laidOut(31337, "economy", 33).layout);
  });

  test("spots use the whole 5-unit grid, not only multiples of 10", () => {
    const spots = [...laidOut(77, "army", 35).layout.buildings];
    expect(spots.some((spot) => Math.abs(spot.X % 10) === 5)).toBe(true);
    expect(spots.some((spot) => Math.abs(spot.Y % 10) === 5)).toBe(true);
  });

  test("two seeds of one level do not share a layout", () => {
    const a = laidOut(1, "towers", 30).layout.buildings.slice(0, 20);
    const b = laidOut(2, "towers", 30).layout.buildings.slice(0, 20);
    expect(a).not.toEqual(b);
  });

  test("zones: the Town Hall in the middle, storage inside, harvesters further out, towers spread, walls in runs", () => {
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
      // Only the single Eye-ra bait blocks stand alone.
      expect(joined / walls.length).toBeGreaterThan(0.8);

      // Traps sit in a hallway, between the harvesters and silos or near a tower, never out on their own.
      const resources = layout.buildings.filter((spot) => HARVESTERS.has(spot.t) || spot.t === SILO).map(centre);
      for (const trap of layout.buildings.filter((spot) => TRAP_TYPES.has(spot.t))) {
        const c = centre(trap);
        const nearest = Math.min(...[...towers, ...resources].map((one) => Math.hypot(one.x - c.x, one.y - c.y)));
        const nearestWall = Math.min(...walls.map((wall) => Math.hypot(wall.X - trap.X, wall.Y - trap.Y)));
        expect(Math.min(nearest, nearestWall)).toBeLessThan(160);
      }
    }
  });

  test(
    "decorations are rare: at most one, on a few bots, from the list, numbered among the buildings",
    () => {
      const seeds = 200;
      let decorated = 0;
      for (let seed = 0; seed < seeds; seed++) {
        const { layout } = laidOut(seed, PERSONAS[seed % PERSONAS.length]!, 30, 0.5);
        expect(layout.decorations.length).toBeLessThanOrEqual(MAX_DECORATIONS);
        if (layout.decorations.length === 0) continue;
        decorated++;
        const top = Math.max(...layout.buildings.map((spot) => spot.id));
        expect(layout.decorations[0]!.id).toBeLessThan(top);
        layout.decorations.forEach((spot) => {
          expect(DECORATION_TYPES).toContain(spot.t);
          expect(footprintOf(spot.t).decoration).toBe(true);
          expect(withinBounds(rectOf(spot.t, spot.X, spot.Y), layout.expansion)).toBe(true);
        });
      }
      expect(MAX_DECORATIONS).toBe(1);
      expect(decorated).toBeGreaterThan(0);
      expect(decorated / seeds).toBeLessThan(DECORATED_SHARE + 0.07);
      expect(laidOut(3, "army", 2).layout.decorations).toEqual([]);
    },
    { timeout: 60_000 }
  );
});

/** Whether a footprint can be reached from the plot's edge without crossing a wall or a trap. */
const reachable = (blocks: readonly PlacedSpot[], target: PlacedSpot, expansion: number): boolean => {
  const [width, height] = yardSize(expansion);
  const cols = width / GRID + 2;
  const rows = height / GRID + 2;
  const ox = -width / 2 - GRID;
  const oy = -height / 2 - GRID;
  const blocked = new Uint8Array(cols * rows);
  for (const block of blocks) {
    const { w, h } = footprintOf(block.t);
    for (let y = block.Y; y < block.Y + h; y += GRID) {
      for (let x = block.X; x < block.X + w; x += GRID) blocked[((y - oy) / GRID) * cols + (x - ox) / GRID] = 1;
    }
  }
  const { w, h } = footprintOf(target.t);
  const c0 = (target.X - ox) / GRID - 1;
  const c1 = (target.X + w - ox) / GRID;
  const r0 = (target.Y - oy) / GRID - 1;
  const r1 = (target.Y + h - oy) / GRID;
  const seen = new Uint8Array(cols * rows);
  const queue = [0];
  seen[0] = 1;
  while (queue.length > 0) {
    const at = queue.pop()!;
    const c = at % cols;
    const r = (at - c) / cols;
    if (c >= c0 && c <= c1 && r >= r0 && r <= r1) return true;
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (seen[next] || blocked[next]) continue;
      seen[next] = 1;
      queue.push(next);
    }
  }
  return false;
};

/** The Base Defense Guide's rules, measured (issue #250). */
describe("layoutBotYard follows the Base Defense Guide", () => {
  const RESOURCES = new Set([...HARVESTERS, SILO, TOWN_HALL_TYPE]);

  test(
    "levels 10-40: towers' ranges cover the Town Hall, silos and harvesters",
    () => {
      let covered = 0;
      let all = 0;
      for (let level = 10; level <= 40; level++) {
        for (let index = 0; index < 3; index++) {
          const { yard, layout } = laidOut(level * 7919 + index * 104729, PERSONAS[index]!, level, (index + 0.5) / 3);
          const towers = layout.buildings.flatMap((spot, at) => {
            const range = TOWER_STATS[spot.t]?.[yard.buildings[at]!.l - 1]?.range;
            if (!TOWERS.has(spot.t) || range === undefined) return [];
            const { w, h } = footprintOf(spot.t);
            return [{ x: spot.X + w / 2, y: spot.Y + h / 2, range }];
          });
          let mine = 0;
          let yours = 0;
          for (const spot of layout.buildings.filter((one) => RESOURCES.has(one.t))) {
            const { w, h } = footprintOf(spot.t);
            const x = spot.X + w / 2;
            const y = spot.Y + h / 2;
            yours++;
            if (towers.some((tower) => Math.hypot(tower.x - x, tower.y - y) <= tower.range)) mine++;
          }
          // Every yard with towers has most of its resource buildings in range.
          if (towers.length > 0) expect({ level, index, most: mine / yours >= 0.7 }).toEqual({ level, index, most: true });
          covered += mine;
          all += yours;
        }
      }
      expect(covered / all).toBeGreaterThan(0.95);
    },
    { timeout: 60_000 }
  );

  test(
    "Town Hall 4 and up: the Town Hall and its silos are walled in, the hallways trapped",
    () => {
      for (let level = 25; level <= 40; level++) {
        for (let index = 0; index < 3; index++) {
          const { yard, layout } = laidOut(level * 7919 + index * 104729, PERSONAS[index]!, level, (index + 0.5) / 3);
          if (yard.townHall < 4) continue;
          const blocks = layout.buildings.filter((spot) => spot.t === WALL_TYPE || TRAP_TYPES.has(spot.t));
          const walls = blocks.filter((spot) => spot.t === WALL_TYPE);
          const hall = layout.buildings.find((spot) => spot.t === TOWN_HALL_TYPE)!;
          // Shut in by walls and traps, and not by walls alone: the trapped hallways are the way in.
          expect({ level, index, hall: reachable(blocks, hall, layout.expansion) }).toEqual({ level, index, hall: false });
          expect(reachable(walls, hall, layout.expansion)).toBe(true);
          for (const silo of layout.buildings.filter((spot) => spot.t === SILO)) {
            expect({ level, index, silo: reachable(blocks, silo, layout.expansion) }).toEqual({ level, index, silo: false });
          }
        }
      }
    },
    { timeout: 60_000 }
  );

  test(
    "Town Hall 10: most harvesters sit inside the walled compartments",
    () => {
      let inside = 0;
      let all = 0;
      for (let seed = 0; seed < 9; seed++) {
        const { yard, layout } = laidOut(seed * 7727 + 3, PERSONAS[seed % PERSONAS.length]!, 40, 0.8);
        expect(yard.townHall).toBe(10);
        const blocks = layout.buildings.filter((spot) => spot.t === WALL_TYPE || TRAP_TYPES.has(spot.t));
        for (const harvester of layout.buildings.filter((spot) => HARVESTERS.has(spot.t))) {
          all++;
          if (!reachable(blocks, harvester, layout.expansion)) inside++;
        }
      }
      expect(inside / all).toBeGreaterThan(0.5);
    },
    { timeout: 60_000 }
  );
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
