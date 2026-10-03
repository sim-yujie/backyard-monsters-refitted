import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { REVENGE_CHANCE, scheduleAfterBotDefence } from "./afterAttack.js";

/**
 * The after-attack booking's SQL against a real Postgres (issue #241): the
 * repair and revenge rows, the partial unique indexes, and the caps counted
 * from booked jobs and bots' attack logs.
 *
 * Opt-in: runs only when BOTS_TEST_DB names a throwaway database with the
 * `bym` schema (e.g. `pg_dump -s -n bym bym | psql -d bym_scratch`), and
 * refuses the shared `bym` database. The booking commits in a transaction of
 * its own, so each test clears its rows (ids well clear of anything a scratch
 * copy holds) before it runs and after the last one.
 */
const dbName = process.env.BOTS_TEST_DB;

const HOUR = 60 * 60 * 1000;
const AT = new Date("2026-10-03T12:00:00Z");
const hoursFrom = (hours: number) => new Date(AT.getTime() + hours * HOUR);

const BOT = 991_001;
const OTHER_BOT = 991_002;
const THIRD_BOT = 991_003;
const PLAYER = 991_100;
const USERS = [BOT, OTHER_BOT, THIRD_BOT, PLAYER];

const REVENGE = REVENGE_CHANCE / 2;
const sequence = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length]!;
};

describe.skipIf(!dbName)("scheduleAfterBotDefence on a real database (issue #241)", () => {
  let orm: MikroORM;

  const clear = async () => {
    const em = orm.em.fork();
    await em.execute(`DELETE FROM bym.bot_job WHERE bot_userid IN (?, ?, ?)`, [BOT, OTHER_BOT, THIRD_BOT]);
    await em.execute(`DELETE FROM bym.attack_logs WHERE defender_userid = ?`, [PLAYER]);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("BOTS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    const em = orm.em.fork();
    for (const userid of USERS) {
      await em.execute(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `wp8_${userid}`, `wp8_${userid}@test.invalid`]
      );
    }
    for (const userid of [BOT, OTHER_BOT, THIRD_BOT]) {
      await em.execute(
        `INSERT INTO bym.bot (userid, seed, persona, level, level_since) VALUES (?, 1, 'towers', 10, now())
         ON CONFLICT DO NOTHING`,
        [userid]
      );
    }
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    const em = orm.em.fork();
    await em.execute(`DELETE FROM bym.bot WHERE userid IN (?, ?, ?)`, [BOT, OTHER_BOT, THIRD_BOT]);
    await em.execute(`DELETE FROM bym."user" WHERE userid IN (?, ?, ?, ?)`, USERS);
    await orm.close(true);
  });

  /** The test bots' jobs, oldest first; timestamps come back as text. */
  const jobs = async () =>
    (
      await orm.em
        .fork()
        .execute<{ bot_userid: number; kind: string; target_userid: number | null; due_at: string; giveup_at: string | null }[]>(
          `SELECT bot_userid, kind, target_userid, due_at, giveup_at FROM bym.bot_job
            WHERE bot_userid IN (?, ?, ?) ORDER BY id`,
          [BOT, OTHER_BOT, THIRD_BOT]
        )
    ).map((job) => ({
      ...job,
      due_at: new Date(job.due_at),
      giveup_at: job.giveup_at === null ? null : new Date(job.giveup_at),
    }));

  const attackLog = (attacker: number, at: Date) =>
    orm.em.fork().execute(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, defender_userid, defender_username, type, attacktime)
       VALUES (?, 'a', ?, 'd', 'main', ?)`,
      [attacker, PLAYER, at]
    );

  test("books a repair and a revenge, and a second landing keeps both as they are", async () => {
    const first = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: BOT,
      attacker: PLAYER,
      at: AT,
      rng: sequence(0.5, REVENGE, 0.5),
      revenge: true,
    });
    expect(first).toEqual({ repair: hoursFrom(2.5), revenge: hoursFrom(12.5) });

    const second = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: BOT,
      attacker: PLAYER,
      at: hoursFrom(1),
      rng: sequence(0, REVENGE, 0.9),
      revenge: true,
    });
    expect(second).toEqual({ repair: null, revenge: null });

    expect(await jobs()).toEqual([
      { bot_userid: BOT, kind: "repair", target_userid: null, due_at: hoursFrom(2.5), giveup_at: null },
      { bot_userid: BOT, kind: "revenge", target_userid: PLAYER, due_at: hoursFrom(12.5), giveup_at: hoursFrom(72) },
    ]);
  });

  test("a booked revenge and a bot's landed one fill the player's 24 hours", async () => {
    await attackLog(OTHER_BOT, hoursFrom(-3));
    const booked = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: THIRD_BOT,
      attacker: PLAYER,
      at: AT,
      rng: sequence(0, REVENGE, 0),
      revenge: true,
    });
    expect(booked.revenge).toEqual(hoursFrom(1));

    const refused = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: BOT,
      attacker: PLAYER,
      at: AT,
      rng: sequence(0, REVENGE, 0.5),
      revenge: true,
    });
    expect(refused.revenge).toBeNull();
    expect((await jobs()).filter((job) => job.kind === "revenge").map((job) => job.bot_userid)).toEqual([THIRD_BOT]);
  });

  test("a real player's attack logs never count, a bot's older than the span neither", async () => {
    await attackLog(PLAYER + 1, hoursFrom(-1));
    await attackLog(BOT, hoursFrom(-30));
    const booked = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: BOT,
      attacker: PLAYER,
      at: AT,
      rng: sequence(0, REVENGE, 0),
      revenge: true,
    });
    expect(booked.revenge).toEqual(hoursFrom(1));
  });

  test("the same bot's landed revenge 10 hours ago blocks a pair revenge in its 24 hours", async () => {
    await attackLog(BOT, hoursFrom(-10));
    const booked = await scheduleAfterBotDefence(orm.em.fork(), {
      bot: BOT,
      attacker: PLAYER,
      at: AT,
      rng: sequence(0, REVENGE, 0),
      revenge: true,
    });
    expect(booked.revenge).toBeNull();
  });
});
