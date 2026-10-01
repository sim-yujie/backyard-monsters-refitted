// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { walkIntoHousing, type MonsterWalkIn } from "./MonsterWalkIn";

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

  it("does nothing without a Housing, or with nobody to walk", () => {
    expect(walkIntoHousing(host(), { buildings: [], bounds: { yardWidth: 1000 } }, "C1", 15)).toBeNull();
    expect(walkIntoHousing(host(), { buildings: [housing], bounds: { yardWidth: 1000 } }, "C1", 0)).toBeNull();
  });
});
