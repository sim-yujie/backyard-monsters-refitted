import { beforeEach, describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { Save } from "../../database/models/save.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { empirePointsColumnValue } from "../base/calculateEmpirePoints.js";
import { STARTER_KITS } from "../../game-data/starterKits.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { outpostPoints, tallyOutposts } from "../maproom/v2/outpostPoints.js";
import { kitBuildings } from "../yard/starterKit.js";
import { BOARD_KEY, BOARD_SQL, BOARD_TTL, OUTPOSTS_SQL, TOP_SIZE, empireBoard, rankRows } from "./empireBoard.js";

/** A whole kit as it lands on an outpost, and its points (`outpostPoints.test.ts`). */
const kit = (name: string): BuildingDataMap =>
  kitBuildings(STARTER_KITS.find((one) => one.name === name)!, "shiny", {}).buildingdata;
const REGULAR = kit("Regular Kit");
const ULTRA = kit("Ultra Kit");
const REGULAR_POINTS = 12_823_091;
const ULTRA_POINTS = 299_272_162;
const BARE: BuildingDataMap = { "1": { id: 1, x: 0, y: 0, t: 112, l: 1 } };

/** A query answer of `count` players, most points first, user ids 1..count. */
const sqlRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    userid: String(i + 1),
    username: `player${i + 1}`,
    pic_square: i === 0 ? "/avatars/frog.webp" : null,
    empirepoints: String((count - i) * 1000),
  }));

/** `i % 3` bare outposts (a core alone, 4 points each) for each of `count` players. */
const bareOutposts = (count: number) =>
  Array.from({ length: count }, (_, i) => Array.from({ length: i % 3 }, () => ({ userid: i + 1, buildingdata: BARE }))).flat();

/**
 * An entity manager whose board query answers `rows` and whose outpost query
 * answers `outposts`, counting the times the board query is asked; the
 * visible-photo lookup answers `photos`.
 */
const fakeEm = (
  rows: unknown[],
  photos: { userid: number; photo_version: number }[] = [],
  outposts: unknown[] = bareOutposts(rows.length),
) => {
  const calls = { count: 0, sql: "", outpostAsks: 0, photoSql: "", photoAsks: 0 };
  const em = {
    execute: async (sql: string) => {
      calls.photoAsks++;
      calls.photoSql = sql;
      return photos;
    },
    getConnection: () => ({
      execute: async (sql: string) => {
        if (sql === OUTPOSTS_SQL) {
          calls.outpostAsks++;
          return outposts;
        }
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
      { rank: 1, userId: 1, name: "player1", pic: "/avatars/frog.webp", empirePoints: 2000, yardPoints: 2000, outpostPoints: 0, outposts: 0 },
      { rank: 2, userId: 2, name: "player2", pic: null, empirePoints: 1000, yardPoints: 1000, outpostPoints: 0, outposts: 0 },
    ]);
  });

  test("adds every outpost a player holds to their main yard points, and ranks by the total", () => {
    const rows = [
      { userid: 1, username: "big-yard", pic_square: null, empirepoints: "400000000" },
      { userid: 2, username: "kit-buyer", pic_square: null, empirepoints: "200000000" },
      { userid: 3, username: "no-outposts", pic_square: null, empirepoints: "150000000" },
    ];
    const outposts = tallyOutposts([
      { userid: 2, buildingdata: ULTRA },
      { userid: 2, buildingdata: REGULAR },
      { userid: 1, buildingdata: BARE },
    ]);
    const ranked = rankRows(rows, outposts);
    expect(ranked.map((row) => row.name)).toEqual(["kit-buyer", "big-yard", "no-outposts"]);
    expect(ranked[0]).toMatchObject({
      rank: 1,
      empirePoints: 200_000_000 + ULTRA_POINTS + REGULAR_POINTS,
      yardPoints: 200_000_000,
      outpostPoints: ULTRA_POINTS + REGULAR_POINTS,
      outposts: 2,
    });
    // A bare outpost, its core alone, adds next to nothing.
    expect(ranked[1]).toMatchObject({ rank: 2, empirePoints: 400_000_000 + outpostPoints(BARE), outposts: 1 });
    expect(outpostPoints(BARE)).toBeLessThan(10);
    // No outposts: exactly as before.
    expect(ranked[2]).toMatchObject({ rank: 3, empirePoints: 150_000_000, yardPoints: 150_000_000, outpostPoints: 0, outposts: 0 });
  });

  test("a lost outpost drops out; its new owner gains it", () => {
    const rows = [
      { userid: 1, username: "loser", pic_square: null, empirepoints: "100000000" },
      { userid: 2, username: "taker", pic_square: null, empirepoints: "90000000" },
    ];
    const before = rankRows(rows, tallyOutposts([{ userid: 1, buildingdata: ULTRA }]));
    expect(before.map((row) => [row.name, row.empirePoints, row.outposts])).toEqual([
      ["loser", 100_000_000 + ULTRA_POINTS, 1],
      ["taker", 90_000_000, 0],
    ]);
    // Taken over: the same outpost row now names the taker.
    const after = rankRows(rows, tallyOutposts([{ userid: 2, buildingdata: ULTRA }]));
    expect(after.map((row) => [row.name, row.empirePoints, row.outposts])).toEqual([
      ["taker", 90_000_000 + ULTRA_POINTS, 1],
      ["loser", 100_000_000, 0],
    ]);
    // Abandoned: nobody holds it.
    expect(rankRows(rows, tallyOutposts([])).map((row) => row.empirePoints)).toEqual([100_000_000, 90_000_000]);
  });

  test("equal totals go to who reached their main yard score first, then the lower user id", () => {
    const rows = [
      { userid: 5, username: "big-yard-late", pic_square: null, empirepoints: "1000", empirepointsat: 300 },
      { userid: 9, username: "outposts-early", pic_square: null, empirepoints: "500", empirepointsat: 100 },
      { userid: 4, username: "same-time-higher-id", pic_square: null, empirepoints: "1000", empirepointsat: 200 },
      { userid: 3, username: "same-time-lower-id", pic_square: null, empirepoints: "1000", empirepointsat: 200 },
    ];
    const ranked = rankRows(rows, new Map([[9, { count: 1, points: 500 }]]));
    expect(ranked.map((row) => [row.rank, row.name, row.empirePoints])).toEqual([
      [1, "outposts-early", 1000],
      [2, "same-time-lower-id", 1000],
      [3, "same-time-higher-id", 1000],
      [4, "big-yard-late", 1000],
    ]);
    expect(ranked[0]).not.toHaveProperty("at");
  });
});

describe("OUTPOSTS_SQL", () => {
  test("reads every Map Room 2 outpost and its holder in one query, never an Inferno yard", () => {
    const sql = OUTPOSTS_SQL.replace(/\s+/g, " ");
    expect(sql).toContain("SELECT o.userid, o.buildingdata FROM bym.save o");
    expect(sql).toContain("o.type = 'outpost'");
    expect(sql).not.toContain("inferno");
    expect(sql).not.toContain("?");
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
    expect(board.you).toEqual({
      rank: 142,
      userId: 142,
      name: "player142",
      pic: null,
      photo: null,
      empirePoints: 9000 + (141 % 3) * outpostPoints(BARE),
      yardPoints: 9000,
      outpostPoints: (141 % 3) * outpostPoints(BARE),
      outposts: 141 % 3,
    });
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
    expect(calls.outpostAsks).toBe(1);
    expect(again.builtAt).toBe(1_000);
    expect(again.you?.rank).toBe(120);
    expect(await redis.ttl(BOARD_KEY)).toBe(BOARD_TTL);
  });

  test("a stored row carries no Discord tag", async () => {
    const { em } = fakeEm(sqlRows(2).map((row) => ({ ...row, discord_tag: "someone#1234" })));
    const board = await empireBoard(em, redis, 1, 1_000);
    expect(JSON.stringify(board)).not.toContain("someone#1234");
    expect(Object.keys(board.top[0]!).sort()).toEqual(["empirePoints", "name", "outpostPoints", "outposts", "photo", "pic", "rank", "userId", "yardPoints"]);
  });

  test("each row carries its visible photo, looked up for every answer in one query", async () => {
    const { em, calls } = fakeEm(sqlRows(150), [
      { userid: 2, photo_version: 4 },
      { userid: 142, photo_version: 1 },
    ]);
    const board = await empireBoard(em, redis, 142, 1_000);
    expect(board.top[0]!.photo).toBeNull();
    expect(board.top[1]!.photo).toBe(4);
    expect(board.you?.photo).toBe(1);
    expect(calls.photoAsks).toBe(1);
    // The shared rule: hidden or banned photos never come back.
    expect(calls.photoSql).toContain("p.photo IS NOT NULL AND p.photo_hidden = false AND u.banned = false");

    // The stored board keeps no photo, so a new or hidden one shows at once.
    const stored = JSON.parse((await redis.get(BOARD_KEY))!) as { top: object[] };
    expect(stored.top[1]).not.toHaveProperty("photo");
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
