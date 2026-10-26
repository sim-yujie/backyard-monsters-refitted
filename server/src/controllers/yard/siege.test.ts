import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardInstantUpgradeAction } from "./instantUpgrade.js";
import { yardRecycleAction } from "./recycle.js";
import {
  yardSiegeFactoryFinishAction,
  yardSiegeFactoryInstantAction,
  yardSiegeFactoryStartAction,
  yardSiegeLabCancelAction,
  yardSiegeLabFinishAction,
  yardSiegeLabInstantAction,
  yardSiegeLabStartAction,
} from "./siege.js";
import { yardStateAction } from "./state.js";
import { yardUpgradeAction } from "./upgrade.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";

/**
 * The Siege Lab and Factory routes (Inferno WP 6.3) end to end through the
 * real wrapper, the database replaced by one in-memory row written only when
 * the transaction commits (as `lab.test.ts` does).
 */

type Row = Record<string, unknown>;

const db = { row: null as Row | null };

/**
 * What the Inferno lookups find (`withInfernoStanding`): the Descent passed,
 * and an Inferno yard whose Under Hall is level 3, so the Lab may be upgraded.
 */
const INFERNO_BASEID = "9001";
const progressRow = { userid: 2, descent_passed_at: 1, inferno_baseid: INFERNO_BASEID };
const infernoRow = { baseid: INFERNO_BASEID, type: "inferno", buildingdata: { "0": { id: 0, t: 14, l: 3 } } };

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const entity = db.row && structuredClone(db.row);
    const findOne = async (_entity: unknown, where: Record<string, unknown>) =>
      where.type === "inferno" ? infernoRow : "basesaveid" in where || "baseid" in where ? entity : progressRow;
    const fork = { findOne, flush: async () => {} };
    const result = await cb(fork);
    db.row = entity;
    return result;
  },
};

const BASESAVEID = 7;
const LAB = 20;
const FACTORY = 21;

const userOf = (overrides: Partial<User> = {}): User =>
  ({ userid: 2, shiny_locked: false, save: { basesaveid: BASESAVEID }, ...overrides }) as unknown as User;

/**
 * A main yard saved just now: Town Hall 9, a level 2 Siege Lab (id 20), a
 * Siege Factory (id 21); 1,000 Shiny, 500,000 of each Inferno resource
 * (caps 1,000,000), no weapons.
 */
const rowOf = (overrides: Row = {}): Row => ({
  basesaveid: BASESAVEID,
  userid: 2,
  type: "main",
  attackid: 0,
  attacks: [],
  savetime: getCurrentDateTime(),
  credits: 1000,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 },
  iresources: {
    r1: 500_000,
    r2: 500_000,
    r3: 500_000,
    r4: 500_000,
    r1max: 1_000_000,
    r2max: 1_000_000,
    r3max: 1_000_000,
    r4max: 1_000_000,
  },
  siege: {},
  buildingdata: {
    "0": { id: 0, t: 14, X: 0, Y: 0, l: 9 },
    [String(LAB)]: { id: LAB, t: 134, X: 300, Y: 300, l: 2 },
    [String(FACTORY)]: { id: FACTORY, t: 133, X: 400, Y: 400, l: 1 },
  },
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: {},
  researchdata: {},
  outposts: [],
  ...overrides,
});

const call = (
  action: YardAction<z.ZodType, unknown>,
  body: unknown,
  user: User = userOf()
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const purse = () => db.row!.iresources as Record<string, number>;
const siege = () => db.row!.siege as Record<string, Row>;
const building = (id: number) => (db.row!.buildingdata as Record<string, Row>)[String(id)]!;

beforeEach(() => {
  db.row = rowOf();
});

describe("Lab", () => {
  test("start then cancel is reversible: the purse back in full, the Lab idle again", async () => {
    const started = await call(yardSiegeLabStartAction, { weapon: "decoy" });

    expect(started.status).toBe(200);
    expect(started.body.report).toMatchObject({
      site: "lab",
      weapon: "decoy",
      building: LAB,
      cost: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 },
    });
    expect(purse()).toMatchObject({ r1: 500_000 - 37_599, r2: 500_000 - 43_866, r4: 500_000, r1max: 1_000_000 });
    const endsAt = (started.body.report as { endsAt: number }).endsAt;
    expect(building(LAB)).toMatchObject({ unlockingWeapons: { decoy: endsAt } });
    // The surface pool is not touched.
    expect((db.row!.resources as Record<string, number>).r1).toBe(1e9);

    const cancelled = await call(yardSiegeLabCancelAction, {});

    expect(cancelled.status).toBe(200);
    expect(cancelled.body.report).toMatchObject({ refund: { r1: 37_599, r2: 43_866, r3: 43_866, r4: 0 } });
    expect(purse()).toMatchObject({ r1: 500_000, r2: 500_000, r3: 500_000, r4: 500_000 });
    expect(building(LAB)).toEqual({ id: LAB, t: 134, X: 300, Y: 300, l: 2 });
  });

  test("finish charges Shiny and raises the level", async () => {
    await call(yardSiegeLabStartAction, { weapon: "decoy" });
    const finished = await call(yardSiegeLabFinishAction, {});

    expect(finished.status).toBe(200);
    // About 14,400 s left: min(ceil(14,400 × 20 / 3,600), int(sqrt(14,400 × 0.8))) = 80.
    expect(finished.body.report).toMatchObject({ weapon: "decoy", credits: 80, siege: { decoy: { level: 1 } } });
    expect(db.row!.credits).toBe(1000 - 80);
    expect(siege().decoy).toEqual({ level: 1, quantity: 0 });
    expect(building(LAB)).not.toHaveProperty("unlockingWeapons");
  });

  test("instant charges GetInstantBuyCost and takes no resources", async () => {
    const done = await call(yardSiegeLabInstantAction, { weapon: "decoy" });

    expect(done.status).toBe(200);
    expect(done.body.report).toMatchObject({ credits: 143 });
    expect(db.row!.credits).toBe(1000 - 143);
    expect(purse().r1).toBe(500_000);
    expect(siege().decoy).toEqual({ level: 1, quantity: 0 });
  });

  test("a Shiny-locked account is refused and nothing is written", async () => {
    const refused = await call(yardSiegeLabInstantAction, { weapon: "decoy" }, userOf({ shiny_locked: true }));
    expect(refused.body).toMatchObject({ reason: "shinyLocked" });
    expect(siege()).toEqual({});
  });

  test("a shortfall bought with Shiny charges both", async () => {
    db.row = rowOf({ iresources: { ...(rowOf().iresources as Row), r1: 30_000, r3: 40_000 } });
    const asked = await call(yardSiegeLabStartAction, { weapon: "decoy" });
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ reason: "shortfall", topUp: 26 });
    expect(building(LAB)).not.toHaveProperty("unlockingWeapons");

    const bought = await call(yardSiegeLabStartAction, { weapon: "decoy", topUp: 26 });
    expect(bought.status).toBe(200);
    expect(db.row!.credits).toBe(1000 - 26);
    expect(purse()).toMatchObject({ r1: 0, r2: 500_000 - 43_866, r3: 0 });
  });

  test("a malformed body is a 400", async () => {
    expect((await call(yardSiegeLabStartAction, {})).status).toBe(400);
    expect((await call(yardSiegeLabStartAction, { weapon: "catapult" })).status).toBe(400);
    expect((await call(yardSiegeLabStartAction, { weapon: "decoy", topUp: -1 })).status).toBe(400);
  });
});

describe("Factory", () => {
  test("a weapon must be researched first", async () => {
    const refused = await call(yardSiegeFactoryStartAction, { weapon: "decoy" });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ reason: "locked", weapon: "decoy" });
  });

  test("makes one, then holds it until an attack uses it", async () => {
    db.row = rowOf({ siege: { decoy: { level: 1, quantity: 0 }, jars: { level: 2, quantity: 0 } } });
    const started = await call(yardSiegeFactoryStartAction, { weapon: "decoy" });
    expect(started.status).toBe(200);
    expect(purse()).toMatchObject({ r1: 500_000 - 14_324, r2: 500_000 - 28_648 });

    const finished = await call(yardSiegeFactoryFinishAction, {});
    expect(finished.status).toBe(200);
    expect(siege().decoy).toEqual({ level: 1, quantity: 1 });

    const refused = await call(yardSiegeFactoryInstantAction, { weapon: "jars" });
    expect(refused.body).toMatchObject({ reason: "holding", weapon: "decoy" });
  });
});

describe("upgrade and recycle refused while busy", () => {
  test("the Lab researching cannot be upgraded or recycled", async () => {
    await call(yardSiegeLabStartAction, { weapon: "decoy" });

    const upgrade = await call(yardUpgradeAction, { id: String(LAB) });
    expect(upgrade.status).toBe(409);
    expect(upgrade.body).toMatchObject({
      reason: "siegeBusy",
      hold: "unlocking",
      weapon: "decoy",
      error: "You cannot upgrade the Lab while a weapon is being unlocked.",
    });

    const instant = await call(yardInstantUpgradeAction, { id: String(LAB) });
    expect(instant.body).toMatchObject({ reason: "siegeBusy", hold: "unlocking" });

    const recycle = await call(yardRecycleAction, { id: String(LAB) });
    expect(recycle.status).toBe(409);
    expect(recycle.body).toMatchObject({ reason: "siegeBusy", id: LAB, hold: "unlocking", weapon: "decoy" });
    expect(building(LAB)).toMatchObject({ unlockingWeapons: { decoy: expect.any(Number) } });
  });

  test("the Factory holding a weapon cannot be upgraded or recycled", async () => {
    db.row = rowOf({ siege: { vacuum: { level: 1, quantity: 1 } } });

    const recycle = await call(yardRecycleAction, { id: String(FACTORY) });
    expect(recycle.body).toMatchObject({ reason: "siegeBusy", hold: "holding", weapon: "vacuum" });
    expect(building(FACTORY)).toBeDefined();

    const upgrade = await call(yardUpgradeAction, { id: String(FACTORY) });
    expect(upgrade.status).toBe(409);
    expect(upgrade.body).toMatchObject({ reason: "siegeBusy", hold: "holding" });
  });

  test("an idle Lab is upgraded as usual, from the purse, once the Under Hall allows", async () => {
    const before = process.env.INFERNO_ENABLED;
    process.env.INFERNO_ENABLED = "on";
    const many = 5_000_000;
    db.row = rowOf({ iresources: { r1: many, r2: many, r3: many, r4: many, r1max: 2 * many, r2max: 2 * many, r3max: 2 * many, r4max: 2 * many } });
    try {
      const upgrade = await call(yardUpgradeAction, { id: String(LAB) });
      expect(upgrade.status).toBe(200);
      expect(building(LAB)).toMatchObject({ cU: expect.any(Number) });
      expect(purse().r1).toBeLessThan(many);
      expect(db.row!.resources).toEqual({ r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 });
    } finally {
      if (before === undefined) delete process.env.INFERNO_ENABLED;
      else process.env.INFERNO_ENABLED = before;
    }
  });

  test("with the new Inferno off, the Lab's upgrade waits for an Under Hall", async () => {
    const before = process.env.INFERNO_ENABLED;
    process.env.INFERNO_ENABLED = "off";
    try {
      const upgrade = await call(yardUpgradeAction, { id: String(LAB) });
      expect(upgrade.status).toBe(409);
      expect(upgrade.body).toMatchObject({ reason: "underHall" });
    } finally {
      if (before === undefined) delete process.env.INFERNO_ENABLED;
      else process.env.INFERNO_ENABLED = before;
    }
  });
});

describe("catch-up", () => {
  test("a job that ended finishes on the next request and is reported", async () => {
    const now = getCurrentDateTime();
    db.row = rowOf({
      buildingdata: {
        ...(rowOf().buildingdata as Row),
        [String(LAB)]: { id: LAB, t: 134, X: 300, Y: 300, l: 2, unlockingWeapons: { vacuum: now - 5 } },
      },
    });
    const answer = await call(yardStateAction, {});

    expect(answer.body.completed).toEqual([
      { kind: "siege", id: "vacuum", t: 134, at: now - 5, detail: { building: LAB, level: 1, quantity: 0 } },
    ]);
    expect(siege().vacuum).toEqual({ level: 1, quantity: 0 });
    expect(building(LAB)).not.toHaveProperty("unlockingWeapons");

    // …so a cancel after it is refused rather than refunding a finished job.
    const refused = await call(yardSiegeLabCancelAction, {});
    expect(refused.body).toMatchObject({ reason: "notBusy" });
  });
});
