import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";

import type { User } from "../../database/models/user.model.js";
import { DAILY_ALWAYS, LOGIN_CARD_SHINY } from "../../game-data/quests.js";
import { utcDay, utcWeek } from "../../services/quests/period.js";
import { claimableCount, emptyQuests, questsJson, readQuests, type QuestEntry, type QuestRecord } from "../../services/quests/state.js";
import { capOf } from "../../services/yard/credit.js";
import { questsActions, type QuestsReport } from "./questsActions.js";
import { yardCancelUpgradeAction, yardUpgradeAction } from "./upgrade.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The quest window's routes end to end through the real yard action wrapper,
 * with the save replaced by one in-memory row written only when the
 * transaction commits (as `eventsActions.test.ts` does) and the friend check
 * by a stand-in. The engine's rules are `services/quests/state.test.ts`.
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    let entity: Row | null = null;
    const fork = {
      async findOne() {
        entity = db.row && structuredClone(db.row);
        return entity;
      },
      async flush() {},
    };
    const result = await cb(fork);
    if (entity) db.row = structuredClone(entity);
    return result;
  },
};

const user = { userid: 2503, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

/** Monday 2030-01-07 09:00 UTC. */
const MONDAY = Date.UTC(2030, 0, 7, 9) / 1000;
const DAY = 86_400;
const at = (seconds: number) => setSystemTime(new Date(seconds * 1000));

/** A main yard: level 3 hall, a Cannon Tower, a Silo, a Map Room. */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2503,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: MONDAY,
  credits: 100,
  points: "100",
  flinger: 0,
  catapult: 0,
  resources: { r1: 60000, r2: 40000, r3: 20000, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 3 },
    "1": { id: 1, t: 20, x: 0, y: 0, l: 2 },
    "2": { id: 2, t: 6, x: 0, y: 0, l: 10 },
    "3": { id: 3, t: 11, x: 0, y: 0, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: { C1: { t: 2 } },
  academy: {},
  champion: [],
  mushrooms: { l: [], s: MONDAY },
  researchdata: {},
  outposts: [],
  ...overrides,
});

let friend = false;
const actions = questsActions(async () => friend);

const call = (action: YardAction<z.ZodType, unknown>, body: unknown = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const record = (): QuestRecord => readQuests(db.row!.dailyquests);
const reportOf = (answer: YardAnswer): QuestsReport => answer.body.report as QuestsReport;

const quest = (overrides: Partial<QuestEntry>): QuestEntry => ({
  slot: 0,
  kind: "mushroom",
  need: 1,
  have: 0,
  claimed: false,
  rewards: [],
  ...overrides,
});

/** Writes a record holding today's and this week's quests as given. */
const withQuests = (daily: QuestEntry[], weekly: QuestEntry[] = []) => {
  const now = Math.floor(Date.now() / 1000);
  db.row!.dailyquests = questsJson({
    ...emptyQuests(),
    daily: { period: utcDay(now), quests: daily, bonus: false, swaps: 0 },
    weekly: { period: utcWeek(now), quests: weekly, bonus: false, swaps: 0 },
  });
};

beforeEach(() => {
  friend = false;
  at(MONDAY);
  db.row = rowOf();
});

afterEach(() => {
  setSystemTime();
});

describe("POST /bm/yard/quests/state", () => {
  test("picks today's and this week's quests, writes them, and answers the window's view", async () => {
    const answer = await call(actions.state);

    expect(answer.status).toBe(200);
    const view = reportOf(answer).quests;
    expect(view).toMatchObject({
      now: MONDAY,
      nextDayAt: Date.UTC(2030, 0, 8) / 1000,
      nextWeekAt: Date.UTC(2030, 0, 14) / 1000,
      claimable: 1,
      login: { day: 1, claimedToday: false, onCard: 0, shiny: [...LOGIN_CARD_SHINY] },
      daily: { swapsLeft: 1, bonus: { shiny: 5, ready: false, claimed: false } },
      weekly: { bonus: { shiny: 10, ready: false, claimed: false } },
    });
    // Map Room, a tower and mushrooms: no Hatchery, Juicer, harvester, champion or friend.
    expect(view.daily.quests.map((one: QuestEntry) => one.kind).sort()).toEqual(
      ["attackPlayer", "destroyTribe", "mushroom", "upgradeDefence"].sort()
    );
    expect(view.daily.quests[0].kind).toBe(DAILY_ALWAYS);
    expect(view.weekly.quests.map((one: QuestEntry) => one.kind)).toEqual([
      "weeklyNewFriends",
      expect.stringMatching(/^weeklyLoot/),
      "weeklyFights",
    ]);
    expect(answer.body.questsClaimable).toBe(1);
    expect(record().daily!.period).toBe("2030-01-07");
    expect(record().hasFriend).toBe(false);
  });

  test("a player with a friend to help gets the help-or-gift weekly", async () => {
    friend = true;
    const answer = await call(actions.state);
    expect(reportOf(answer).quests.weekly.quests[0].kind).toBe("weeklyHelpGift");
    expect(record().hasFriend).toBe(true);
  });

  test("any yard action picks the quests too, so every yard answer carries the red number", async () => {
    const answer = await call(yardUpgradeAction, { id: 1 });
    expect(answer.status).toBe(200);
    expect(record().daily!.period).toBe("2030-01-07");
    // The login day, and the upgradeDefence daily this very upgrade finished.
    expect(answer.body.questsClaimable).toBe(claimableCount(record(), MONDAY));
    expect(answer.body.questsClaimable).toBe(2);
  });
});

describe("POST /bm/yard/quests/login/claim", () => {
  test("pays today's Shiny once a UTC day; the next day pays the next card day", async () => {
    const first = await call(actions.loginClaim);
    expect(first.status).toBe(200);
    expect(first.body.report).toMatchObject({ day: 1, granted: [{ kind: "shiny", amount: 2 }] });
    expect(db.row!.credits).toBe(102);
    expect(first.body.questsClaimable).toBe(0);

    const again = await call(actions.loginClaim);
    expect(again).toMatchObject({ status: 409, body: { reason: "claimedToday", nextAt: MONDAY - 9 * 3600 + DAY } });
    expect(db.row!.credits).toBe(102);

    at(MONDAY + 3 * DAY);
    const later = await call(actions.loginClaim);
    expect(later.body.report).toMatchObject({ day: 2, granted: [{ kind: "shiny", amount: 2 }] });
    expect(db.row!.credits).toBe(104);
  });
});

describe("POST /bm/yard/quests/claim", () => {
  test("a finished quest pays once, its resources capped at storage", async () => {
    const cap = capOf(rowOf() as never);
    db.row = rowOf({ resources: { r1: cap - 500, r2: 0, r3: 0, r4: 0 } });
    withQuests([quest({ need: 1, have: 1, rewards: [{ kind: "resources", amounts: { r1: 4000 } }] }), quest({ slot: 1, need: 2 })]);

    const answer = await call(actions.claim, { period: "daily", slot: 0 });
    expect(answer.status).toBe(200);
    expect(reportOf(answer).granted).toMatchObject([
      { kind: "resources", credited: { r1: 500, r2: 0, r3: 0, r4: 0 }, overflow: { r1: 3500, r2: 0, r3: 0, r4: 0 } },
    ]);
    expect((db.row!.resources as Row).r1).toBe(cap);
    expect(record().daily!.quests[0]!.claimed).toBe(true);

    expect(await call(actions.claim, { period: "daily", slot: 0 })).toMatchObject({ status: 409, body: { reason: "claimed" } });
    expect(await call(actions.claim, { period: "daily", slot: 1 })).toMatchObject({ status: 409, body: { reason: "notDone" } });
    expect(await call(actions.claim, { period: "daily", slot: 6 })).toMatchObject({ status: 409, body: { reason: "noSuchQuest" } });
    expect((await call(actions.claim, { period: "monthly", slot: 0 })).status).toBe(400);
  });

  test("a weekly quest pays its speed-up and Shiny", async () => {
    withQuests(
      [],
      [quest({ kind: "weeklyFights", need: 10, have: 10, rewards: [{ kind: "speedup", item: "SP2", count: 1 }, { kind: "shiny", amount: 5 }] })]
    );
    const answer = await call(actions.claim, { period: "weekly", slot: 0 });
    expect(answer.status).toBe(200);
    expect(db.row!.credits).toBe(105);
    expect((db.row!.storedata as Row).FREESP2).toEqual({ q: 1 });
  });

  test("yesterday's finished quest is gone after midnight", async () => {
    withQuests([quest({ need: 1, have: 1, rewards: [{ kind: "shiny", amount: 1 }] })]);
    at(MONDAY + DAY);
    const answer = await call(actions.claim, { period: "daily", slot: 0 });
    expect(answer.status).toBe(409);
    expect(db.row!.credits).toBe(100);
  });
});

describe("POST /bm/yard/quests/bonus/claim", () => {
  test("pays 5 Shiny once every daily is finished, once", async () => {
    withQuests([quest({ need: 1, have: 1 }), quest({ slot: 1, need: 2, have: 1 })]);
    expect(await call(actions.bonusClaim, { period: "daily" })).toMatchObject({ status: 409, body: { reason: "bonusNotReady" } });

    withQuests([quest({ need: 1, have: 1 }), quest({ slot: 1, need: 2, have: 2 })]);
    const answer = await call(actions.bonusClaim, { period: "daily" });
    expect(answer.status).toBe(200);
    expect(db.row!.credits).toBe(105);
    expect(await call(actions.bonusClaim, { period: "daily" })).toMatchObject({ status: 409, body: { reason: "bonusClaimed" } });
    expect(db.row!.credits).toBe(105);
  });
});

describe("POST /bm/yard/quests/swap", () => {
  test("one free swap a day; the tribe quest swaps to another tribe", async () => {
    await call(actions.state);
    // Every kind this yard has unlocked is already shown: nothing to swap a non-tribe quest to.
    expect(await call(actions.swap, { slot: 1 })).toMatchObject({ status: 409, body: { reason: "nothingToSwapTo" } });

    const before = record().daily!.quests[0]!;
    const answer = await call(actions.swap, { slot: 0 });
    expect(answer.status).toBe(200);
    expect(reportOf(answer).quests.daily.swapsLeft).toBe(0);
    expect(record().daily!.quests[0]).toMatchObject({ kind: DAILY_ALWAYS });
    expect(record().daily!.quests[0]!.variant).not.toBe(before.variant);
    expect(await call(actions.swap, { slot: 2 })).toMatchObject({ status: 409, body: { reason: "noSwapsLeft" } });
  });
});

describe("progress counted by other yard actions", () => {
  test("an upgrade started on a tower counts; a cancel takes it back; the red number rides along", async () => {
    withQuests([quest({ kind: "upgradeDefence", need: 1 })]);

    const started = await call(yardUpgradeAction, { id: 1 });
    expect(started.status).toBe(200);
    expect(record().daily!.quests[0]!.have).toBe(1);
    // The login day, the finished quest and the daily all-done bonus.
    expect(started.body.questsClaimable).toBe(3);

    const cancelled = await call(yardCancelUpgradeAction, { id: 1 });
    expect(cancelled.status).toBe(200);
    expect(record().daily!.quests[0]!.have).toBe(0);
    expect(cancelled.body.questsClaimable).toBe(1);
  });
});
