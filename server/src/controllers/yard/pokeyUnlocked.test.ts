import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import { devConfig } from "../../config/GameConfig.js";
import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardHatcheryAddAction } from "./hatchery.js";
import { yardLockerStartAction } from "./locker.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Pokey is always unlocked (issue #218): a brand-new player can hatch
 * Pokeys from their first Hatchery, as in Flash (`CREATURELOCKER.as:65`).
 *
 * The yard is built the way sign-up builds it (`Save.createMainSave`: the
 * entity's defaults, then `getDefaultBaseData` for a normal start, no
 * sandbox), then given a Hatchery, a Housing and goo, and driven through the
 * real yard wrapper with the database replaced by one in-memory row (as
 * `hatchery.test.ts` does).
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const entity = db.row && structuredClone(db.row);
    const fork = { findOne: async () => entity, flush: async () => {} };
    const result = await cb(fork);
    db.row = entity;
    return result;
  },
};

const BASESAVEID = 9;

const user = {
  userid: 3,
  username: "zz_newbie",
  sandbox_start: false,
  shiny_locked: false,
  save: { basesaveid: BASESAVEID },
} as unknown as User;

/** A fresh normal-start main save, as `Save.createMainSave` makes it. */
const freshSave = (): Row => ({
  ...structuredClone({ ...new Save() }),
  ...structuredClone(getDefaultBaseData(user, BaseType.MAIN)),
  basesaveid: BASESAVEID,
  type: "main",
  attackid: 0,
  attacks: [],
  points: "0",
  outposts: [],
  savetime: getCurrentDateTime(),
});

/** The fresh save with a Hatchery, a Housing and 10,000 goo, so a hatch can go in. */
const withHatchery = (save: Row): Row => ({
  ...save,
  buildingdata: {
    ...(save.buildingdata as Row),
    "10": { id: 10, t: 13, X: 200, Y: 200, l: 1 },
    "11": { id: 11, t: 15, X: -200, Y: 200, l: 1 },
  },
  resources: { ...(save.resources as Row), r4: 10_000 },
});

const call = (action: YardAction<z.ZodType, unknown>, body: unknown): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, user, action, body);

const sandbox = devConfig.devSandbox;

beforeEach(() => {
  devConfig.devSandbox = false;
});

afterEach(() => {
  devConfig.devSandbox = sandbox;
});

describe("a brand-new player and the Pokey", () => {
  test("a new main save starts with the Pokey unlocked, and nothing else", () => {
    expect(freshSave().lockerdata).toEqual({ C1: { t: 2 } });
  });

  test("hatches Pokeys from the first Hatchery", async () => {
    db.row = withHatchery(freshSave());
    const answer = await call(yardHatcheryAddAction, { hatchery: 10, monster: "C1", count: 4 });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ monster: "C1", added: 4 });
    expect((db.row.resources as Row).r4).toBe(10_000 - 4 * 250);
  });

  test("every other monster is still locked", async () => {
    db.row = withHatchery(freshSave());
    for (const monster of ["C2", "C3", "C5", "C12"]) {
      expect(await call(yardHatcheryAddAction, { hatchery: 10, monster, count: 1 })).toMatchObject({
        status: 409,
        body: { reason: "locked", monster },
      });
    }
  });

  test("an existing save with an empty locker gets the Pokey on its next catch-up, and keeps it", async () => {
    db.row = withHatchery({ ...freshSave(), lockerdata: {} });
    const answer = await call(yardHatcheryAddAction, { hatchery: 10, monster: "C1", count: 1 });

    expect(answer.status).toBe(200);
    expect(answer.body.lockerdata).toEqual({ C1: { t: 2 } });
    expect(db.row.lockerdata).toEqual({ C1: { t: 2 } });
  });

  test("an existing save's other locker entries are left alone", async () => {
    const running = { t: 1, s: getCurrentDateTime(), e: getCurrentDateTime() + 600 };
    db.row = withHatchery({ ...freshSave(), lockerdata: { C2: { t: 2 }, C4: running } });
    await call(yardHatcheryAddAction, { hatchery: 10, monster: "C1", count: 1 });

    expect(db.row.lockerdata).toEqual({ C1: { t: 2 }, C2: { t: 2 }, C4: running });
  });

  test("the Monster Locker refuses to unlock the Pokey again", async () => {
    db.row = { ...freshSave(), lockerdata: {} };
    expect(await call(yardLockerStartAction, { monster: "C1" })).toMatchObject({
      status: 409,
      body: { reason: "alreadyUnlocked", monster: "C1" },
    });
  });
});
