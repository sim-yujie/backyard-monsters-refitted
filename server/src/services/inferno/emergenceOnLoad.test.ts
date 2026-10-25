import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";

import type { Save } from "../../database/models/save.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The emergence's load hook and its pause on wild raids, on a stand-in
 * entity manager: what each reads, and that the level-up is written only
 * when a raid is due, with the level it was read at (so two loads at once
 * raise it once: the statement itself is tested on a real database in
 * `infernoProgress.db.test.ts`).
 */

const redis = memoryRedis();
mock.module("../../server.js", () => ({ postgres: { em: {} }, redis }));

const { emergenceHoldsRaids, emergenceOnLoad } = await import("./emergenceOnLoad.js");
const { openRaid } = await import("../raids/raidStore.js");

const USER = 41;
const NOW = 1_800_000_000;

/** The stored progress row, the reads made and the level-up statements sent. */
const db = {
  row: null as Record<string, unknown> | null,
  reads: 0,
  raises: [] as unknown[][],
  /** What the level-up statement answers: the new level, or none (another request won). */
  raiseAnswer: null as number | null,
};
const em = {
  findOne: async () => {
    db.reads++;
    return db.row;
  },
  execute: async (_sql: string, params: unknown[]) => {
    db.raises.push(params);
    return db.raiseAnswer === null ? [] : [{ emergence_level: db.raiseAnswer }];
  },
} as unknown as EntityManager;

const save = (extra: Record<string, unknown> = {}) =>
  ({
    type: "main",
    tutorialstage: 205,
    buildingdata: { "1": { id: 1, t: 14, l: 5, x: 0, y: 0 } },
    buildinghealthdata: {},
    attackid: 0,
    attacks: [],
    ...extra,
  }) as unknown as Save;

beforeEach(() => {
  redis.clear();
  db.row = null;
  db.reads = 0;
  db.raises = [];
  db.raiseAnswer = null;
});

describe("the emergence on a main-yard load", () => {
  test("switched off, it reads and writes nothing and answers nothing", async () => {
    expect(await emergenceOnLoad(em, USER, save(), NOW, false)).toBeUndefined();
    expect(db.reads).toBe(0);
    expect(db.raises).toEqual([]);
  });

  test("due: the cave goes from 0 to 1 at once, written before anything else", async () => {
    db.raiseAnswer = 1;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.raised).toBe(1);
    expect(result.notDue).toBeNull();
    expect(result.progress.emergenceLevel).toBe(1);
    expect(result.progress.emergenceLastAt).toBe(NOW);
    // userid, the new level, now, the level it was read at, now - 12 h.
    expect(db.raises).toEqual([[USER, 1, NOW, 0, NOW - 43_200]]);
  });

  test("12 hours after the last, the next level", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 43_200) * 1000) };
    db.raiseAnswer = 3;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.raised).toBe(3);
    expect(db.raises).toEqual([[USER, 3, NOW, 2, NOW - 43_200]]);
  });

  test("too soon: nothing written, and the reason told", async () => {
    db.row = { userid: USER, emergence_level: 2, emergence_last_at: new Date((NOW - 3_600) * 1000) };
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "tooSoon" });
    expect(result.progress.emergenceLevel).toBe(2);
    expect(db.raises).toEqual([]);
  });

  test("an open wild raid holds it back to the next load", async () => {
    await openRaid(USER, { id: "r1", phase: "warning", tribe: "kozu", plan: {}, seed: 1, attackAt: NOW + 300, warned: 0 } as never, NOW);
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result.notDue).toBe("raidOpen");
    expect(db.raises).toEqual([]);
  });

  test("a yard at 10% health or less waits", async () => {
    const result = (await emergenceOnLoad(em, USER, save({ buildinghealthdata: { "1": 0 } }), NOW, true))!;
    expect(result.notDue).toBe("damaged");
    expect(db.raises).toEqual([]);
  });

  test("another load raised it first: no level here, and the stored one is read back", async () => {
    db.raiseAnswer = null;
    const result = (await emergenceOnLoad(em, USER, save(), NOW, true))!;
    expect(result).toMatchObject({ raised: null, notDue: "race" });
    expect(db.reads).toBe(2);
  });
});

describe("the pause on wild raids, as the raid ping asks it", () => {
  const pinged = (extra: Record<string, unknown> = {}) => ({ type: "main", thlevel: 5, tutorialstage: 205, ...extra });

  test("below Town Hall 5 or with the Inferno off, no read at all", async () => {
    expect(await emergenceHoldsRaids(em, USER, pinged({ thlevel: 4 }), true)).toBe(false);
    expect(await emergenceHoldsRaids(em, USER, pinged(), false)).toBe(false);
    expect(db.reads).toBe(0);
  });

  test("at Town Hall 5 before the fifth raid, raids wait", async () => {
    db.row = { userid: USER, emergence_level: 3, emergence_last_at: new Date(NOW * 1000) };
    expect(await emergenceHoldsRaids(em, USER, pinged(), true)).toBe(true);
  });

  test("after the fifth, they come again", async () => {
    db.row = { userid: USER, emergence_level: 5, emergence_last_at: new Date(NOW * 1000) };
    expect(await emergenceHoldsRaids(em, USER, pinged(), true)).toBe(false);
  });
});
