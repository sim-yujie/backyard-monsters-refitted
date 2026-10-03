import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import ormConfig from "../../../mikro-orm.config.js";
import { experiencePoints } from "../../../game-data/stats/experiencePoints.js";
import { NEIGHBOUR_LIMIT, findOverworldNeighbours } from "./findOverworldNeighbours.js";

/**
 * The neighbour search's SQL against a real Postgres (issue #236,
 * `docs/design/bot-neighbours.md` §9): the 30-day rule, the level range, the
 * end of the 150-most-recent cut, bots kept out of real places and retired
 * bots out of every list.
 *
 * Opt-in: runs only when NEIGHBOURS_TEST_DB names a throwaway database holding
 * an empty copy of the `bym` schema (e.g. `pg_dump -s -n bym bym | psql -d
 * bym_scratch`; other players in it would join the lists), and refuses the
 * shared `bym` database. Every test writes its rows inside a
 * transaction that is rolled back, so the database is left as it was.
 */
const dbName = process.env.NEIGHBOURS_TEST_DB;

const NOW = new Date("2026-10-03T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
const pointsFor = (level: number) => String(experiencePoints[level - 1]);

/** Ids well clear of anything a scratch copy may hold. */
const PLAYER = 990_000;
let nextId = PLAYER;

class Rollback extends Error {}

const addPlayer = async (
  em: EntityManager,
  { level, seen, mapversion = 1, updated = daysAgo(1) }: { level: number; seen: Date | null; mapversion?: number; updated?: Date }
): Promise<number> => {
  const userid = nextId++;
  await em.execute(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', ?)`,
    [userid, `wp3_${userid}`, `wp3_${userid}@test.invalid`, seen]
  );
  await em.execute(
    `INSERT INTO bym.save (userid, saveuserid, baseid, type, mapversion, points, basevalue,
                           createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
     VALUES (?, ?, ?, 'main', ?, ?, '0', 0, 'yard', 0, '[]', now(), now(), ?)`,
    [userid, userid, `${userid}00`, mapversion, pointsFor(level), updated]
  );
  return userid;
};

const makeBot = async (em: EntityManager, userid: number, level: number, state = "active") => {
  await em.execute(
    `INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 1, 'towers', ?, now(), ?)`,
    [userid, level, state]
  );
};

describe.skipIf(!dbName)("findOverworldNeighbours on a real database (issue #236)", () => {
  let orm: MikroORM;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("NEIGHBOURS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
  });

  afterAll(async () => {
    await orm?.close(true);
  });

  /** Runs `body` in a transaction that is always rolled back. */
  const rolledBack = async (body: (em: EntityManager) => Promise<void>) => {
    try {
      await orm.em.fork().transactional(async (em) => {
        await body(em);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  };

  test("real players seen in 30 days and in range take places, from anywhere in the table", async () => {
    await rolledBack(async (em) => {
      const player = await addPlayer(em, { level: 20, seen: NOW });

      // Found: seen lately, levels 13-27. The oldest save in the table, so
      // the old 150-most-recent cut would never have reached it.
      const active = await addPlayer(em, { level: 20, seen: daysAgo(1), updated: daysAgo(400) });
      const lowEdge = await addPlayer(em, { level: 13, seen: daysAgo(29) });
      const highEdge = await addPlayer(em, { level: 27, seen: daysAgo(2) });

      // Never found.
      await addPlayer(em, { level: 20, seen: daysAgo(31) });
      await addPlayer(em, { level: 20, seen: null });
      await addPlayer(em, { level: 12, seen: daysAgo(1) });
      await addPlayer(em, { level: 28, seen: daysAgo(1) });
      await addPlayer(em, { level: 20, seen: daysAgo(1), mapversion: 2 });
      for (let i = 0; i < 160; i++) await addPlayer(em, { level: 40, seen: daysAgo(1), updated: NOW });

      // Bots never take a real player's place, retired or not, seen or not.
      const bot = await addPlayer(em, { level: 20, seen: daysAgo(1) });
      await makeBot(em, bot, 20);
      const retired = await addPlayer(em, { level: 20, seen: daysAgo(1) });
      await makeBot(em, retired, 20, "retired");

      const neighbours = await findOverworldNeighbours(
        em,
        { userid: player },
        { points: pointsFor(20), basevalue: "0" },
        { now: NOW, fill: false }
      );

      expect(neighbours.map((n) => n.userid).sort()).toEqual([active, lowEdge, highEdge].sort());
      expect(neighbours.find((n) => n.userid === lowEdge)?.level).toBe(13);
    });
  });

  test("bots fill the rest from active bots within 7 levels; retired bots never appear", async () => {
    await rolledBack(async (em) => {
      const player = await addPlayer(em, { level: 20, seen: NOW });
      const real = await addPlayer(em, { level: 21, seen: daysAgo(3) });

      const inRange = await addPlayer(em, { level: 15, seen: null });
      await makeBot(em, inRange, 15);
      const alsoInRange = await addPlayer(em, { level: 27, seen: daysAgo(1) });
      await makeBot(em, alsoInRange, 27);
      const retired = await addPlayer(em, { level: 20, seen: null });
      await makeBot(em, retired, 20, "retired");
      const tooHigh = await addPlayer(em, { level: 35, seen: null });
      await makeBot(em, tooHigh, 35);
      const offMapRoom1 = await addPlayer(em, { level: 20, seen: null, mapversion: 2 });
      await makeBot(em, offMapRoom1, 20);

      const neighbours = await findOverworldNeighbours(
        em,
        { userid: player },
        { points: pointsFor(20), basevalue: "0" },
        { now: NOW, fill: true }
      );

      expect(neighbours.map((n) => n.userid).sort()).toEqual([real, inRange, alsoInRange].sort());
    });
  });

  test("at most 25, real players first: a full list of real players leaves no room for bots", async () => {
    await rolledBack(async (em) => {
      const player = await addPlayer(em, { level: 10, seen: NOW });
      const reals: number[] = [];
      for (let i = 0; i < 30; i++) reals.push(await addPlayer(em, { level: 10, seen: daysAgo(1 + i / 10) }));
      const bot = await addPlayer(em, { level: 10, seen: null });
      await makeBot(em, bot, 10);

      const neighbours = await findOverworldNeighbours(
        em,
        { userid: player },
        { points: pointsFor(10), basevalue: "0" },
        { now: NOW, fill: true }
      );

      expect(neighbours).toHaveLength(NEIGHBOUR_LIMIT);
      // The most recently seen 25.
      expect(neighbours.map((n) => n.userid).sort()).toEqual(reals.slice(0, NEIGHBOUR_LIMIT).sort());
    });
  });
});
