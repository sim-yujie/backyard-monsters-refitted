import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { useBotFloor } from "../../testing/botFloor.js";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { RETIRE_BOTS_SQL } from "../../database/migrations/20261117_RetireBots.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { createBots, deleteBots } from "./factory.js";

/**
 * The migration that retires every bot (owner, 12 Nov 2026,
 * `20261117_RetireBots.ts`) against a real Postgres: active bots leave Map
 * Room 1 and become `retired`, their jobs go, a seeded dev player is left
 * alone, and a player's cached list loses its bots, keeps its real
 * neighbours (with their attack counters) and is searched again on its next
 * read. Run twice, it changes nothing more.
 *
 * Opt-in, like `factory.db.test.ts`: runs only when BOTS_TEST_DB names a
 * throwaway database with the `bym` schema, and refuses the shared `bym`.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const T = 3;
const PLAYER = "retirebots1";
const NEIGHBOUR = "retirebots2";

describe.skipIf(!dbName)("retiring every bot (migration 20261117_RetireBots)", () => {
  useBotFloor(15);

  let orm: MikroORM;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const removePlayers = async () => {
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username IN (?, ?)`, [PLAYER, NEIGHBOUR]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.maproom WHERE userid = ?`, [userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  const reset = async () => {
    await removePlayers();
    await sql(`UPDATE bym.bot SET state = 'active' WHERE state = 'seeded'`);
    await deleteBots(orm.em.fork(), "all");
  };

  const player = async (username: string) => {
    const em = orm.em.fork();
    const user = em.create(User, { username, email: `${username}@test.com`, password: "x" });
    await em.flush();
    await Save.createMainSave(em, user);
    return user.userid;
  };

  const retire = async () => {
    for (const statement of RETIRE_BOTS_SQL) await sql(statement);
  };

  const botRow = async (userid: number) => (await sql(`SELECT * FROM bym.bot WHERE userid = ?`, [userid]))[0]!;
  const mainSave = async (userid: number) =>
    (await sql(`SELECT mapversion, worldid, points FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!;

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await orm.close(true);
  });

  test("active bots leave Map Room 1 retired, with no jobs; seeded players and real yards are untouched", async () => {
    const [botA, botB, seeded] = await createBots(orm.em.fork(), [20, 25, 30], { rng: mulberry32(1112), now: NOW, pace: T });
    await sql(`UPDATE bym.bot SET state = 'seeded' WHERE userid = ?`, [seeded!.userid]);
    const me = await player(PLAYER);
    const pointsBefore = (await mainSave(botA!.userid)).points;

    await sql(
      `INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'grow', now()), (?, 'grow', now()), (?, 'repair', now()), (?, 'grow', now())`,
      [botA!.userid, botB!.userid, botB!.userid, seeded!.userid]
    );
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, target_userid, due_at) VALUES (?, 'revenge', ?, now())`, [
      botA!.userid,
      me,
    ]);

    await retire();

    for (const bot of [botA!, botB!]) {
      expect(await botRow(bot.userid)).toMatchObject({ state: "retired" });
      expect((await botRow(bot.userid)).retired_at).not.toBeNull();
      expect(await mainSave(bot.userid)).toMatchObject({ mapversion: 2, worldid: null });
      expect(await sql(`SELECT * FROM bym.bot_job WHERE bot_userid = ?`, [bot.userid])).toEqual([]);
    }
    // The yard itself is kept as it was: the account, its name and its yard stay for logs and mail.
    expect((await mainSave(botA!.userid)).points).toBe(pointsBefore);
    expect(await sql(`SELECT userid FROM bym."user" WHERE userid = ?`, [botA!.userid])).toHaveLength(1);

    // The seeded dev player keeps its row, its Map Room and its job.
    expect(await botRow(seeded!.userid)).toMatchObject({ state: "seeded" });
    expect((await mainSave(seeded!.userid)).mapversion).toBe(1);
    expect((await sql(`SELECT kind FROM bym.bot_job WHERE bot_userid = ?`, [seeded!.userid])).map((j) => j.kind)).toEqual([
      "grow",
    ]);

    // A real player's yard stays where it was.
    expect((await mainSave(me)).mapversion).toBe(1);
  }, 60_000);

  test("a cached list loses its bots, keeps its real neighbours and their counters, and is searched again", async () => {
    const [botA, botB] = await createBots(orm.em.fork(), [20, 25], { rng: mulberry32(1113), now: NOW, pace: T });
    const me = await player(PLAYER);
    const real = await player(NEIGHBOUR);
    const cached = [
      { userid: botA!.userid, baseid: "1", attacksToday: 2 },
      { userid: real, baseid: "2", attacksToday: 1, attacksTodayAt: NOW },
      { userid: botB!.userid, baseid: "3" },
    ];
    await sql(
      `INSERT INTO bym.maproom (userid, neighbors, neighbors_last_calculated, neighbors_level, created_at, lastupdate_at)
       VALUES (?, ?::jsonb, now(), 20, now(), now())`,
      [me, JSON.stringify(cached)]
    );
    // A list with no bots in it is left alone, its cache date and all.
    await sql(
      `INSERT INTO bym.maproom (userid, neighbors, neighbors_last_calculated, neighbors_level, created_at, lastupdate_at)
       VALUES (?, ?::jsonb, now(), 20, now(), now())`,
      [real, JSON.stringify([{ userid: me, baseid: "9" }])]
    );

    await retire();

    const [mine] = await sql(`SELECT neighbors, neighbors_last_calculated FROM bym.maproom WHERE userid = ?`, [me]);
    expect(mine!.neighbors).toEqual([{ userid: real, baseid: "2", attacksToday: 1, attacksTodayAt: NOW }]);
    expect(mine!.neighbors_last_calculated).toBeNull();

    const [theirs] = await sql(`SELECT neighbors, neighbors_last_calculated FROM bym.maproom WHERE userid = ?`, [real]);
    expect(theirs!.neighbors).toEqual([{ userid: me, baseid: "9" }]);
    expect(theirs!.neighbors_last_calculated).not.toBeNull();

    // Run again: nothing more changes.
    await sql(`UPDATE bym.maproom SET neighbors_last_calculated = now() WHERE userid = ?`, [me]);
    await retire();
    const [again] = await sql(`SELECT neighbors, neighbors_last_calculated FROM bym.maproom WHERE userid = ?`, [me]);
    expect(again!.neighbors).toEqual(mine!.neighbors);
    expect(again!.neighbors_last_calculated).not.toBeNull();
  }, 60_000);

  test("a list of nothing but bots is left empty, ready for a fresh search", async () => {
    const [bot] = await createBots(orm.em.fork(), [20], { rng: mulberry32(1114), now: NOW, pace: T });
    const me = await player(PLAYER);
    await sql(
      `INSERT INTO bym.maproom (userid, neighbors, neighbors_last_calculated, neighbors_level, created_at, lastupdate_at)
       VALUES (?, ?::jsonb, now(), 20, now(), now())`,
      [me, JSON.stringify([{ userid: bot!.userid, baseid: "1" }])]
    );

    await retire();

    const [mine] = await sql(`SELECT neighbors, neighbors_last_calculated FROM bym.maproom WHERE userid = ?`, [me]);
    expect(mine).toEqual({ neighbors: [], neighbors_last_calculated: null });
  }, 60_000);
});
