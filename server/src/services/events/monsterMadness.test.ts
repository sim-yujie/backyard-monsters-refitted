import { afterEach, describe, expect, test } from "bun:test";

import { Reward } from "../../enums/Rewards.js";
import { EVENTS } from "../../game-data/events/events.js";
import {
  MONSTER_MADNESS_GOALS,
  MONSTER_MADNESS_ID,
  MONSTER_MADNESS_LADDER,
  korathPowerOf,
  monsterMadnessRun,
} from "../../game-data/events/monsterMadness.js";
import { CHAMPION_STATUS, planChampionRaise, type ChampionSave } from "../yard/champion.js";
import { planGrant } from "./grant.js";
import { grantKorathPower } from "./korathPower.js";
import { liveEvents } from "./liveEvents.js";
import {
  monsterMadnessEvents,
  readRuns,
  runningRun,
  setMonsterMadnessRuns,
  startRun,
  stopRun,
} from "./monsterMadnessRuns.js";
import { memoryProgressStore } from "./progressStore.js";
import { visibleEvents } from "./schedule.js";
import { countTakeover, takeoverEventsOn, takeoverPoints, tribeTakeoverPoints } from "./takeoverEvents.js";

/**
 * Monster Madness (owner, 11 Nov 2026): takeover points while a run is on,
 * Korath's powers at the goals, a power won before Korath waits for him, and
 * no run unless the owner starts one.
 */

const DAY = 24 * 60 * 60;
const START = 1_900_000_000;
const RUN = { startsAt: START, endsAt: START + 4 * DAY };
const IN = START + DAY;
const NO_FORCE: ReadonlySet<string> = new Set();
const READY = { buildingdata: {}, tutorialstage: 205 };
const em = {} as never;
const CAGE = { "3": { id: 3, t: 114, x: 0, y: 0, l: 1 } };

afterEach(() => setMonsterMadnessRuns([]));

describe("off until the owner starts it", () => {
  test("the calendar has no Monster Madness, and nothing is listed or counting without a run", () => {
    expect(EVENTS.some((event) => event.id.startsWith(MONSTER_MADNESS_ID))).toBe(false);
    expect(liveEvents(NO_FORCE)).toBe(EVENTS);
    const now = Date.UTC(2026, 10, 20) / 1000;
    expect(visibleEvents(now, liveEvents(NO_FORCE), NO_FORCE, NO_FORCE).some((one) => one.event.kind === "monster-madness")).toBe(false);
    expect(takeoverEventsOn(now, liveEvents(NO_FORCE))).toEqual([]);
  });

  test("a started run is listed and counts takeovers for four days, then stops", () => {
    setMonsterMadnessRuns([RUN]);
    const events = liveEvents(NO_FORCE);
    const run = events.find((event) => event.kind === "monster-madness")!;
    expect(run.id).toBe(`monster-madness-${START}`);
    expect(takeoverEventsOn(IN, events).map((event) => event.id)).toEqual([run.id]);
    expect(takeoverEventsOn(START - 1, events)).toEqual([]);
    expect(takeoverEventsOn(START + 4 * DAY, events)).toEqual([]);
    const shown = visibleEvents(IN, events, NO_FORCE, NO_FORCE).find((one) => one.event.id === run.id);
    expect(shown?.status).toBe("active");
  });

  test("EVENTS_FORCE_ON=monster-madness adds a local run from today", () => {
    const forced = new Set([MONSTER_MADNESS_ID]);
    const events = liveEvents(forced);
    const today = Date.UTC(2026, 10, 20, 12) / 1000;
    const shown = visibleEvents(today, events, forced, NO_FORCE).find((one) => one.event.id === MONSTER_MADNESS_ID);
    expect(shown?.status).toBe("active");
    expect(shown!.window.endsAt - shown!.window.startsAt).toBe(4 * DAY);
  });
});

describe("runs", () => {
  test("start: four days from now, refused while one is on; stop ends it now", () => {
    const started = startRun([], START)!;
    expect(started).toEqual([RUN]);
    expect(startRun(started, IN)).toBeNull();
    const stopped = stopRun(started, IN)!;
    expect(stopped).toEqual([{ startsAt: START, endsAt: IN }]);
    expect(runningRun(IN, stopped)).toBeNull();
    expect(stopRun(stopped, IN + 1)).toBeNull();
    expect(startRun(stopped, IN + 10)).toEqual([...stopped, { startsAt: IN + 10, endsAt: IN + 10 + 4 * DAY }]);
  });

  test("a stopped run ends when stopped; each run its own id", () => {
    const [first, second] = monsterMadnessEvents([{ startsAt: START, endsAt: IN }, { startsAt: IN + 10, endsAt: IN + 99 }]);
    expect(first!.endsAt).toBe(new Date(IN * 1000).toISOString().replace(".000Z", "Z"));
    expect(first!.id).not.toBe(second!.id);
  });

  test("the stored value is read forgivingly", () => {
    expect(readRuns({ runs: [RUN, { startsAt: 5, endsAt: 1 }, "x", { startsAt: "a" }] })).toEqual([RUN]);
    expect(readRuns(JSON.stringify({ runs: [RUN] }))).toEqual([RUN]);
    expect(readRuns(null)).toEqual([]);
  });
});

describe("takeover points", () => {
  test("a tribe camp scores as a player outpost priced the same: about 1.8M low, 3.2M at level 44", () => {
    expect(tribeTakeoverPoints(1)).toBe(tribeTakeoverPoints(28));
    expect(tribeTakeoverPoints(1)).toBeGreaterThan(1_750_000);
    expect(tribeTakeoverPoints(1)).toBeLessThan(1_850_000);
    expect(tribeTakeoverPoints(44)).toBeGreaterThan(3_100_000);
    expect(tribeTakeoverPoints(44)).toBeLessThan(3_300_000);
    expect(takeoverPoints({ tribe: false, level: 0, empireValue: 2_500_000.7 })).toBe(2_500_000);
    expect(takeoverPoints({ tribe: true, level: 44, empireValue: 0 })).toBe(tribeTakeoverPoints(44));
  });

  const RUN_EVENT = monsterMadnessRun(START);
  const count = (store = memoryProgressStore(), now = IN, save: unknown = READY, baseid = "500", points = 2_000_000) =>
    countTakeover(em, 7, save as never, baseid, points, now, { store, events: [RUN_EVENT], skipTutorial: false });

  test("counts only while the run is on, each outpost once", async () => {
    const store = memoryProgressStore();
    expect(await count(store)).toEqual([{ event: RUN_EVENT.id, points: 2_000_000, total: 2_000_000 }]);
    expect(await count(store, IN, READY, "501", 3_000_000)).toEqual([{ event: RUN_EVENT.id, points: 3_000_000, total: 5_000_000 }]);
    expect(await count(store, IN, READY, "500")).toEqual([]);
    expect(await count(store, START - 1, READY, "502")).toEqual([]);
    expect(await count(store, START + 4 * DAY, READY, "503")).toEqual([]);
    expect(store.rows.get(`7:${RUN_EVENT.id}`)?.counter).toBe(5_000_000);
  });

  test("nothing for a player still in the guided start, or a takeover worth nothing", async () => {
    const store = memoryProgressStore();
    expect(await count(store, IN, { tutorialstage: 10 })).toEqual([]);
    expect(await count(store, IN, READY, "9", 0)).toEqual([]);
    expect(store.rows.size).toBe(0);
  });

  test("a store that throws is logged, not thrown", async () => {
    const broken = { ...memoryProgressStore(), addTakeover: () => Promise.reject(new Error("db down")) };
    expect(await count(broken)).toEqual([]);
  });
});

describe("Korath's powers", () => {
  test("goals are Flash's, in Flash's order: Burn, Breath of Fire, Fists of Doom", () => {
    expect(MONSTER_MADNESS_GOALS).toEqual([42_000_000, 94_500_000, 160_125_000]);
    expect(MONSTER_MADNESS_LADDER.map((tier) => [tier.need, tier.rewards])).toEqual([
      [42_000_000, [{ kind: "korath", power: 1 }]],
      [94_500_000, [{ kind: "korath", power: 2 }]],
      [160_125_000, [{ kind: "korath", power: 3 }]],
    ]);
  });

  const korath = { t: 4, hp: 28_000, l: 5, ft: START, fd: 0, fb: 0, pl: 0, status: 0 };
  const gorgo = { t: 1, hp: 4_000, l: 2, ft: START, fd: 0, fb: 0, pl: 1, status: 0 };

  test("lifts Korath in the yard, frozen ones too, and never lowers a power", () => {
    const won = grantKorathPower({ rewards: { other: 1 }, champion: [gorgo, korath] }, 2);
    expect(won).toMatchObject({ power: 2, raised: true, hasKorath: true });
    expect(won.champions).toEqual([gorgo, { ...korath, pl: 2 }]);
    expect(won.rewards).toEqual({ other: 1, [Reward.KORATH_POWER]: { id: Reward.KORATH_POWER, value: 2 } });

    const frozen = grantKorathPower({ champion: [{ ...korath, status: CHAMPION_STATUS.FROZEN }] }, 3);
    expect(frozen.champions?.[0]).toMatchObject({ pl: 3, status: CHAMPION_STATUS.FROZEN });

    const lower = grantKorathPower({ rewards: won.rewards, champion: won.champions }, 1);
    expect(lower).toMatchObject({ power: 2, raised: false });
    expect(lower.champions).toBeUndefined();
  });

  test("ignores the old Town Hall 7 KorathReward of 3", () => {
    expect(korathPowerOf({ [Reward.KORATH]: { id: Reward.KORATH, value: 3 } })).toBe(0);
  });

  test("a power won before Korath waits for him, and he hatches with it", () => {
    const won = grantKorathPower({ rewards: {}, champion: [gorgo] }, 3);
    expect(won).toMatchObject({ power: 3, raised: true, hasKorath: false });
    expect(won.champions).toBeUndefined();

    const save: ChampionSave = { buildingdata: { ...CAGE }, champion: [], rewards: won.rewards };
    const raised = planChampionRaise(save, 4, START, { korath: true });
    expect(raised.slices.champion).toEqual([expect.objectContaining({ t: 4, l: 1, pl: 3 })]);

    const without = planChampionRaise({ buildingdata: { ...CAGE }, champion: [] }, 4, START, { korath: true });
    expect(without.slices.champion).toEqual([expect.objectContaining({ t: 4, pl: 0 })]);
    // Other champions keep the catalogue's power.
    const drull = planChampionRaise({ buildingdata: { ...CAGE }, champion: [], rewards: won.rewards }, 2, START);
    expect(drull.slices.champion?.[0]?.pl).not.toBe(3);
  });

  test("a goal's claim pays the power into rewards and the yard's Korath", () => {
    const plan = planGrant({ resources: {}, champion: [korath], rewards: {} } as never, MONSTER_MADNESS_LADDER[1]!.rewards, START);
    expect(plan.granted).toEqual([{ kind: "korath", power: 2, raised: true, hasKorath: true }]);
    expect(plan.slices.champion).toEqual([{ ...korath, pl: 2 }]);
    expect(korathPowerOf(plan.slices.rewards)).toBe(2);
  });
});
