import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";

import type { User } from "../../database/models/user.model.js";
import type { BaiterTokenStore } from "../../services/goals/baiterRun.js";
import { readQuests } from "../../services/quests/state.js";
import { goalsActions } from "./goalsActions.js";
import { questsActions } from "./questsActions.js";
import { partsFor, yardStateAction, type StatePartsReport } from "./state.js";
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
    const report = answer.body.report as StatePartsReport;
    expect(report.goals?.goals.length).toBeGreaterThan(0);
    expect(report.quests?.quests.daily.quests.length).toBeGreaterThan(0);
    // The quest record was rolled to today and written, as `quests/state` writes it.
    expect(readQuests(db.row!.dailyquests).daily?.quests.length).toBe(report.quests!.quests.daily.quests.length);

    // Their own routes, now on the written row, answer the same.
    const goalsAnswer = await call(goals.state, {});
    const questsAnswer = await call(quests.state, {});
    expect(goalsAnswer.body.report).toEqual(report.goals);
    expect(questsAnswer.body.report).toEqual(report.quests);
    // The rest of the answer is the yard, as any yard route's.
    expect(answer.body.questsClaimable).toBe(questsAnswer.body.questsClaimable);
    expect(answer.body.caps).toEqual(goalsAnswer.body.caps);
  });

  test("an unknown part is ignored; one part alone comes back alone", async () => {
    const answer = await call(yardStateAction, { parts: "goals,mystery" });
    const report = answer.body.report as StatePartsReport;
    expect(Object.keys(report)).toEqual(["goals"]);
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
