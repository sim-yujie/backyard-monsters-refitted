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

const fakeEm = (reals: object[]) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const em = {
    execute: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return reals;
    },
  };
  return { em: em as unknown as EntityManager, queries };
};

const player = { userid: 1 };
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
    await findOverworldNeighbours(em, player, { points: pointsFor(20), basevalue: "0" }, { now: NOW });

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

  test("is real players only: the bot search is gone (bots retired 12 Nov 2026, code removed in beta 9)", async () => {
    const { em, queries } = fakeEm([realRow(2), realRow(3)]);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW });

    expect(neighbours.map((n) => n.userid).sort()).toEqual([2, 3]);
    expect(queries).toHaveLength(1);
  });

  test("a full list of real players is kept whole", async () => {
    const reals = Array.from({ length: NEIGHBOUR_LIMIT }, (_, i) => realRow(100 + i));
    const { em } = fakeEm(reals);
    const neighbours = await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, random: alea("full") });

    expect(neighbours.map((n) => n.userid).sort((a, b) => a - b)).toEqual(reals.map((row) => row.userid));
  });
});

describe("neighbours dropped today by the attack cap (issue #247)", () => {
  test("are left out of the real-player search", async () => {
    const { em, queries } = fakeEm([]);
    await findOverworldNeighbours(em, player, levelTwenty, { now: NOW, exclude: [7, 8] });

    const [{ sql, params }] = queries;
    expect(sql).toContain("u.userid NOT IN (?, ?, ?)");
    expect(params.slice(2, 5)).toEqual([1, 7, 8]);
  });
});
