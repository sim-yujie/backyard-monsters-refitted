// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Texture, type Container, type Sprite } from "pixi.js";
import { MonsterSheetTextures } from "@/game/attack/AttackBattleLayer";
import { depthKey } from "@/game/yard/YardGrid";
import {
  hatcheryWalk,
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
    expect(walk!.worldBox()).toEqual({ x: 80, y: 20, width: 480, height: 120 });
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
    // Each key is the creep key of a point on the walk, never the screen-y key
    // of a separate layer drawn over every building.
    const [first] = walkers;
    expect(first!.zIndex % 8).toBe(4);
    expect(first!.zIndex).toBeGreaterThan(1_000_000);

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
