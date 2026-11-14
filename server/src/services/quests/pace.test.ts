import { describe, expect, test } from "bun:test";

import { WEEKLY_PACE, WEEKLY_QUEST_SHINY } from "../../game-data/quests.js";
import { DAY_SECONDS, utcWeek, utcWeekStart } from "./period.js";
import {
  claimQuest,
  countQuests,
  emptyQuests,
  nextPace,
  pacedNeed,
  pickWeekly,
  questsJson,
  readQuests,
  rollOver,
  startPace,
  type QuestEntry,
  type QuestPace,
  type QuestPlayer,
  type QuestRecord,
  type QuestSet,
} from "./state.js";
import { questsView } from "./view.js";

/**
 * Adaptive weekly quests (owner, 9 Nov, Option A "pace multiplier"): the
 * Fighting and Resources quests' need follows how fast the player finished
 * them last week. Numbers from `agent-handoffs/fable-quests-dynamic.md`.
 */

const DAY = DAY_SECONDS;
/** Monday 2026-11-02 00:00 UTC. */
const WEEK0 = Date.parse("2026-11-02T00:00:00Z") / 1000;
const CAP = 19_400_000;

const playerOf = (overrides: Partial<QuestPlayer> = {}): QuestPlayer => ({
  userid: 42,
  townHall: 7,
  buildings: new Set([1, 2, 3, 4, 9, 11, 13, 20, 51]),
  champion: true,
  hasFriend: true,
  monsters: ["C1", "C2", "C5"],
  cap: CAP,
  ...overrides,
});

/** Week `w`'s Monday 00:00 UTC. */
const weekAt = (w: number): number => WEEK0 + w * 7 * DAY;
/** An hour into day `day` (1 = Monday) of week `w`. */
const dayAt = (w: number, day: number): number => weekAt(w) + (day - 1) * DAY + 3600;

/** Everything a weekly Fighting and Resources quest counts, a lot of it. */
const FINISH = { attackWin: 1_000, lootR1: 1e9, lootR2: 1e9, lootR3: 1e9, lootR4: 1e9 };

const fights = (record: QuestRecord): QuestEntry => record.weekly!.quests.find((one) => one.kind === "weeklyFights")!;
const loot = (record: QuestRecord): QuestEntry => record.weekly!.quests.find((one) => one.kind.startsWith("weeklyLoot"))!;
const payOf = (quest: QuestEntry): number => {
  const reward = quest.rewards.find((one) => one.kind === "resources") as { amounts: Record<string, number> };
  return Object.values(reward.amounts)[0]!;
};

/** A last-week set whose Fighting and Resources quests were finished on `day` (null: not finished). */
const lastWeek = (week: string, day: number | null, doneAt = true): QuestSet => {
  const start = Date.parse(`${week}T00:00:00Z`) / 1000;
  const one = (slot: number, kind: string, need: number): QuestEntry => ({
    slot,
    kind,
    need,
    have: day === null ? need - 1 : need,
    claimed: false,
    rewards: [],
    ...(day !== null && doneAt && { doneAt: start + (day - 1) * DAY + 60 }),
  });
  return {
    period: week,
    quests: [one(0, "weeklyHelpGift", 5), one(1, "weeklyLootGoo", CAP), one(2, "weeklyFights", 10)],
    bonus: false,
    swaps: 0,
  };
};

describe("the pace step at the weekly rollover", () => {
  const week = utcWeek(weekAt(1));
  const prev = utcWeek(weekAt(0));
  const cases: [string, number | null, number][] = [
    ["day 1", 1, 1.25],
    ["day 2", 2, 1.25],
    ["day 3", 3, 1],
    ["day 4", 4, 1],
    ["day 5", 5, 1],
    ["day 6", 6, 0.85],
    ["day 7", 7, 0.85],
    ["not finished", null, 0.7],
  ];
  for (const [name, day, pace] of cases) {
    test(`finished ${name}: pace x${pace}`, () => {
      expect(nextPace(startPace(), lastWeek(prev, day), week)).toEqual({ fighting: pace, resources: pace });
    });
  }

  test("the pace stays within 0.5-3", () => {
    expect(nextPace({ fighting: 2.9, resources: 2.5 }, lastWeek(prev, 1), week)).toEqual({ fighting: 3, resources: 3 });
    expect(nextPace({ fighting: 0.55, resources: 0.6 }, lastWeek(prev, null), week)).toEqual({ fighting: 0.5, resources: 0.5 });
  });

  test("a new player starts at 1 and gets today's numbers", () => {
    const record = rollOver(emptyQuests(), playerOf(), dayAt(0, 1));
    expect(record.pace).toEqual({ fighting: 1, resources: 1 });
    expect(fights(record).need).toBe(10);
    expect(loot(record).need).toBe(CAP);
  });

  test("a player away last week: each paced group counts as not finished, once", () => {
    const old = utcWeek(weekAt(-3));
    expect(nextPace({ fighting: 2, resources: 1 }, lastWeek(old, 1), week)).toEqual({ fighting: 1.4, resources: 0.7 });
  });

  test("a quest finished before finish times were kept leaves the pace alone", () => {
    expect(nextPace({ fighting: 2, resources: 1 }, lastWeek(prev, 1, false), week)).toEqual({ fighting: 2, resources: 1 });
  });

  test("a group with no quest last week (no Map Room) keeps its pace", () => {
    const set = lastWeek(prev, 1);
    const noLoot = { ...set, quests: set.quests.filter((one) => !one.kind.startsWith("weeklyLoot")) };
    expect(nextPace({ fighting: 1, resources: 1.5 }, noLoot, week)).toEqual({ fighting: 1.25, resources: 1.5 });
  });

  test("the same week never steps the pace again", () => {
    const first = rollOver({ ...emptyQuests(), weekly: lastWeek(prev, 1) }, playerOf(), dayAt(1, 1));
    expect(first.pace.fighting).toBe(1.25);
    expect(rollOver(first, playerOf(), dayAt(1, 5)).pace).toBe(first.pace);
  });
});

describe("finish time (doneAt)", () => {
  test("is stamped when progress first reaches the need, not on Claim", () => {
    let record = rollOver(emptyQuests(), playerOf(), dayAt(0, 1));
    record = countQuests(record, { attackWin: 9 }, dayAt(0, 1)).record;
    expect(fights(record).doneAt).toBeUndefined();
    record = countQuests(record, { attackWin: 1 }, dayAt(0, 2)).record;
    expect(fights(record).doneAt).toBe(dayAt(0, 2));
    // More progress later never moves it.
    record = countQuests(record, { attackWin: 5 }, dayAt(0, 4)).record;
    expect(fights(record).doneAt).toBe(dayAt(0, 2));
    // Claiming on day 7 keeps the day-2 finish: next week is harder.
    const claimed = claimQuest(record, "weekly", fights(record).slot);
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(fights(claimed.record).doneAt).toBe(dayAt(0, 2));
    const next = rollOver(claimed.record, playerOf(), dayAt(1, 1));
    expect(next.pace.fighting).toBe(1.25);
    expect(fights(next).need).toBe(13);
  });

  test("daily quests are not stamped", () => {
    const record = rollOver(emptyQuests(), playerOf(), dayAt(0, 1));
    const done = countQuests(record, { mushroom: 99, upgradeDefence: 99, upgradeResource: 99 }, dayAt(0, 1)).record;
    expect(done.daily!.quests.every((one) => one.doneAt === undefined)).toBe(true);
  });

  test("pace and doneAt survive the save column; bad pace reads as 1 or clamped", () => {
    let record = rollOver({ ...emptyQuests(), weekly: lastWeek(utcWeek(weekAt(0)), 1) }, playerOf(), dayAt(1, 1));
    record = countQuests(record, FINISH, dayAt(1, 3)).record;
    const back = readQuests(questsJson(record));
    expect(back.pace).toEqual(record.pace);
    expect(fights(back)).toEqual(fights(record));
    expect(fights(back).doneAt).toBe(dayAt(1, 3));
    expect(readQuests({}).pace).toEqual({ fighting: 1, resources: 1 });
    expect(readQuests({ pace: { fighting: "x", resources: 99 } }).pace).toEqual({ fighting: 1, resources: 3 });
  });
});

describe("paced needs and rewards", () => {
  test("Fighting = round(10 x pace) within 5-30", () => {
    expect(pacedNeed("fighting", 10, 1)).toBe(10);
    expect(pacedNeed("fighting", 10, 1.25)).toBe(13);
    expect(pacedNeed("fighting", 10, 0.85)).toBe(9);
    expect(pacedNeed("fighting", 10, 0.5)).toBe(WEEKLY_PACE.fightsMin);
    expect(pacedNeed("fighting", 10, 3)).toBe(WEEKLY_PACE.fightsMax);
    expect(pacedNeed("fighting", 20, 3)).toBe(30);
  });

  test("Loot = storage target x pace to 3 significant figures, within 0.5-3x", () => {
    expect(pacedNeed("resources", CAP, 1)).toBe(CAP);
    expect(pacedNeed("resources", CAP, 1.25)).toBe(24_300_000);
    expect(pacedNeed("resources", CAP, 3)).toBe(58_200_000);
    expect(pacedNeed("resources", CAP, 0.5)).toBe(9_700_000);
    expect(pacedNeed("resources", 120_000, 0.85)).toBe(102_000);
    // An odd cap at pace 1 stays exactly today's target.
    expect(pacedNeed("resources", 19_387_512, 1)).toBe(19_387_512);
  });

  test("Social is never paced: 5 at any pace, its reward unchanged", () => {
    const pace: QuestPace = { fighting: 3, resources: 3 };
    const fast = pickWeekly(playerOf(), utcWeek(weekAt(0)), pace);
    const normal = pickWeekly(playerOf(), utcWeek(weekAt(0)));
    expect(fast.quests[0]).toEqual(normal.quests[0]!);
    expect(fast.quests[0]!.need).toBe(5);
  });

  test("Resources pay = 15% x pace of the cap, never above 45%; Shiny and the Fighting reward unchanged", () => {
    const week = utcWeek(weekAt(0));
    const at = (pace: number) => pickWeekly(playerOf(), week, { fighting: pace, resources: pace });
    expect(payOf(at(1).quests[1]!)).toBe(Math.floor(CAP * 0.15));
    expect(payOf(at(1.25).quests[1]!)).toBe(Math.floor(CAP * 0.1875));
    expect(payOf(at(0.5).quests[1]!)).toBe(Math.floor(CAP * 0.075));
    expect(payOf(at(3).quests[1]!)).toBe(Math.floor(CAP * WEEKLY_PACE.payMaxShare));
    for (const pace of [0.5, 1, 3]) {
      for (const one of at(pace).quests) expect(one.rewards).toContainEqual({ kind: "shiny", amount: WEEKLY_QUEST_SHINY });
      expect(at(pace).quests[2]!.rewards).toEqual(at(1).quests[2]!.rewards);
    }
  });
});

describe("the pace is the server's alone (owner, 12 Nov)", () => {
  const prev = utcWeek(weekAt(0));
  const next = (day: number | null, pace: QuestPace = startPace()) =>
    rollOver({ ...emptyQuests(), pace, weekly: lastWeek(prev, day) }, playerOf(), dayAt(1, 1));

  test("a faster or slower week moves the need, and the player's view shows only need, have and rewards", () => {
    expect(fights(next(1)).need).toBe(13);
    expect(fights(next(7)).need).toBe(9);
    for (const record of [next(1), next(7), next(null)]) {
      const view = questsView(record, dayAt(1, 1));
      const text = JSON.stringify(view);
      expect(text).not.toContain("pace");
      expect(text).not.toContain("was");
      expect(text).not.toContain("doneAt");
      for (const quest of view.weekly.quests) {
        expect(Object.keys(quest).sort()).toEqual(
          ["claimed", "have", "kind", "need", "ready", "rewards", "slot", ...(quest.variant !== undefined ? ["variant"] : [])].sort()
        );
      }
    }
  });

  test("an old record's stored was is dropped on read", () => {
    const record = next(1);
    const json = questsJson(record) as { weekly: { quests: Record<string, unknown>[] } };
    json.weekly.quests[2]!["was"] = 10;
    expect(readQuests(json).weekly!.quests.every((one) => !("was" in one))).toBe(true);
  });
});

describe("six weeks (Fable's worked example: cap 19.4M, Town Hall 7)", () => {
  /** Plays six weeks, finishing on `days[w]` (null: not finished); what each week asked and paid. */
  const play = (days: (number | null)[]) => {
    let record = emptyQuests();
    const rows: { fights: number; loot: number; pay: number }[] = [];
    days.forEach((day, w) => {
      record = rollOver(record, playerOf(), weekAt(w) + 60);
      expect(record.weekly!.period).toBe(utcWeek(weekAt(w)));
      rows.push({ fights: fights(record).need, loot: loot(record).need, pay: payOf(loot(record)) / CAP });
      if (day !== null) record = countQuests(record, FINISH, dayAt(w, day)).record;
    });
    return rows;
  };

  test("a fast player (done day 1-2 every week)", () => {
    const rows = play([1, 2, 1, 2, 1, 1]);
    expect(rows.map((row) => row.fights)).toEqual([10, 13, 16, 20, 24, 30]);
    expect(rows.map((row) => row.loot)).toEqual([19_400_000, 24_300_000, 30_300_000, 37_900_000, 47_400_000, 58_200_000]);
    [0.15, 0.1875, 0.2344, 0.293, 0.3662, 0.45].forEach((share, w) => expect(rows[w]!.pay).toBeCloseTo(share, 3));
  });

  test("a slow player (done day 6-7, week 5 not finished)", () => {
    const rows = play([6, 7, 6, 7, null, 6]);
    expect(rows.map((row) => row.fights)).toEqual([10, 9, 7, 6, 5, 5]);
    expect(rows.map((row) => row.loot)).toEqual([19_400_000, 16_500_000, 14_000_000, 11_900_000, 10_100_000, 9_700_000]);
    [0.15, 0.1275, 0.1084, 0.0921, 0.0783, 0.075].forEach((share, w) => expect(rows[w]!.pay).toBeCloseTo(share, 3));
  });

  test("a normal player (done day 3-5) keeps 10 fights and one storage", () => {
    const rows = play([3, 4, 5, 3, 4, 5]);
    expect(rows.every((row) => row.fights === 10 && row.loot === CAP)).toBe(true);
  });

  test("weeks start on Monday 00:00 UTC", () => {
    expect(utcWeekStart(weekAt(2) + 5 * DAY)).toBe(weekAt(2));
  });
});
