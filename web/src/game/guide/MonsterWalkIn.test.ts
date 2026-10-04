// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture, type Container, type Sprite } from "pixi.js";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { anchorOffset, spriteFor } from "@/game/attack/monsterSprites";
import type { BaseLoadResponse } from "@/api/types";
import { blocksPathing, gridCost } from "@/game/combat/rules";
import { depthKey } from "@/game/yard/YardGrid";
import { readYard } from "@/game/yard/yardModel";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import {
  hatcheryWalk,
  routeBetween,
  walkerAt,
  walkerZIndex,
  walkIntoHousing,
  walkOutOfHatchery,
  type MonsterWalkIn,
} from "./MonsterWalkIn";

/**
 * New monsters walking into Housing (issue #227): Bob's Pokeys in the guided
 * start, and Goals' monster rewards (`plugins/goals.ts`).
 */

/** A yard renderer that keeps what stands among its buildings in a set. */
const host = () => {
  const among = new Set<Container>();
  return {
    among,
    yardToWorld: (x: number, y: number) => ({ x, y }),
    standAmongBuildings: (child: Container) => void among.add(child),
    leaveBuildings: (child: Container) => void among.delete(child),
  };
};
const housing = { type: 15, x: 100, y: 40, footprint: [80, 80] as const };
const started: MonsterWalkIn[] = [];

afterEach(() => {
  while (started.length) started.pop()?.destroy();
});

describe("walkIntoHousing", () => {
  it("walks from the plot's east edge to the first Housing's middle", () => {
    const stage = host();
    const walk = walkIntoHousing(stage, { buildings: [{ type: 14, x: 0, y: 0, footprint: [130, 130] }, housing], bounds: { yardWidth: 1000 } }, "C1", 15);
    expect(walk).not.toBeNull();
    started.push(walk!);
    // The box holds both ends of the walk, whichever way the route goes.
    const box = walk!.worldBox()!;
    expect(box.x).toBeLessThanOrEqual(140 - 60);
    expect(box.x + box.width).toBeGreaterThanOrEqual(500 + 60);
    expect(box.y).toBeLessThanOrEqual(80 - 60);
  });

  it("tells whoever started it once it is over, even when taken down early (#228)", () => {
    const onEnd = vi.fn();
    const walk = walkIntoHousing(host(), { buildings: [housing], bounds: { yardWidth: 1000 } }, "C1", 3, onEnd);
    walk!.destroy();
    walk!.destroy();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("does nothing without a Housing, or with nobody to walk", () => {
    expect(walkIntoHousing(host(), { buildings: [], bounds: { yardWidth: 1000 } }, "C1", 15)).toBeNull();
    expect(walkIntoHousing(host(), { buildings: [housing], bounds: { yardWidth: 1000 } }, "C1", 0)).toBeNull();
  });
});

describe("walkOutOfHatchery (#228)", () => {
  const hatchery = { id: 4, type: 13, x: 0, y: 0, footprint: [100, 100] as const };
  const near = { id: 5, type: 15, x: 200, y: 0, footprint: [80, 80] as const };
  const far = { id: 6, type: 15, x: -600, y: 0, footprint: [80, 80] as const };
  const yard = (buildings: object[]) => ({ buildings, bounds: { yardWidth: 1000 } }) as Parameters<typeof hatcheryWalk>[0];

  it("steps out of the Hatchery's front corner and heads for the nearest standing Housing", () => {
    expect(hatcheryWalk(yard([far, hatchery, near]), 4)).toEqual({ from: { x: 100, y: 100 }, to: { x: 240, y: 40 } });
    expect(hatcheryWalk(yard([far, hatchery, { ...near, hp: 0 }]), 4)?.to).toEqual({ x: -560, y: 40 });
  });

  it("does nothing without that Hatchery, a Housing, or anybody to walk", () => {
    expect(hatcheryWalk(yard([far, near]), 4)).toBeNull();
    expect(hatcheryWalk(yard([hatchery]), 4)).toBeNull();
    expect(walkOutOfHatchery(host(), yard([hatchery, near]), 4, "C1", 0)).toBeNull();
  });

  it("starts at once on the host", () => {
    const stage = host();
    const walk = walkOutOfHatchery(stage, yard([hatchery, near]), 4, "C1", 1);
    expect(walk).not.toBeNull();
    started.push(walk!);
    expect(walk!.worldBox()).not.toBeNull();
  });
});

describe("walkers among the buildings (#272)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stands each walker among the buildings, sorted by its ground point, and takes it out after", () => {
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    vi.spyOn(MonsterSheetTextures.prototype, "frame").mockReturnValue(Texture.WHITE);
    const stage = host();
    const housing = { type: 15, x: 400, y: 0, footprint: [80, 80] as const };
    const walk = walkIntoHousing(stage, { buildings: [housing], bounds: { yardWidth: 1000 } }, "C1", 2)!;
    vi.advanceTimersByTime(600);

    const walkers = [...stage.among] as Sprite[];
    expect(walkers).toHaveLength(2);
    for (const walker of walkers) expect(walker.parent).toBeNull();
    // Each key is the creep key of the ground the walker stands on, never the
    // screen-y key of a separate layer drawn over every building.
    const anchor = anchorOffset(spriteFor("C1")!);
    walkers.forEach((walker, index) => {
      const ground = { x: walker.position.x - anchor.x, y: walker.position.y - anchor.y };
      expect(walker.zIndex).toBeCloseTo(walkerZIndex(ground, index), 0);
    });

    walk.destroy();
    expect(stage.among.size).toBe(0);
  });

  it("sorts a walker behind a building it passes behind, and in front of one it passes in front of", () => {
    // A Housing 80 x 80 whose centre is world (0, 40), sorted as the yard sorts it.
    const building = depthKey(0, 40, 7) * 8;
    expect(walkerZIndex({ x: 0, y: 10 }, 0)).toBeLessThan(building);
    expect(walkerZIndex({ x: 0, y: 70 }, 0)).toBeGreaterThan(building);
  });
});

describe("walking round buildings (#272)", () => {
  const hatchery = { id: 1, type: 13, x: 0, y: 0, footprint: [100, 100] as const };
  const housing = { id: 2, type: 15, x: 300, y: -40, footprint: [160, 160] as const };
  const yard = (buildings: object[]) => ({ buildings, bounds: { yardWidth: 1000 } }) as Parameters<typeof routeBetween>[0];
  /** Strictly inside a rectangle, in yard units. */
  const inside = (point: { x: number; y: number }, x: number, y: number, w: number, h: number) =>
    point.x > x && point.x < x + w && point.y > y && point.y < y + h;

  it("goes round a Hatchery standing in the way, not through its middle", () => {
    const from = { x: -100, y: 50 };
    const to = { x: 200, y: 50 };
    const route = routeBetween(yard([hatchery]), from, to)!;
    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
    // The middle the grid prices at 200 a cell (`[10, 10, 80, 80, 200]`).
    for (const point of route) expect(inside(point, 10, 10, 80, 80)).toBe(false);
    // Round it, not the long way: well under twice the straight line.
    let length = 0;
    for (let index = 1; index < route.length; index++) {
      length += Math.hypot(route[index]!.x - route[index - 1]!.x, route[index]!.y - route[index - 1]!.y);
    }
    expect(length).toBeLessThan(2 * 300);
  });

  it("goes into a Housing by its gate, never over the fence", () => {
    // From behind the pen: the gate is in the front-left side (`GRID_COST[15]`).
    const route = routeBetween(yard([housing]), { x: 380, y: -200 }, { x: 380, y: 40 })!;
    expect(route).not.toBeNull();
    const fence = [
      [10, 10, 140, 20],
      [130, 30, 20, 120],
      [10, 30, 20, 120],
      [30, 130, 30, 20],
      [100, 130, 30, 20],
    ] as const;
    // Waypoints are cell corners nudged up to 2 units (`PATHING.Jiggle`), so
    // one walking along the fence may sit that far over its edge.
    for (const point of route) {
      for (const [x, y, w, h] of fence) {
        expect(inside(point, 300 + x + 3, -40 + y + 3, w - 6, h - 6)).toBe(false);
      }
    }
    // In through the gap between the two front pieces, x 360 to 400.
    const crossing = route.find((point) => point.y < 90 && point.y > 60 && point.x > 340)!;
    expect(crossing.x).toBeGreaterThan(355);
    expect(crossing.x).toBeLessThan(405);
  });

  it("takes every Hatchery's monsters home round the full test yard's buildings", () => {
    const full = readYard(fixture as unknown as BaseLoadResponse);
    const hatcheries = full.buildings.filter((building) => building.type === 13);
    expect(hatcheries.length).toBeGreaterThan(0);
    for (const source of hatcheries) {
      const walk = hatcheryWalk(full, source.id)!;
      const route = routeBetween(full, walk.from, walk.to)!;
      expect(route).not.toBeNull();
      for (const building of full.buildings) {
        if (blocksPathing(building.type)) continue;
        // The pen the walk ends in is gone into by its gate.
        if (building.x + 80 === walk.to.x && building.y + 80 === walk.to.y) continue;
        for (const [x, y, w, h, cost] of gridCost(building.type, building.level)) {
          if (cost < 200) continue;
          for (const point of route) {
            expect(inside(point, building.x + x + 3, building.y + y + 3, w - 6, h - 6)).toBe(false);
          }
        }
      }
    }
  });

  it("walks straight when the grid has no route", () => {
    // Off the 2,600-unit grid.
    expect(routeBetween(yard([hatchery]), { x: 5000, y: 0 }, { x: 200, y: 50 })).toBeNull();
  });

  it("follows the route in single file, facing the way it goes", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 110, y: 0 },
      { x: 110, y: 110 },
    ];
    const options = { from: route[0]!, to: route[2]!, route };
    // One second at 110 units a second: at the corner.
    expect(walkerAt(options, 0, 1)).toMatchObject({ x: 110, y: 0, done: false });
    // Halfway down the second leg, heading down it.
    const later = walkerAt(options, 0, 1.5);
    expect(later.x).toBeCloseTo(110);
    expect(later.y).toBeCloseTo(55);
    expect(later.heading).toBeCloseTo(Math.PI / 2);
    // The next one in line is a stagger behind on the same route.
    expect(walkerAt(options, 1, 1.18)).toMatchObject({ x: 110, y: 0 });
    expect(walkerAt(options, 0, 10).done).toBe(true);
  });
});
