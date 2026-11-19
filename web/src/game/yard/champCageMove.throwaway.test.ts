// THROWAWAY (champ-cage diagnosis, not for merge): proves a raised champion
// keeps its old cage's wander area when the cage moves under the same id.
import { describe, expect, it } from "vitest";
import { EMPTY_LIFE, championWalkerKey, reconcileWalkers, walkerSpecs, type YardLife } from "./yardLifeModel";

const seeded = (seed = 1) => {
  let state = seed >>> 0;
  return (): number => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
};
const life = (cageX: number, cageY: number): YardLife => ({
  ...EMPTY_LIFE,
  plot: { width: 1000, height: 1000 },
  cage: { id: 51, x: cageX, y: cageY },
  champions: [{ id: "G3", level: 6, sheetLevel: 6 }],
});

describe("champion after its cage moved (same building id)", () => {
  it("keeps pacing the OLD cage", () => {
    const before = reconcileWalkers(new Map(), walkerSpecs(life(100, 100), seeded()), seeded());
    const walker = before.get(championWalkerKey(51, "G3"))!;
    const oldArea = { ...walker.area };
    const after = reconcileWalkers(before, walkerSpecs(life(600, 600), seeded(2)), seeded(3));
    const kept = after.get(championWalkerKey(51, "G3"))!;
    expect(kept).toBe(walker); // same walker object, same key
    expect(kept.area).toEqual(oldArea); // area not moved to the new cage
    expect(kept.x).toBeLessThan(300); // still standing at the old cage
    expect(kept.targetX).toBeLessThan(300); // and not heading anywhere new
  });
});
