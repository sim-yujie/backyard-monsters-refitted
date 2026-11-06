import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";
import alea from "alea";

import { attackWindowSeconds } from "../base/attackWindow.js";
import { neighbourLevelWindow } from "../maproom/v1/findOverworldNeighbours.js";
import {
  botLevelWindow,
  type BotNeighbourCandidate,
  findBotCandidates,
  FLOOR_REACH,
  showsBots,
  pickBotNeighbours,
} from "./botNeighbours.js";

const NOW = 1_790_000_000;

const row = (userid: number, extra: object = {}) => ({
  userid,
  level: 5,
  baseid: `${userid}00`,
  points: "7500",
  basevalue: "0",
  lastupdate_at: "2026-10-02T00:00:00.000Z",
  protected: 0,
  attackid: 0,
  last_attack: null,
  username: `bot${userid}`,
  pic_square: null,
  ...extra,
});

const fakeEm = (rows: object[]) => {
  const queries: { sql: string; params: unknown[] }[] = [];
  const em = {
    execute: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return rows;
    },
  };
  return { em: em as unknown as EntityManager, queries };
};

const candidate = (userid: number, level: number, attackable = true): BotNeighbourCandidate => ({
  userid,
  baseid: `${userid}00`,
  points: "0",
  basevalue: "0",
  lastupdateAt: new Date(0),
  username: `bot${userid}`,
  pic_square: null,
  level,
  attackable,
});

describe("findBotCandidates (issue #236)", () => {
  test("asks for active Map Room 1 bots in the window, never the player", async () => {
    const { em, queries } = fakeEm([]);
    await findBotCandidates(em, 7, { min: 3, max: 17 }, NOW);

    expect(queries[0].sql).toContain("b.state = 'active'");
    expect(queries[0].sql).toContain("b.level BETWEEN ? AND ?");
    expect(queries[0].params).toEqual(["main", 3, 17, 7, 1]);
  });

  test("tells which bots can be attacked now, as the neighbour refresh does", async () => {
    const { em } = fakeEm([
      row(1),
      row(2, { protected: NOW + 60 }),
      row(3, { protected: NOW - 60 }),
      row(4, { attackid: 9, last_attack: { starttime: NOW - 10 } }),
      row(5, { attackid: 9, last_attack: { starttime: NOW - attackWindowSeconds() - 1 } }),
      row(6, { attackid: 9, last_attack: null }),
    ]);
    const bots = await findBotCandidates(em, 7, { min: 1, max: 12 }, NOW);

    expect(bots.map((bot) => [bot.userid, bot.attackable])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, false],
      [5, true],
      [6, true],
    ]);
    expect(bots[0].lastupdateAt).toEqual(new Date("2026-10-02T00:00:00.000Z"));
  });
});

describe("pickBotNeighbours (issue #236)", () => {
  test("takes no more than the empty places", () => {
    const bots = Array.from({ length: 10 }, (_, i) => candidate(i, 5));
    expect(pickBotNeighbours(bots, 0)).toEqual([]);
    expect(pickBotNeighbours(bots, 4)).toHaveLength(4);
    expect(pickBotNeighbours(bots.slice(0, 3), 25)).toHaveLength(3);
  });

  test("picks bots attackable now before the rest", () => {
    const closed = Array.from({ length: 20 }, (_, i) => candidate(i, 5, false));
    const open = [candidate(100, 8), candidate(101, 9)];
    const picked = pickBotNeighbours([...closed, ...open], 5, alea("open"));

    expect(picked.slice(0, 2).map((bot) => bot.userid).sort()).toEqual([100, 101]);
    expect(picked.slice(2).every((bot) => !bot.attackable)).toBe(true);
  });

  test("spreads the picks across the levels in range", () => {
    // Most bots sit on one level; the picks still cover every level.
    const crowded = Array.from({ length: 30 }, (_, i) => candidate(i, 5));
    const others = [6, 7, 8, 9].map((level) => candidate(100 + level, level));
    const picked = pickBotNeighbours([...crowded, ...others], 5, alea("spread"));

    expect(new Set(picked.map((bot) => bot.level))).toEqual(new Set([5, 6, 7, 8, 9]));
  });

  test("never picks one bot twice and is shuffled by the random source", () => {
    const bots = Array.from({ length: 30 }, (_, i) => candidate(i, 1 + (i % 6)));
    const a = pickBotNeighbours(bots, 20, alea("a")).map((bot) => bot.userid);
    const b = pickBotNeighbours(bots, 20, alea("b")).map((bot) => bot.userid);

    expect(new Set(a).size).toBe(20);
    expect(a).not.toEqual(b);
    expect(pickBotNeighbours(bots, 20, alea("a")).map((bot) => bot.userid)).toEqual(a);
  });
});

describe("botLevelWindow (no bot below the floor: 25 by default, owner 3 Nov 2026)", () => {
  test("a player from 15 up but below the floor gets the nearest bots, 25-27; higher players keep their window from the floor up", () => {
    // Level 15: the window is 8-22, with no bot in it.
    expect(botLevelWindow(neighbourLevelWindow(15))).toEqual({ min: 25, max: 27 });
    // Level 20: 13-27.
    expect(botLevelWindow(neighbourLevelWindow(20))).toEqual({ min: 25, max: 27 });
    // Level 24: 17-31.
    expect(botLevelWindow(neighbourLevelWindow(24))).toEqual({ min: 25, max: 31 });
    // Level 30: 23-37.
    expect(botLevelWindow(neighbourLevelWindow(30))).toEqual({ min: 25, max: 37 });
    // Level 35: 28-42, as before.
    expect(botLevelWindow(neighbourLevelWindow(35))).toEqual({ min: 28, max: 42 });
    expect(FLOOR_REACH).toBe(2);
  });

  test("follows BOTS_FLOOR_LEVEL, or the floor given", () => {
    expect(botLevelWindow(neighbourLevelWindow(3), 15)).toEqual({ min: 15, max: 17 });
    expect(botLevelWindow(neighbourLevelWindow(25), 15)).toEqual({ min: 18, max: 32 });
    const before = process.env.BOTS_FLOOR_LEVEL;
    try {
      process.env.BOTS_FLOOR_LEVEL = "30";
      expect(botLevelWindow(neighbourLevelWindow(20))).toEqual({ min: 30, max: 32 });
    } finally {
      if (before === undefined) delete process.env.BOTS_FLOOR_LEVEL;
      else process.env.BOTS_FLOOR_LEVEL = before;
    }
  });
});

describe("showsBots (owner 3 Nov 2026)", () => {
  test("players under level 15 are shown no bots; from 15 up they are", () => {
    for (const level of [1, 5, 10, 14]) expect(showsBots(level)).toBe(false);
    for (const level of [15, 20, 24, 25, 40, 50]) expect(showsBots(level)).toBe(true);
  });
});
