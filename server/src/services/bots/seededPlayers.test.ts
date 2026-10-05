import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/postgresql";

import { botConfig, seededYardsOn } from "../../config/BotConfig.js";
import { Bot } from "../../database/models/bot.model.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { starterBuildingData } from "../yard/starterBase.js";
import { BOT_MAX_LEVEL, evenSpread } from "./factory.js";
import { giveSeededYards, isBlankSeedYard, planSeededLevels } from "./seededPlayers.js";
import { bookFirstGrows, tends } from "./sweep.js";

/**
 * Real yards for the seeded Map Room 2 dev players (issue #233): which yards
 * count as blank, the level spread, the dev-only guard, and the yards given,
 * driven over an in-memory stand-in for `bym.user`, `bym.save` and `bym.bot`.
 */

const NOW = 1_790_000_000;
const WORLD = "3cff3884-0000-4000-8000-000000000000";

type Row = Record<string, any>;

/** A seeded player's save as `db:seed:mr2` leaves it: a new main save on a Map Room 2 world cell. */
const seededSave = (userid: number): Row => ({
  ...getDefaultBaseData({ userid, username: `seeded${userid}`, sandbox_start: false } as User, BaseType.MAIN),
  type: BaseType.MAIN,
  baseid: String(1000 + userid),
  worldid: WORLD,
  homebase: [String(userid), "7"],
  cell: { x: userid, y: 7 },
});

/** An entity manager over seeded players' saves; `seeded` are the levels of `seeded` bot rows already there. */
const fakeEm = (saves: Map<number, Row>, seeded: number[] = []) => {
  const created: Row[] = [];
  const em: Record<string, unknown> = {
    fork: () => em,
    transactional: async <T>(body: (tx: unknown) => Promise<T>) => body(em),
    execute: async (sql: string) => {
      if (sql.includes("FROM bym.\"user\" u")) {
        return [...saves.entries()].map(([userid, save]) => ({ userid, buildingdata: save.buildingdata }));
      }
      if (sql.includes("state = 'seeded' GROUP BY level")) {
        const counts = new Map<number, number>();
        for (const level of seeded) counts.set(level, (counts.get(level) ?? 0) + 1);
        return [...counts].map(([level, count]) => ({ level, count: String(count) }));
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    findOne: async (_entity: unknown, where: { userid: number }) => saves.get(where.userid) ?? null,
    create: (entity: unknown, data: Row) => {
      expect(entity).toBe(Bot);
      created.push(data);
      return data;
    },
    flush: async () => {},
  };
  return { em: em as unknown as EntityManager, created };
};

describe("isBlankSeedYard", () => {
  test("a new account's yard is blank: the starter set, part of it, or nothing", () => {
    expect(isBlankSeedYard(starterBuildingData())).toBe(true);
    expect(isBlankSeedYard({} as BuildingDataMap)).toBe(true);
    expect(isBlankSeedYard(null)).toBe(true);
    const some = starterBuildingData();
    delete some["4"];
    expect(isBlankSeedYard(some)).toBe(true);
  });

  test("a yard someone has built on or upgraded is not", () => {
    const upgraded = starterBuildingData();
    upgraded["1"] = { ...upgraded["1"]!, l: 2 };
    expect(isBlankSeedYard(upgraded)).toBe(false);

    const built = { ...starterBuildingData(), "5": { id: 5, t: 6, X: 0, Y: 100, l: 1 } } as unknown as BuildingDataMap;
    expect(isBlankSeedYard(built)).toBe(false);
  });
});

describe("planSeededLevels", () => {
  test("2,500 players are spread evenly over levels 1-40, as the bots are, and shuffled", () => {
    const levels = planSeededLevels(2500, {}, mulberry32(233));
    expect(levels).toHaveLength(2500);
    const counts = Array.from({ length: BOT_MAX_LEVEL }, (_, index) => levels.filter((level) => level === index + 1).length);
    expect(counts).toEqual(evenSpread(2500));
    expect(levels).not.toEqual([...levels].sort((a, b) => a - b));
  });

  test("a second run fills the levels the first left short", () => {
    const already: Record<number, number> = {};
    for (let level = 1; level <= 40; level++) already[level] = level <= 20 ? 1 : 0;
    expect(planSeededLevels(20, already, mulberry32(1)).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, index) => 21 + index)
    );
  });

  test("players past an even share still get a level", () => {
    const levels = planSeededLevels(5, { 1: 10 }, mulberry32(2));
    expect(levels).toHaveLength(5);
    for (const level of levels) expect(level).toBeGreaterThanOrEqual(1);
  });
});

describe("the dev-only guard", () => {
  test("seeded yards are given and tended everywhere but production", () => {
    expect(seededYardsOn({ ENV: "local" })).toBe(true);
    expect(seededYardsOn({})).toBe(true);
    expect(seededYardsOn({ ENV: "production" })).toBe(false);
  });

  test("the bot config carries it, and the sweep tends seeded rows only with it", () => {
    const env = process.env.ENV;
    try {
      process.env.ENV = "production";
      expect(botConfig().seeded).toBe(false);
      process.env.ENV = "local";
      expect(botConfig().seeded).toBe(true);
    } finally {
      if (env === undefined) delete process.env.ENV;
      else process.env.ENV = env;
    }
    expect(tends("active", {})).toBe(true);
    expect(tends("active", { seeded: false })).toBe(true);
    expect(tends("seeded", { seeded: true })).toBe(true);
    expect(tends("seeded", { seeded: false })).toBe(false);
    expect(tends("seeded", {})).toBe(false);
    expect(tends("retired", { seeded: true })).toBe(false);
  });

  test("the sweep books seeded players' first grows only when told to", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const em = {
      execute: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return [];
      },
    } as unknown as EntityManager;
    await bookFirstGrows(em, NOW);
    await bookFirstGrows(em, NOW, true);
    expect(calls[0]!.sql).toContain("(b.state = 'active' OR (?::boolean AND b.state = 'seeded'))");
    expect(calls[0]!.params).toEqual([NOW, 3600, false]);
    expect(calls[1]!.params).toEqual([NOW, 3600, true]);
  });

  test("giving yards on production is refused before anything is read", async () => {
    const { em } = fakeEm(new Map([[1, seededSave(1)]]));
    const reads: string[] = [];
    (em as unknown as Row).execute = async (sql: string) => {
      reads.push(sql);
      return [];
    };
    await expect(
      giveSeededYards(em, { rng: mulberry32(1), now: NOW, daysPerLevel: 3, env: { ENV: "production" } })
    ).rejects.toThrow(/dev databases only/);
    expect(reads).toEqual([]);
  });
});

describe("giveSeededYards", () => {
  test("blank seeded players get a generated yard on every level 1-40 and a seeded row; built-on ones are left", async () => {
    const saves = new Map<number, Row>();
    for (let userid = 1; userid <= 40; userid++) saves.set(userid, seededSave(userid));
    const builtOn = seededSave(41);
    builtOn.buildingdata["1"].l = 3;
    saves.set(41, builtOn);
    const { em, created } = fakeEm(saves);

    const batches: number[] = [];
    const report = await giveSeededYards(em, {
      rng: mulberry32(233),
      now: NOW,
      daysPerLevel: 3,
      env: { ENV: "local" },
      onBatch: (batch) => batches.push(batch.length),
    });

    expect(report.notBlank).toBe(1);
    expect(report.given).toHaveLength(40);
    expect(batches).toEqual([25, 15]);
    // Forty players against an even spread: one on each level, 1-40.
    expect(report.given.map((player) => player.level).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1)
    );

    for (const player of report.given) {
      const save = saves.get(player.userid)!;
      // A level 1 yard can be just the starter set, as a level 1 bot's is; above that it is built on.
      if (player.level > 1) {
        expect(isBlankSeedYard(save.buildingdata)).toBe(false);
        expect(Object.keys(save.buildingdata).length).toBeGreaterThan(4);
        expect(Number(save.points)).toBeGreaterThan(0);
      }
      expect(Object.values(save.buildingdata).some((building: any) => building.t === 14)).toBe(true);
      expect(save.level).toBe(player.level);
      expect(save.protected).toBe(0);
      // The account's world, cell and home stay where the seed put them.
      expect(save.worldid).toBe(WORLD);
      expect(save.cell).toEqual({ x: player.userid, y: 7 });
      expect(save.homebase).toEqual([String(player.userid), "7"]);
    }
    expect(created).toHaveLength(40);
    for (const row of created) {
      expect(row.state).toBe("seeded");
      expect(row.level).toBe(report.given.find((player) => player.userid === row.userid)!.level);
      expect(typeof row.seed).toBe("number");
      expect(row.level_since).toBeInstanceOf(Date);
    }
    expect(saves.get(41)!.buildingdata["1"].l).toBe(3);
    expect(created.some((row) => row.userid === 41)).toBe(false);
  }, 60_000);

  test("a yard built on between the read and the write is left alone", async () => {
    const saves = new Map<number, Row>([[1, seededSave(1)]]);
    const { em, created } = fakeEm(saves);
    const findOne = (em as unknown as Row).findOne;
    (em as unknown as Row).findOne = async (entity: unknown, where: { userid: number }) => {
      const save = await findOne(entity, where);
      save.buildingdata["9"] = { id: 9, t: 6, X: 0, Y: 0, l: 1 };
      return save;
    };
    const report = await giveSeededYards(em, { rng: mulberry32(3), now: NOW, daysPerLevel: 3, env: {} });
    expect(report.given).toEqual([]);
    expect(created).toEqual([]);
  });
});
