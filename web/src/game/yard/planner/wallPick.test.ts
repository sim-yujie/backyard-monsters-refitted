import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData, Resources } from "@/api/types";
import { townHallLevel } from "../buildingCosts";
import { readYard, type Yard } from "../yardModel";
import { wallTargets } from "./summary";
import { Plan } from "./plan";
import type { PlanNode } from "./placement";
import {
  affordablePick,
  allWallIds,
  autoWallTarget,
  boxPick,
  followWallTarget,
  isPickableWall,
  pickSummary,
  togglePick,
  wallsOnly,
} from "./wallPick";

/**
 * Upgrade walls' picking arithmetic (owner, 2026-11-04).
 *
 * The fixture is `WallUpgradePanel.test.ts`'s: four blocks at level 1, one at
 * level 5, a tower (type 20) and a Town Hall. Raising a block from 1 to 2
 * costs 10,000 pebbles and nothing else; 2 to 3 costs 100,000 twigs and
 * 100,000 pebbles.
 */

const BUILDINGS: readonly BuildingData[] = [
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 20, Y: 0 },
  { id: 3, t: 17, X: 40, Y: 0 },
  { id: 4, t: 17, X: 60, Y: 0, l: 2 },
  { id: 5, t: 17, X: 100, Y: 0, l: 5 },
  { id: 7, t: 20, X: 200, Y: 0 },
];

const yardOf = (resources: Resources, hallLevel = 10): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    savetime: 1_700_000_000,
    storedata: { ENL: { q: 0 } },
    resources,
    buildingdata: Object.fromEntries(
      [...BUILDINGS, { id: 8, t: 14, X: -300, Y: 0, l: hallLevel }].map((entry) => [
        String(entry.id),
        entry,
      ]),
    ),
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

const planOf = (yard: Yard): Plan => Plan.fromYard(yard);

const nodes = (plan: Plan, ids: readonly number[]): PlanNode[] =>
  ids.map((id) => {
    const node = plan.get(id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  });

describe("what can be picked", () => {
  it("is a wall on the plot, never a tower, the Town Hall or a stored wall", () => {
    const plan = planOf(yardOf(RICH));
    expect(isPickableWall(plan.get(1))).toBe(true);
    expect(isPickableWall(plan.get(7))).toBe(false);
    expect(isPickableWall(plan.get(8))).toBe(false);
    expect(isPickableWall(undefined)).toBe(false);

    plan.store([2]);
    expect(isPickableWall(plan.get(2))).toBe(false);
    expect(allWallIds(plan.buildings())).toEqual([1, 3, 4, 5]);
  });

  it("Select all is every wall on the plot", () => {
    const plan = planOf(yardOf(RICH));
    expect(allWallIds(plan.buildings())).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("boxes and taps", () => {
  const plan = planOf(yardOf(RICH));
  const get = (id: number): PlanNode | undefined => plan.get(id);

  it("a box picks the walls it touches and ignores everything else", () => {
    expect([...boxPick(new Set(), [1, 7, 8, 2], get)]).toEqual([1, 2]);
  });

  it("a box adds to the pick so far", () => {
    expect([...boxPick(new Set([5]), [1, 7], get)].sort()).toEqual([1, 5]);
  });

  it("a tap takes a wall in, a second tap takes it out, anything else is ignored", () => {
    const once = togglePick(new Set([1]), 3, get);
    expect([...once].sort()).toEqual([1, 3]);
    expect([...togglePick(once, 3, get)]).toEqual([1]);
    expect([...togglePick(once, 7, get)].sort()).toEqual([1, 3]);
    expect([...togglePick(once, null, get)].sort()).toEqual([1, 3]);
  });

  it("entering the mode keeps only the walls of a selection", () => {
    expect([...wallsOnly([7, 1, 8, 4], get)]).toEqual([1, 4]);
  });

  it("Clear is an empty pick", () => {
    expect(pickSummary([], 2, yardOf(RICH)).picked).toBe(0);
  });
});

describe("the cost line", () => {
  it("counts the pick, prices the walls below the level and says it is affordable", () => {
    const yard = yardOf(RICH);
    const line = pickSummary(nodes(planOf(yard), [1, 2, 4, 5, 7]), 2, yard);

    expect(line.picked).toBe(4);
    expect(line.eligible).toEqual([1, 2]);
    expect(line.skipped).toEqual([4, 5]);
    expect(line.cost.r2).toBe(20_000);
    expect(line.affordable).toBe(true);
  });

  it("says when the yard cannot pay for the whole pick", () => {
    const yard = yardOf({ r1: 0, r2: 25_000 });
    const line = pickSummary(nodes(planOf(yard), [1, 2, 3]), 2, yard);

    expect(line.cost.r2).toBe(30_000);
    expect(line.shortfall.r2).toBe(5_000);
    expect(line.affordable).toBe(false);
  });

  it("is not affordable when nothing would change", () => {
    const yard = yardOf(RICH);
    expect(pickSummary(nodes(planOf(yard), [5]), 2, yard).affordable).toBe(false);
  });
});

describe("Affordable", () => {
  it("trims a pick the yard cannot pay for, keeping the walls picked first", () => {
    const yard = yardOf({ r1: 0, r2: 25_000 });
    const plan = planOf(yard);
    expect(affordablePick(nodes(plan, [3, 1, 2]), 2, yard)).toEqual([3, 1]);
  });

  it("takes the cheapest walls first: the ones already nearest the level", () => {
    // Wall 4 is at level 2, one step from 3; the level 1 walls are two.
    const yard = yardOf({ r1: 150_000, r2: 150_000 });
    const plan = planOf(yard);
    expect(affordablePick(nodes(plan, [1, 2, 4]), 3, yard)).toEqual([4]);
  });

  it("leaves out walls already at the level", () => {
    const yard = yardOf(RICH);
    expect(affordablePick(nodes(planOf(yard), [5, 1]), 2, yard)).toEqual([1]);
  });

  it("is empty when the hall does not allow the level, or nothing can be paid for", () => {
    const poor = yardOf({ r1: 0, r2: 0 });
    expect(affordablePick(nodes(planOf(poor), [1, 2]), 2, poor)).toEqual([]);

    const lowHall = yardOf(RICH, 1);
    expect(affordablePick(nodes(planOf(lowHall), [1, 2]), 5, lowHall)).toEqual([]);
  });
});

/** The levels a yard's hall allows, in rising order, as the panel passes them. */
const allowedOf = (yard: Yard) => {
  const hall = townHallLevel(yard);
  return wallTargets(yard.kind).filter((entry) => entry.need <= hall);
};

describe("the level the window offers", () => {
  const yard = yardOf(RICH);
  const plan = planOf(yard);
  const allowed = allowedOf(yard);

  it("is one above the lowest wall picked", () => {
    // Wall 4 is at level 2, wall 5 at level 5.
    expect(autoWallTarget(nodes(plan, [4]), plan.buildings(), allowed)).toBe(3);
    expect(autoWallTarget(nodes(plan, [5, 4]), plan.buildings(), allowed)).toBe(3);
    expect(autoWallTarget(nodes(plan, [1, 4]), plan.buildings(), allowed)).toBe(2);
  });

  it("ignores a level 1 tower, picked or elsewhere in the yard", () => {
    // Tower 7 has no level, so it reads as 1; it must not pull the level to 2.
    expect(autoWallTarget(nodes(plan, [4, 7]), plan.buildings(), allowed)).toBe(3);
    expect(autoWallTarget([], nodes(plan, [4, 5, 7, 8]), allowed)).toBe(3);
  });

  it("with nothing picked, is one above the lowest wall in the yard", () => {
    expect(autoWallTarget([], plan.buildings(), allowed)).toBe(2);
  });

  it("stops at the highest level the hall allows", () => {
    const top = allowed.at(-1)?.level;
    expect(autoWallTarget(nodes(plan, [5]), plan.buildings(), allowed)).toBe(top);
    expect(autoWallTarget(nodes(plan, [4]), plan.buildings(), [{ level: 2 }])).toBe(2);
    expect(autoWallTarget(nodes(plan, [4]), plan.buildings(), [])).toBeNull();
  });
});

describe("the level after the pick changes", () => {
  const yard = yardOf(RICH);
  const plan = planOf(yard);
  const allowed = allowedOf(yard);

  it("follows the pick while the player has not pressed a level", () => {
    let choice = followWallTarget({ target: 5, manual: false }, nodes(plan, [4]), plan.buildings(), allowed, yard);
    expect(choice).toEqual({ target: 3, manual: false });
    choice = followWallTarget(choice, nodes(plan, [4, 1]), plan.buildings(), allowed, yard);
    expect(choice).toEqual({ target: 2, manual: false });
  });

  it("keeps a level the player pressed while it still raises a picked wall", () => {
    const pressed = { target: 4, manual: true };
    expect(followWallTarget(pressed, nodes(plan, [4]), plan.buildings(), allowed, yard)).toBe(pressed);
    expect(followWallTarget(pressed, nodes(plan, [1, 5]), plan.buildings(), allowed, yard)).toBe(pressed);
    // Nothing picked: nothing to judge it by, so it stays.
    expect(followWallTarget(pressed, [], plan.buildings(), allowed, yard)).toBe(pressed);
  });

  it("moves on from a pressed level that would do nothing", () => {
    // Every picked wall is already at 2: the level follows the pick again.
    const pressed = { target: 2, manual: true };
    expect(followWallTarget(pressed, nodes(plan, [4]), plan.buildings(), allowed, yard)).toEqual({
      target: 3,
      manual: false,
    });
  });
});
