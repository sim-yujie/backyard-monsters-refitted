import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import alea from "alea";

import { experiencePoints } from "../../../game-data/stats/experiencePoints.js";
import {
  ACTIVE_PLAYER_DAYS,
  NEIGHBOUR_LIMIT,
  empirePointsRange,
  findOverworldNeighbours,
  neighbourLevelWindow,
} from "./findOverworldNeighbours.js";

/**
 * The Map Room 1 neighbour search (issue #236, `docs/design/bot-neighbours.md`
 * §4.3). The SQL filters themselves (30-day rule, level range, no 150 cut,
 * retired bots) are checked against a real database in
 * `findOverworldNeighbours.db.test.ts`; these check what the search does with
 * the rows it gets back.
 */

const NOW = new Date("2026-10-03T12:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);

/** Points that put a yard on `level`. */
const pointsFor = (level: number) => String(experiencePoints[level - 1]);

const realRow = (userid: number, level = 5) => ({
  userid,
  baseid: `${userid}00`,
  points: pointsFor(level),
  basevalue: "0",
  lastupdate_at: new Date("2026-10-01T00:00:00Z"),
  username: `player${userid}`,
  pic_square: "https://example.com/pic.png",
});

const botRow = (userid: number, level = 5, protectedUntil = 0) => ({
  userid,
  level,
  baseid: `${userid}00`,
  points: pointsFor(level),
  basevalue: "0",
  lastupdate_at: new Date("2026-10-02T00:00:00Z"),
  protected: protectedUntil,
  attackid: 0,
  last_attack: null,
  username: `bot${userid}`,
  pic_square: null,
});

const fakeEm = (reals: object[], bots: object[] = []) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const em = {
    execute: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return sql.includes("b.state = 'active'") ? bots : reals;
    },
  };
  return { em: em as unknown as EntityManager, queries };
};

const player = { userid: 1 };
/** A player shown bots: from level 15 up (owner 3 Nov 2026). */
const levelTwenty = { points: pointsFor(20), basevalue: "0" };

describe("the level window", () => {
  test("is seven levels either way, never below level 1", () => {
    expect(neighbourLevelWindow(20)).toEqual({ min: 13, max: 27 });
    expect(neighbourLevelWindow(3)).toEqual({ min: 1, max: 10 });
  });

  test("turns into the empire points calculateBaseLevel gives those levels", () => {
    expect(empirePointsRange({ min: 13, max: 27 })).toEqual({
      low: experiencePoints[12],
      high: experiencePoints[27],
    });
    // Level 1 takes everything under level 2; the top level has no ceiling.
    expect(empirePointsRange({ min: 1, max: 10 })).toEqual({ low: null, high: experiencePoints[10] });
    expect(empirePointsRange({ min: 43, max: 57 })).toEqual({ low: experiencePoints[42], high: null });
  });
});

describe("findOverworldNeighbours", () => {
  test("asks for real players seen in the last 30 days, in range, at most 25, no 150 cut", async () => {
    const { em, queries } = fakeEm([]);
    await findOverworldNeighbours(em, player, { points: pointsFor(20), basevalue: "0" }, { now: NOW, fill: false });

    expect(queries).toHaveLength(1);
    const [{ sql, params }] = queries;
    expect(sql).toContain("u.last_seen_at >= ?");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM bym.bot b WHERE b.userid = u.userid)");
    expect(sql).not.toContain("150");
    expect(params).toEqual([
      "main",
      new Date(NOW.getTime() - ACTIVE_PLAYER_DAYS * 24 * 60 * 60 * 1000),
      1,
      1,
      experiencePoints[12],
      experiencePoints[27],
      NEIGHBOUR_LIMIT,
    ]);
  });

  test("with BOTS_FILL off the list is real players only and bots are never asked for", async () => {
    const { em, queries } = fakeEm([realRow(2), realRow(3)], [botRow(50)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: false });

    expect(neighbours.map((n) => n.userid).sort()).toEqual([2, 3]);
    expect(queries).toHaveLength(1);
  });

  test("bots retired (owner, 12 Nov 2026): no bot fills a list even with BOTS_FILL=on", async () => {
    const before = process.env.BOTS_FILL;
    try {
      delete process.env.BOTS_FILL;
      const off = fakeEm([realRow(2)], [botRow(50)]);
      expect(await findOverworldNeighbours(off.em, player, levelTwenty, { now: NOW })).toHaveLength(1);

      process.env.BOTS_FILL = "on";
      const on = fakeEm([realRow(2)], [botRow(50)]);
      expect(await findOverworldNeighbours(on.em, player, levelTwenty, { now: NOW })).toHaveLength(1);
      // Only the real players were asked for: no bot search at all.
      expect(on.queries).toHaveLength(1);
    } finally {
      if (before === undefined) delete process.env.BOTS_FILL;
      else process.env.BOTS_FILL = before;
    }
  });

  test("a full list of real players asks for no bots", async () => {
    const reals = Array.from({ length: NEIGHBOUR_LIMIT }, (_, i) => realRow(100 + i));
    const { em, queries } = fakeEm(reals, [botRow(50)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: true });

    expect(neighbours).toHaveLength(NEIGHBOUR_LIMIT);
    expect(queries).toHaveLength(1);
  });

  test("bots fill only the places real players leave, every real player kept", async () => {
    const reals = [realRow(2), realRow(3), realRow(4)];
    const bots = Array.from({ length: 40 }, (_, i) => botRow(500 + i, 15 + (i % 3)));
    const { em, queries } = fakeEm(reals, bots);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, {
      now: NOW,
      fill: true,
      random: alea("fill"),
    });

    expect(neighbours).toHaveLength(NEIGHBOUR_LIMIT);
    const ids = neighbours.map((n) => n.userid);
    expect(new Set(ids).size).toBe(NEIGHBOUR_LIMIT);
    for (const real of reals) expect(ids).toContain(real.userid);
    expect(ids.filter((id) => id >= 500)).toHaveLength(NEIGHBOUR_LIMIT - reals.length);

    const botQuery = queries[1];
    expect(botQuery.sql).toContain("b.state = 'active'");
    // A level 20 player's window is 13-27, but no bot stands below the floor, 25: the nearest bots, 25-27 (`botLevelWindow`).
    expect(botQuery.params).toEqual(["main", 25, 27, 1, 1]);
  });

  test("a player under level 15 is shown no bots, only real players, with BOTS_FILL on (owner 3 Nov 2026)", async () => {
    for (const level of [1, 5, 14]) {
      const { em, queries } = fakeEm([realRow(2), realRow(3)], [botRow(50, 25)]);
      const neighbours = await findOverworldNeighbours(em, player, { points: pointsFor(level), basevalue: "0" }, {
        now: NOW,
        fill: true,
      });
      expect(neighbours.map((n) => n.userid).sort()).toEqual([2, 3]);
      expect(queries).toHaveLength(1);
    }
    // From 15 up the bots come back.
    const { em, queries } = fakeEm([realRow(2)], [botRow(50, 25)]);
    const fifteen = await findOverworldNeighbours(em, player, { points: pointsFor(15), basevalue: "0" }, { now: NOW, fill: true });
    expect(fifteen.map((n) => n.userid).sort((a, b) => a - b)).toEqual([2, 50]);
    expect(queries[1]!.params).toEqual(["main", 25, 27, 1, 1]);
  });

  test("bots attackable now are picked before protected ones", async () => {
    const protectedBots = Array.from({ length: 30 }, (_, i) => botRow(600 + i, 5, NOW_S + 3600));
    const openBots = Array.from({ length: 5 }, (_, i) => botRow(700 + i, 6));
    const { em } = fakeEm([], [...protectedBots, ...openBots]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, {
      now: NOW,
      fill: true,
      random: alea("open"),
    });

    expect(neighbours).toHaveLength(NEIGHBOUR_LIMIT);
    for (const open of openBots) expect(neighbours.map((n) => n.userid)).toContain(open.userid);
  });

  test("a bot entry has exactly the fields and types of a real player's", async () => {
    const { em } = fakeEm([realRow(2)], [botRow(50)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: true });

    const shape = (entry: object) =>
      Object.entries(entry)
        .map(([key, value]) => `${key}:${typeof value}`)
        .sort();
    const real = neighbours.find((n) => n.userid === 2)!;
    const bot = neighbours.find((n) => n.userid === 50)!;
    expect(shape(bot)).toEqual(shape(real));
    expect(bot.pic).toBe("");
    expect(bot.level).toBe(5);
  });

  test("the order gives nothing away: bots are not always last, real players not always first", async () => {
    const reals = [realRow(2), realRow(3), realRow(4), realRow(5), realRow(6)];
    const bots = Array.from({ length: 20 }, (_, i) => botRow(500 + i, 5));
    let botFirst = 0;
    let realLast = 0;

    for (let run = 0; run < 100; run++) {
      const { em } = fakeEm(reals, bots);
      const neighbours = await findOverworldNeighbours(em, player, levelTwenty, {
        now: NOW,
        fill: true,
        random: alea(`order-${run}`),
      });
      if (neighbours[0].userid >= 500) botFirst++;
      if (neighbours.at(-1)!.userid < 500) realLast++;
    }

    // 20 of 25 places are bots and 5 real: about 80 and 20 of 100 runs.
    expect(botFirst).toBeGreaterThan(50);
    expect(realLast).toBeGreaterThan(5);
  });

  test("a bot already on the list is not added twice", async () => {
    const { em } = fakeEm([realRow(2)], [botRow(2), botRow(50)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: true });

    expect(neighbours.map((n) => n.userid).sort((a, b) => a - b)).toEqual([2, 50]);
  });
});

describe("neighbours dropped today by the attack cap (issue #247)", () => {
  test("are left out of the real-player search", async () => {
    const { em, queries } = fakeEm([]);
    await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: false, exclude: [7, 8] });

    const [{ sql, params }] = queries;
    expect(sql).toContain("u.userid NOT IN (?, ?, ?)");
    expect(params.slice(2, 5)).toEqual([1, 7, 8]);
  });

  test("are never picked as bots", async () => {
    const { em } = fakeEm([realRow(2)], [botRow(50), botRow(51)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, fill: true, exclude: [50] });

    expect(neighbours.map((n) => n.userid).sort((a, b) => a - b)).toEqual([2, 51]);
  });
});
