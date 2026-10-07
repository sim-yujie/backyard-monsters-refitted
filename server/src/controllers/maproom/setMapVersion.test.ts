import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";

/**
 * `setmapversion` is one way from Map Room 2 (owner decision 2026-09-30): a
 * save on Map Room 2 asking for version 1, or for 0 (the Flash client's
 * "recycle the Map Room"), is refused and nothing is written, while the move
 * from Map Room 1 to 2 works as before. Drives the controller over an
 * in-memory stand-in for the rows it reads.
 */

const ME = 2505;

type Row = Record<string, unknown>;

let save: Row;
let flushed: number;
let removed: Row[];
let moves: string[];
/** Keys `invalidatePlayerSight` dropped (issue #329, #330 WP1). */
let delCalls: string[];

mock.module("../../server.js", () => ({
  postgres: {
    em: {
      populate: async (user: Row) => {
        user.save = save;
      },
      findOne: async () => ({ userid: ME }),
      nativeDelete: async () => 0,
      persist: () => {},
      remove: (row: Row) => removed.push(row),
      flush: async () => {
        flushed += 1;
      },
    },
  },
  redis: {
    del: async (key: string) => {
      delCalls.push(key);
      return 0;
    },
  },
}));

mock.module("../../services/maproom/v2/leaveWorld.js", () => ({
  leaveWorld: async () => {
    moves.push("leave");
  },
}));

mock.module("../../services/maproom/v2/joinOrCreateWorld.js", () => ({
  joinOrCreateWorld: async () => {
    moves.push("join");
  },
}));

const { setMapVersion } = await import("./setMapVersion.js");

const run = async (version: number, allianceId: number | null = null) => {
  const ctx = {
    authUser: { userid: ME, alliance_id: allianceId },
    meetsDiscordAgeCheck: true,
    request: { body: { version: String(version) } },
  } as unknown as Context;
  try {
    await setMapVersion(ctx, async () => {});
    return { ok: true as const, body: ctx.body as Row, status: undefined, reason: undefined };
  } catch (caught) {
    const error = caught as { status?: number; data?: { reason?: string } };
    return { ok: false as const, body: undefined, status: error.status, reason: error.data?.reason };
  }
};

const townHall = (level: number) => ({ b1: { t: 14, l: level, id: 1, x: 0, y: 0 } });

beforeEach(() => {
  flushed = 0;
  removed = [];
  moves = [];
  delCalls = [];
});

describe("setMapVersion from Map Room 2", () => {
  beforeEach(() => {
    save = { basesaveid: 2526, mapversion: 2, mr2upgraded: true, worldid: "world-a", buildingdata: townHall(10) };
  });

  test("version 1 is refused softly and nothing is written", async () => {
    const result = await run(1);
    expect(result).toMatchObject({ ok: false, status: 409, reason: "mapRoom2Final" });
    expect(save).toMatchObject({ mapversion: 2, worldid: "world-a" });
    expect(flushed).toBe(0);
    expect(moves).toEqual([]);
  });

  test("version 0 (leave the world) is refused the same way", async () => {
    const result = await run(0);
    expect(result).toMatchObject({ ok: false, status: 409, reason: "mapRoom2Final" });
    expect(save.mapversion).toBe(2);
    expect(flushed).toBe(0);
    expect(moves).toEqual([]);
  });

  test("asking for version 2 again still answers", async () => {
    const result = await run(2);
    expect(result.ok).toBe(true);
    expect(save.mapversion).toBe(2);
  });
});

describe("setMapVersion from Map Room 1", () => {
  beforeEach(() => {
    save = { basesaveid: 2526, mapversion: 1, mr2upgraded: false, worldid: null, buildingdata: townHall(6) };
  });

  test("version 2 joins a world and moves the save to Map Room 2", async () => {
    const result = await run(2);
    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ error: 0 });
    expect(save).toMatchObject({ mapversion: 2, mr2upgraded: true });
    expect(moves).toEqual(["join"]);
    expect(removed).toHaveLength(1);
    expect(flushed).toBe(1);
  });

  test("version 2 still needs Town Hall 6", async () => {
    save.buildingdata = townHall(5);
    const result = await run(2);
    expect(result.ok).toBe(false);
    expect(save.mapversion).toBe(1);
    expect(moves).toEqual([]);
  });

  test("version 1 stays allowed", async () => {
    const result = await run(1);
    expect(result.ok).toBe(true);
    expect(save.mapversion).toBe(1);
  });

  test("version 0 (leaving entirely) drops the player's own cached sight (#329, #330 WP1)", async () => {
    const result = await run(0);
    expect(result.ok).toBe(true);
    expect(moves).toEqual(["leave"]);
    expect(delCalls).toEqual([`sight:${ME}`]);
  });

  test("a member of an alliance is refused first, and nothing invalidates", async () => {
    const result = await run(0, 42);
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(moves).toEqual([]);
    expect(delCalls).toEqual([]);
  });
});
