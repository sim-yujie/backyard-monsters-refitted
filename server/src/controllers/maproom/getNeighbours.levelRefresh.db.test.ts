import { afterAll, describe, expect, mock, test } from "bun:test";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import type { User } from "../../database/models/user.model.js";
import type { Save } from "../../database/models/save.model.js";

/**
 * The Map Room 1 list is searched again once the player's level has moved
 * more than 7 levels from the level it was built for (owner, 2026-10-23,
 * replacing decision 23 of `docs/design/bot-neighbours.md`). A list built at
 * level 5 still holds at level 12, and is searched again at level 13.
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when NEIGHBOURS_TEST_DB
 * names a throwaway database holding an empty copy of the `bym` schema, and
 * refuses the shared `bym`. Every test writes inside a transaction that is
 * rolled back. Redis is a stand-in in memory, and so is `server.js`; run this
 * file on its own, as the stand-in stays for files run after it.
 */
const dbName = process.env.NEIGHBOURS_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } }) : null;

/** The entity manager of the transaction being run. */
let current: EntityManager | null = null;

if (enabled) {
  mock.module("../../server.js", () => ({
    postgres: {
      orm,
      get em() {
        if (!current) throw new Error("No transaction running");
        return current;
      },
    },
    redis: memoryRedis(),
  }));
}

const { overworldNeighbours } = await import("./getNeighbours.js");

const pointsFor = (level: number) => String(experiencePoints[level - 1]);
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60 * 1000);

/** Ids well clear of anything a scratch copy may hold. */
let nextId = 993_000;

class Rollback extends Error {}

const addPlayer = async (em: EntityManager, level: number): Promise<number> => {
  const userid = nextId++;
  await em.execute(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', now())`,
    [userid, `nr_${userid}`, `nr_${userid}@test.invalid`]
  );
  await em.execute(
    `INSERT INTO bym.save (userid, saveuserid, baseid, type, mapversion, points, basevalue,
                           createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
     VALUES (?, ?, ?, 'main', 1, ?, '0', 0, 'yard', 0, '[]', now(), now(), now())`,
    [userid, userid, `${userid}00`, pointsFor(level)]
  );
  return userid;
};

describe.skipIf(!enabled)("the Map Room 1 list follows the player's level (owner, 2026-10-23)", () => {
  afterAll(async () => {
    await orm?.close(true);
  });

  /** Runs `body` in a transaction that is always rolled back, as `postgres.em`. */
  const rolledBack = async (body: (em: EntityManager) => Promise<void>) => {
    try {
      await orm!.em.fork().transactional(async (em) => {
        current = em;
        await body(em);
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    } finally {
      current = null;
    }
  };

  /**
   * A player whose list was built at level 5 ten minutes ago (inside the
   * 30-minute retry, so only a level move can search again), and a real
   * player at level 13 whom only a search from level 13's window would find.
   */
  const builtAtLevel5 = async (em: EntityManager) => {
    const player = await addPlayer(em, 5);
    const levelThirteen = await addPlayer(em, 13);
    const builtAt = minutesAgo(10);
    await em.execute(
      `INSERT INTO bym.maproom (userid, tribedata, neighbors, neighbors_last_calculated, neighbors_level,
                                dropped_neighbours, created_at, lastupdate_at)
       VALUES (?, '[]', '[]', ?, 5, '[]', now(), now())`,
      [player, builtAt]
    );
    return { player, levelThirteen, builtAt };
  };

  const maproomRow = async (em: EntityManager, userid: number) => {
    const [row] = await em.execute<{ neighbors_last_calculated: Date; neighbors_level: number | null }[]>(
      `SELECT neighbors_last_calculated, neighbors_level FROM bym.maproom WHERE userid = ?`,
      [userid]
    );
    return row;
  };

  const open = (player: number, level: number) =>
    overworldNeighbours(
      { userid: player } as User,
      { points: pointsFor(level), basevalue: "0" } as Save
    );

  test("at level 12 the list built at level 5 is kept", async () => {
    await rolledBack(async (em) => {
      const { player, builtAt } = await builtAtLevel5(em);

      const neighbours = await open(player, 12);

      expect(neighbours).toEqual([]);
      const row = await maproomRow(em, player);
      expect(new Date(row.neighbors_last_calculated).getTime()).toBe(builtAt.getTime());
      expect(row.neighbors_level).toBe(5);
    });
  });

  test("at level 13 the list is searched again from level 13, and notes it", async () => {
    await rolledBack(async (em) => {
      const { player, levelThirteen, builtAt } = await builtAtLevel5(em);

      const neighbours = await open(player, 13);

      expect(neighbours.map((neighbour) => neighbour.userid)).toContain(levelThirteen);
      const row = await maproomRow(em, player);
      expect(new Date(row.neighbors_last_calculated).getTime()).toBeGreaterThan(builtAt.getTime());
      expect(row.neighbors_level).toBe(13);
    });
  });

  test("a list from before levels were noted is searched again once, and notes the level", async () => {
    await rolledBack(async (em) => {
      const { player } = await builtAtLevel5(em);
      await em.execute(`UPDATE bym.maproom SET neighbors_level = NULL WHERE userid = ?`, [player]);

      await open(player, 5);

      expect((await maproomRow(em, player)).neighbors_level).toBe(5);
    });
  });
});
