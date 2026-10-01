import { describe, expect, test } from "bun:test";
import type { FlingLog } from "../../../game-rules/combat/index.js";
import { MAX_CHECKPOINT_TICK } from "../attackCheckpoint.js";
import {
  campKeyOf,
  parseStoredPlan,
  planFromFought,
  planLog,
  planNeeds,
  planShortfall,
  type PlanSupply,
} from "./attackPlan.js";

/**
 * What an auto-attack repeats (issue #221): the plan a hand-played camp
 * attack leaves, what it needs, and what the player lacks for it.
 */

const FOUGHT: FlingLog = {
  v: 1,
  seed: 99,
  events: [
    { kind: "fling", t: 80, x: -600, y: 100, r: 150, monsters: { C1: 200, C5: 20 }, champion: { t: 3, l: 4, pl: 1 } },
    { kind: "siege", t: 120, x: 0, y: 0, weapon: "wreckingball" },
    { kind: "bomb", t: 160, x: 10, y: 20, id: "tw1" },
    { kind: "fling", t: 400, x: 300, y: -200, r: 120, monsters: { C1: 100 } },
    { kind: "bomb", t: 480, x: 30, y: 40, id: "pb1" },
    { kind: "retreat", t: 6_000 },
  ],
};

const supply = (overrides: Partial<PlanSupply> = {}): PlanSupply => ({
  housed: { home: { C1: 250, C5: 20 }, outpost: { C1: 60 } },
  champions: [{ t: 3, l: 5, pl: 2, hp: 4000, status: 0 }],
  catapultLevel: 2,
  resources: { r1: 1_000_000, r2: 1_000_000, r3: 0, r4: 0 },
  ...overrides,
});

describe("campKeyOf", () => {
  test("a Map Room 2 wild camp is keyed by its tribe and level", () => {
    expect(campKeyOf({ type: "tribe", wmid: 11, level: 35 })).toEqual({ wmid: 11, level: 35 });
    expect(campKeyOf({ type: "tribe", wmid: 1, level: 25 })).toEqual({ wmid: 1, level: 25 });
  });

  test("anything else has no key: players' yards, outposts, Map Room 3 structures", () => {
    expect(campKeyOf({ type: "main", wmid: 0, level: 30 })).toBeNull();
    expect(campKeyOf({ type: "outpost", wmid: 11, level: 35 })).toBeNull();
    expect(campKeyOf({ type: "tribe", wmid: 0, level: 35 })).toBeNull();
    // An MR3 structure's wmid is its yard type, never 1, 11, 21 or 31.
    expect(campKeyOf({ type: "tribe", wmid: 5, level: 35 })).toBeNull();
    expect(campKeyOf({ type: "inferno", wmid: 11, level: 35 })).toBeNull();
    expect(campKeyOf({ type: "tribe", wmid: 11, level: 0 })).toBeNull();
  });
});

describe("planFromFought", () => {
  test("keeps every event as fought, retreats included, and leaves the siege weapons out", () => {
    const plan = planFromFought(FOUGHT, 6_400)!;
    expect(plan.events.map((event) => event.kind)).toEqual(["fling", "bomb", "fling", "bomb", "retreat"]);
    expect(plan.events[0]).toEqual(FOUGHT.events[0]!);
    expect(plan.tick).toBe(6_400);
    expect(plan.siege).toBe(true);
  });

  test("an attack without siege weapons says none were left out", () => {
    const plan = planFromFought({ ...FOUGHT, events: FOUGHT.events.filter((event) => event.kind !== "siege") }, 6_400)!;
    expect(plan.siege).toBeUndefined();
  });

  test("the tick is never before the last event, nor past the longest attack", () => {
    expect(planFromFought(FOUGHT, 100)!.tick).toBe(6_000);
    expect(planFromFought(FOUGHT, 10_000_000)!.tick).toBe(MAX_CHECKPOINT_TICK);
  });

  test("a log that flung nothing is nothing to repeat", () => {
    expect(planFromFought({ v: 1, seed: 1, events: [{ kind: "bomb", t: 1, x: 0, y: 0, id: "tw0" }] }, 100)).toBeNull();
    expect(
      planFromFought({ v: 1, seed: 1, events: [{ kind: "fling", t: 1, x: 0, y: 0, r: 100, monsters: {} }] }, 100)
    ).toBeNull();
  });

  test("survives being stored and read back", () => {
    const plan = planFromFought(FOUGHT, 6_400)!;
    expect(parseStoredPlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(parseStoredPlan({ v: 2, tick: 1, events: [] })).toBeNull();
    expect(parseStoredPlan({ v: 1, tick: 1, events: [{ kind: "nonsense" }] })).toBeNull();
    expect(parseStoredPlan(null)).toBeNull();
  });
});

describe("planNeeds and planShortfall", () => {
  const plan = planFromFought(FOUGHT, 6_400)!;
  const needs = planNeeds(plan);

  test("a plan needs its monsters summed over its drops, its champion and its bombs", () => {
    expect(needs).toEqual({ monsters: { C1: 300, C5: 20 }, champions: [3], bombs: ["tw1", "pb1"], siege: true });
  });

  test("a player with everything lacks nothing, counting every yard in range", () => {
    expect(planShortfall(needs, supply())).toEqual([]);
  });

  test("one monster short is missing, with what they have", () => {
    const missing = planShortfall(needs, supply({ housed: { home: { C1: 250, C5: 19 }, outpost: { C1: 49 } } }));
    expect(missing).toEqual([
      { kind: "monster", id: "C1", need: 300, have: 299 },
      { kind: "monster", id: "C5", need: 20, have: 19 },
    ]);
  });

  test("the champion is missing when not owned, with no health, or away", () => {
    expect(planShortfall(needs, supply({ champions: [] }))).toEqual([{ kind: "champion", t: 3, reason: "none" }]);
    expect(planShortfall(needs, supply({ champions: [{ t: 3, l: 5, hp: 0, status: 0 }] }))).toEqual([
      { kind: "champion", t: 3, reason: "hurt" },
    ]);
    expect(planShortfall(needs, supply({ champions: [{ t: 3, l: 5, hp: 10, status: 1 }] }))).toEqual([
      { kind: "champion", t: 3, reason: "away" },
    ]);
  });

  test("a bomb is missing when the Catapult is too low or the pool cannot pay", () => {
    expect(planShortfall(needs, supply({ catapultLevel: 1 }))).toEqual([
      { kind: "bomb", id: "pb1", reason: "catapult" },
    ]);
    expect(planShortfall(needs, supply({ resources: { r1: 99_999, r2: 1_000_000 } }))).toEqual([
      { kind: "bomb", id: "tw1", reason: "cost" },
    ]);
  });
});

describe("planLog", () => {
  test("fights the plan under the new seed, the champion at its level and power now", () => {
    const plan = planFromFought(FOUGHT, 6_400)!;
    const log = planLog(plan, 1234, [{ t: 3, l: 6, pl: 2, hp: 100, status: 0 }]);
    expect(log.seed).toBe(1234);
    expect(log.events).toHaveLength(plan.events.length);
    expect(log.events[0]).toEqual({ ...FOUGHT.events[0]!, champion: { t: 3, l: 6, pl: 2 } } as never);
    expect(log.events.slice(1)).toEqual(plan.events.slice(1));
  });

  test("repeats the Mode the champion was flung in, through storage and back (#220)", () => {
    const fling = FOUGHT.events[0] as Extract<FlingLog["events"][number], { kind: "fling" }>;
    const fought: FlingLog = {
      ...FOUGHT,
      events: [{ ...fling, champion: { ...fling.champion!, s: "defensive" } }, ...FOUGHT.events.slice(1)],
    };
    const stored = parseStoredPlan(JSON.parse(JSON.stringify(planFromFought(fought, 6_400))))!;
    const log = planLog(stored, 1, [{ t: 3, l: 6, pl: 2, hp: 100, status: 0 }]);
    expect(log.events[0]).toMatchObject({ champion: { t: 3, l: 6, pl: 2, s: "defensive" } });
  });

  test("a champion with no power level fights at its level alone", () => {
    const plan = planFromFought(FOUGHT, 6_400)!;
    const log = planLog(plan, 1, [{ t: 3, l: 2, hp: 100 }]);
    expect(log.events[0]).toMatchObject({ champion: { t: 3, l: 2 } });
    expect((log.events[0] as { champion: { pl?: number } }).champion.pl).toBeUndefined();
  });
});
