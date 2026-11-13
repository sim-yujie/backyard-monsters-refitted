import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Save } from "../../database/models/save.model.js";
import {
  DAILY_ALWAYS,
  DAILY_PAY_SHARE,
  DAILY_QUEST_COUNT,
  DAILY_QUESTS,
  LOGIN_CARD_SHINY,
  QUEST_TRIBES,
  WEEKLY_ALL_DONE_SHINY,
  WEEKLY_QUEST_SHINY,
  DAILY_GLIMMERS,
} from "../../game-data/quests.js";
import { FilterFrontendKeys } from "../../utils/FrontendKey.js";
import { utcDay, utcWeek } from "./period.js";
import {
  allDone,
  claimableCount,
  claimBonus,
  claimLogin,
  claimQuest,
  countQuests,
  emptyQuests,
  isUnlocked,
  loginToday,
  pickDaily,
  pickWeekly,
  questsJson,
  readQuests,
  recordQuests,
  rollOver,
  swapDaily,
  updateQuests,
  type QuestEntry,
  type QuestPlayer,
  type QuestRecord,
  type QuestSave,
  type QuestSet,
} from "./state.js";

const DAY = 86_400;
/** Monday 2026-11-02 10:00 UTC. */
const MONDAY = Date.parse("2026-11-02T10:00:00Z") / 1000;

/** A player with everything unlocked: harvesters, Juicer, Map Room, Hatchery, a tower, the catapult. */
const playerOf = (overrides: Partial<QuestPlayer> = {}): QuestPlayer => ({
  userid: 42,
  townHall: 5,
  buildings: new Set([1, 2, 3, 4, 9, 11, 13, 20, 51]),
  champion: true,
  hasFriend: true,
  monsters: ["C1", "C2", "C5"],
  cap: 100_000,
  ...overrides,
});

const quest = (overrides: Partial<QuestEntry> = {}): QuestEntry => ({
  slot: 0,
  kind: "mushroom",
  need: 2,
  have: 0,
  claimed: false,
  rewards: [],
  ...overrides,
});

const setOf = (period: string, quests: QuestEntry[], extra: Partial<QuestSet> = {}): QuestSet => ({
  period,
  quests,
  bonus: false,
  swaps: 0,
  ...extra,
});

/** A record whose day and week are `now`'s, with the quests given. */
const recordAt = (now: number, daily: QuestEntry[], weekly: QuestEntry[] = []): QuestRecord => ({
  ...emptyQuests(),
  daily: setOf(utcDay(now), daily),
  weekly: setOf(utcWeek(now), weekly),
});

describe("the daily pick", () => {
  test("five quests, slots 0-4, no kind twice, and slot 0 is always a tribe's yard", () => {
    for (let d = 0; d < 30; d++) {
      const set = pickDaily(playerOf(), utcDay(MONDAY + d * DAY));
      expect(set.quests).toHaveLength(DAILY_QUEST_COUNT);
      expect(set.quests.map((one) => one.slot)).toEqual([0, 1, 2, 3, 4]);
      expect(new Set(set.quests.map((one) => one.kind)).size).toBe(DAILY_QUEST_COUNT);
      expect(set.quests[0]!.kind).toBe(DAILY_ALWAYS);
      expect(QUEST_TRIBES as readonly string[]).toContain(set.quests[0]!.variant!);
      expect(set.quests.filter((one) => one.kind === DAILY_ALWAYS)).toHaveLength(1);
    }
  });

  test("seeded: the same player and day always pick the same; days and players differ", () => {
    const day = utcDay(MONDAY);
    expect(pickDaily(playerOf(), day)).toEqual(pickDaily(playerOf(), day));

    const kinds = (player: QuestPlayer, d: number) =>
      pickDaily(player, utcDay(MONDAY + d * DAY)).quests.map((one) => `${one.kind}:${one.variant ?? ""}:${one.need}`).join();
    const days = new Set(Array.from({ length: 14 }, (_, d) => kinds(playerOf(), d)));
    expect(days.size).toBeGreaterThan(1);
    const players = new Set(Array.from({ length: 14 }, (_, i) => kinds(playerOf({ userid: 100 + i }), 0)));
    expect(players.size).toBeGreaterThan(1);
  });

  test("only kinds the player has unlocked", () => {
    // Map Room only: no Hatchery, Juicer, harvesters, tower, catapult, friend or champion.
    const player = playerOf({ buildings: new Set([11]), champion: false, hasFriend: false });
    for (let d = 0; d < 14; d++) {
      const set = pickDaily(player, utcDay(MONDAY + d * DAY));
      const kinds = set.quests.map((one) => one.kind).sort();
      expect(kinds).toEqual(["attackPlayer", "destroyTribe", "mushroom"]);
    }
    const all = DAILY_QUESTS.filter((kind) => isUnlocked(kind, player)).map((kind) => kind.id);
    expect(all.sort()).toEqual(["attackPlayer", "destroyTribe", "mushroom"]);
  });

  test("without a Map Room there is no tribe quest, and the rest still fill the day", () => {
    const set = pickDaily(playerOf({ buildings: new Set([1, 2, 3, 4, 9, 13, 20]) }), utcDay(MONDAY));
    expect(set.quests.map((one) => one.kind)).not.toContain(DAILY_ALWAYS);
    expect(set.quests).toHaveLength(DAILY_QUEST_COUNT);
  });

  test("a hatch quest names a monster the player has unlocked, 1-5 of it", () => {
    const player = playerOf({ monsters: ["C1", "C7"] });
    let seen = 0;
    for (let d = 0; d < 60; d++) {
      for (const one of pickDaily(player, utcDay(MONDAY + d * DAY)).quests) {
        if (one.kind !== "hatchMonster") continue;
        seen++;
        expect(["C1", "C7"]).toContain(one.variant!);
        expect(one.need).toBeGreaterThanOrEqual(1);
        expect(one.need).toBeLessThanOrEqual(5);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  test("each daily quest pays 4% of the storage cap in its one resource; needs follow Town Hall", () => {
    const set = pickDaily(playerOf({ cap: 250_000, townHall: 5 }), utcDay(MONDAY));
    const last = set.quests.length - 1;
    for (const one of set.quests) {
      expect(one.rewards).toHaveLength(1);
      if (one.slot === last) continue;
      const reward = one.rewards[0] as { kind: string; amounts: Record<string, number> };
      expect(reward.kind).toBe("resources");
      expect(Object.values(reward.amounts)).toEqual([Math.floor(250_000 * DAILY_PAY_SHARE)]);
    }
    // The last slot pays Glimmers instead (and only that slot).
    expect(set.quests[last]!.rewards).toEqual([{ kind: "eventCoins", amount: DAILY_GLIMMERS }]);
    expect(DAILY_GLIMMERS).toBe(5);
    // destroyTribe needs 2 at Town Hall 5.
    expect(set.quests[0]).toMatchObject({ kind: "destroyTribe", need: 2 });
  });
});

describe("the weekly pick (owner decision 13)", () => {
  test("social, resources and fighting, each with 5 Shiny", () => {
    const set = pickWeekly(playerOf(), utcWeek(MONDAY));
    expect(set.quests.map((one) => one.slot)).toEqual([0, 1, 2]);
    expect(set.quests[0]!.kind).toBe("weeklyHelpGift");
    expect(set.quests[1]!.kind).toMatch(/^weeklyLoot(Twigs|Pebbles|Putty|Goo)$/);
    expect(set.quests[2]!.kind).toBe("weeklyFights");
    for (const one of set.quests) expect(one.rewards).toContainEqual({ kind: "shiny", amount: WEEKLY_QUEST_SHINY });
  });

  test("Social and Fighting pay a 1-hour speed-up (SP2); Fighting needs 10 at every Town Hall", () => {
    for (const townHall of [1, 4, 10]) {
      const set = pickWeekly(playerOf({ townHall }), utcWeek(MONDAY));
      expect(set.quests[2]).toMatchObject({ kind: "weeklyFights", need: 10 });
      expect(set.quests[0]!.rewards).toContainEqual({ kind: "speedup", item: "SP2", count: 1 });
      expect(set.quests[2]!.rewards).toContainEqual({ kind: "speedup", item: "SP2", count: 1 });
    }
  });

  test("Resources: loot one full storage cap of one resource; pays 15% of the cap in THAT resource", () => {
    const resource = { weeklyLootTwigs: "r1", weeklyLootPebbles: "r2", weeklyLootPutty: "r3", weeklyLootGoo: "r4" } as const;
    const seen = new Set<string>();
    for (let w = 0; w < 20; w++) {
      const loot = pickWeekly(playerOf({ cap: 120_000 }), utcWeek(MONDAY + w * 7 * DAY)).quests[1]!;
      seen.add(loot.kind);
      expect(loot.need).toBe(120_000);
      const r = resource[loot.kind as keyof typeof resource];
      expect(loot.rewards).toEqual([
        { kind: "resources", amounts: { [r]: 18_000 } },
        { kind: "shiny", amount: WEEKLY_QUEST_SHINY },
      ]);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("a player with no friend to help gets 'make 5 new friends' instead", () => {
    const set = pickWeekly(playerOf({ hasFriend: false }), utcWeek(MONDAY));
    expect(set.quests[0]).toMatchObject({ kind: "weeklyNewFriends", need: 5 });
  });

  test("the all-done bonus is 10 Shiny", () => {
    const now = MONDAY;
    const record = recordAt(now, [], [quest({ kind: "weeklyFights", need: 1, have: 1 })]);
    expect(claimBonus(record, "weekly")).toMatchObject({ ok: true, value: { shiny: WEEKLY_ALL_DONE_SHINY } });
  });
});

describe("rolling over", () => {
  test("the same day keeps the record as it is", () => {
    const record = rollOver(emptyQuests(), playerOf(), MONDAY);
    expect(rollOver(record, playerOf(), MONDAY + 3600)).toBe(record);
  });

  test("a new day brings new dailies and keeps the week; finished, unclaimed quests are lost", () => {
    const first = rollOver(emptyQuests(), playerOf(), MONDAY);
    const done = countQuests(first, { tribeDestroy: 99, [`tribeDestroy:${first.daily!.quests[0]!.variant}`]: 99 }).record;
    expect(claimableCount(done, MONDAY)).toBeGreaterThan(1);

    const next = rollOver(done, playerOf(), MONDAY + DAY);
    expect(next.daily!.period).toBe(utcDay(MONDAY + DAY));
    expect(next.daily!.quests.every((one) => one.have === 0 && !one.claimed)).toBe(true);
    expect(next.weekly).toBe(done.weekly);
  });

  test("Monday 00:00 UTC brings new weeklies", () => {
    const first = rollOver(emptyQuests(), playerOf(), MONDAY);
    const sunday = rollOver(first, playerOf(), MONDAY + 6 * DAY);
    expect(sunday.weekly).toBe(first.weekly);
    const monday = rollOver(first, playerOf(), MONDAY + 7 * DAY);
    expect(monday.weekly!.period).toBe(utcWeek(MONDAY + 7 * DAY));
  });
});

describe("counting progress", () => {
  test("a stat moves every unclaimed quest that counts it, never past its need", () => {
    const record = recordAt(MONDAY, [quest({ kind: "mushroom", need: 2 })], [quest({ kind: "weeklyFights", need: 10 })]);
    const once = countQuests(record, { mushroom: 1, attackWin: 1 }).record;
    expect(once.daily!.quests[0]!.have).toBe(1);
    expect(once.weekly!.quests[0]!.have).toBe(1);
    const more = countQuests(once, { mushroom: 5, defenceWin: 2 }).record;
    expect(more.daily!.quests[0]!.have).toBe(2);
    expect(more.weekly!.quests[0]!.have).toBe(3);
  });

  test("a quest with a variant counts only `<stat>:<variant>`", () => {
    const record = recordAt(MONDAY, [quest({ kind: "hatchMonster", variant: "C2", need: 3 })]);
    expect(countQuests(record, { hatch: 4, "hatch:C1": 4 }).changed).toBe(false);
    expect(countQuests(record, { hatch: 2, "hatch:C2": 2 }).record.daily!.quests[0]!.have).toBe(2);
  });

  test("loot counts per resource, to one full cap (decision 13)", () => {
    const record = recordAt(MONDAY, [], [quest({ kind: "weeklyLootPutty", need: 100_000 })]);
    const after = countQuests(record, { lootR1: 50_000, lootR3: 60_000 }).record;
    expect(after.weekly!.quests[0]!.have).toBe(60_000);
    expect(countQuests(after, { lootR3: 60_000 }).record.weekly!.quests[0]!.have).toBe(100_000);
  });

  test("a negative takes back (a cancelled upgrade), never below 0; a claimed quest no longer moves", () => {
    const record = recordAt(MONDAY, [quest({ kind: "upgradeDefence", need: 1 }), quest({ slot: 1, kind: "mushroom", need: 1, have: 1, claimed: true })]);
    const started = countQuests(record, { upgradeDefence: 1 }).record;
    expect(started.daily!.quests[0]!.have).toBe(1);
    expect(countQuests(started, { upgradeDefence: -1 }).record.daily!.quests[0]!.have).toBe(0);
    expect(countQuests(record, { upgradeDefence: -1 }).changed).toBe(false);
    expect(countQuests(record, { mushroom: 1 }).changed).toBe(false);
  });

  test("unknown keys and zeros are dropped", () => {
    const save: QuestSave = { userid: 42, poolCap: 100_000, dailyquests: questsJson(recordAt(MONDAY, [quest()])) };
    const before = save.dailyquests;
    recordQuests(save, MONDAY, { nonsense: 5, mushroom: 0 });
    expect(save.dailyquests).toBe(before);
  });
});

describe("the login card (decision 3)", () => {
  test("day 1 pays 2 Shiny; a second claim the same UTC day is refused", () => {
    const first = claimLogin(emptyQuests(), MONDAY);
    expect(first).toMatchObject({ ok: true, value: { day: 1, shiny: LOGIN_CARD_SHINY[0] } });
    if (!first.ok) throw new Error("claim");
    expect(claimLogin(first.record, MONDAY + 13 * 3600 - 1)).toEqual({ ok: false, reason: "claimedToday" });
    expect(loginToday(first.record, MONDAY)).toEqual({ day: 1, claimedToday: true, onCard: 1 });
  });

  test("a missed day pauses the card, never resets it", () => {
    let record = emptyQuests();
    for (const d of [0, 1, 5]) {
      const result = claimLogin(record, MONDAY + d * DAY);
      if (!result.ok) throw new Error("claim");
      record = result.record;
    }
    expect(record.login).toEqual({ claimed: 3, last: utcDay(MONDAY + 5 * DAY), total: 3 });
    expect(loginToday(record, MONDAY + 9 * DAY)).toEqual({ day: 4, claimedToday: false, onCard: 3 });
  });

  test("after day 7 (10 Shiny) the next claim starts a new card at day 1", () => {
    let record = emptyQuests();
    const paid: number[] = [];
    for (let d = 0; d < 9; d++) {
      const result = claimLogin(record, MONDAY + d * DAY);
      if (!result.ok) throw new Error("claim");
      paid.push(result.value.shiny);
      record = result.record;
    }
    expect(paid).toEqual([2, 2, 3, 3, 5, 5, 10, 2, 2]);
    expect(record.login).toMatchObject({ claimed: 2, total: 9 });
  });
});

describe("claims", () => {
  test("a quest claims once, only when finished", () => {
    const record = recordAt(MONDAY, [quest({ need: 2, have: 1 }), quest({ slot: 1, need: 1, have: 1 })]);
    expect(claimQuest(record, "daily", 0)).toEqual({ ok: false, reason: "notDone" });
    expect(claimQuest(record, "daily", 7)).toEqual({ ok: false, reason: "noSuchQuest" });
    const claimed = claimQuest(record, "daily", 1);
    expect(claimed).toMatchObject({ ok: true, value: { slot: 1, claimed: true } });
    if (!claimed.ok) throw new Error("claim");
    expect(claimQuest(claimed.record, "daily", 1)).toEqual({ ok: false, reason: "claimed" });
  });

  test("the all-done bonus needs every quest finished (not claimed), and pays once", () => {
    const record = recordAt(MONDAY, [quest({ need: 1, have: 1 }), quest({ slot: 1, need: 2, have: 1 })]);
    expect(claimBonus(record, "daily")).toEqual({ ok: false, reason: "bonusNotReady" });
    const done = countQuests(record, { mushroom: 1 }).record;
    expect(allDone(done.daily)).toBe(true);
    const bonus = claimBonus(done, "daily");
    expect(bonus).toMatchObject({ ok: true, value: { shiny: 5 } });
    if (!bonus.ok) throw new Error("bonus");
    expect(claimBonus(bonus.record, "daily")).toEqual({ ok: false, reason: "bonusClaimed" });
    expect(claimBonus(recordAt(MONDAY, []), "weekly")).toEqual({ ok: false, reason: "bonusNotReady" });
  });
});

describe("the daily swap (one free a day)", () => {
  const player = playerOf();
  const today = () => rollOver(emptyQuests(), player, MONDAY);

  test("a tribe quest swaps to another tribe, never another kind", () => {
    const record = today();
    const before = record.daily!.quests[0]!;
    const swapped = swapDaily(record, player, 0);
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(swapped.value.kind).toBe(DAILY_ALWAYS);
    expect(swapped.value.variant).not.toBe(before.variant);
    expect(QUEST_TRIBES as readonly string[]).toContain(swapped.value.variant!);
    expect(swapped.value).toMatchObject({ slot: 0, have: 0, claimed: false });
  });

  test("a swap keeps the Glimmers on the last slot and never moves them to another slot", () => {
    const record = today();
    const last = record.daily!.quests.length - 1;
    const swapped = swapDaily(record, player, last);
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(swapped.value.rewards).toEqual([{ kind: "eventCoins", amount: DAILY_GLIMMERS }]);
    const other = swapDaily(record, player, 2);
    if (!other.ok) throw new Error(other.reason);
    expect(other.value.rewards[0]!.kind).toBe("resources");
  });

  test("another quest swaps to an unlocked kind not shown today, never the tribe kind", () => {
    const record = today();
    const shown = record.daily!.quests.map((one) => one.kind);
    const swapped = swapDaily(record, player, 2);
    if (!swapped.ok) throw new Error(swapped.reason);
    expect(shown).not.toContain(swapped.value.kind);
    expect(swapped.value.kind).not.toBe(DAILY_ALWAYS);
    expect(swapped.value.slot).toBe(2);
    expect(swapped.record.daily!.swaps).toBe(1);
  });

  test("one a day: the second is refused; a new day has its swap again", () => {
    const first = swapDaily(today(), player, 1);
    if (!first.ok) throw new Error(first.reason);
    expect(swapDaily(first.record, player, 2)).toEqual({ ok: false, reason: "noSwapsLeft" });
    const tomorrow = rollOver(first.record, player, MONDAY + DAY);
    expect(swapDaily(tomorrow, player, 2).ok).toBe(true);
  });

  test("a finished or claimed quest cannot be swapped; nothing left to swap to is refused", () => {
    const record = recordAt(MONDAY, [quest({ need: 1, have: 1 })]);
    expect(swapDaily(record, player, 0)).toEqual({ ok: false, reason: "cannotSwap" });
    // Map Room only: all three kinds already shown.
    const small = playerOf({ buildings: new Set([11]), champion: false, hasFriend: false });
    const full = rollOver(emptyQuests(), small, MONDAY);
    expect(swapDaily(full, small, 1)).toEqual({ ok: false, reason: "nothingToSwapTo" });
  });
});

describe("the red number", () => {
  test("counts the login day, finished unclaimed quests and ready bonuses of the current periods", () => {
    const record = recordAt(MONDAY, [quest({ need: 1, have: 1 }), quest({ slot: 1, need: 1, have: 1, claimed: true })], [quest({ kind: "weeklyFights", need: 10, have: 3 })]);
    // Login day + one quest + the daily bonus (all done).
    expect(claimableCount(record, MONDAY)).toBe(3);
    const login = claimLogin(record, MONDAY);
    if (!login.ok) throw new Error("login");
    expect(claimableCount(login.record, MONDAY)).toBe(2);
    // Tomorrow, yesterday's leftovers no longer count; only the login day does.
    expect(claimableCount(login.record, MONDAY + DAY)).toBe(1);
  });
});

describe("the record (save.dailyquests)", () => {
  test("anything unreadable reads as an empty record; unknown kinds are dropped; have never exceeds need", () => {
    expect(readQuests(null)).toEqual(emptyQuests());
    expect(readQuests([1, 2])).toEqual(emptyQuests());
    const record = readQuests({
      login: { claimed: 12, last: "nope", total: -3 },
      daily: { period: "2026-11-02", quests: [{ kind: "gone", need: 1 }, { kind: "mushroom", need: 2, have: 9, slot: 0 }] },
      weekly: { period: "bad" },
    });
    expect(record.login).toEqual({ claimed: 7, last: null, total: 0 });
    expect(record.daily!.quests).toEqual([quest({ need: 2, have: 2 })]);
    expect(record.weekly).toBeNull();
  });

  test("the first update writes it; one with nothing new leaves the column alone", () => {
    const save: QuestSave = { userid: 42, poolCap: 100_000, buildingdata: { "0": { id: 0, t: 14, x: 0, y: 0, l: 3 } } };
    expect(updateQuests(save, MONDAY).changed).toBe(true);
    recordQuests(save, MONDAY);
    const written = save.dailyquests;
    expect(readQuests(written).daily!.period).toBe("2026-11-02");
    recordQuests(save, MONDAY + 60);
    expect(save.dailyquests).toBe(written);
  });

  test("it is the server's: the client never writes it and no load sends it", () => {
    expect(Save.saveKeys).not.toContain("dailyquests");
    expect(Save.attackSaveKeys).not.toContain("dailyquests");
    const save = new Save();
    expect(save.dailyquests).toBeNull();
    save.dailyquests = questsJson(emptyQuests());
    expect("dailyquests" in FilterFrontendKeys(save)).toBe(false);
  });

  test("the migration adds a nullable jsonb column and fills nothing in", () => {
    const migration = readFileSync(
      path.join(import.meta.dirname, "../../database/migrations/20261102_AddDailyQuestsToSave.ts"),
      "utf8"
    );
    expect(migration).toContain(`ADD COLUMN IF NOT EXISTS "dailyquests" jsonb NULL`);
    expect(migration).not.toContain("UPDATE");
  });
});
