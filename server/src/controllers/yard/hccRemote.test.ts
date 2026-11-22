import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { LockMode, type EntityManager } from "@mikro-orm/core";
import type z from "zod";
import type { User } from "../../database/models/user.model.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import {
  yardHatcheryAddAction,
  yardHatcheryClearAction,
  yardHccOutpostsAction,
  yardHccPresetSaveAction,
  yardHccPresetSendAction,
} from "./hatchery.js";
import { runYardAction, type YardAction, type YardAnswer } from "./yardAction.js";
import { memoryWelcomeStore, useWelcomeStore } from "../../services/events/mr2Welcome.js";

/**
 * The HCC's beta 9 routes end to end through the real wrapper, on a main yard
 * and an outpost held as in-memory rows (as `yardAction.outpost.test.ts`):
 * presets live on the main row whichever yard saves them; level 3 runs an
 * outpost from home only with a level 3 home HCC and an outpost HCC; another
 * player's outpost stays refused.
 */

type Row = Record<string, unknown>;

const db = { rows: new Map<number, Row>() };

const matches = (row: Row, where: Row) =>
  Object.entries(where).every(([key, value]) =>
    value !== null && typeof value === "object" && "$in" in value
      ? (value.$in as unknown[]).includes(row[key])
      : row[key] === value
  );

const em = {
  async transactional<T>(cb: (fork: unknown) => Promise<T>): Promise<T> {
    const read = new Map<number, Row>();
    const fork = {
      async findOne(_entity: unknown, where: Row, _options?: { lockMode?: LockMode }) {
        const found = [...db.rows.values()].find((row) => matches(row, where));
        if (!found) return null;
        const id = found.basesaveid as number;
        const entity = structuredClone(db.rows.get(id)!);
        read.set(id, entity);
        return entity;
      },
      async find(_entity: unknown, where: Row) {
        return [...db.rows.values()].filter((row) => matches(row, where)).map((row) => structuredClone(row));
      },
      async flush() {},
    };
    const result = await cb(fork);
    for (const [id, entity] of read) db.rows.set(id, structuredClone(entity));
    return result;
  },
};

const USERID = 2503;
const MAIN = 7;
const OUTPOST = 90;
const OUTPOST_BASEID = "900";
const BARE = 91;
const BARE_BASEID = "901";
const WORLD = "world-a";

const userOf = (): User =>
  ({ userid: USERID, username: "agenttester", shiny_locked: false, save: { basesaveid: MAIN, baseid: "7" } }) as unknown as User;

const now = () => getCurrentDateTime();

const yardRow = (overrides: Row): Row => ({
  userid: USERID,
  saveuserid: USERID,
  mapversion: 2,
  worldid: WORLD,
  wmid: 0,
  attackid: 0,
  attacks: [],
  damage: 0,
  savetime: now() - 10,
  credits: 1000,
  points: "0",
  flinger: 0,
  catapult: 0,
  buildinghealthdata: {},
  storedata: {},
  monsters: {},
  lockerdata: {},
  academy: {},
  champion: [],
  mushrooms: { l: [], s: now() },
  researchdata: {},
  outposts: [],
  ...overrides,
});

const hcc = (level: number) => ({ id: 6, t: 16, X: 300, Y: 0, l: level });

const mainRow = (level: number): Row =>
  yardRow({
    basesaveid: MAIN,
    baseid: "7",
    type: "main",
    resources: { r1: 0, r2: 0, r3: 0, r4: 1_000_000 },
    buildingdata: {
      "0": { id: 0, t: 14, X: 0, Y: 0, l: 8 },
      "1": { id: 1, t: 13, X: 100, Y: 100, l: 3 },
      "3": { id: 3, t: 6, X: 300, Y: 300, l: 10 },
      "4": { id: 4, t: 15, X: 400, Y: 400, l: 6 },
      ...(level > 0 ? { "6": hcc(level) } : {}),
    },
    lockerdata: { C1: { t: 2 }, C2: { t: 2 } },
    outposts: [
      [241, 208, OUTPOST_BASEID],
      [242, 208, BARE_BASEID],
    ],
  });

const outpostRow = (basesaveid: number, baseid: string, level: number, overrides: Row = {}): Row =>
  yardRow({
    basesaveid,
    baseid,
    type: "outpost",
    credits: 0,
    resources: {},
    buildingdata: {
      "1": { id: 1, t: 112, X: 0, Y: -50, l: 1 },
      "2": { id: 2, t: 15, X: 100, Y: 100, l: 6 },
      "3": { id: 3, t: 13, X: -150, Y: 100, l: 3 },
      ...(level > 0 ? { "6": hcc(level) } : {}),
    },
    ...overrides,
  });

const call = (action: YardAction<z.ZodType, unknown>, body: Row = {}): Promise<YardAnswer> =>
  runYardAction(em as unknown as EntityManager, userOf(), action, body);

const reason = (answer: YardAnswer) => answer.body.reason;
const mainSave = () => db.rows.get(MAIN)!;
const outpostSave = () => db.rows.get(OUTPOST)!;

const setUp = (home: number, outpost = 1) => {
  db.rows = new Map([
    [MAIN, mainRow(home)],
    [OUTPOST, outpostRow(OUTPOST, OUTPOST_BASEID, outpost)],
    [BARE, outpostRow(BARE, BARE_BASEID, 0)],
  ]);
};

const realWelcome = useWelcomeStore(memoryWelcomeStore(0));
afterAll(() => useWelcomeStore(realWelcome));

beforeEach(() => setUp(3));

describe("presets on the main row", () => {
  test("the main yard's and the outposts' lists are both written to the main row, never to the outpost", async () => {
    const home = await call(yardHccPresetSaveAction, { slot: "0", stacks: JSON.stringify([["C1", 30], ["C2", 40], ["C1", 30]]) });
    expect(home.status).toBe(200);
    const out = await call(yardHccPresetSaveAction, { slot: "1", stacks: JSON.stringify([["C2", 20]]), baseid: OUTPOST_BASEID });
    expect(out.status).toBe(200);
    expect(mainSave().hccpresets).toEqual({
      home: [[["C1", 30], ["C2", 40], ["C1", 30]]],
      out: [[], [["C2", 20]]],
    });
    expect(outpostSave().hccpresets).toBeUndefined();
    // Every answer carries the player's presets.
    expect(out.body.hccpresets).toEqual(mainSave().hccpresets);
  });

  test("send charges the main pool and fills the yard's own queue", async () => {
    await call(yardHccPresetSaveAction, { slot: "0", stacks: JSON.stringify([["C1", 30], ["C2", 40]]) });
    const sent = await call(yardHccPresetSendAction, { slot: "0" });
    expect(sent.status).toBe(200);
    expect(sent.body.report).toMatchObject({ added: 70, stoppedBy: null });
    // One hatchery took a Pokey; the rest waits in order, in level 3's stacks of 30.
    expect((mainSave().monsters as Row).hcc).toEqual([
      ["C1", 29, 1],
      ["C2", 30, 1],
      ["C2", 10, 1],
    ]);
    expect((mainSave().resources as Row).r4).toBe(1_000_000 - 30 * 250 - 40 * 500);
  });

  test("a bad stacks field is a 400", async () => {
    expect((await call(yardHccPresetSaveAction, { slot: "0", stacks: "nope" })).status).toBe(400);
    expect((await call(yardHccPresetSaveAction, { slot: "9", stacks: "[]" })).status).toBe(400);
  });
});

describe("level 3 runs outposts from home", () => {
  test("remote add, clear and presets work at level 3 on an outpost with an HCC", async () => {
    const add = await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", baseid: OUTPOST_BASEID, remote: "1" });
    expect(add.status).toBe(200);
    expect((outpostSave().monsters as Row).hcc).toEqual([["C1", 4, 1]]);
    // The answer is the outpost's yard: what the HCC window shows.
    expect(Object.values(add.body.buildingdata as Row).some((b) => (b as Row).t === 112)).toBe(true);
    // A run-from-home outpost offers six presets.
    expect((await call(yardHccPresetSaveAction, { slot: "5", stacks: "[[\"C1\",1]]", baseid: OUTPOST_BASEID, remote: "1" })).status).toBe(200);
    expect((await call(yardHccPresetSendAction, { slot: "5", baseid: OUTPOST_BASEID, remote: "1" })).status).toBe(200);
    expect((await call(yardHatcheryClearAction, { hatchery: "hcc", baseid: OUTPOST_BASEID, remote: "1" })).status).toBe(200);
  });

  test("refused below level 3, on an outpost with no HCC, and on the main yard", async () => {
    setUp(2);
    const low = await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", baseid: OUTPOST_BASEID, remote: "1" });
    expect([low.status, reason(low)]).toEqual([409, "hccLevel"]);
    // Without `remote` (the player is in the outpost) it works as it always did.
    expect((await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", baseid: OUTPOST_BASEID })).status).toBe(200);
    setUp(3);
    const bare = await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", baseid: BARE_BASEID, remote: "1" });
    expect([bare.status, reason(bare)]).toEqual([409, "noOutpostHcc"]);
    const home = await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", remote: "1" });
    expect(home.status).toBe(400);
  });

  test("another player's outpost is refused 403 and nothing is written", async () => {
    db.rows.set(OUTPOST, outpostRow(OUTPOST, OUTPOST_BASEID, 1, { userid: 99, saveuserid: 99 }));
    const before = structuredClone([...db.rows.values()]);
    const answer = await call(yardHatcheryAddAction, { hatchery: "hcc", monster: "C1", count: "5", baseid: OUTPOST_BASEID, remote: "1" });
    expect([answer.status, reason(answer)]).toEqual([403, "notYourYard"]);
    expect([...db.rows.values()]).toEqual(before);
  });

  test("the yard list names each outpost with its HCC level; only at level 3, only on the main yard", async () => {
    const list = await call(yardHccOutpostsAction);
    expect(list.status).toBe(200);
    expect(list.body.report).toEqual({
      yards: [
        { baseid: OUTPOST_BASEID, hcc: 1, queued: 0 },
        { baseid: BARE_BASEID, hcc: 0, queued: 0 },
      ],
    });
    expect(reason(await call(yardHccOutpostsAction, { baseid: OUTPOST_BASEID }))).toBe("notInOutpost");
    setUp(2);
    expect(reason(await call(yardHccOutpostsAction))).toBe("hccLevel");
  });
});
