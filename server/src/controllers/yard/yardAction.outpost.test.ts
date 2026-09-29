import { beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { Save } from "../../database/models/save.model.js";
import { WorldMapCell } from "../../database/models/worldmapcell.model.js";
import type { User } from "../../database/models/user.model.js";
import { fortifyStepsOf, OUTPOST_COSTS } from "../../game-data/buildingCosts.js";
import { storageCap } from "../../services/base/economy/resourceBudget.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import { yardAcademyTrainAction } from "./academy.js";
import { yardBankAction } from "./bank.js";
import { yardBuildAction, yardCancelBuildAction } from "./build.js";
import { yardCancelFortifyAction, yardFortifyAction } from "./fortify.js";
import { yardLockerStartAction } from "./locker.js";
import { yardMushroomPickAction } from "./mushrooms.js";
import { yardRecycleAction } from "./recycle.js";
import { yardPlaceDecorationAction } from "./decor.js";
import { yardRepairInstantAction } from "./repair.js";
import { yardShopBuyAction } from "./shopBuy.js";
import { yardStarterKitAction } from "./starterKit.js";
import { yardSpeedupAction } from "./speedup.js";
import { yardStateAction } from "./state.js";
import { yardCancelUpgradeAction, yardUpgradeAction } from "./upgrade.js";
import {
  catchUpLockedOutpost,
  catchUpLockedYard,
  runYardAction,
  type YardAction,
  type YardAnswer,
} from "./yardAction.js";

/**
 * The yard action wrapper on Map Room 2 outposts (outposts WP3, issue #184),
 * with the database replaced by a few in-memory rows.
 *
 * The stand-in behaves like Postgres where it matters: a `PESSIMISTIC_WRITE`
 * read waits for the previous holder of that row to commit or roll back and
 * then reads the committed row; writes land on commit only, all or nothing.
 * A plain `find` reads committed rows and never writes them back.
 */

type Row = Record<string, unknown>;

const db = {
  rows: new Map<number, Row>(),
  /** `world_map_cell` rows, for the outposts' heights. */
  cells: [] as Row[],
  tails: new Map<number, Promise<void>>(),
  /** Every locked read, in order, by `basesaveid`. */
  locked: [] as number[],
  /** Awaited once after the next locked read of this row, while its lock is held. */
  hold: new Map<number, () => Promise<void>>(),
};

/** Takes one row's lock; resolves with its release once every earlier holder let go. */
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
        if (options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
          releases.push(await acquire(id));
          db.locked.push(id);
        }
        const entity = structuredClone(db.rows.get(id)!);
        read.set(id, entity);
        const hook = db.hold.get(id);
        if (hook && options?.lockMode === LockMode.PESSIMISTIC_WRITE) {
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
};

const USERID = 2503;
const MAIN = 7;
const OUTPOST = 90;
const OUTPOST_BASEID = "900";
const WORLD = "world-a";

const userOf = (): User =>
  ({ userid: USERID, shiny_locked: false, save: { basesaveid: MAIN, baseid: "7" } }) as unknown as User;

const now = () => getCurrentDateTime();

const mainRow = (overrides: Row = {}): Row => ({
  basesaveid: MAIN,
  baseid: "7",
  userid: USERID,
  saveuserid: USERID,
  type: "main",
  mapversion: 2,
  worldid: WORLD,
  attackid: 0,
  attacks: [],
  savetime: now() - 10,
  credits: 1000,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: { r1: 1_000_000, r2: 1_000_000, r3: 1_000_000, r4: 1_000_000 },
  buildingdata: { "0": { id: 0, t: 14, X: 0, Y: 0, l: 10 } },
  buildinghealthdata: {},
  // Four bought workers: five on the main yard, still one on an outpost.
  storedata: { BEW: { q: 4 } },
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  // Spawned a moment ago, so the main catch-up springs none under a test's build.
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [[241, 208, OUTPOST_BASEID]],
  ...overrides,
});

/** An outpost with its core, one Housing and one Cannon Tower. */
const outpostRow = (overrides: Row = {}): Row => ({
  basesaveid: OUTPOST,
  baseid: OUTPOST_BASEID,
  userid: USERID,
  saveuserid: USERID,
  type: "outpost",
  mapversion: 2,
  worldid: WORLD,
  wmid: 0,
  attackid: 0,
  attacks: [],
  damage: 0,
  savetime: now() - 10,
  credits: 0,
  points: "0",
  flinger: 0,
  catapult: 0,
  resources: {},
  buildingdata: {
    "1": { id: 1, t: 112, X: 0, Y: -50, l: 1 },
    "2": { id: 2, t: 15, X: 100, Y: 100, l: 1 },
    "3": { id: 3, t: 20, X: -150, Y: 100, l: 1 },
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
  body: Row = {},
  user: User = userOf()
): Promise<YardAnswer> => runYardAction(em as unknown as EntityManager, user, action, body);

const onOutpost = (action: YardAction<z.ZodType, unknown>, body: Row = {}) =>
  call(action, { ...body, baseid: OUTPOST_BASEID });

const mainSave = () => db.rows.get(MAIN)!;
const outpostSave = () => db.rows.get(OUTPOST)!;
const buildings = (row: Row) => row.buildingdata as Record<string, Row>;
const pool = () => mainSave().resources as Record<string, number>;

const stepOf = (type: number, level = 0) => {
  const [r1, r2, r3, r4, time] = OUTPOST_COSTS[type]!.costs[level]!;
  return { r1, r2, r3, r4, time };
};

beforeEach(() => {
  db.rows = new Map([
    [MAIN, mainRow()],
    [OUTPOST, outpostRow()],
  ]);
  db.cells = [{ baseid: OUTPOST_BASEID, map_version: 2, terrainHeight: 125 }];
  db.tails = new Map();
  db.locked = [];
  db.hold = new Map();
});

describe("which yard a request acts on", () => {
  test("no baseid: the main yard, exactly as before, and the outpost row is never read", async () => {
    const answer = await call(yardBuildAction, { type: 20, x: 200, y: 200 });

    expect(answer.status).toBe(200);
    expect(db.locked).toEqual([MAIN]);
    expect(Object.values(buildings(mainSave())).some((b) => b.t === 20)).toBe(true);
    expect(outpostSave()).toEqual(outpostRow({ savetime: outpostSave().savetime }));
  });

  test("the main yard's own baseid is the main yard", async () => {
    const answer = await call(yardStateAction, { baseid: "7" });
    expect(answer.status).toBe(200);
    expect(db.locked).toEqual([MAIN]);
  });

  test("an outpost locks the main row first, then the outpost row", async () => {
    const answer = await onOutpost(yardStateAction);
    expect(answer.status).toBe(200);
    expect(db.locked).toEqual([MAIN, OUTPOST]);
  });

  test("another player's outpost is refused 403 notYourYard, and nothing is written", async () => {
    db.rows.set(OUTPOST, outpostRow({ userid: 99, saveuserid: 99 }));
    const before = structuredClone([...db.rows.values()]);

    const answer = await onOutpost(yardBuildAction, { type: 20, x: 250, y: -200 });

    expect(answer.status).toBe(403);
    expect(answer.body.reason).toBe("notYourYard");
    expect([...db.rows.values()]).toEqual(before);
  });

  test("an outpost missing from the main yard's list, in another world, or on Map Room 3 is refused", async () => {
    db.rows.set(MAIN, mainRow({ outposts: [] }));
    expect((await onOutpost(yardStateAction)).body.reason).toBe("notYourYard");

    db.rows.set(MAIN, mainRow());
    db.rows.set(OUTPOST, outpostRow({ worldid: "world-b" }));
    expect((await onOutpost(yardStateAction)).body.reason).toBe("notYourYard");

    db.rows.set(OUTPOST, outpostRow({ mapversion: 3 }));
    expect((await onOutpost(yardStateAction)).body.reason).toBe("notYourYard");

    expect((await call(yardStateAction, { baseid: "12345" })).body.reason).toBe("notYourYard");
  });

  test("a baseid that is not a whole number is a 400", async () => {
    const answer = await call(yardStateAction, { baseid: "abc" });
    expect(answer.status).toBe(400);
    expect(answer.body.reason).toBe("badRequest");
  });

  test("an attack on the outpost, or on the main yard, refuses 409 underAttack", async () => {
    const attack = { attackid: 5, attacks: [{ starttime: now() - 30 }] };

    db.rows.set(OUTPOST, outpostRow(attack));
    expect((await onOutpost(yardStateAction)).body.reason).toBe("underAttack");

    db.rows.set(OUTPOST, outpostRow());
    db.rows.set(MAIN, mainRow(attack));
    expect((await onOutpost(yardStateAction)).body.reason).toBe("underAttack");
  });
});

describe("the one pool", () => {
  test("a build on an outpost charges the main pool, and the building is the outpost's", async () => {
    const cost = stepOf(20);
    const answer = await onOutpost(yardBuildAction, { type: 20, x: 250, y: -200 });

    expect(answer.status).toBe(200);
    expect(pool()).toEqual({
      r1: 1_000_000 - cost.r1,
      r2: 1_000_000 - cost.r2,
      r3: 1_000_000 - cost.r3,
      r4: 1_000_000 - cost.r4,
    });
    expect(outpostSave().resources).toEqual({});
    const id = (answer.body.report as { id: number }).id;
    expect(buildings(outpostSave())[String(id)]).toMatchObject({ t: 20, cB: cost.time });
    expect(buildings(mainSave())[String(id)]).toBeUndefined();
  });

  test("the answer carries the main pool and caps and the outpost's buildings", async () => {
    const answer = await onOutpost(yardStateAction);
    const cap = storageCap(mainRow() as Parameters<typeof storageCap>[0]);

    expect(answer.body.resources).toEqual(mainRow().resources);
    expect(answer.body.caps).toEqual({ r1: cap, r2: cap, r3: cap, r4: cap });
    expect(answer.body.credits).toBe(1000);
    expect(answer.body.buildingdata).toEqual(buildings(outpostRow()));
    expect(answer.body.workers).toEqual({ total: 1, busy: 0 });
  });

  test("a refund lands in the main pool under the main cap", async () => {
    await onOutpost(yardUpgradeAction, { id: 3 });
    const step = stepOf(20, 1);
    expect(pool().r1).toBe(1_000_000 - step.r1);

    const answer = await onOutpost(yardCancelUpgradeAction, { id: 3 });
    expect(answer.status).toBe(200);
    expect(pool().r1).toBe(1_000_000);
    expect(buildings(outpostSave())["3"]!.cU).toBeUndefined();
  });

  test("a shortfall is measured against the main pool", async () => {
    db.rows.set(MAIN, mainRow({ resources: { r1: 10, r2: 10, r3: 10, r4: 10 } }));
    db.rows.set(OUTPOST, outpostRow({ resources: { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 } }));

    const answer = await onOutpost(yardBuildAction, { type: 20, x: 250, y: -200 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("shortfall");
  });

  test("two actions racing on the main yard and an outpost cannot spend the pool twice", async () => {
    const cost = stepOf(20);
    // Enough for one cannon, not two.
    db.rows.set(MAIN, mainRow({ resources: { r1: cost.r1, r2: cost.r2, r3: cost.r3, r4: 0 } }));

    // The main-yard build holds the main row while the outpost build queues behind it.
    let releaseMain!: () => void;
    const mainHeld = new Promise<void>((resolve) => (releaseMain = resolve));
    db.hold.set(MAIN, () => mainHeld);

    const onMain = call(yardBuildAction, { type: 20, x: 200, y: 200 });
    const onOut = onOutpost(yardBuildAction, { type: 20, x: 250, y: -200 });
    await Promise.resolve();
    releaseMain();

    const [first, second] = await Promise.all([onMain, onOut]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe("shortfall");
    expect(pool()).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });
});

describe("outpost build rules", () => {
  test("one worker: a second job is refused, whatever workers were bought", async () => {
    expect((await onOutpost(yardUpgradeAction, { id: 3 })).status).toBe(200);

    const second = await onOutpost(yardBuildAction, { type: 21, x: 250, y: -200 });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe("workers");
    expect(second.body.workers).toEqual({ total: 1, busy: 1 });
  });

  test("the fifth cannon is refused", async () => {
    const withCannons: Record<string, Row> = { ...buildings(outpostRow()) };
    for (const id of [4, 5, 6]) withCannons[String(id)] = { id, t: 20, X: -300 + id * 60, Y: 300, l: 1 };
    db.rows.set(OUTPOST, outpostRow({ buildingdata: withCannons }));

    const answer = await onOutpost(yardBuildAction, { type: 20, x: 250, y: -200 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("limit");
    expect(answer.body.limit).toEqual({ have: 4, allowed: 4, next: null });
  });

  test("a type the outpost table blocks is not buildable (a Storage Silo)", async () => {
    const answer = await onOutpost(yardBuildAction, { type: 6, x: 250, y: -200 });
    expect(answer.status).toBe(400);
    expect(answer.body.reason).toBe("notBuildable");
  });

  test("the Juicer needs a Housing", async () => {
    const noHousing = { ...buildings(outpostRow()) };
    delete noHousing["2"];
    db.rows.set(OUTPOST, outpostRow({ buildingdata: noHousing }));

    const answer = await onOutpost(yardBuildAction, { type: 9, x: 250, y: -200 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("requirements");
    expect(answer.body.requirements).toEqual([[15, 1, 1]]);
  });

  test("the core cannot be upgraded", async () => {
    const answer = await onOutpost(yardUpgradeAction, { id: 1 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("maxLevel");
    expect(answer.body.error).toBe("The outpost can not be upgraded.");
  });

  test("an upgrade stops at the outpost ladder's top (a Laser Tower at 6)", async () => {
    db.rows.set(
      OUTPOST,
      outpostRow({ buildingdata: { ...buildings(outpostRow()), "9": { id: 9, t: 23, X: 300, Y: -300, l: 6 } } })
    );
    const answer = await onOutpost(yardUpgradeAction, { id: 9 });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("maxLevel");
    expect(answer.body.max).toBe(6);
  });
});

describe("routes Flash refuses in an outpost", () => {
  const cases: [string, YardAction<z.ZodType, unknown>, Row, string][] = [
    ["recycle", yardRecycleAction, { id: 3 }, "You cannot Recycle buildings in Outposts."],
    [
      "build/cancel",
      yardCancelBuildAction,
      { id: 3 },
      "You cannot stop the construction of a building in your Outposts.",
    ],
    ["bank", yardBankAction, { all: 1 }, "Outposts bank automatically (Auto-Banking)."],
    ["academy/train", yardAcademyTrainAction, { monster: "C1", academy: 3 }, "That cannot be done in an outpost."],
    ["locker/start", yardLockerStartAction, { monster: "C5" }, "That cannot be done in an outpost."],
    ["mushroom/pick", yardMushroomPickAction, { id: 0 }, "That cannot be done in an outpost."],
    ["decor/place", yardPlaceDecorationAction, { type: 28, x: 0, y: 0 }, "Decorations go in your main yard."],
  ];

  for (const [name, action, body, message] of cases) {
    test(`${name} is refused 409 notInOutpost, and nothing is written`, async () => {
      const before = structuredClone([...db.rows.values()]);
      const answer = await onOutpost(action, body);

      expect(answer.status).toBe(409);
      expect(answer.body.reason).toBe("notInOutpost");
      expect(answer.body.error).toBe(message);
      expect([...db.rows.values()]).toEqual(before);
    });
  }

  test("the store sells an outpost only its own list: no extra worker", async () => {
    for (const item of ["BEW", "BIP", "ENL", "CLOD", "PRO1", "PRO2", "PRO3"]) {
      const refused = await onOutpost(yardShopBuyAction, { item });
      expect(refused.status).toBe(400);
      expect(refused.body.reason).toBe("notForSale");
    }

    const production = await onOutpost(yardShopBuyAction, { item: "POD" });
    expect(production.status).toBe(200);
    expect((outpostSave().storedata as Row).POD).toBeDefined();

    const overdrive = await onOutpost(yardShopBuyAction, { item: "HOD" });
    expect(overdrive.status).toBe(200);
    expect((outpostSave().storedata as Row).HOD).toBeDefined();
    expect((mainSave().storedata as Row).HOD).toBeUndefined();
    expect(mainSave().credits).toBe(
      1000 -
        (production.body.report as { credits: number }).credits -
        (overdrive.body.report as { credits: number }).credits,
    );
  });
});

describe("fortify", () => {
  test("the core fortifies F1 on the main pool, holding the worker", async () => {
    const [r1, r2, r3, , time] = fortifyStepsOf(112, "outpost")[0]!;
    const answer = await onOutpost(yardFortifyAction, { id: 1 });

    expect(answer.status).toBe(200);
    expect(answer.body.report).toMatchObject({ id: 1, from: 0, to: 1, seconds: time });
    expect(buildings(outpostSave())["1"]).toMatchObject({ cF: time });
    expect(pool()).toMatchObject({ r1: 1_000_000 - r1, r2: 1_000_000 - r2, r3: 1_000_000 - r3 });
    expect(answer.body.workers).toEqual({ total: 1, busy: 1 });
  });

  test("the catch-up finishes it: fort 1 and Fortified()'s points on the main yard", async () => {
    const [r1, r2, r3, r4, time] = fortifyStepsOf(112, "outpost")[0]!;
    const core = { id: 1, t: 112, X: 0, Y: -50, l: 1, cF: 5 };
    db.rows.set(OUTPOST, outpostRow({ buildingdata: { ...buildings(outpostRow()), "1": core } }));

    const answer = await onOutpost(yardStateAction);

    expect(buildings(outpostSave())["1"]).toEqual({ id: 1, t: 112, X: 0, Y: -50, l: 1, fort: 1 });
    expect(answer.body.completed).toEqual([
      expect.objectContaining({ kind: "fortify", id: 1, detail: expect.objectContaining({ fort: 1 }) }),
    ]);
    expect(mainSave().points).toBe(String(Math.floor((time + r1 + r2 + r3 + r4) / 3)));
    expect(outpostSave().points).toBe("0");
  });

  test("cancel refunds the step into the main pool", async () => {
    await onOutpost(yardFortifyAction, { id: 1 });
    const answer = await onOutpost(yardCancelFortifyAction, { id: 1 });

    expect(answer.status).toBe(200);
    expect(pool()).toEqual(mainRow().resources as Record<string, number>);
    expect(buildings(outpostSave())["1"]!.cF).toBeUndefined();
  });

  test("a fortification can be finished with SP4", async () => {
    await onOutpost(yardFortifyAction, { id: 1 });
    const answer = await onOutpost(yardSpeedupAction, { id: 1, item: "SP4" });

    expect(answer.status).toBe(200);
    expect(buildings(outpostSave())["1"]).toMatchObject({ fort: 1 });
    expect(buildings(outpostSave())["1"]!.cF).toBeUndefined();
  });

  test("a fully fortified building and a Housing are refused", async () => {
    db.rows.set(
      OUTPOST,
      outpostRow({ buildingdata: { ...buildings(outpostRow()), "1": { id: 1, t: 112, X: 0, Y: -50, l: 1, fort: 4 } } })
    );
    const full = await onOutpost(yardFortifyAction, { id: 1 });
    expect(full.body.reason).toBe("maxFortify");

    const housing = await onOutpost(yardFortifyAction, { id: 2 });
    expect(housing.status).toBe(400);
    expect(housing.body.reason).toBe("notFortifiable");
  });

  test("a main yard has nothing to fortify", async () => {
    const answer = await call(yardFortifyAction, { id: 0 });
    expect(answer.status).toBe(400);
    expect(answer.body.reason).toBe("notFortifiable");
  });
});

describe("outpost catch-up", () => {
  test("an action catches the outpost up first: a finished build stands", async () => {
    db.rows.set(
      OUTPOST,
      outpostRow({
        savetime: now() - 100,
        buildingdata: { ...buildings(outpostRow()), "4": { id: 4, t: 21, X: 200, Y: 200, cB: 30, cL: 30 } },
      })
    );

    const answer = await onOutpost(yardStateAction);

    expect(buildings(outpostSave())["4"]).toEqual({ id: 4, t: 21, X: 200, Y: 200 });
    const [r1, r2, r3, r4, time] = OUTPOST_COSTS[21]!.costs[0]!;
    expect(answer.body.completed).toEqual([expect.objectContaining({ kind: "build", id: 4 })]);
    expect(mainSave().points).toBe(String(Math.floor(time / 2 + (r1 + r2 + r3 + r4) / 10)));
    expect(outpostSave().savetime).toBe(answer.body.currenttime as number);
  });

  test("damage drops after a paid repair", async () => {
    db.rows.set(
      OUTPOST,
      outpostRow({
        damage: 60,
        buildingdata: { ...buildings(outpostRow()), "3": { id: 3, t: 20, X: -150, Y: 100, l: 1, hp: 10 } },
        buildinghealthdata: { "3": 10 },
      })
    );

    const answer = await onOutpost(yardRepairInstantAction);

    expect(answer.status).toBe(200);
    expect(buildings(outpostSave())["3"]!.hp).toBeUndefined();
    expect(outpostSave().damage).toBe(0);
  });

  test("the owner's load gives an empty outpost its core, and writes it", async () => {
    db.rows.set(OUTPOST, outpostRow({ buildingdata: {} }));

    const { save, completed } = await catchUpLockedOutpost(
      em as unknown as EntityManager,
      userOf(),
      outpostRow() as unknown as Save
    );

    expect(completed).toEqual([]);
    expect(db.locked).toEqual([MAIN, OUTPOST]);
    expect(buildings(outpostSave())).toEqual({ "1": { id: 1, t: 112, X: 0, Y: -50, l: 1 } });
    expect(buildings(save as unknown as Row)).toEqual(buildings(outpostSave()));
  });

  test("the owner's load of an outpost under attack is not caught up", async () => {
    db.rows.set(OUTPOST, outpostRow({ buildingdata: {}, attackid: 5, attacks: [{ starttime: now() - 30 }] }));
    const row = outpostRow({ buildingdata: {} }) as unknown as Save;

    const { save, completed } = await catchUpLockedOutpost(em as unknown as EntityManager, userOf(), row);

    expect(save).toBe(row);
    expect(completed).toEqual([]);
    expect(buildings(outpostSave())).toEqual({});
  });
});

describe("outpost income (outposts WP4, issue #185)", () => {
  const HOUR = 3600;
  /** Four level 10 Twig Snappers at height 125: 224 twigs a tick, 80,640 an hour. */
  const HOURLY = 224 * 360;

  const snappers = (level = 10) =>
    Object.fromEntries(
      [10, 11, 12, 13].map((id) => [String(id), { id, t: 1, X: -200 + id * 40, Y: -250, l: level }])
    );

  beforeEach(() => {
    db.rows.set(MAIN, mainRow({ buildingresources: { t: now() - HOUR } }));
    db.rows.set(OUTPOST, outpostRow({ buildingdata: { ...buildings(outpostRow()), ...snappers() } }));
  });

  const paidOnce = () => {
    expect(pool().r1).toBe(1_000_000 + HOURLY);
    expect(pool().r2).toBe(1_000_000);
    expect(mainSave().points).toBe(String(Math.ceil(HOURLY * 0.375)));
    expect(mainSave().buildingresources).toEqual({
      t: expect.any(Number),
      b900: { r1: 224, r2: 0, r3: 0, r4: 0 },
    });
    expect(now() - ((mainSave().buildingresources as Row).t as number)).toBeLessThan(10);
  };

  test("the yard state on an outpost pays the hour into the main pool", async () => {
    const answer = await onOutpost(yardStateAction);
    expect(answer.status).toBe(200);
    paidOnce();
    expect((answer.body.resources as Row).r1).toBe(1_000_000 + HOURLY);
  });

  test("the yard state on the main yard pays it too", async () => {
    await call(yardStateAction);
    paidOnce();
  });

  test("the owner's load of an outpost pays it", async () => {
    await catchUpLockedOutpost(em as unknown as EntityManager, userOf(), outpostSave() as unknown as Save);
    paidOnce();
  });

  test("the owner's load of the main yard pays it", async () => {
    await catchUpLockedYard(em as unknown as EntityManager, mainSave() as unknown as Save);
    paidOnce();
  });

  test("a load racing an action pays the hour once", async () => {
    let load!: Promise<unknown>;
    db.hold.set(MAIN, async () => {
      load = catchUpLockedOutpost(em as unknown as EntityManager, userOf(), outpostSave() as unknown as Save);
      await Promise.resolve();
    });

    await onOutpost(yardStateAction);
    await load;

    paidOnce();
  });

  test("income lands before the action decides: an upgrade pays the hour at the old level", async () => {
    db.rows.set(OUTPOST, outpostRow({ buildingdata: { ...buildings(outpostRow()), ...snappers(9) } }));

    expect((await onOutpost(yardUpgradeAction, { id: 10 })).status).toBe(200);
    // Level 9 makes 46 a tick; the snapper being upgraded counts at 10 from here on.
    expect(pool().r1).toBe(1_000_000 + 4 * 46 * 360);

    db.rows.set(MAIN, { ...mainSave(), buildingresources: { t: now() - HOUR } });
    await onOutpost(yardStateAction);
    expect(pool().r1).toBe(1_000_000 + 4 * 46 * 360 + (56 + 3 * 46) * 360);
  });
});

describe("Starter Kits (outposts WP9, issue #188)", () => {
  const RICH = { r1: 20_000_000, r2: 20_000_000, r3: 20_000_000, r4: 7 };

  test("a Regular kit paid with resources: the main pool pays, the outpost gets prefabs", async () => {
    db.rows.set(MAIN, mainRow({ resources: RICH }));
    const answer = await onOutpost(yardStarterKitAction, { kit: 1, pay: "resources" });

    expect(answer.status).toBe(200);
    expect(pool()).toMatchObject({ r1: 8_000_000, r2: 8_000_000, r3: 14_000_000, r4: 7 });
    expect(mainSave().credits).toBe(1000);
    const after = Object.values(buildings(outpostSave()));
    expect(after).toHaveLength(113);
    expect(after.filter((b) => b.t !== 112).every((b) => Number(b.cB) > 0 && Number(b.prefab) > 0)).toBe(true);
    // The kit's prefabs hold no worker: the answer says the one worker is free.
    expect(answer.body.workers).toEqual({ total: 1, busy: 0 });
  });

  test("a normal build after the kit still takes the outpost's one worker", async () => {
    db.rows.set(MAIN, mainRow({ resources: RICH }));
    await onOutpost(yardStarterKitAction, { kit: 1, pay: "resources" });

    const build = await onOutpost(yardBuildAction, { type: 20, x: 300, y: 250 });
    expect(build.status).toBe(200);
    expect(build.body.workers).toEqual({ total: 1, busy: 1 });

    const second = await onOutpost(yardBuildAction, { type: 21, x: -350, y: 250 });
    expect(second.status).toBe(409);
    expect(second.body.reason).toBe("workers");
  });

  test("paid with Shiny: the main yard's Shiny, the buildings finished", async () => {
    const answer = await onOutpost(yardStarterKitAction, { kit: 1, pay: "shiny" });

    expect(answer.status).toBe(200);
    expect(mainSave().credits).toBe(1000 - 420);
    expect(pool()).toMatchObject({ r1: 1_000_000, r2: 1_000_000, r3: 1_000_000 });
    expect(Object.values(buildings(outpostSave())).some((b) => b.cB !== undefined)).toBe(false);
  });

  test("a short pool is refused with the top-up, and nothing is written", async () => {
    const before = structuredClone([...db.rows.values()]);
    const answer = await onOutpost(yardStarterKitAction, { kit: 1, pay: "resources" });

    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("shortfall");
    expect(answer.body.topUp).toBeGreaterThan(0);
    expect([...db.rows.values()]).toEqual(before);
  });

  test("a damaged outpost's damage drops with the kit, so the map shows it at once", async () => {
    db.rows.set(
      OUTPOST,
      outpostRow({
        damage: 95,
        buildinghealthdata: { "1": 10_000, "2": 0, "3": 0 },
      })
    );
    const answer = await onOutpost(yardStarterKitAction, { kit: 1, pay: "shiny" });

    expect(answer.status).toBe(200);
    expect(outpostSave().damage).toBe(0);
    expect(outpostSave().buildinghealthdata).toEqual({});
  });

  test("the main yard has no kits", async () => {
    const answer = await call(yardStarterKitAction, { kit: 1, pay: "shiny" });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("notOutpost");
  });
});
