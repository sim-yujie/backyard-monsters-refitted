import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";

import type { User } from "../../database/models/user.model.js";
import type { BaiterTokenStore } from "../../services/goals/baiterRun.js";
import { readQuests } from "../../services/quests/state.js";
import { goalsActions } from "./goalsActions.js";
import { questsActions } from "./questsActions.js";
import { haveOf, partsFor, stampOf, yardStateAction, type StatePartsReport } from "./state.js";
import type { GoalsStateReport } from "../../services/goals/claim.js";
import type { QuestsReport } from "./questsActions.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * `POST /bm/yard/state` with `parts` (beta 9, speed-ups item 5): the yard's
 * start-up reads in one call. Driven through the real wrapper with one
 * in-memory row written on commit, as `questsActions.test.ts` does.
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

const call = (action: YardAction<z.ZodType, unknown>, body: unknown = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

/** `goals/state` never touches the Baiter tokens. */
const goals = goalsActions({} as BaiterTokenStore);
const quests = questsActions(async () => false);

beforeEach(() => {
  setSystemTime(new Date(MONDAY * 1000));
  db.row = rowOf();
});

afterEach(() => {
  setSystemTime();
});

describe("POST /bm/yard/state with parts", () => {
  test("without parts it answers as before: report null", async () => {
    const answer = await call(yardStateAction, {});
    expect(answer.status).toBe(200);
    expect(answer.body.report).toBeNull();
  });

  test("goals and quests come back in one answer, exactly as their own routes answer them", async () => {
    const answer = await call(yardStateAction, { parts: "goals,quests" });
    expect(answer.status).toBe(200);
    const report = answer.body.report as { goals: GoalsStateReport & { stamp: string }; quests: QuestsReport & { stamp: string } };
    expect(report.goals.goals.length).toBeGreaterThan(0);
    expect(report.quests.quests.daily.quests.length).toBeGreaterThan(0);
    // The quest record was rolled to today and written, as `quests/state` writes it.
    expect(readQuests(db.row!.dailyquests).daily?.quests.length).toBe(report.quests.quests.daily.quests.length);

    // Their own routes, now on the written row, answer the same (each part also carries its stamp).
    const goalsAnswer = await call(goals.state, {});
    const questsAnswer = await call(quests.state, {});
    const { stamp: goalsStamp, ...goalsView } = report.goals;
    const { stamp: questsStamp, ...questsView } = report.quests;
    expect(goalsAnswer.body.report).toEqual(goalsView);
    expect(questsAnswer.body.report).toEqual(questsView);
    expect(goalsStamp).toBe(stampOf("goals", goalsView));
    expect(questsStamp).toBe(stampOf("quests", questsView));
    expect(goalsStamp).toHaveLength(16);
    // The rest of the answer is the yard, as any yard route's.
    expect(answer.body.questsClaimable).toBe(questsAnswer.body.questsClaimable);
    expect(answer.body.caps).toEqual(goalsAnswer.body.caps);
  });

  test("a part the client holds unchanged comes back as same, not re-sent (item 6)", async () => {
    const first = (await call(yardStateAction, { parts: "goals,quests" })).body.report as Record<string, { stamp: string }>;
    const have = `goals:${first.goals!.stamp},quests:${first.quests!.stamp}`;

    // A minute later: the quest view's clock moved, nothing the windows show did.
    setSystemTime(new Date((MONDAY + 60) * 1000));
    const again = (await call(yardStateAction, { parts: "goals,quests", have })).body.report;
    expect(again).toEqual({
      goals: { same: true, stamp: first.goals!.stamp },
      quests: { same: true, stamp: first.quests!.stamp, now: MONDAY + 60 },
    });
  });

  test("a changed view is sent again with its new stamp: progress, a new day, a stale stamp", async () => {
    const first = (await call(yardStateAction, { parts: "goals,quests" })).body.report as Record<string, { stamp: string }>;
    const have = `goals:${first.goals!.stamp},quests:${first.quests!.stamp}`;

    // A new UTC day: new daily quests and login day, so the quest view changes.
    setSystemTime(new Date((MONDAY + 86_400) * 1000));
    const nextDay = (await call(yardStateAction, { parts: "goals,quests", have })).body.report as Record<string, Record<string, unknown>>;
    expect(nextDay.quests!.same).toBeUndefined();
    expect(nextDay.quests!.quests).toBeDefined();
    expect(nextDay.quests!.stamp).not.toBe(first.quests!.stamp);
    // Goals did not change in a day of doing nothing.
    expect(nextDay.goals).toEqual({ same: true, stamp: first.goals!.stamp });

    // Progress: a Town Hall level up changes what the Goals window shows.
    const buildings = db.row!.buildingdata as Record<string, Record<string, unknown>>;
    buildings["0"] = { ...buildings["0"], l: 5 };
    const progressed = (await call(yardStateAction, { parts: "goals", have: `goals:${first.goals!.stamp}` })).body.report as Record<string, Record<string, unknown>>;
    expect(progressed.goals!.same).toBeUndefined();
    expect(progressed.goals!.goals).toBeDefined();

    // A stamp that matches nothing gets the view.
    const stale = (await call(yardStateAction, { parts: "goals", have: "goals:nope" })).body.report as Record<string, Record<string, unknown>>;
    expect(stale.goals!.goals).toBeDefined();
  });

  test("an unknown part is ignored; one part alone comes back alone", async () => {
    const answer = await call(yardStateAction, { parts: "goals,mystery" });
    const report = answer.body.report as StatePartsReport;
    expect(Object.keys(report)).toEqual(["goals"]);
  });
});

describe("haveOf", () => {
  test("reads part:stamp pairs and skips anything else", () => {
    expect([...haveOf("goals:abc,quests:def")]).toEqual([["goals", "abc"], ["quests", "def"]]);
    expect([...haveOf("goals,:x,quests:")]).toEqual([]);
    expect([...haveOf(undefined)]).toEqual([]);
  });
});

describe("partsFor", () => {
  test("main yard: goals and quests; Inferno: goals only; outpost: none", () => {
    expect(partsFor("goals,quests", "main")).toEqual(["goals", "quests"]);
    expect(partsFor("quests,goals", undefined)).toEqual(["goals", "quests"]);
    expect(partsFor("goals,quests", "inferno")).toEqual(["goals"]);
    expect(partsFor("goals,quests", "outpost")).toEqual([]);
    expect(partsFor(undefined, "main")).toEqual([]);
    expect(partsFor("", "main")).toEqual([]);
  });
});
