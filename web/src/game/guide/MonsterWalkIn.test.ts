// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Container } from "pixi.js";
import { hatcheryWalk, walkIntoHousing, walkOutOfHatchery, type MonsterWalkIn } from "./MonsterWalkIn";

/**
 * New monsters walking into Housing (issue #227): Bob's Pokeys in the guided
 * start, and Goals' monster rewards (`plugins/goals.ts`).
 */

const host = () => ({ root: new Container(), yardToWorld: (x: number, y: number) => ({ x, y }) });
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
    expect(stage.root.children).toHaveLength(1);
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
    expect(stage.root.children).toHaveLength(1);
  });
});
