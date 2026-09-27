import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * The attack save's `monsterupdate` (§4.6): the save that ends the attack
 * takes the flung monsters out of the attacker's caught-up yards and never
 * writes the client's blobs. Rows are plain objects behind a stand-in ORM.
 */

const HOME = "2000241207";
const OUTPOST = "2000240207";
const ATTACKER = 2505;

let userSave: Record<string, any>;
let outpost: Record<string, any>;
const persisted: unknown[] = [];

mock.module("../../../../server.js", () => ({
  redis: {},
  postgres: {
    em: {
      find: async (_entity: unknown, where: { baseid: { $in: string[] }; saveuserid: number }) =>
        where.baseid.$in.includes(OUTPOST) && where.saveuserid === ATTACKER ? [outpost] : [],
      findOne: async () => null,
      persist: (row: unknown) => persisted.push(row),
    },
  },
}));

const { monsterUpdateHandler } = await import("./monsterUpdateHandler.js");

const NOW = 1_800_000_000;

/** Four Housing L6 (2,160), one L3 hatchery producing Pokeys (15 s at level 1). */
const home = () => ({
  baseid: HOME,
  saveuserid: ATTACKER,
  type: "main",
  savetime: NOW - 60,
  buildingdata: {
    "1": { id: 1, t: 15, l: 6 },
    "2": { id: 2, t: 15, l: 6 },
    "3": { id: 3, t: 15, l: 6 },
    "4": { id: 4, t: 15, l: 6 },
    "9": { id: 9, t: 13, l: 3 },
  },
  storedata: {},
  academy: { C1: { level: 1 } },
  resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
  monsters: { saved: NOW - 60, housed: { C1: 100 }, h: [["C1", 15, [["C1", 10, 1]]]], hid: [9], hstage: [1], hcc: [] },
});

const session = (entryHoused?: Record<string, Record<string, number>>) => ({
  attackerid: ATTACKER,
  attackid: 1,
  startedat: NOW - 60,
  ...(entryHoused && { entryHoused }),
});

const log = (C1: number) => ({ v: 1, seed: 1, events: [{ kind: "fling", t: 10, x: 0, y: 0, r: 1, monsters: { C1 } }] });

beforeEach(() => {
  persisted.length = 0;
  userSave = home();
  outpost = { baseid: OUTPOST, saveuserid: ATTACKER, type: "outpost", protected: 99, buildingdata: {}, monsters: { housed: { C1: 30 } } };
});

describe("monsterUpdateHandler — Map Room 2", () => {
  test("takes the logged flings from the yard as caught up now, keeping what hatched meanwhile", async () => {
    await monsterUpdateHandler(
      [{ baseid: Number(HOME), m: { housed: { C1: 90 }, h: [], saved: 1 } } as never],
      userSave as never,
      { session: session({ [HOME]: { C1: 102 } }), finalises: true, flinglog: log(10), now: NOW }
    );

    // 60 s of production: 15, 30, 45, 60 → 4 Pokeys; 100 + 4 − 10 flung.
    expect(userSave.monsters.housed).toEqual({ C1: 94 });
    // The server's production state, not the client's blob.
    expect(userSave.monsters.saved).toBe(NOW);
    expect(userSave.monsters.h).toEqual([["C1", 15, [["C1", 6, 1]], 1]]);
  });

  test("a sent count above what the yard had adds nothing", async () => {
    await monsterUpdateHandler(
      [{ baseid: HOME, m: { housed: { C1: 5000 } } } as never],
      userSave as never,
      { session: session({ [HOME]: { C1: 100 } }), finalises: true, flinglog: undefined, now: NOW }
    );

    expect(userSave.monsters.housed).toEqual({ C1: 104 });
  });

  test("without a log: entry minus sent leaves, from the caught-up yard", async () => {
    await monsterUpdateHandler(
      [
        { baseid: HOME, m: { housed: { C1: 93 } } } as never,
        { baseid: OUTPOST, m: { housed: { C1: 25 } } } as never,
      ],
      userSave as never,
      { session: session({ [HOME]: { C1: 100 }, [OUTPOST]: { C1: 30 } }), finalises: true, flinglog: undefined, now: NOW }
    );

    expect(userSave.monsters.housed).toEqual({ C1: 97 });
    expect(outpost.monsters.housed).toEqual({ C1: 25 });
    expect(outpost.protected).toBe(0);
    expect(persisted).toContain(outpost);
  });

  test("a save that does not end the attack changes nothing (the final one settles it once)", async () => {
    const before = structuredClone(userSave);
    await monsterUpdateHandler(
      [{ baseid: HOME, m: { housed: { C1: 0 } } } as never],
      userSave as never,
      { session: session({ [HOME]: { C1: 100 } }), finalises: false, flinglog: log(100), now: NOW }
    );

    expect(userSave).toEqual(before);
  });

  test("another player's yard in the update is never touched", async () => {
    await monsterUpdateHandler(
      [{ baseid: "2000999999", m: { housed: { C1: 0 } } } as never],
      userSave as never,
      { session: session({}), finalises: true, flinglog: log(5), now: NOW }
    );

    expect(persisted).toEqual([]);
  });
});
