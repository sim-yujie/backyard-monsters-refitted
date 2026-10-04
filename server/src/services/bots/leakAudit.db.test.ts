import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { User } from "../../database/models/user.model.js";
import { PLACEHOLDER_PIC_SQUARE } from "../../game-data/avatars.js";
import { mulberry32 } from "../../game-rules/combat/rng.js";
import { shapeDiff } from "../../testing/shapeDiff.js";
import { createBots, deleteBots } from "./factory.js";

/**
 * The bot leak audit (issue #245, `docs/design/bot-neighbours.md` §7.4,
 * decision 3): every response a player can get about a bot has exactly the
 * shape the same response about a real player of the same level has, and no
 * response carries an email address or anything from the bot tables.
 *
 * The real routes run against a real Postgres, as a player's requests would:
 * the view and attack loads, Map Room 1's read and `bm/neighbours/get`, the
 * mail targets and thread list, and the attack logs. The real player signed
 * up, loaded their yard and opened Map Room 1 through the same routes; the
 * bot is fresh from the factory, not yet touched by the sweep (the state in
 * which it differed most, before #245).
 *
 * Opt-in, like the other bot `*.db.test.ts`: runs only when BOTS_TEST_DB
 * names a throwaway database with the `bym` schema, and refuses the shared
 * `bym`. Redis is a stand-in in memory, and so is `server.js` (that database
 * and that Redis), so nothing boots; run this file on its own, as the stand-in
 * stays for files run after it in the same process.
 */
const dbName = process.env.BOTS_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

/** Fields a building has only while something runs on it. */
const RUNNING_STATE = new Set(["cB", "cL", "cU", "cF", "cP", "rE", "hp"]);

/** Names that would only be in a response because something about a bot leaked. */
const BOT_ONLY_KEYS = ["persona", "level_since", "retired_at", "grow_drops", "bot_userid", "last_seen_at", "email", "password"];

const PREFIX = "wp12leak";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } }) : null;

/** The entity manager of the request being handled. */
let current: EntityManager | null = null;

const strings = new Map<string, string>();
const sets = new Map<string, Set<string>>();
const redis = {
  get: async (key: string) => strings.get(key) ?? null,
  mget: async (...keys: (string | string[])[]) => keys.flat().map((key) => strings.get(key) ?? null),
  set: async (key: string, value: string) => {
    strings.set(key, String(value));
    return "OK";
  },
  setex: async (key: string, _ttl: number, value: string) => {
    strings.set(key, String(value));
    return "OK";
  },
  del: async (...keys: (string | string[])[]) => keys.flat().filter((key) => strings.delete(key)).length,
  sadd: async (key: string, ...members: (string | string[])[]) => {
    const set = sets.get(key) ?? new Set<string>();
    members.flat().forEach((member) => set.add(String(member)));
    sets.set(key, set);
    return members.flat().length;
  },
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
  srem: async (key: string, ...members: (string | string[])[]) =>
    members.flat().filter((member) => sets.get(key)?.delete(String(member))).length,
  expire: async () => 1,
};

if (enabled) {
  mock.module("../../server.js", () => ({
    postgres: {
      orm,
      get em() {
        if (!current) throw new Error("No request running");
        return current;
      },
    },
    redis,
  }));
}

type Controller = (ctx: Context) => Promise<void>;
type Body = Record<string, unknown>;

describe.skipIf(!enabled)("bots leak nothing to any client (issue #245)", () => {
  const db = orm!;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => db.em.fork().execute<R[]>(query, params);

  let routes: {
    baseLoad: Controller;
    getMapRoom1: Controller;
    getNeighbours: Controller;
    getMessageTargets: Controller;
    getMessageThreads: Controller;
    sendMessage: Controller;
    getAttackLogs: Controller;
  };

  /** Every response a test read, for the checks that span them all. */
  const responses: unknown[] = [];

  /** Runs a route as `email`'s request, as `verifyUserAuth` would hand it over. */
  const call = async (controller: Controller, email: string, body: Body = {}, query: Body = {}) => {
    current = db.em.fork();
    const authUser = await current.findOneOrFail(User, { email });
    const ctx = { authUser, meetsDiscordAgeCheck: true, request: { body }, query, status: 0, body: undefined as unknown };
    try {
      await controller(ctx as unknown as Context);
    } finally {
      current = null;
    }
    responses.push(ctx.body);
    return ctx.body as Body;
  };

  const load = (email: string, type: string, baseid: string) =>
    call(routes.baseLoad, email, { type, userid: "0", baseid, mapversion: "1" });

  /** A player as sign-up makes one (`register.ts`), then their first yard load and a look at Map Room 1. */
  const signUp = async (name: string) => {
    const em = db.em.fork();
    const user = em.create(User, {
      username: name,
      email: `${name}@test.com`,
      password: "x",
      pic_square: PLACEHOLDER_PIC_SQUARE,
      terms_accepted_at: new Date(),
    });
    await em.flush();
    await load(user.email, "build", "0");
    await call(routes.getMapRoom1, user.email);
    return user;
  };

  const saveOf = async (userid: number) =>
    (await sql<{ baseid: string; level: number }>(`SELECT baseid, level FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]))[0]!;

  /** A response with `buildingdata` keyed by building type, so yards of different layouts compare. */
  const byType = (body: Body) => {
    const buildings: Record<string, unknown> = {};
    for (const building of Object.values((body.buildingdata ?? {}) as Record<string, { t: number }>)) {
      buildings[String(building.t)] ??= building;
    }
    return { ...body, buildingdata: buildings };
  };

  const expectSameShape = (bot: unknown, real: unknown) => {
    expect(shapeDiff(bot, real, RUNNING_STATE)).toEqual([]);
    if (bot && typeof bot === "object" && real && typeof real === "object") {
      expect(Object.keys(bot).sort()).toEqual(Object.keys(real).sort());
    }
  };

  let viewer: User;
  let rival: User;
  let real: User;
  let bot: { userid: number; username: string; baseid: string };
  const saved = { fill: process.env.BOTS_FILL };

  const cleanUp = async () => {
    await deleteBots(db.em.fork(), "all");
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username LIKE ?`, [`${PREFIX}%`]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.message WHERE userid = ? OR targetid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.thread WHERE userid = ? OR targetid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid = ? OR defender_userid = ?`, [userid, userid]);
      await sql(`DELETE FROM bym.maproom WHERE userid = ?`, [userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL, infernosave_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  beforeAll(async () => {
    routes = {
      baseLoad: (await import("../../controllers/base/load/baseLoad.js")).baseLoad,
      getMapRoom1: (await import("../../controllers/maproom/getMapRoom1.js")).getMapRoom1,
      getNeighbours: (await import("../../controllers/maproom/getNeighbours.js")).getNeighbours,
      getMessageTargets: (await import("../../controllers/mail/getMessageTargets.js")).getMessageTargets,
      getMessageThreads: (await import("../../controllers/mail/getMessageThreads.js")).getMessageThreads,
      sendMessage: (await import("../../controllers/mail/sendMessage.js")).sendMessage,
      getAttackLogs: (await import("../../controllers/attacklogs/getAttackLogs.js")).getAttackLogs,
    };
    process.env.BOTS_FILL = "on";
    await cleanUp();

    [bot] = await createBots(db.em.fork(), [1], { rng: mulberry32(245), now: Math.floor(Date.now() / 1000), daysPerLevel: 3 });
    // The real player first, so the viewer's first Map Room 1 search finds them.
    real = await signUp(`${PREFIX}real`);
    rival = await signUp(`${PREFIX}rival`);
    viewer = await signUp(`${PREFIX}viewer`);
    // A player who has attacked someone has lost the new-player protection, as every bot has none.
    await sql(`UPDATE bym.save SET protected = 0 WHERE userid = ?`, [real.userid]);
    // And has since closed the game: online, they could not be attacked.
    strings.delete(`last-seen:main:${real.userid}`);
  }, 120_000);

  afterAll(async () => {
    if (saved.fill === undefined) delete process.env.BOTS_FILL;
    else process.env.BOTS_FILL = saved.fill;
    await cleanUp();
    await db.close(true);
  });

  test("the real player and the bot stand on the same level", async () => {
    expect((await saveOf(real.userid)).level).toBe(1);
    expect((await saveOf(bot.userid)).level).toBe(1);
  });

  test("the view load", async () => {
    const ofReal = await load(viewer.email, "view", (await saveOf(real.userid)).baseid);
    const ofBot = await load(viewer.email, "view", bot.baseid);
    expectSameShape(byType(ofBot), byType(ofReal));
    // Both have opened Map Room 1, as every player who looks for a fight has.
    expect((ofBot.wmstatus as unknown[]).length).toBe((ofReal.wmstatus as unknown[]).length);
  });

  test("Map Room 1's read and bm/neighbours/get: the two entries", async () => {
    for (const read of [() => call(routes.getMapRoom1, viewer.email), () => call(routes.getNeighbours, viewer.email)]) {
      const body = await read();
      const list = (body.neighbours ?? body.bases) as Body[];
      const ofReal = list.find((entry) => entry.userid === real.userid);
      const ofBot = list.find((entry) => entry.userid === bot.userid);
      expect(ofReal).toBeDefined();
      expect(ofBot).toBeDefined();
      expectSameShape(ofBot, ofReal);
    }
  });

  test("the attack load", async () => {
    // Two attackers, so neither attack load finds the other attack running.
    const onReal = await load(viewer.email, "attack", (await saveOf(real.userid)).baseid);
    const onBot = await load(rival.email, "attack", bot.baseid);
    expect(onReal.error).toBe(0);
    expect(onBot.error).toBe(0);
    expectSameShape(byType(onBot), byType(onReal));
  });

  test("the attack logs", async () => {
    const ofReal = (await call(routes.getAttackLogs, viewer.email, {}, { filter: "both" })).attackLogs as Body[];
    const ofBot = (await call(routes.getAttackLogs, rival.email, {}, { filter: "both" })).attackLogs as Body[];
    expect(ofReal.find((log) => log.defender_userid === real.userid)).toBeDefined();
    expect(ofBot.find((log) => log.defender_userid === bot.userid)).toBeDefined();
    expectSameShape(JSON.parse(JSON.stringify(ofBot[0])), JSON.parse(JSON.stringify(ofReal[0])));
  });

  test("mail: the message targets and the thread list", async () => {
    for (const target of [real.userid, bot.userid]) {
      const sent = await call(routes.sendMessage, viewer.email, {
        threadid: "0",
        targetid: String(target),
        subject: "Hello",
        type: "message",
        message: "Nice yard.",
        targetbaseid: "0",
      });
      expect(sent.error).toBe(0);
    }

    const { targets } = (await call(routes.getMessageTargets, viewer.email)) as { targets: Record<string, Body> };
    expectSameShape(targets[bot.userid], targets[real.userid]);

    const { threads } = (await call(routes.getMessageThreads, viewer.email)) as { threads: Record<string, Body> };
    const listed = Object.values(threads);
    const withReal = listed.find((thread) => thread.targetid === real.userid);
    const withBot = listed.find((thread) => thread.targetid === bot.userid);
    expectSameShape(withBot, withReal);
  });

  test("no response carries an email address or anything from the bot tables", async () => {
    const [botUser] = await sql<{ email: string }>(`SELECT email FROM bym."user" WHERE userid = ?`, [bot.userid]);
    const text = JSON.stringify(responses);
    expect(text).not.toContain(botUser!.email);
    expect(text).not.toContain("@bymr.invalid");
    expect(text).not.toContain(real.email);
    for (const key of BOT_ONLY_KEYS) expect(text).not.toContain(`"${key}":`);
  });
});
