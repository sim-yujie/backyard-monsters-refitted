import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardChampionEvolveAction,
  yardChampionFeedAction,
  yardChampionHealAction,
  yardChampionRaiseAction,
  yardChampionRenameAction,
} from "./champion.js";
import { yardChampionFreezeAction, yardChampionThawAction } from "./chamber.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Champion Cage's routes through the real wrapper, the database replaced
 * by one in-memory row written only when a transaction commits (as
 * `bunker.test.ts`): the catch-up runs first, Shiny is charged and refused the
 * wrapper's way, and a refusal writes nothing.
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

const user = { userid: 2505, shiny_locked: false, save: { basesaveid: 7 } } as unknown as User;

const HOUR = 3_600;

const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: 7,
  userid: 2505,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 500,
  points: "100",
  tutorialstage: 0,
  flinger: 0,
  catapult: 0,
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  buildingdata: {
    "0": { id: 0, t: 14, x: 0, y: 0, l: 4 },
    "1": { id: 1, t: 15, x: 0, y: 200, l: 1 },
    "3": { id: 3, t: 114, x: 200, y: 0, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: { housed: { C2: 20 }, saved: getCurrentDateTime() },
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const run = <S extends z.ZodType, R>(action: YardAction<S, R>, body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const championOf = (row: Row | null) => (row!.champion as Row[])[0]!;

describe("champion routes", () => {
  beforeEach(() => {
    db.row = rowOf();
  });

  test("raise, then the answer carries the champion in the state", async () => {
    const answer = await run(yardChampionRaiseAction, { type: "3" });
    expect(answer.status).toBe(200);
    expect(answer.body.champion).toEqual(db.row!.champion);
    expect(championOf(db.row)).toMatchObject({ t: 3, l: 1, hp: 15_000, status: 0 });
    expect(db.row!.credits).toBe(500);
  });

  test("a starving champion loses its feed in the catch-up before the action runs", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({
      savetime: now - 60,
      champion: [{ t: 1, hp: 1_000, l: 1, ft: now - 25 * HOUR, fd: 2, fb: 0, pl: 1, status: 0 }],
    });
    const answer = await run(yardChampionHealAction);
    expect(answer.status).toBe(200);
    expect((answer.body.completed as Row[]).map((job) => job.kind)).toContain("starve");
    expect(championOf(db.row)).toMatchObject({ l: 1, fd: 1, hp: 40_000, ft: now - 60 + 23 * HOUR });

    // Starving restarted the clock: it is not hungry again for 22 hours.
    const feed = await run(yardChampionFeedAction, { mode: "monsters" });
    expect(feed.body).toMatchObject({ reason: "notHungry" });
    expect((db.row!.monsters as Row).housed).toEqual({ C2: 20 });
  });

  test("a hungry champion eats from housing", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: now - HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const answer = await run(yardChampionFeedAction, { mode: "monsters" });
    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ mode: "monsters", eaten: { C2: 15 }, credits: 0, evolved: false });
    expect((db.row!.monsters as Row).housed).toEqual({ C2: 5 });
    expect(championOf(db.row)).toMatchObject({ fd: 1 });
  });

  test("Shiny is charged by the wrapper and refused when short", async () => {
    db.row = rowOf({ champion: [{ t: 1, hp: 1, l: 2, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const evolve = await run(yardChampionEvolveAction);
    expect(evolve.status).toBe(409);
    expect(evolve.body).toMatchObject({ reason: "credits", credits: { have: 500, need: 44 * 2 * 6 } });
    expect(championOf(db.row)).toMatchObject({ l: 2 });

    const heal = await run(yardChampionHealAction);
    expect(heal.status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ hp: 80_000 });
    expect(db.row!.credits).toBe(500 - Number((heal.body.report as Row).credits));
  });

  test("a Shiny-locked account cannot evolve", async () => {
    db.row = rowOf({ credits: 10_000, champion: [{ t: 1, hp: 40_000, l: 1, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    const locked = { ...user, shiny_locked: true } as unknown as User;
    const answer = await runYardAction(em as unknown as EntityManager, locked, yardChampionEvolveAction, {});
    expect(answer.body).toMatchObject({ reason: "shinyLocked" });
  });

  test("rename rejects a malformed body with 400", async () => {
    db.row = rowOf({ champion: [{ t: 1, hp: 40_000, l: 1, ft: getCurrentDateTime() + HOUR, fd: 0, fb: 0, pl: 1, status: 0 }] });
    expect((await run(yardChampionRenameAction, {})).status).toBe(400);
    expect((await run(yardChampionRenameAction, { name: "Kong" })).status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ nm: "Kong" });
  });

  test("freeze then thaw is a round trip through the chamber", async () => {
    const now = getCurrentDateTime();
    const buildings = { ...(rowOf().buildingdata as Row), "4": { id: 4, t: 119, x: 400, y: 0, l: 1 } };
    const gorgo = { t: 1, hp: 80_000, l: 2, ft: now + 5 * HOUR, fd: 3, fb: 0, pl: 1, status: 0 };
    db.row = rowOf({ buildingdata: buildings, champion: [gorgo] });

    expect((await run(yardChampionFreezeAction)).status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ status: 1, fd: 3 });
    expect(JSON.parse(String((db.row!.buildingdata as Record<string, Row>)["4"]!.fz))).toHaveLength(1);

    const thaw = await run(yardChampionThawAction, { type: "1" });
    expect(thaw.status).toBe(200);
    expect(championOf(db.row)).toMatchObject({ status: 0, fd: 3, l: 2 });
    expect(Number(championOf(db.row).ft)).toBeGreaterThanOrEqual(now + 5 * HOUR);
  });
});
