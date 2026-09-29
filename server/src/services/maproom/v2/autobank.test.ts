import { beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import type { BuildingData } from "../../../types/BuildingData.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { OUTPOST_STORAGE, storageCap } from "../../base/economy/resourceBudget.js";
import {
  autobankOwner,
  autobankTicks,
  autobankYard,
  harvesterIncome,
  incomeHeight,
  outpostIncome,
  payAutobank,
  type AutobankSave,
} from "./autobank.js";

const T0 = 1_800_000_000;
const HOUR = 3600;
const TWO_DAYS = 2 * 24 * HOUR;

/** A harvester of `t` (1 twigs .. 4 goo) at level `l`, full health. */
const harvester = (t: number, l: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id: 1, t, X: 0, Y: 0, l, ...extra }) as BuildingData;

/** Four level-10 harvesters of each of the given types, as one outpost's buildings. */
const fourOf = (...types: number[]) => {
  const buildingdata: Record<string, BuildingData> = {};
  let id = 10;
  for (const t of types) {
    for (let i = 0; i < 4; i += 1) {
      buildingdata[String(id)] = harvester(t, 10, { id });
      id += 1;
    }
  }
  return buildingdata;
};

describe("the rate per 10 s tick (AutoBankManager.as:176-236)", () => {
  test("at height 125 a level 10 harvester makes its produce, 56", () => {
    expect(harvesterIncome(harvester(1, 10), undefined, 125)).toBe(56);
    expect(harvesterIncome(harvester(4, 1), undefined, 125)).toBe(2);
  });

  test("at height 250 it makes half, truncated", () => {
    expect(harvesterIncome(harvester(1, 10), undefined, 250)).toBe(28);
    expect(harvesterIncome(harvester(2, 3), undefined, 250)).toBe(3); // int(7 * 0.5)
  });

  test("never less than 1", () => {
    expect(harvesterIncome(harvester(1, 1), undefined, 300)).toBe(1); // int(2 * 125 / 300) = 0
  });

  test("four level 10 harvesters at height 125 make 80,640 an hour of their resource", () => {
    const rate = outpostIncome({ buildingdata: fourOf(1) }, 125);
    expect(rate).toEqual({ r1: 224, r2: 0, r3: 0, r4: 0 });
    expect(rate.r1 * (HOUR / 10)).toBe(80_640);
  });

  test("each type pays its own resource", () => {
    expect(outpostIncome({ buildingdata: fourOf(1, 2, 3, 4) }, 250)).toEqual({
      r1: 112,
      r2: 112,
      r3: 112,
      r4: 112,
    });
  });

  test("a harvester being upgraded counts at its next level", () => {
    expect(harvesterIncome(harvester(3, 9, { cU: 5000 }), undefined, 125)).toBe(56);
    expect(harvesterIncome(harvester(3, 9), undefined, 125)).toBe(46);
  });

  test("one still being built is level 0, so it makes the minimum 1", () => {
    expect(harvesterIncome(harvester(1, 1, { cB: 300 }), undefined, 125)).toBe(1);
  });

  test("damage does not lower it; no health at all stops it", () => {
    expect(harvesterIncome(harvester(1, 10, { hp: 1 }), 1, 125)).toBe(56);
    expect(harvesterIncome(harvester(1, 10, { hp: 0 }), 0, 125)).toBe(0);

    const rate = outpostIncome(
      {
        buildingdata: { "1": harvester(1, 10, { id: 1 }), "2": harvester(1, 10, { id: 2, hp: 0 }) },
        buildinghealthdata: { "1": 0 },
      },
      125
    );
    expect(rate.r1).toBe(0);
  });

  test("anything but the four harvesters earns nothing", () => {
    expect(harvesterIncome(harvester(6, 5), undefined, 125)).toBe(0);
    expect(harvesterIncome(harvester(112, 1), undefined, 125)).toBe(0);
  });

  test("a cell with no height reads as 100", () => {
    expect(incomeHeight(undefined)).toBe(100);
    expect(incomeHeight(0)).toBe(100);
    expect(incomeHeight(180)).toBe(180);
  });
});

describe("the ticks owed", () => {
  const rate = { r1: 224, r2: 0, r3: 0, r4: 0 };

  test("an hour is 360 ticks", () => {
    const due = autobankTicks(rate, T0 - HOUR, T0);
    expect(due).toEqual({ owed: { r1: 80_640, r2: 0, r3: 0, r4: 0 }, ticks: 360, t: T0 });
  });

  test("the part of a tick not reached yet is kept for next time", () => {
    const due = autobankTicks(rate, T0 - 25, T0);
    expect(due.ticks).toBe(2);
    expect(due.t).toBe(T0 - 5);
    expect(autobankTicks(rate, due.t, T0 + 5).ticks).toBe(1);
  });

  test("at most two days are paid", () => {
    const due = autobankTicks(rate, T0 - 5 * 24 * HOUR, T0);
    expect(due.ticks).toBe(TWO_DAYS / 10);
    expect(due.owed.r1).toBe(224 * (TWO_DAYS / 10));
    expect(due.t).toBe(T0);
  });

  test("Production Overdrive doubles the ticks up to its end", () => {
    // Runs out half an hour in: 180 ticks doubled, 180 plain.
    const due = autobankTicks(rate, T0 - HOUR, T0, T0 - HOUR / 2);
    expect(due.owed.r1).toBe(224 * (180 * 2 + 180));
    // Still running: every tick doubled.
    expect(autobankTicks(rate, T0 - HOUR, T0, T0 + HOUR).owed.r1).toBe(224 * 720);
    // Ran out before the window: none.
    expect(autobankTicks(rate, T0 - HOUR, T0, T0 - 2 * HOUR).owed.r1).toBe(80_640);
  });

  test("no time on record pays nothing and starts the clock", () => {
    expect(autobankTicks(rate, undefined, T0)).toEqual({
      owed: { r1: 0, r2: 0, r3: 0, r4: 0 },
      ticks: 0,
      t: T0,
    });
  });

  test("a time in the future pays nothing and is pulled back to now", () => {
    expect(autobankTicks(rate, T0 + HOUR, T0)).toMatchObject({ ticks: 0, t: T0 });
  });
});

/** A main yard with one outpost listed and `r1` held. */
const mainYard = (r1: number, extra: Partial<AutobankSave> = {}): AutobankSave => ({
  buildingdata: {},
  storedata: {},
  outposts: [[1, 2, "900"]],
  resources: { r1, r2: 0, r3: 0, r4: 0 },
  points: "100",
  buildingresources: { t: T0 - HOUR },
  ...extra,
});

describe("paying it", () => {
  const rates = { "900": { r1: 224, r2: 0, r3: 0, r4: 0 } };

  test("an hour lands in the pool, with ceil(0.375 * paid) points, and t moves to now", () => {
    const main = mainYard(0);
    const report = payAutobank(main, rates, T0);

    expect(report.paid.r1).toBe(80_640);
    expect(report.points).toBe(30_240);
    expect(main.resources!.r1).toBe(80_640);
    expect(main.points).toBe(String(100 + 30_240));
    expect(main.buildingresources).toEqual({ t: T0, b900: { r1: 224, r2: 0, r3: 0, r4: 0 } });
  });

  test("points round up", () => {
    const main = mainYard(0, { buildingresources: { t: T0 - 10 } });
    const report = payAutobank(main, { "900": { r1: 1, r2: 0, r3: 0, r4: 0 } }, T0);
    expect(report.paid.r1).toBe(1);
    expect(report.points).toBe(1); // ceil(0.375)
  });

  test("the storage cap clamps it and the overflow is lost; points count what landed", () => {
    const cap = storageCap(mainYard(0));
    expect(cap).toBe(10_000 + OUTPOST_STORAGE);

    const main = mainYard(cap - 1000);
    const report = payAutobank(main, rates, T0);

    expect(report.paid.r1).toBe(1000);
    expect(report.overflow.r1).toBe(80_640 - 1000);
    expect(main.resources!.r1).toBe(cap);
    expect(report.points).toBe(375);
    expect(main.buildingresources!.t).toBe(T0);
  });

  test("a pool already over the cap keeps what it has and takes nothing", () => {
    const main = mainYard(5_000_000);
    const report = payAutobank(main, rates, T0);
    expect(main.resources!.r1).toBe(5_000_000);
    expect(report.points).toBe(0);
    expect(main.points).toBe("100");
  });

  test("Production Overdrive on the main yard doubles it while it runs", () => {
    const main = mainYard(0, { storedata: { POD: { q: 1, s: T0 - HOUR, e: T0 + HOUR } } });
    expect(payAutobank(main, rates, T0).paid.r1).toBe(161_280);
  });

  test("an overdrive the main yard's catch-up just expired still counts up to its end", () => {
    const main = mainYard(0);
    const completed = [{ kind: "storeItem", id: "POD", t: null, at: T0 - HOUR / 2, detail: {} }];
    expect(payAutobank(main, rates, T0, completed).paid.r1).toBe(224 * 540);
  });

  test("the server's rates replace whatever the column held, stale outposts included", () => {
    const main = mainYard(0, {
      buildingresources: { t: T0 - 10, b900: { r1: 99_999 }, b123: { r1: 5 }, junk: "x" } as JsonObject,
    });
    payAutobank(main, rates, T0);
    expect(main.buildingresources).toEqual({ t: T0, b900: { r1: 224, r2: 0, r3: 0, r4: 0 } });
  });

  test("a second payout at the same moment pays nothing", () => {
    const main = mainYard(0);
    payAutobank(main, rates, T0);
    const again = payAutobank(main, rates, T0);
    expect(again.paid.r1).toBe(0);
    expect(main.resources!.r1).toBe(80_640);
  });

  test("with no outposts it only keeps the clock", () => {
    const main = mainYard(0, { outposts: [] });
    const report = payAutobank(main, {}, T0);
    expect(report.paid.r1).toBe(0);
    expect(main.buildingresources).toEqual({ t: T0 });
  });
});

/* -------------------------------------------------------------------------- */
/* The locked payout, over a stand-in database                                 */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

/**
 * Enough of Postgres for the payout: a `PESSIMISTIC_WRITE` read waits for the
 * row's previous holder to commit and then reads the committed row; writes
 * land on commit.
 */
const db = {
  rows: new Map<number, Row>(),
  cells: [] as Row[],
  tails: new Map<number, Promise<void>>(),
  /** Awaited once after the next locked read of this row, while its lock is held. */
  hold: new Map<number, () => Promise<void>>(),
};

const acquire = (id: number): Promise<() => void> => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const previous = db.tails.get(id) ?? Promise.resolve();
  db.tails.set(id, previous.then(() => held));
  return previous.then(() => release);
};

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "$in" in value
      ? (value.$in as unknown[]).includes(row[key])
      : row[key] === value
  );

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const releases: (() => void)[] = [];
    const read = new Map<number, Row>();
    const fork = {
      async findOne(_entity: unknown, where: Row, options?: { lockMode?: LockMode }) {
        const found = [...db.rows.values()].find((row) => matches(row, where));
        if (!found) return null;
        const id = found.basesaveid as number;
        const locking = options?.lockMode === LockMode.PESSIMISTIC_WRITE;
        if (locking) releases.push(await acquire(id));
        const entity = structuredClone(db.rows.get(id)!);
        read.set(id, entity);
        const hook = db.hold.get(id);
        if (hook && locking) {
          db.hold.delete(id);
          await hook();
        }
        return entity;
      },
      async find(entity: unknown, where: Row) {
        const table = entity === WorldMapCell ? db.cells : [...db.rows.values()];
        return table.filter((row) => matches(row, where)).map((row) => structuredClone(row));
      },
      async flush() {},
    };
    try {
      const result = await cb(fork);
      for (const [id, entity] of read) db.rows.set(id, structuredClone(entity));
      return result;
    } finally {
      for (const release of releases) release();
    }
  },
} as unknown as EntityManager;

const OWNER = 2505;
const MAIN = 2526;

const mainRow = (extra: Row = {}): Row => ({
  basesaveid: MAIN,
  baseid: "2526",
  userid: OWNER,
  saveuserid: OWNER,
  type: "main",
  mapversion: 2,
  attackid: 0,
  attacks: [],
  points: "0",
  buildingdata: {},
  storedata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  outposts: [
    [241, 208, "900"],
    [240, 208, "901"],
  ],
  buildingresources: { t: getCurrentDateTime() - HOUR },
  ...extra,
});

const outpostRow = (basesaveid: number, baseid: string, buildingdata: Row, extra: Row = {}): Row => ({
  basesaveid,
  baseid,
  userid: OWNER,
  saveuserid: OWNER,
  type: "outpost",
  mapversion: 2,
  buildingdata,
  buildinghealthdata: {},
  ...extra,
});

const pool = () => db.rows.get(MAIN)!.resources as Record<string, number>;

beforeEach(() => {
  db.rows = new Map([
    [MAIN, mainRow()],
    [900, outpostRow(900, "900", fourOf(1))],
    [901, outpostRow(901, "901", fourOf(4))],
  ]);
  db.cells = [
    { baseid: "900", map_version: 2, terrainHeight: 125 },
    { baseid: "901", map_version: 2, terrainHeight: 250 },
  ];
  db.tails = new Map();
  db.hold = new Map();
});

describe("autobanking a player", () => {
  test("each outpost at its own cell's height, into the main pool", async () => {
    const report = await autobankOwner(em, OWNER);

    // An hour, give or take the second the test takes: 360 ticks.
    expect(report!.seconds).toBe(HOUR);
    expect(pool()).toEqual({ r1: 224 * 360, r2: 0, r3: 0, r4: 112 * 360 });
    expect(db.rows.get(MAIN)!.buildingresources).toMatchObject({
      b900: { r1: 224, r2: 0, r3: 0, r4: 0 },
      b901: { r1: 0, r2: 0, r3: 0, r4: 112 },
    });
  });

  test("two payouts racing for one player pay the interval once", async () => {
    // The first holds the main row while the second asks for it.
    let second!: Promise<unknown>;
    db.hold.set(MAIN, async () => {
      second = autobankOwner(em, OWNER);
      await Promise.resolve();
    });

    await autobankOwner(em, OWNER);
    await second;

    expect(pool().r1).toBe(224 * 360);
    expect(pool().r4).toBe(112 * 360);
  });

  test("an outpost of someone else's, or on Map Room 3, earns nothing", async () => {
    db.rows.set(900, outpostRow(900, "900", fourOf(1), { saveuserid: 77 }));
    db.rows.set(901, outpostRow(901, "901", fourOf(4), { mapversion: 3 }));

    await autobankOwner(em, OWNER);

    expect(pool()).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(db.rows.get(MAIN)!.buildingresources).toEqual({ t: expect.any(Number) });
  });

  test("the outpost row in hand is used as it stands", async () => {
    const inHand = outpostRow(900, "900", { "1": harvester(2, 10) }) as unknown as Parameters<typeof autobankYard>[4];
    const main = mainRow() as unknown as Parameters<typeof autobankYard>[1];

    await em.transactional((tx) => autobankYard(tx, main, getCurrentDateTime(), [], inHand));

    expect(main.resources).toMatchObject({ r1: 0, r2: 56 * 360 });
  });

  test("a player not on Map Room 2 is left alone", async () => {
    db.rows.set(MAIN, mainRow({ mapversion: 3 }));
    expect(await autobankOwner(em, OWNER)).toBeNull();
    expect(pool().r1).toBe(0);
    expect(db.rows.get(MAIN)!.buildingresources).toEqual({ t: expect.any(Number) });
  });

  test("a main yard under attack is left to that attack", async () => {
    db.rows.set(MAIN, mainRow({ attackid: 5, attacks: [{ starttime: getCurrentDateTime() - 30 }] }));
    expect(await autobankOwner(em, OWNER)).toBeNull();
    expect(pool().r1).toBe(0);
  });
});
