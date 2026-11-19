import { describe, expect, it } from "vitest";
import {
  EMPTY_LIFE,
  cageMoved,
  championWalkerKey,
  recageTrip,
  reconcileWalkers,
  walkerSpecs,
  type YardLife,
} from "./yardLifeModel";

const seeded = (seed = 1) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};

const life = (cageX: number, cageY: number, id = 51): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: 1000, height: 1000 },
  cage: { id, x: cageX, y: cageY },
  champions: [{ id: "G3", level: 6, sheetLevel: 6 }],
});

const inside = (area: { x: number; y: number; width: number; height: number }, x: number, y: number) =>
  x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;

/** A walker pacing the cage at (100, 100), as the yard had it before the move. */
const pacing = () => {
  const walkers = reconcileWalkers(new Map(), walkerSpecs(life(100, 100), seeded()), seeded());
  return { walkers, walker: walkers.get(championWalkerKey(51, "G3"))! };
};

describe("cageMoved", () => {
  it("is true only for the same cage at another corner", () => {
    expect(cageMoved(life(100, 100), life(600, 600))).toBe(true);
    expect(cageMoved(life(100, 100), life(100, 140))).toBe(true);
    expect(cageMoved(life(100, 100), life(100, 100))).toBe(false);
    expect(cageMoved(life(100, 100), life(600, 600, 52))).toBe(false);
    expect(cageMoved(EMPTY_LIFE, life(600, 600))).toBe(false);
    expect(cageMoved(life(100, 100), EMPTY_LIFE)).toBe(false);
  });
});

describe("a champion after its cage moved (same building id)", () => {
  it("is kept by the yard re-read at its old cage, which is why the move has to send it", () => {
    const { walkers, walker } = pacing();
    const oldArea = { ...walker.area };
    const after = reconcileWalkers(walkers, walkerSpecs(life(600, 600), seeded(2)), seeded(3));
    expect(after.get(championWalkerKey(51, "G3"))).toBe(walker);
    expect(walker.area).toEqual(oldArea);
  });

  it("walks along the route from where it stands to a spot in the new cage", () => {
    const { walker } = pacing();
    const [spec] = walkerSpecs(life(600, 600), seeded(2));
    const from = { x: walker.x, y: walker.y };
    const calls: { x: number; y: number }[][] = [];
    const route = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      calls.push([a, b]);
      return [a, { x: a.x, y: b.y }, b];
    };
    expect(recageTrip(walker, spec!.area, route, seeded(4))).toBe(true);
    expect(walker.area).toEqual(spec!.area);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual(from);
    expect(inside(spec!.area, calls[0]![1]!.x, calls[0]![1]!.y)).toBe(true);
    expect(walker.trip).toHaveLength(2);
    expect(walker.leaving).toBe(false);
    expect(inside(spec!.area, walker.targetX, walker.targetY)).toBe(true);
  });

  it("is put straight in the new cage with no route, or none to be had", () => {
    for (const route of [null, () => null]) {
      const { walker } = pacing();
      const [spec] = walkerSpecs(life(600, 600), seeded(2));
      expect(recageTrip(walker, spec!.area, route, seeded(4))).toBe(false);
      expect(walker.trip).toBeNull();
      expect(walker.moving).toBe(false);
      expect(inside(spec!.area, walker.x, walker.y)).toBe(true);
      expect([walker.targetX, walker.targetY]).toEqual([walker.x, walker.y]);
    }
  });

  it("keeps one on its way into the Chamber going, but gives it the new cage to come back to", () => {
    const { walker } = pacing();
    walker.leaving = true;
    walker.trip = [{ x: 900, y: 900 }];
    const [spec] = walkerSpecs(life(600, 600), seeded(2));
    expect(recageTrip(walker, spec!.area, (a, b) => [a, b], seeded(4))).toBe(false);
    expect(walker.trip).toEqual([{ x: 900, y: 900 }]);
    expect(walker.leaving).toBe(true);
    expect(walker.area).toEqual(spec!.area);
  });
});
