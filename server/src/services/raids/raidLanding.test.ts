import { describe, expect, mock, test } from "bun:test";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * A wild monster raid's landing on the yard (#226 WP3,
 * `docs/design/wild-raids.md` §6.3), on a hand-made fight outcome: the theft
 * from the bank and the harvesters never below 0, the good defence's Shiny,
 * the repairs, the fired traps and the schedule starting again; and goal N1,
 * "survive a tribe attack" (WP5), which only a good defence counts towards.
 */

mock.module("../../server.js", () => ({
  postgres: { em: {} },
  redis: memoryRedis(),
}));

const { GOOD_DEFENCE_SHINY, landRaid, landedResult } = await import("./raidLanding.js");
const { RAID_PREFERENCES, readSchedule } = await import("./raidSchedule.js");
const { GOALS } = await import("../../game-data/goals.js");
const { goalStatus } = await import("../goals/goalRules.js");
const { readOnboarding } = await import("../onboarding/state.js");
type Outcome = Parameters<typeof landRaid>[1]["outcome"];
type LandingSave = Parameters<typeof landRaid>[0];

const NOW = 1_900_000_000;
const STARTED = NOW - 200;
const NO_LOSS = { r1: 0, r2: 0, r3: 0, r4: 0 };

/** A Town Hall, a twig harvester holding 300, a silo, a fired-able trap and a cannon already repairing. */
const saveOf = (extra: Partial<LandingSave> = {}): LandingSave =>
  ({
    type: "main",
    mapversion: 2,
    wmid: 0,
    buildingdata: {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 1 },
      "1": { id: 1, t: 1, X: 100, Y: 0, l: 1, st: 300 },
      "2": { id: 2, t: 6, X: 0, Y: 100, l: 1 },
      "3": { id: 3, t: 24, X: 200, Y: 0, l: 1 },
      "4": { id: 4, t: 20, X: 0, Y: 200, l: 1, hp: 100, rE: 1 },
    },
    buildinghealthdata: { "4": 100 },
    resources: { r1: 1000, r2: 50, r3: 0, r4: 0 },
    credits: 100,
    champion: [],
    monsters: {},
    academy: {},
    storedata: {},
    firedtraps: [],
    damage: 0,
    aiattacks: { v: 2, lastattack: 0, nextAttack: STARTED, sessionsSinceLastAttack: 4, attackPreference: 0, recent: [], fight: { id: "r_one", until: NOW + 60 } },
    ...extra,
  }) as LandingSave;

const outcomeOf = (extra: Partial<Outcome> = {}): Outcome => ({
  ticks: 8000,
  health: {},
  damage: 0,
  firedTraps: [],
  destroyedIds: [],
  defenderLoss: { ...NO_LOSS },
  bankLoss: { ...NO_LOSS },
  harvesterLoss: {},
  healthShare: 1,
  bunkerGarrisons: {},
  defenderChampion: null,
  creepsFlung: 10,
  creepsKilled: 10,
  digest: "d",
  ...extra,
});

const land = (save: LandingSave, outcome: Outcome) =>
  landRaid(save, { id: "r_one", tribe: "Kozu", startedAt: STARTED, outcome }, NOW);

describe("landRaid", () => {
  test("a good defence (90% or more) pays exactly 10 Shiny", () => {
    const save = saveOf();
    const result = land(save, outcomeOf({ healthShare: 0.9 }));
    expect(result.defended).toBe(true);
    expect(result.shiny).toBe(GOOD_DEFENCE_SHINY);
    expect(GOOD_DEFENCE_SHINY).toBe(10);
    expect(save.credits).toBe(110);
  });

  test("a poor defence pays nothing", () => {
    const save = saveOf();
    const result = land(save, outcomeOf({ healthShare: 0.8999 }));
    expect(result.defended).toBe(false);
    expect(result.shiny).toBe(0);
    expect(save.credits).toBe(100);
  });

  test("theft comes off the bank and the harvester, never below 0", () => {
    const save = saveOf();
    const result = land(
      save,
      outcomeOf({
        bankLoss: { r1: 400, r2: 500, r3: 0, r4: 0 },
        harvesterLoss: { "1": 1000 },
        defenderLoss: { r1: 1400, r2: 500, r3: 0, r4: 0 },
      })
    );
    expect(save.resources).toMatchObject({ r1: 600, r2: 0, r3: 0, r4: 0 });
    expect(save.buildingdata!["1"]!.st).toBe(0);
    expect(result.stolen).toEqual({ r1: 400 + 300, r2: 50, r3: 0, r4: 0 });
  });

  test("every damaged building is repairing afterwards, its hp in step with the health map", () => {
    const save = saveOf();
    const result = land(save, outcomeOf({ health: { "0": 500, "2": 0, "4": 100 }, damage: 40 }));
    expect(result.damaged).toEqual([0, 2, 4]);
    for (const id of ["0", "2", "4"]) expect(save.buildingdata![id]!.rE).toBe(1);
    expect(save.buildingdata!["0"]!.hp).toBe(500);
    expect(save.buildingdata!["2"]!.hp).toBe(0);
    expect(save.buildingdata!["1"]!.rE).toBeUndefined();
    expect(save.buildinghealthdata).toEqual({ "0": 500, "2": 0, "4": 100 });
    expect(save.damage).toBe(40);
  });

  test("a trap that fired is gone and kept for re-arming", () => {
    const save = saveOf();
    land(save, outcomeOf({ firedTraps: [3] }));
    expect(save.buildingdata!["3"]).toBeUndefined();
    expect(save.firedtraps).toEqual([expect.objectContaining({ t: 24, X: 200, Y: 0 })]);
  });

  test("the wait starts again from the fight's start and the yard's fight lock is lifted", () => {
    const save = saveOf();
    const result = land(save, outcomeOf({ healthShare: 0.95 }));
    const schedule = readSchedule(save.aiattacks);
    expect(schedule.fight).toBeUndefined();
    expect(schedule.lastattack).toBe(STARTED);
    expect(schedule.nextAttack).toBe(STARTED + RAID_PREFERENCES[0].waitSeconds);
    expect(schedule.sessionsSinceLastAttack).toBe(0);
    expect(schedule.lastRaidId).toBe("r_one");
    expect(schedule.recent[0]).toMatchObject({ id: "r_one", tribe: "Kozu", at: STARTED, health: 0.95, shiny: 10 });
    expect(landedResult(save.aiattacks, "r_one")).toMatchObject({
      id: result.id,
      defended: true,
      health: 0.95,
      shiny: 10,
      stolen: result.stolen,
    });
    expect(landedResult(save.aiattacks, "r_other")).toBeNull();
  });
});

describe("goal N1, survive a tribe attack (WP5)", () => {
  const N1 = GOALS.find((goal) => goal.id === "N1")!;

  /** A guided-start player past CR1, so N1 shows; `goals` and `counters` as given. */
  const playerSave = (goals: Record<string, unknown> = {}, counters: Record<string, unknown> = {}) =>
    saveOf({
      onboarding: {
        v: 1,
        guide: { state: "done" },
        goals: { CR1: { done: STARTED - 100, claimed: STARTED - 50 }, ...goals },
        counters: { mushrooms: 3, ...counters },
      },
    });

  const n1 = (save: LandingSave) => goalStatus(N1, save, readOnboarding(save));

  test("N1 counts raids survived, nothing else", () => {
    expect(N1.condition).toEqual({ kind: "counter", counter: "raidsSurvived", target: 1 });
    expect(N1.name).toBe("Survive a Tribe Attack");
  });

  test("a good defence completes N1", () => {
    const save = playerSave();
    expect(n1(save)).toBe("open");
    land(save, outcomeOf({ healthShare: 0.9 }));
    const onboarding = readOnboarding(save);
    expect(onboarding.counters.raidsSurvived).toBe(1);
    // The rest of the record stays as it was.
    expect(onboarding.counters.mushrooms).toBe(3);
    expect(onboarding.goals.CR1).toEqual({ done: STARTED - 100, claimed: STARTED - 50 });
    expect(n1(save)).toBe("ready");
  });

  test("a poor defence does not", () => {
    const save = playerSave();
    land(save, outcomeOf({ healthShare: 0.8999 }));
    expect(readOnboarding(save).counters.raidsSurvived).toBe(0);
    expect(n1(save)).toBe("open");
  });

  test("a Baiter practice run no longer counts", () => {
    expect(n1(playerSave({}, { baiterRuns: 3 }))).toBe("open");
  });

  test("a player who already finished N1 keeps it, even after a poor defence", () => {
    const finished = playerSave({ N1: { done: STARTED - 10 } }, { baiterRuns: 1 });
    const claimed = playerSave({ N1: { done: STARTED - 10, claimed: STARTED - 5 } }, { baiterRuns: 1 });
    for (const save of [finished, claimed]) land(save, outcomeOf({ healthShare: 0.5 }));
    expect(n1(finished)).toBe("ready");
    expect(n1(claimed)).toBe("claimed");
  });
});
