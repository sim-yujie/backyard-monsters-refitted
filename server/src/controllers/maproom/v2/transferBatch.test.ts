import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `POST /worldmapv2/transferbatch` (beta 9 #7): one move from the world map's
 * tray, several pairs of yards. Every yard must be the caller's and on one
 * world, none under attack; rows lock main yard first; one refused pair
 * writes nothing; the counts are checked against the server's rosters, never
 * the client's.
 */

const ME = 2505;
const OTHER = 9999;
const MAIN = "2000241207";
const A = "2000241208";
const B = "2000241209";

type Row = Record<string, unknown>;

let saves: Row[];
let cells: Row[];
let locked: number[];
let flushed: number;
let sessions: Set<number>;

const { Save } = await import("../../../database/models/save.model.js");

const yard = (baseid: string, basesaveid: number, type: string, housed: Record<string, number>): Row => ({
  baseid,
  basesaveid,
  type,
  userid: ME,
  saveuserid: ME,
  attackid: 0,
  attacks: [],
  monsters: { housed },
  // One level-6 housing: 540 room (54 Pokeys at Academy level 1).
  buildingdata: { "1": { id: 1, t: 15, l: 6 } },
  buildinghealthdata: {},
});

const em = {
  findOne: async (_entity: unknown, where: Row) => {
    locked.push(where.basesaveid as number);
    return saves.find((save) => save.basesaveid === where.basesaveid) ?? null;
  },
  persist: () => {},
  flush: async () => {
    flushed += 1;
  },
};

mock.module("../../../server.js", () => ({
  postgres: {
    em: {
      find: async (entity: unknown, where: { baseid: { $in: string[] } }) =>
        (entity === Save ? saves : cells).filter((row) => where.baseid.$in.includes(row.baseid as string)),
      populate: async (user: Row) => {
        user.save = saves[0];
      },
      transactional: async (run: (tx: typeof em) => Promise<unknown>) => run(em),
      execute: async (sql: string, params: unknown[]) => {
        if (!sql.includes('bym."user"')) throw new Error("no database");
        return params[0] === ME ? [{ basesaveid: saves[0]!.basesaveid }] : [];
      },
    },
  },
  redis: {},
}));

mock.module("../../../services/base/attackSessionStore.js", () => ({
  startAttackSession: async () => {},
  readAttackSession: async (basesaveid: number) =>
    sessions.has(basesaveid) ? { attackerid: 77, attackid: 1, startedat: 0 } : null,
  endAttackSession: async () => {},
}));

const { transferBatch } = await import("./transferBatch.js");

const movesBody = (moves: unknown) => ({ moves: JSON.stringify(moves) });

const run = async (request: Row) => {
  const ctx = { authUser: { userid: ME }, request: { body: request } } as unknown as Context;
  try {
    await transferBatch(ctx, async () => {});
    return { ok: true as const, rule: undefined, body: ctx.body as Row };
  } catch (caught) {
    return { ok: false as const, rule: (caught as { data?: { rule?: string } }).data?.rule, caught, body: null };
  }
};

const housedOf = (index: number) => (saves[index]!.monsters as { housed: unknown }).housed;

beforeEach(() => {
  const main = yard(MAIN, 2526, "main", { C1: 100, C12: 2 });
  // Four level-6 housings on the main yard: 2,160 room.
  main.buildingdata = Object.fromEntries([1, 2, 3, 4].map((id) => [String(id), { id, t: 15, l: 6 }]));
  saves = [
    main,
    yard(A, 900, "outpost", { C1: 4 }),
    yard(B, 901, "outpost", {}),
  ];
  cells = [MAIN, A, B].map((baseid) => ({ baseid, world: { uuid: "world-a" } }));
  locked = [];
  flushed = 0;
  sessions = new Set();
});

describe("transferBatch", () => {
  test("the main yard fills two outposts in one write, main row locked first", async () => {
    const result = await run(
      movesBody([
        { from: MAIN, to: A, moved: { C1: 50 } },
        { from: MAIN, to: B, moved: { C1: 30, C12: 1 } },
      ])
    );
    expect(result.ok).toBe(true);
    expect(locked).toEqual([2526, 900, 901]);
    expect(housedOf(0)).toEqual({ C1: 20, C12: 1 });
    expect(housedOf(1)).toEqual({ C1: 54 });
    expect(housedOf(2)).toEqual({ C1: 30, C12: 1 });
    expect(flushed).toBe(1);
    expect(result.body).toMatchObject({ error: 0, moved: 81 });
    expect((result.body!.yards as unknown[]).length).toBe(3);
  });

  test("every outpost home in one move", async () => {
    saves[2]!.monsters = { housed: { C1: 7 } };
    const result = await run(
      movesBody([
        { from: A, to: MAIN, moved: { C1: 4 } },
        { from: B, to: MAIN, moved: { C1: 7 } },
      ])
    );
    expect(result.ok).toBe(true);
    expect(housedOf(0)).toEqual({ C1: 111, C12: 2 });
    expect(housedOf(1)).toEqual({});
    expect(housedOf(2)).toEqual({});
  });

  test("one pair over an outpost's room refuses the whole move and writes nothing", async () => {
    const result = await run(
      movesBody([
        { from: MAIN, to: B, moved: { C1: 10 } },
        { from: MAIN, to: A, moved: { C1: 51 } },
      ])
    );
    expect(result.rule).toBe("capacity");
    expect(flushed).toBe(0);
    expect(housedOf(0)).toEqual({ C1: 100, C12: 2 });
  });

  test("client counts are not trusted: asking for more than the yard houses is refused", async () => {
    const result = await run(
      movesBody([
        { from: MAIN, to: A, moved: { C1: 40 } },
        { from: MAIN, to: B, moved: { C1: 61 } },
      ])
    );
    expect(result.rule).toBe("holdings");
    expect(flushed).toBe(0);
  });

  test("another player's outpost in the move is refused before anything is locked", async () => {
    saves[2]!.saveuserid = OTHER;
    const result = await run(movesBody([{ from: MAIN, to: B, moved: { C1: 1 } }]));
    expect(result.ok).toBe(false);
    expect(result.rule).toBeUndefined();
    expect(locked).toEqual([]);
    expect(flushed).toBe(0);
  });

  test("a yard id that does not exist is refused", async () => {
    const result = await run(movesBody([{ from: MAIN, to: "123", moved: { C1: 1 } }]));
    expect(result.ok).toBe(false);
    expect(flushed).toBe(0);
  });

  test("an outpost on another world is refused", async () => {
    cells[2] = { baseid: B, world: { uuid: "world-b" } };
    expect((await run(movesBody([{ from: MAIN, to: B, moved: { C1: 1 } }]))).rule).toBe("world");
  });

  test("an attack running on any yard of the move refuses it", async () => {
    sessions.add(901);
    const result = await run(
      movesBody([
        { from: MAIN, to: A, moved: { C1: 1 } },
        { from: MAIN, to: B, moved: { C1: 1 } },
      ])
    );
    expect(result.rule).toBe("underAttack");
    expect(flushed).toBe(0);
  });

  test("a body that is not a list of pairs is refused", async () => {
    expect((await run(movesBody({ from: MAIN }))).rule).toBe("batch");
    expect((await run(movesBody([]))).rule).toBe("batch");
    expect((await run({})).ok).toBe(false);
  });

  test("negative counts are refused (no pulling monsters backwards)", async () => {
    expect((await run(movesBody([{ from: A, to: MAIN, moved: { C1: -50 } }]))).rule).toBe("quantities");
    expect(flushed).toBe(0);
  });
});
