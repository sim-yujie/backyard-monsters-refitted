import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { RedisClient } from "bun";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { BotConfig } from "../../config/BotConfig.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { scheduleAfterBotDefence } from "./afterAttack.js";
import { createBots, deleteBots } from "./factory.js";
import { REBALANCE_JOB, runBotSweep, type RevengeRunner, type SweepReport } from "./sweep.js";

/**
 * A bot's revenge fought for real (issue #244), end to end: a bot made by the
 * factory, a player's yard, the after-attack booking, the sweep's checks with
 * the player's real last-seen key, and the runner's attack load, checkpoint
 * and landing through the real finaliser and replay worker. Then a revenge
 * whose replay runs past its deadline: nothing spent, and the attack
 * finaliser's sweep lands it exactly once, as the in-process replay of the
 * same log and seed fights it.
 *
 * Opt-in and heavy: runs only when BOTS_TEST_DB names a throwaway database
 * with the `bym` schema AND BOTS_TEST_REDIS names a Redis database of its own
 * (`redis://localhost:6379/11`, never database 0, which a running server
 * reads: its attack finaliser would land these checkpoints against its own
 * rows). `server.js` is stood in for with that database and that Redis, so
 * nothing boots. Run this file on its own: the stand-in stays for files run
 * after it in the same process.
 */
const dbName = process.env.BOTS_TEST_DB;
const redisUrl = process.env.BOTS_TEST_REDIS;
const enabled = !!dbName && !!redisUrl;

const HEAVY_MS = 120_000;
const MINUTE = 60;
const HOUR = 60 * MINUTE;
const now = () => Math.floor(Date.now() / 1000);
const at = (seconds: number) => new Date(seconds * 1000);

const postgres = {} as { orm: MikroORM; em: MikroORM["em"] };
const redis = enabled ? new RedisClient(redisUrl) : (null as unknown as RedisClient);
if (enabled) mock.module("../../server.js", () => ({ postgres, redis }));

describe.skipIf(!enabled)("a bot's revenge fought for real (issue #244)", () => {
  let orm: MikroORM;
  let bot = 0;
  let secondBot = 0;
  let player = 0;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const yard = async (userid: number) =>
    (await sql(`SELECT * FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!;
  const housedTotal = (save: Record<string, any>) =>
    Object.values((save.monsters?.housed ?? {}) as Record<string, number>).reduce((sum, count) => sum + count, 0);
  const pool = (save: Record<string, any>) =>
    ["r1", "r2", "r3", "r4"].reduce((sum, key) => sum + Number(save.resources?.[key] ?? 0), 0);
  const config = (): BotConfig => ({ fill: false, brain: true, revenge: true, total: 3, daysPerLevel: 3 });

  let modules: {
    runRevengeAttack: typeof import("./revengeRun.js").runRevengeAttack;
    seenRecently: typeof import("./revengeRun.js").seenRecently;
    finaliseExpiredAttacks: typeof import("../base/finaliseAttack.js").finaliseExpiredAttacks;
    ReplayTimeoutError: typeof import("../base/combat/replayRunner.js").ReplayTimeoutError;
  };

  const realRunner = (): RevengeRunner => ({
    isOnline: modules.seenRecently,
    attack: (input) => modules.runRevengeAttack(input),
  });

  const pass = async (runner: RevengeRunner = realRunner()): Promise<SweepReport> =>
    (await runBotSweep({ em: orm.em, now, config, rng: () => 0, revenge: runner }))!;

  /** The player attacked `by`: the after-attack booking, its revenge made due now. */
  const attackedBot = async (by: number) => {
    const booked = await scheduleAfterBotDefence(orm.em, {
      bot: by,
      attacker: player,
      at: new Date(),
      rng: () => 0,
      revenge: true,
    });
    expect(booked.revenge).not.toBeNull();
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'revenge' AND bot_userid = ?`, [at(now() - MINUTE), by]);
    await sql(`DELETE FROM bym.bot_job WHERE kind = 'repair'`);
  };
  const revengeJobs = () => sql(`SELECT * FROM bym.bot_job WHERE kind = 'revenge'`);
  const neighbourFor = async (userid: number, of: number) => {
    const [room] = await sql<{ neighbors: { userid: number; attacksfrom?: number; retaliatecount?: number }[] }>(
      `SELECT neighbors FROM bym.maproom WHERE userid = ?`,
      [userid]
    );
    return room?.neighbors.find((entry) => entry.userid === of);
  };

  const dropPlayer = async () => {
    if (!player) return;
    for (const table of ["message", "thread"]) {
      await sql(`DELETE FROM bym.${table} WHERE targetid = ? OR userid = ?`, [player, player]);
    }
    await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid = ? OR defender_userid = ?`, [player, player]);
    await sql(`DELETE FROM bym.maproom WHERE userid = ?`, [player]);
    await sql(`DELETE FROM bym."user" WHERE userid = ?`, [player]);
    await sql(`DELETE FROM bym.save WHERE userid = ?`, [player]);
  };

  /** Only ever this test's own Redis database. */
  const clearRedis = async () => {
    const info = String(await redis.send("CLIENT", ["INFO"]));
    const db = Number(/\bdb=(\d+)/.exec(info)?.[1]);
    if (!(db > 0)) throw new Error(`BOTS_TEST_REDIS must select a Redis database other than 0 (got ${info})`);
    const keys = (await redis.send("KEYS", ["*"])) as string[];
    for (const key of keys) await redis.del(key);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 8 } });
    postgres.orm = orm;
    postgres.em = orm.em;
    await redis.connect();
    await clearRedis();

    const run = await import("./revengeRun.js");
    const finaliser = await import("../base/finaliseAttack.js");
    const replay = await import("../base/combat/replayRunner.js");
    modules = {
      runRevengeAttack: run.runRevengeAttack,
      seenRecently: run.seenRecently,
      finaliseExpiredAttacks: finaliser.finaliseExpiredAttacks,
      ReplayTimeoutError: replay.ReplayTimeoutError,
    };

    await deleteBots(orm.em.fork(), "all");
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
    // Two bots of level 25 and 26, and a level 20 player: a bot-made yard
    // grown once by the sweep (a real catch-up), then taken out of the bot table.
    const made = await createBots(orm.em.fork(), [25, 26, 20], { rng: mulberry32(2244), now: now(), daysPerLevel: 3 });
    [bot, secondBot, player] = made.map((one) => one.userid) as [number, number, number];
    await sql(`INSERT INTO bym.job_run (job, period, ran_at) VALUES (?, ?, now())`, [
      REBALANCE_JOB,
      at(now()).toISOString().slice(0, 10),
    ]);
    await runBotSweep({ em: orm.em, now, config: () => ({ ...config(), revenge: false }), rng: () => 0.5 });
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [at(now() - MINUTE)]);
    await runBotSweep({ em: orm.em, now, config: () => ({ ...config(), revenge: false }), rng: () => 0.5 });
    await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'grow'`, [at(now() + 10 * HOUR)]);
    await sql(`DELETE FROM bym.bot_job WHERE bot_userid = ?`, [player]);
    await sql(`DELETE FROM bym.bot WHERE userid = ?`, [player]);
    await sql(`UPDATE bym.save SET protected = 0, attackid = 0 WHERE userid IN (?, ?, ?)`, [bot, secondBot, player]);
  }, HEAVY_MS);

  afterAll(async () => {
    if (!enabled || !orm) return;
    await deleteBots(orm.em.fork(), "all");
    await dropPlayer();
    await sql(`DELETE FROM bym.job_run WHERE job = ?`, [REBALANCE_JOB]);
    await clearRedis();
    redis.close();
    await orm.close(true);
  }, HEAVY_MS);

  test(
    "online and protected wait; then the revenge lands like a real attack",
    async () => {
      await attackedBot(bot);

      // Online: the player's last-seen key from a presence ping 30 seconds ago.
      await redis.setex(`last-seen:main:${player}`, 120, String(now() - 30));
      expect((await pass()).revenge).toEqual({ "wait:online": 1 });
      await redis.del(`last-seen:main:${player}`);

      // Protected for another hour: again 1-6 hours after it ends.
      await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'revenge'`, [at(now() - MINUTE)]);
      await sql(`UPDATE bym.save SET protected = ? WHERE userid = ?`, [now() + HOUR, player]);
      expect((await pass()).revenge).toEqual({ "wait:protected": 1 });
      const [waiting] = await revengeJobs();
      expect(new Date(waiting!.due_at).getTime() / 1000).toBeGreaterThanOrEqual(now() + 2 * HOUR - 5);
      await sql(`UPDATE bym.save SET protected = 0 WHERE userid = ?`, [player]);
      await sql(`UPDATE bym.bot_job SET due_at = ? WHERE kind = 'revenge'`, [at(now() - MINUTE)]);

      const yardBefore = await yard(player);
      const botBefore = await yard(bot);
      const started = now();
      expect((await pass()).revenge).toEqual({ landed: 1 });
      expect(await revengeJobs()).toEqual([]);

      // The player's yard: real damage and real loot, the attack over.
      const yardAfter = await yard(player);
      expect(Number(yardAfter.damage)).toBeGreaterThan(Number(yardBefore.damage ?? 0));
      expect(pool(yardAfter)).toBeLessThan(pool(yardBefore));
      expect(Number(yardAfter.attackid)).toBe(0);
      expect(yardAfter.attackreport).not.toContain("Left the attack");
      // Post-attack protection, as for any attacker: 36 hours once damage reaches 50%.
      if (Number(yardAfter.damage) >= 50) expect(Number(yardAfter.protected)).toBeGreaterThan(started + 35 * HOUR);
      expect(yardAfter.lastattackername).toBeDefined();

      // The bot: monsters spent, loot banked, its own protection gone.
      const botAfter = await yard(bot);
      expect(housedTotal(botAfter)).toBeLessThan(housedTotal(botBefore));
      expect(pool(botAfter)).toBeGreaterThan(pool(botBefore));
      expect(Number(botAfter.protected)).toBe(0);

      // The record: an attack log, the map counters, retaliatecount + 1.
      const logs = await sql(`SELECT * FROM bym.attack_logs WHERE attacker_userid = ? AND defender_userid = ?`, [
        bot,
        player,
      ]);
      expect(logs).toHaveLength(1);
      expect(await neighbourFor(player, bot)).toMatchObject({ attacksfrom: 1, retaliatecount: 1 });

      // The defence notice, as any attacker's: from the game, unread, naming the bot.
      const [botUser] = await sql(`SELECT username FROM bym."user" WHERE userid = ?`, [bot]);
      const notices = await sql(`SELECT * FROM bym.message WHERE targetid = ? AND userid = 0`, [player]);
      expect(notices).toHaveLength(1);
      expect(String(notices[0]!.subject) + String(notices[0]!.message)).toContain(botUser!.username);

      // Nothing left in Redis but what an attack always leaves.
      const keys = (await redis.send("KEYS", ["attack-*"])) as string[];
      expect(keys.filter((key) => key.startsWith("attack-checkpoint:"))).toEqual([]);

      // The same revenge never runs twice: a second booking for the same attack is refused by the log.
      await sql(
        `INSERT INTO bym.bot_job (bot_userid, kind, target_userid, due_at, giveup_at, created_at) VALUES (?, 'revenge', ?, ?, ?, ?)`,
        [bot, player, at(now() - MINUTE), at(started - HOUR + 72 * HOUR), at(started - HOUR)]
      );
      await sql(`UPDATE bym.save SET protected = 0 WHERE userid = ?`, [player]);
      expect((await pass()).revenge).toEqual({ "cancel:alreadyAvenged": 1 });
    },
    HEAVY_MS
  );

  test(
    "a replay past its deadline spends nothing, and the finaliser lands it exactly once, as the same log and seed fight",
    async () => {
      await sql(`UPDATE bym.save SET protected = 0 WHERE userid = ?`, [player]);
      await attackedBot(secondBot);

      const yardBefore = await yard(player);
      const botBefore = await yard(secondBot);
      const timingOut: RevengeRunner = {
        isOnline: modules.seenRecently,
        attack: (input) =>
          modules.runRevengeAttack(input, {
            land: async () => {
              throw new modules.ReplayTimeoutError(1);
            },
          }),
      };
      expect((await pass(timingOut)).revenge).toEqual({ pending: 1 });
      expect(await revengeJobs()).toEqual([]);

      // Committed but not landed: the yard and the bot's army as they were, the checkpoint kept.
      const yardHeld = await yard(player);
      expect(yardHeld.buildinghealthdata).toEqual(yardBefore.buildinghealthdata);
      expect(pool(yardHeld)).toBe(pool(yardBefore));
      expect(Number(yardHeld.attackid)).toBeGreaterThan(0);
      expect(housedTotal(await yard(secondBot))).toBeGreaterThanOrEqual(housedTotal(botBefore));
      const key = `attack-checkpoint:${yardHeld.basesaveid}`;
      const stored = JSON.parse((await redis.get(key))!);
      expect(stored.attackerid).toBe(secondBot);
      expect(await neighbourFor(player, secondBot)).toMatchObject({ retaliatecount: 1 });

      // The window closes; the battle the finaliser will fight, in process, from the same log and seed.
      stored.startedat -= 8 * MINUTE;
      await redis.setex(key, 7 * 24 * HOUR, JSON.stringify(stored));
      const { battleReplayInput } = await import("../base/combat/battle.js");
      const { replayAbandonedAttack } = await import("../base/combat/abandonedAttack.js");
      const { checkpointSession } = await import("../base/attackCheckpoint.js");
      const botNow = await yard(secondBot);
      const input = battleReplayInput({
        flinglog: stored.flinglog,
        session: checkpointSession(stored),
        defender: {
          type: yardHeld.type,
          buildingdata: yardHeld.buildingdata,
          buildinghealthdata: yardHeld.buildinghealthdata,
          resources: yardHeld.resources,
        },
        attacker: botNow,
        tick: stored.tick,
        declareWar: false,
      })!;
      const expected = replayAbandonedAttack(input);

      expect(await modules.finaliseExpiredAttacks()).toBe(1);
      expect(await modules.finaliseExpiredAttacks()).toBe(0);

      const yardAfter = await yard(player);
      expect(yardAfter.buildinghealthdata).toEqual(expected.buildinghealthdata);
      expect(Number(yardAfter.damage)).toBe(Math.trunc(expected.damage ?? 0));
      expect(Number(yardAfter.attackid)).toBe(0);
      expect(housedTotal(await yard(secondBot))).toBeLessThan(housedTotal(botNow));
      expect(await redis.get(key)).toBeNull();
      // Two notices now, one per attack.
      expect(await sql(`SELECT * FROM bym.message WHERE targetid = ? AND userid = 0`, [player])).toHaveLength(2);
    },
    HEAVY_MS
  );
});
