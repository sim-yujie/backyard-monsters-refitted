import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { devConfig } from "../../config/GameConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { calculateBaseLevel } from "../base/calculateBaseLevel.js";
import {
  activeBotsByLevel,
  BATCH_SIZE,
  botsMadeSince,
  botStatus,
  createBots,
  deleteBots,
  retireAllBots,
} from "./factory.js";

/**
 * The bot factory's writes against a real Postgres (issue #239): the rows a
 * bot is made of, the batches, names unique without case, retire-all and the
 * two deletes.
 *
 * Opt-in: runs only when BOTS_TEST_DB names a throwaway database with the
 * `bym` schema (e.g. `pg_dump -s -n bym bym | psql -d bym_scratch`), and
 * refuses the shared `bym` database. Every test starts from no bots: it
 * deletes every bot in that database, so never point it at one you keep.
 */
const dbName = process.env.BOTS_TEST_DB;

const NOW = Math.floor(Date.now() / 1000);
const T = 3;
const TAKEN_PREFIX = "wp6t";

describe.skipIf(!dbName)("the bot factory on a real database (issue #239)", () => {
  let orm: MikroORM;
  const sandbox = devConfig.devSandbox;

  const sql = <T = Record<string, unknown>>(query: string, params: unknown[] = []) =>
    orm.em.fork().execute<T[]>(query, params);

  const reset = async () => {
    await deleteBots(orm.em.fork(), "all");
    await sql(`DELETE FROM bym.save WHERE userid IN (SELECT userid FROM bym."user" WHERE email LIKE ?)`, [
      `${TAKEN_PREFIX}%`,
    ]);
    await sql(`DELETE FROM bym."user" WHERE email LIKE ?`, [`${TAKEN_PREFIX}%`]);
  };

  const make = (levels: number[], seed = 239) =>
    createBots(orm.em.fork(), levels, { rng: mulberry32(seed), now: NOW, daysPerLevel: T });

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    // A server with DEV_SANDBOX on: bots must still get their generated yard.
    devConfig.devSandbox = true;
  });

  beforeEach(reset);

  afterAll(async () => {
    devConfig.devSandbox = sandbox;
    if (!orm) return;
    await reset();
    await orm.close(true);
  });

  test("a bot is a user, a Map Room 1 main save and a bot row, and nothing else", async () => {
    const made = await make([1, 20, 40]);
    expect(made.map((bot) => bot.level)).toEqual([1, 20, 40]);

    for (const bot of made) {
      const [user] = await sql<Record<string, any>>(`SELECT * FROM bym."user" WHERE userid = ?`, [bot.userid]);
      const saves = await sql<Record<string, any>>(`SELECT * FROM bym.save WHERE userid = ?`, [bot.userid]);
      const [row] = await sql<Record<string, any>>(`SELECT * FROM bym.bot WHERE userid = ?`, [bot.userid]);

      expect(user.username).toBe(bot.username);
      expect(user.email).toMatch(/^bot\+[0-9a-f-]{36}@bymr\.invalid$/);
      expect(user.password).toMatch(/^\$2[aby]\$10\$/);
      expect(user.sandbox_start).toBe(false);

      expect(saves).toHaveLength(1);
      const [save] = saves;
      expect(user.save_basesaveid).toBe(save.basesaveid);
      expect(save.type).toBe("main");
      expect(save.mapversion).toBe(1);
      expect(save.worldid).toBeNull();
      expect(save.protected).toBe(0);
      expect(save.createtime).toBeLessThan(NOW);
      expect(save.baseid).toBe(bot.baseid);
      expect(Number(save.homebaseid)).toBe(Number(bot.baseid));
      expect(save.onboarding).toBeNull();
      expect(calculateBaseLevel(save.points, save.basevalue)).toBe(bot.level);
      // Not the sandbox yard (maxed) and not the bare starter base.
      expect(Object.keys(save.buildingdata).length).toBeGreaterThan(4);

      expect(row.level).toBe(bot.level);
      expect(row.state).toBe("active");
      expect(row.persona).toBe(bot.persona);
      expect(new Date(row.level_since).getTime()).toBeLessThanOrEqual(NOW * 1000);
    }
    expect(await activeBotsByLevel(orm.em.fork())).toEqual({ 1: 1, 20: 1, 40: 1 });
  });

  test("names are unique without case against every user", async () => {
    const first = await make([5, 5, 5, 5, 5], 77);
    await reset();
    // Take every name the same draw gave, in upper case, as players.
    for (const [index, bot] of first.entries()) {
      await sql(`INSERT INTO bym."user" (username, email, password, blocked_users) VALUES (?, ?, 'x', '[]')`, [
        bot.username.toUpperCase(),
        `${TAKEN_PREFIX}${index}@test.invalid`,
      ]);
    }
    const second = await make([5, 5, 5, 5, 5], 77);
    const taken = new Set(first.map((bot) => bot.username.toLowerCase()));
    expect(second.some((bot) => taken.has(bot.username.toLowerCase()))).toBe(false);
    expect(new Set(second.map((bot) => bot.username.toLowerCase())).size).toBe(5);
  });

  test("more than one batch, each committed, all counted", async () => {
    const batches: number[] = [];
    const levels = Array.from({ length: BATCH_SIZE + 5 }, (_, index) => 1 + (index % 3));
    const made = await createBots(orm.em.fork(), levels, {
      rng: mulberry32(5),
      now: NOW,
      daysPerLevel: T,
      onBatch: (batch) => batches.push(batch.length),
    });
    expect(made).toHaveLength(BATCH_SIZE + 5);
    expect(batches).toEqual([BATCH_SIZE, 5]);
    expect(await botsMadeSince(orm.em.fork(), new Date(Date.now() - 60_000))).toBe(BATCH_SIZE + 5);
    const status = await botStatus(orm.em.fork(), new Date());
    expect(status).toMatchObject({ active: BATCH_SIZE + 5, retired: 0, madeToday: BATCH_SIZE + 5 });
  });

  test("retire-all moves every bot off Map Room 1 and drops its jobs", async () => {
    const made = await make([3, 9]);
    await sql(`INSERT INTO bym.bot_job (bot_userid, kind, due_at) VALUES (?, 'grow', now())`, [made[0]!.userid]);

    expect(await retireAllBots(orm.em.fork(), new Date())).toBe(2);
    const rows = await sql<{ state: string; mapversion: number; retired_at: Date | null }>(
      `SELECT b.state, b.retired_at, s.mapversion FROM bym.bot b JOIN bym.save s ON s.userid = b.userid`
    );
    expect(rows.every((row) => row.state === "retired" && row.mapversion === 2 && row.retired_at)).toBe(true);
    expect(await sql(`SELECT * FROM bym.bot_job`)).toEqual([]);
    expect(await activeBotsByLevel(orm.em.fork())).toEqual({});
  });

  test("delete-retired keeps a bot the mail refers to and removes the rest whole", async () => {
    const [kept, gone, active] = await make([4, 6, 8]);
    await sql(`UPDATE bym.bot SET state = 'retired' WHERE userid IN (?, ?)`, [kept!.userid, gone!.userid]);
    await sql(
      `INSERT INTO bym.message
         (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, message, subject, created_at)
       VALUES ('wp6-test-message', 1, 0, 1, ?, 'message', 0, 1, 'hi', 'hi', now())`,
      [kept!.userid]
    );

    expect(await deleteBots(orm.em.fork(), "retired")).toBe(1);
    const left = await sql<{ userid: number }>(`SELECT userid FROM bym.bot ORDER BY userid`);
    expect(left.map((row) => row.userid)).toEqual([kept!.userid, active!.userid]);
    expect(await sql(`SELECT 1 FROM bym."user" WHERE userid = ?`, [gone!.userid])).toEqual([]);
    expect(await sql(`SELECT 1 FROM bym.save WHERE userid = ?`, [gone!.userid])).toEqual([]);

    // remove-all takes the rest, mail included.
    expect(await deleteBots(orm.em.fork(), "all")).toBe(2);
    expect(await sql(`SELECT 1 FROM bym.message WHERE id = 'wp6-test-message'`)).toEqual([]);
    expect(await sql(`SELECT 1 FROM bym."user" WHERE email LIKE 'bot+%'`)).toEqual([]);
    expect(await sql(`SELECT 1 FROM bym.save WHERE userid IN (?, ?)`, [kept!.userid, active!.userid])).toEqual([]);
  });
});
