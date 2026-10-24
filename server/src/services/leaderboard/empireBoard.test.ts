import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { Save } from "../../database/models/save.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { empirePointsColumnValue } from "../base/calculateEmpirePoints.js";
import { BOARD_KEY, BOARD_SQL, BOARD_TTL, TOP_SIZE, empireBoard, rankRows } from "./empireBoard.js";

/** A query answer of `count` players, most points first, user ids 1..count. */
const sqlRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    userid: String(i + 1),
    username: `player${i + 1}`,
    pic_square: i === 0 ? "/avatars/frog.webp" : null,
    empirepoints: String((count - i) * 1000),
    outposts: i % 3,
  }));

/** An entity manager whose one query answers `rows`, counting the times it is asked. */
const fakeEm = (rows: unknown[]) => {
  const calls = { count: 0, sql: "" };
  const em = {
    getConnection: () => ({
      execute: async (sql: string) => {
        calls.count++;
        calls.sql = sql;
        return rows;
      },
    }),
  } as unknown as EntityManager;
  return { em, calls };
};

describe("rankRows", () => {
  test("ranks rows in the order the query gave them, as numbers", () => {
    expect(rankRows(sqlRows(2))).toEqual([
      { rank: 1, userId: 1, name: "player1", pic: "/avatars/frog.webp", empirePoints: 2000, outposts: 0 },
      { rank: 2, userId: 2, name: "player2", pic: null, empirePoints: 1000, outposts: 1 },
    ]);
  });
});

describe("BOARD_SQL", () => {
  test("orders by empire points, then who reached them first, then user id", () => {
    expect(BOARD_SQL.replace(/\s+/g, " ")).toContain(
      "ORDER BY s.empirepoints DESC, s.empirepointsat ASC, s.userid ASC",
    );
  });

  test("counts only main yards and leaves out bots and banned players", () => {
    const sql = BOARD_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("s.type = 'main'");
    expect(sql).toContain("u.banned = false");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)");
  });

  test("never reads a Discord tag", () => {
    expect(BOARD_SQL).not.toContain("discord");
  });
});

describe("empireBoard", () => {
  let redis: ReturnType<typeof memoryRedis>;

  beforeEach(() => {
    redis = memoryRedis();
  });

  test("sends the top 100 and the asker's own row when they are in it", async () => {
    const { em } = fakeEm(sqlRows(150));
    const board = await empireBoard(em, redis, 7, 1_000);
    expect(board.top).toHaveLength(TOP_SIZE);
    expect(board.top[0]!.rank).toBe(1);
    expect(board.top.at(-1)!.rank).toBe(100);
    expect(board.you).toEqual(board.top[6]!);
    expect(board.total).toBe(150);
    expect(board.builtAt).toBe(1_000);
  });

  test("finds the asker's own place below the top 100", async () => {
    const { em } = fakeEm(sqlRows(150));
    const board = await empireBoard(em, redis, 142, 1_000);
    expect(board.you).toEqual({ rank: 142, userId: 142, name: "player142", pic: null, empirePoints: 9000, outposts: 141 % 3 });
  });

  test("an asker who is not ranked (a bot, banned, no yard) gets no row", async () => {
    const { em } = fakeEm(sqlRows(3));
    const board = await empireBoard(em, redis, 99, 1_000);
    expect(board.you).toBeNull();
    expect(board.top).toHaveLength(3);
  });

  test("the board is worked out once and served from the store until it expires", async () => {
    const { em, calls } = fakeEm(sqlRows(150));
    await empireBoard(em, redis, 1, 1_000);
    const again = await empireBoard(em, redis, 120, 1_100);
    expect(calls.count).toBe(1);
    expect(again.builtAt).toBe(1_000);
    expect(again.you?.rank).toBe(120);
    expect(await redis.ttl(BOARD_KEY)).toBe(BOARD_TTL);
  });

  test("a stored row carries no Discord tag", async () => {
    const { em } = fakeEm(sqlRows(2).map((row) => ({ ...row, discord_tag: "someone#1234" })));
    const board = await empireBoard(em, redis, 1, 1_000);
    expect(JSON.stringify(board)).not.toContain("someone#1234");
    expect(Object.keys(board.top[0]!).sort()).toEqual(["empirePoints", "name", "outposts", "pic", "rank", "userId"]);
  });

  test("an empty board is fine", async () => {
    const { em } = fakeEm([]);
    const board = await empireBoard(em, redis, 1, 1_000);
    expect(board).toEqual({ top: [], you: null, total: 0, builtAt: 1_000 });
  });
});

describe("empirePointsColumnValue", () => {
  test("adds the two strings, whole", () => {
    expect(empirePointsColumnValue("1200", "345")).toBe(1545);
    expect(empirePointsColumnValue("10.7", "0.5")).toBe(11);
  });

  test("a missing or unreadable part counts as 0", () => {
    expect(empirePointsColumnValue(undefined, "50")).toBe(50);
    expect(empirePointsColumnValue("abc", "50")).toBe(50);
    expect(empirePointsColumnValue("-20", "50")).toBe(50);
    expect(empirePointsColumnValue(null, null)).toBe(0);
  });
});

describe("Save.syncEmpirePoints", () => {
  const make = (points: string, basevalue: string, empirepoints = 0, empirepointsat = 0) =>
    Object.assign(Object.create(Save.prototype), { points, basevalue, empirepoints, empirepointsat }) as InstanceType<typeof Save>;

  test("an insert works the total out and stamps the time", () => {
    const save = make("100", "50");
    save.syncEmpirePoints();
    expect(save.empirepoints).toBe(150);
    expect(save.empirepointsat).toBeGreaterThan(0);
  });

  test("an update that changes the score stamps a new time", () => {
    const save = make("300", "50", 150, 10);
    save.syncEmpirePoints({ changeSet: { payload: { points: "300" } } });
    expect(save.empirepoints).toBe(350);
    expect(save.empirepointsat).toBeGreaterThan(10);
  });

  test("an update that leaves the score where it was keeps the old time (the tie break)", () => {
    const save = make("100", "50", 150, 10);
    save.syncEmpirePoints({ changeSet: { payload: { basevalue: "50" } } });
    expect(save.empirepoints).toBe(150);
    expect(save.empirepointsat).toBe(10);
  });

  test("an update that touches neither part leaves both alone", () => {
    const save = make("900", "50", 150, 10);
    save.syncEmpirePoints({ changeSet: { payload: { resources: {} } } });
    expect(save.empirepoints).toBe(150);
    expect(save.empirepointsat).toBe(10);
  });
});
