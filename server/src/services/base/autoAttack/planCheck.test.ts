import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { FlingEvent } from "../../../game-rules/combat/index.js";
import { replayAbandonedAttack, type AbandonedInput } from "../combat/abandonedAttack.js";
import type { AttackPlan } from "./attackPlan.js";

/**
 * Repeat attack's plan check (beta 9, the owner's fix 2 on desk card
 * repeat-record-fix): a saved plan's flings held against the camp's fresh
 * layout by the hand-played drop rule, with the battle fought only when a
 * fling touches a building something before it might have flattened.
 */

// A plain string keeps tsc from resolving the "?real" query (as baseSave.attack.test.ts does).
const REAL_LAYOUTS = "../../maproom/v2/tribeLayouts.ts?real";
const realLayouts = (await import(REAL_LAYOUTS)) as typeof import("../../maproom/v2/tribeLayouts.js");
/** The fresh layout the check reads; null for the real data files'. */
let layout: Record<string, unknown> | null = null;
mock.module("../../maproom/v2/tribeLayouts.js", () => ({
  ...realLayouts,
  tribeLayoutFor: (...args: Parameters<typeof realLayouts.tribeLayoutFor>) =>
    layout ? { from: args[1], save: { buildingdata: layout }, saved: false } : realLayouts.tribeLayoutFor(...args),
}));

const { planFlingOnBuilding, freshCampYard } = await import("./planCheck.js");

/** One Twig Snapper at the yard's centre: 30 Pokeys flung beside it flatten it between ticks 400 and 2,000. */
const SNAPPER = { "1": { id: 1, t: 1, l: 1, X: 0, Y: 0 } };
const KEY = { wmid: 11, level: 35 };
const ATTACKER = { academy: { C1: { level: 1 } }, champion: null };

const fling = (t: number, x: number, y: number, count: number): FlingEvent => ({
  kind: "fling",
  t,
  x,
  y,
  r: 100,
  monsters: { C1: count },
});
const planOf = (...events: FlingEvent[]): AttackPlan => ({ v: 1, tick: 4_000, events });

/** The battle, fought here rather than in a worker, and counted. */
const replay = mock(async (input: AbandonedInput) => replayAbandonedAttack(input));

beforeEach(() => {
  layout = SNAPPER;
  replay.mockClear();
});

describe("planFlingOnBuilding", () => {
  test("every fling on open ground: a good plan, and no battle fought", async () => {
    const plan = planOf(fling(100, 200, 0, 30), fling(400, 0, 250, 5));
    expect(await planFlingOnBuilding(plan, KEY, ATTACKER, 7, 0, replay)).toBeNull();
    expect(replay).not.toHaveBeenCalled();
  });

  test("the first fling on a building: refused at once, as a damaged camp's plan is", async () => {
    const plan = planOf(fling(100, 0, 0, 30), fling(400, 200, 0, 5));
    expect(await planFlingOnBuilding(plan, KEY, ATTACKER, 7, 0, replay)).toEqual({
      index: 0,
      t: 100,
      x: 0,
      y: 0,
      buildings: [1],
    });
    expect(replay).not.toHaveBeenCalled();
  });

  test("a fling where the plan's own monsters flattened the building first: a good plan", async () => {
    const plan = planOf(fling(100, 200, 0, 30), fling(2_000, 0, 0, 1));
    expect(await planFlingOnBuilding(plan, KEY, ATTACKER, 7, 0, replay)).toBeNull();
    expect(replay).toHaveBeenCalledTimes(1);
    // Fought only to that fling, under the Repeat's own seed.
    const input = replay.mock.calls[0]![0];
    expect(input.tick).toBe(2_000);
    expect(input.log.seed).toBe(7);
    expect(input.fallenBefore).toEqual([1]);
  });

  test("a later fling on a building still standing then: refused", async () => {
    const plan = planOf(fling(100, 200, 0, 30), fling(400, 0, 0, 1));
    expect(await planFlingOnBuilding(plan, KEY, ATTACKER, 7, 0, replay)).toEqual({
      index: 1,
      t: 400,
      x: 0,
      y: 0,
      buildings: [1],
    });
    expect(replay).toHaveBeenCalledTimes(1);
  });

  test("a bomb or a retreat alone does not count as a fling", async () => {
    const plan: AttackPlan = { v: 1, tick: 4_000, events: [{ kind: "retreat", t: 3_000 }] };
    expect(await planFlingOnBuilding(plan, KEY, ATTACKER, 7, 0, replay)).toBeNull();
  });

  test("a bigger army has a bigger drop zone: academy levels size it, as by hand", async () => {
    // 300 Pokeys fill the bucket past the 200 floor: the zone reaches the snapper from 150 away.
    const near = planOf(fling(100, 150, 0, 300));
    expect(await planFlingOnBuilding(near, KEY, ATTACKER, 7, 0, replay)).not.toBeNull();
    expect(await planFlingOnBuilding(planOf(fling(100, 150, 0, 1)), KEY, ATTACKER, 7, 0, replay)).toBeNull();
  });
});

describe("the camp's fresh layout", () => {
  test("is the tribe's yard for the level, from the data files", async () => {
    layout = null;
    const yard = freshCampYard(KEY);
    const buildings = Object.values(yard.buildingdata ?? {}) as { X: number; Y: number; t: number }[];
    expect(buildings.length).toBeGreaterThan(10);
    // A Town Hall's spot is a building; far outside the yard is open ground.
    const hall = buildings.find((building) => building.t === 14)!;
    const onHall = planOf(fling(100, hall.X, hall.Y, 10));
    expect((await planFlingOnBuilding(onHall, KEY, ATTACKER, 7, 0, replay))?.index).toBe(0);
    expect(await planFlingOnBuilding(planOf(fling(100, 2_000, 2_000, 10)), KEY, ATTACKER, 7, 0, replay)).toBeNull();
  });
});
