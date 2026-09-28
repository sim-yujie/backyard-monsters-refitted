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

mock.module("../../../../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { monsterUpdateHandler, monsterUpdateMode } = await import("./monsterUpdateHandler.js");

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
      { session: session({ [HOME]: { C1: 102 } }), finalises: true, flinglog: log(10), now: NOW, mapRoom3: false }
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
      { session: session({ [HOME]: { C1: 100 } }), finalises: true, flinglog: undefined, now: NOW, mapRoom3: false }
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
      { session: session({ [HOME]: { C1: 100 }, [OUTPOST]: { C1: 30 } }), finalises: true, flinglog: undefined, now: NOW, mapRoom3: false }
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
      { session: session({ [HOME]: { C1: 100 } }), finalises: false, flinglog: log(100), now: NOW, mapRoom3: false }
    );

    expect(userSave).toEqual(before);
  });

  test("another player's yard in the update is never touched", async () => {
    await monsterUpdateHandler(
      [{ baseid: "2000999999", m: { housed: { C1: 0 } } } as never],
      userSave as never,
      { session: session({}), finalises: true, flinglog: log(5), now: NOW, mapRoom3: false }
    );

    expect(persisted).toEqual([]);
  });
});

describe("monsterUpdateHandler — the path the attack expects (issue #164)", () => {
  /** Flash's Map Room 3 per-creep shape. */
  const MR3_UPDATE = { C1: [{ health: 100, ownerID: 1, q: 0 }], Q: [] };

  const settle = (monsters: unknown, extra: { finalises?: boolean; mapRoom3?: boolean; roster?: boolean } = {}) =>
    monsterUpdateHandler(monsters, userSave as never, {
      session: session(extra.roster === false ? undefined : { [HOME]: { C1: 100 } }),
      finalises: extra.finalises ?? true,
      flinglog: log(10),
      now: NOW,
      mapRoom3: extra.mapRoom3 ?? false,
    });

  test("a Map Room 2 attack cannot write an object over the army, finalising or not", async () => {
    const before = structuredClone(userSave);
    await settle({ housed: { C1: 5000, C20: 99 } });
    await settle(MR3_UPDATE, { finalises: false });
    await settle(MR3_UPDATE, { mapRoom3: true });
    await settle("C1", {});
    await settle(null, {});

    expect(userSave).toEqual(before);
    expect(persisted).toEqual([]);
  });

  test("junk entries in the array are dropped and the rest settles", async () => {
    await monsterUpdateHandler(
      [null, "x", [HOME], { baseid: {} }, { baseid: "../1" }, { baseid: HOME, m: { housed: { C1: 93 } } }],
      userSave as never,
      { session: session({ [HOME]: { C1: 100 } }), finalises: true, flinglog: undefined, now: NOW, mapRoom3: false }
    );

    // 104 caught up, 100 − 93 flung.
    expect(userSave.monsters.housed).toEqual({ C1: 97 });
  });

  test("a Map Room 3 attack writes its per-creep object, and only that shape", async () => {
    await settle({ C1: "lots" }, { roster: false, mapRoom3: true });
    await settle([{ baseid: HOME, m: { housed: { C1: 0 } } }], { roster: false, mapRoom3: true });
    expect(userSave.monsters.housed).toEqual({ C1: 100 });

    await settle(MR3_UPDATE, { roster: false, mapRoom3: true });
    expect(userSave.monsters).toEqual(MR3_UPDATE);
  });

  test("a session without a roster from a player not on Map Room 3 writes nothing", async () => {
    const before = structuredClone(userSave);
    await settle(MR3_UPDATE, { roster: false, mapRoom3: false });
    await settle([{ baseid: HOME, m: { housed: { C1: 0 } } }], { roster: false, mapRoom3: false });

    expect(userSave).toEqual(before);
  });

  test("the mode is the server's: roster from the session, Map Room 3 from the attacker's save", () => {
    expect(monsterUpdateMode({ session: session({}), mapRoom3: true })).toBe("roster");
    expect(monsterUpdateMode({ session: session(), mapRoom3: true })).toBe("mapRoom3");
    expect(monsterUpdateMode({ session: session(), mapRoom3: false })).toBe("none");
    expect(monsterUpdateMode({ session: null, mapRoom3: false })).toBe("none");
  });
});
