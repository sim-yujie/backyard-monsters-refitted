import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { randomUUID } from "node:crypto";

import ormConfig from "../../mikro-orm.config.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import {
  AccountDeletionRefused,
  DELETED_PLAYER_NAME,
  deleteAccount,
  findAccount,
  planAccountDeletion,
  type CommandRedis,
} from "./deleteAccount.js";

/**
 * Deleting one player's account on request (deleteAccount.ts) against a real
 * Postgres and an in-memory Redis: their rows and keys go, other players'
 * history keeps the record without their name, their alliance passes on or
 * disbands, and the dry run touches nothing.
 *
 * Opt-in, like the bot database tests: runs only when PRIVACY_TEST_DB names a
 * throwaway database with the `bym` schema (`bun run db:init` against it),
 * and refuses the shared `bym`. Its players are named `zz_del_*`.
 */
const dbName = process.env.PRIVACY_TEST_DB;

const WORLD = "00000000-0000-4000-8000-00000000d31e";

/** The Redis commands deletion sends, in memory. SCAN answers in one page. */
const fakeRedis = () => {
  const strings = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const sets = new Map<string, Set<string>>();
  const glob = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const allKeys = () => [...strings.keys(), ...lists.keys(), ...sets.keys()];
  const has = (key: string) => strings.has(key) || lists.has(key) || sets.has(key);

  const redis: CommandRedis = {
    send: async (command, args) => {
      switch (command) {
        case "SCAN":
          return ["0", allKeys().filter((key) => glob(args[2]!).test(key))];
        case "EXISTS":
          return has(args[0]!) ? 1 : 0;
        case "DEL":
          return args.filter((key) => strings.delete(key) || lists.delete(key) || sets.delete(key)).length;
        case "LRANGE":
          return [...(lists.get(args[0]!) ?? [])];
        case "LREM": {
          const list = lists.get(args[0]!) ?? [];
          const kept = list.filter((entry) => entry !== args[2]);
          lists.set(args[0]!, kept);
          return list.length - kept.length;
        }
        case "SISMEMBER":
          return sets.get(args[0]!)?.has(args[1]!) ? 1 : 0;
        case "SREM":
          return sets.get(args[0]!)?.delete(args[1]!) ? 1 : 0;
        default:
          throw new Error(`fake redis: ${command} not supported`);
      }
    },
  };
  return { redis, strings, lists, sets };
};

describe.skipIf(!dbName)("deleting a player's account (deleteAccount.ts)", () => {
  let orm: MikroORM;
  let store: ReturnType<typeof fakeRedis>;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
    orm.em.fork().execute<R[]>(query, params);

  const one = async <R = Record<string, any>>(query: string, params: unknown[] = []) =>
    (await sql<R>(query, params))[0];

  const countOf = async (query: string, params: unknown[] = []) =>
    Number((await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${query}`, params))!.n);

  const ids = async () =>
    (await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username LIKE 'zz_del_%'`)).map((row) =>
      Number(row.userid)
    );

  const reset = async () => {
    const users = await ids();
    const list = users.length ? users.join(",") : "0";
    await sql(`DELETE FROM bym.message WHERE userid IN (${list}) OR targetid IN (${list})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${list}) OR targetid IN (${list})`);
    await sql(`DELETE FROM bym.truce WHERE initiator_userid IN (${list}) OR recipient_userid IN (${list})`);
    await sql(`DELETE FROM bym.attack_logs WHERE attacker_userid IN (${list}) OR defender_userid IN (${list})`);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (${list}) OR reported_id IN (${list})`);
    await sql(`DELETE FROM bym.notification WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.attack_plan WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.maproom WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.report WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.bot WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.world_map_cell WHERE uid IN (${list})`);
    await sql(`DELETE FROM bym.alliance WHERE name LIKE 'zz_del_%'`);
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym.world WHERE uuid = ?`, [WORLD]);
  };

  /** A player with a main yard. */
  const player = async (name: string) => {
    const em = orm.em.fork();
    const user = em.create(User, { username: `zz_del_${name}`, email: `zz_del_${name}@test.com`, password: "x" });
    await em.flush();
    await Save.createMainSave(em, user);
    return user.userid;
  };

  const alliance = async (name: string, leader: number, members: number[]) => {
    const row = await one<{ id: number }>(
      `INSERT INTO bym.alliance (name, leader_userid, leader_name, world_id, created_at)
       VALUES (?, ?, (SELECT username FROM bym."user" WHERE userid = ?), ?, now()) RETURNING id`,
      [`zz_del_${name}`, leader, leader, WORLD]
    );
    const id = Number(row!.id);
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [id, leader]);
    for (const member of members) {
      await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [id, member]);
    }
    return id;
  };

  /** A mail thread between two players, one message each way. */
  const mail = async (from: number, to: number) => {
    const threadid = Number((await one<{ n: number }>(`SELECT coalesce(max(threadid), 0) + 1 AS n FROM bym.thread`))!.n);
    const first = randomUUID();
    const reply = randomUUID();
    for (const [id, a, b] of [
      [first, from, to],
      [reply, to, from],
    ] as const) {
      await sql(
        `INSERT INTO bym.message (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, message, subject, created_at)
         VALUES (?, ?, 0, ?, ?, 'message', 0, 1, 'hello', 'subject', now())`,
        [id, threadid, a, b]
      );
    }
    await sql(
      `INSERT INTO bym.thread (id, threadid, userid, targetid, last_message_id, messagecount, created_at) VALUES (?, ?, ?, ?, ?, 2, now())`,
      [randomUUID(), threadid, from, to, reply]
    );
    return threadid;
  };

  const attack = (attacker: number, defender: number) =>
    sql(
      `INSERT INTO bym.attack_logs (attacker_userid, attacker_username, attacker_pic_square, defender_userid, defender_username, defender_pic_square, type, attackreport, attacktime)
       VALUES (?, (SELECT username FROM bym."user" WHERE userid = ?), 'pic', ?, (SELECT username FROM bym."user" WHERE userid = ?), 'pic', 'main', '{}', now())`,
      [attacker, attacker, defender, defender]
    );

  /**
   * P, the player who asked to be deleted, leads an alliance with Q, mails Q,
   * fought Q and R, has land on the map and keys in Redis. Q and R mail each
   * other, and R blocks P.
   */
  const world = async () => {
    const p = await player("p");
    const q = await player("q");
    const r = await player("r");
    await sql(
      `INSERT INTO bym.world (uuid, name, player_count, map_version, created_at, lastupdate_at) VALUES (?, 'zz_del', 3, 2, now(), now())`,
      [WORLD]
    );
    await sql(`UPDATE bym.save SET worldid = ? WHERE userid = ? AND type = 'main'`, [WORLD, p]);
    await sql(
      `INSERT INTO bym.world_map_cell (baseid, map_version, uid, x, y, base_type, terrain_height, world_id) VALUES ('1', 2, ?, 5, 5, 1, 0, ?)`,
      [p, WORLD]
    );
    const allianceId = await alliance("pq", p, [q]);
    await sql(`INSERT INTO bym.alliance_message (alliance_id, user_id, body, created_at) VALUES (?, ?, 'gg', now())`, [allianceId, p]);

    const pq = await mail(p, q);
    const qr = await mail(q, r);
    await sql(`INSERT INTO bym.truce (initiator_userid, recipient_userid, status, created_at) VALUES (?, ?, 'requested', now())`, [p, q]);
    await sql(`INSERT INTO bym.notification (userid, kind, jobs, created_at) VALUES (?, 'away', '[]', now())`, [p]);
    await sql(`INSERT INTO bym.report (userid, username, created_at, lastupdate_at) VALUES (?, 'zz_del_p', now(), now())`, [p]);
    await sql(`INSERT INTO bym.maproom (userid, neighbors, dropped_neighbours, created_at, lastupdate_at) VALUES (?, '[]', '[]', now(), now())`, [p]);

    await attack(p, q);
    await attack(r, p);
    await attack(q, r);
    await sql(`UPDATE bym.save SET lastattackername = 'zz_del_p' WHERE userid = ? AND type = 'main'`, [q]);
    await sql(`UPDATE bym."user" SET blocked_users = ?::jsonb WHERE userid = ?`, [JSON.stringify([p, 5]), r]);
    await sql(
      `INSERT INTO bym.chat_report (reporter_id, reported_id, channel, message, message_ts, verified, created_at)
       VALUES (?, ?, 'chat:mr2-global', 'rude', 1, true, now())`,
      [q, p]
    );

    store = fakeRedis();
    store.strings.set("user-token:game:zz_del_p@test.com", "token");
    store.strings.set(`chat-token:${p}`, "chat");
    store.strings.set(`sight:${p}`, "{}");
    store.strings.set(`sight:${q}`, "{}");
    store.strings.set(`sight:ally:${allianceId}`, "{}");
    store.strings.set(`bot-check:routes:${p}:3`, "1");
    store.strings.set(`attackLogs:${q}:both`, "[]");
    store.strings.set(`attackLogs:${p}:undefined`, "[]");
    store.strings.set("leaderboards_x_v2", "[]");
    store.strings.set("sight:999999", "{}");
    store.strings.set("attackLogs:999999:both", "[]");
    const line = (userId: number, body: string) => JSON.stringify({ userId, displayName: "x", body, ts: 1 });
    store.lists.set("history:chat:mr2-global", [line(p, "mine"), line(q, "theirs"), line(p, "mine again")]);
    store.lists.set("bot-check:log", [JSON.stringify({ userid: p }), JSON.stringify({ userid: q })]);
    store.sets.set(`chat-ignore:${q}`, new Set([String(p), "77"]));
    store.sets.set(`chat-ignore:${p}`, new Set([String(q)]));

    return { p, q, r, allianceId, pq, qr };
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("PRIVACY_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(reset);

  afterAll(async () => {
    await reset();
    await orm.close();
  });

  test("finds the account by name or id, and refuses a bot, a stranger or an ambiguous number", async () => {
    const p = await player("p");

    expect((await findAccount(orm.em, "ZZ_DEL_P")).userid).toBe(p);
    expect((await findAccount(orm.em, String(p))).username).toBe("zz_del_p");
    expect((await findAccount(orm.em, `id:${p}`)).username).toBe("zz_del_p");
    await expect(findAccount(orm.em, "zz_del_nobody")).rejects.toBeInstanceOf(AccountDeletionRefused);

    const numbered = await player(String(p));
    await sql(`UPDATE bym."user" SET username = ? WHERE userid = ?`, [String(p), numbered]);
    await expect(findAccount(orm.em, String(p))).rejects.toThrow(/say id:/);
    expect((await findAccount(orm.em, `name:${p}`)).userid).toBe(numbered);
    await sql(`UPDATE bym."user" SET username = 'zz_del_numbered' WHERE userid = ?`, [numbered]);

    await sql(`INSERT INTO bym.bot (userid, seed, persona, level, level_since, created_at) VALUES (?, 1, '{}', 1, now(), now())`, [p]);
    await expect(findAccount(orm.em, "zz_del_p")).rejects.toThrow(/bot/);
  });

  test("the dry run lists everything and changes nothing", async () => {
    const { p, q } = await world();
    const account = await findAccount(orm.em, "zz_del_p");

    const plan = await planAccountDeletion(orm.em, store.redis, account);

    expect(plan.rows).toMatchObject({
      "mail messages": 2,
      "mail threads": 1,
      truces: 1,
      "alliance chat messages": 1,
      notifications: 1,
      "anti-cheat report": 1,
      "Map Room 1 neighbour lists": 1,
      "map cells (home and outposts)": 1,
      "account (login and email)": 1,
      "saves (yards, outposts, inferno)": 1,
      "battle records where they attacked (name replaced)": 1,
      "battle records where they defended (name replaced)": 1,
      "other bases last attacked by them (name replaced)": 1,
      "other players' block lists (id removed)": 1,
    });
    expect(plan.alliance).toBe(`leadership of "zz_del_pq" passes to zz_del_q (#${q})`);
    expect(plan.redis.keys.sort()).toEqual(
      [
        "user-token:game:zz_del_p@test.com",
        `chat-token:${p}`,
        `chat-ignore:${p}`,
        `sight:${p}`,
        `sight:${q}`,
        `sight:ally:${account.alliance_id}`,
        `bot-check:routes:${p}:3`,
        `attackLogs:${p}:undefined`,
        `attackLogs:${q}:both`,
        "leaderboards_x_v2",
      ].sort()
    );
    expect(plan.redis).toMatchObject({ chatLines: 2, botCheckRows: 1, ignoreLists: 1 });

    expect(await countOf(`bym."user" WHERE userid = ?`, [p])).toBe(1);
    expect(await countOf(`bym.message WHERE userid = ?`, [p])).toBe(1);
    expect(store.strings.has(`chat-token:${p}`)).toBe(true);
    expect(store.lists.get("history:chat:mr2-global")).toHaveLength(3);
  });

  test("deleting removes their rows and keys and keeps others' history without their name", async () => {
    const { p, q, r, allianceId, pq, qr } = await world();
    const account = await findAccount(orm.em, "zz_del_p");

    const done = await deleteAccount(orm.em, store.redis, account);
    expect(done.rows["account (login and email)"]).toBe(1);

    // Their own rows.
    expect(await countOf(`bym."user" WHERE userid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.save WHERE userid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.world_map_cell WHERE uid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.thread WHERE threadid = ?`, [pq])).toBe(0);
    expect(await countOf(`bym.message WHERE threadid = ?`, [pq])).toBe(0);
    expect(await countOf(`bym.truce WHERE initiator_userid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.alliance_message WHERE user_id = ?`, [p])).toBe(0);
    expect(await countOf(`bym.notification WHERE userid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.report WHERE userid = ?`, [p])).toBe(0);
    expect(await countOf(`bym.maproom WHERE userid = ?`, [p])).toBe(0);
    expect(Number((await one<{ player_count: number }>(`SELECT player_count FROM bym.world WHERE uuid = ?`, [WORLD]))!.player_count)).toBe(2);

    // Other players' mail is untouched.
    expect(await countOf(`bym.message WHERE threadid = ?`, [qr])).toBe(2);

    // The alliance passes to Q.
    expect(await one(`SELECT leader_userid, leader_name FROM bym.alliance WHERE id = ?`, [allianceId])).toEqual({
      leader_userid: q,
      leader_name: "zz_del_q",
    });
    expect((await one(`SELECT alliance_role FROM bym."user" WHERE userid = ?`, [q]))!.alliance_role).toBe("leader");

    // Battle records stay, with the name replaced; Q and R's own record is unchanged.
    const logs = await sql<{ attacker_username: string; defender_username: string; attacker_pic_square: string | null }>(
      `SELECT attacker_username, defender_username, attacker_pic_square FROM bym.attack_logs
        WHERE attacker_userid IN (?, ?, ?) ORDER BY id`,
      [p, q, r]
    );
    expect(logs).toEqual([
      { attacker_username: DELETED_PLAYER_NAME, defender_username: "zz_del_q", attacker_pic_square: null },
      { attacker_username: "zz_del_r", defender_username: DELETED_PLAYER_NAME, attacker_pic_square: "pic" },
      { attacker_username: "zz_del_q", defender_username: "zz_del_r", attacker_pic_square: "pic" },
    ]);
    expect((await one(`SELECT lastattackername FROM bym.save WHERE userid = ? AND type = 'main'`, [q]))!.lastattackername).toBe(
      DELETED_PLAYER_NAME
    );
    expect((await one(`SELECT blocked_users FROM bym."user" WHERE userid = ?`, [r]))!.blocked_users).toEqual([5]);

    // Chat reports are kept until the daily clean-up.
    expect(await countOf(`bym.chat_report WHERE reported_id = ?`, [p])).toBe(1);

    // Redis: their keys and lines go; everyone else's stay.
    expect([...store.strings.keys()].sort()).toEqual(["attackLogs:999999:both", "sight:999999"]);
    expect(store.lists.get("history:chat:mr2-global")!.map((raw) => JSON.parse(raw).body)).toEqual(["theirs"]);
    expect(store.lists.get("bot-check:log")).toEqual([JSON.stringify({ userid: q })]);
    expect([...store.sets.get(`chat-ignore:${q}`)!]).toEqual(["77"]);
    expect(store.sets.has(`chat-ignore:${p}`)).toBe(false);
  });

  test("an alliance with no one else in it is disbanded", async () => {
    const p = await player("p");
    const allianceId = await alliance("solo", p, []);
    await sql(`INSERT INTO bym.alliance_message (alliance_id, user_id, body, created_at) VALUES (?, ?, 'hi', now())`, [allianceId, p]);
    store = fakeRedis();

    const done = await deleteAccount(orm.em, store.redis, await findAccount(orm.em, "zz_del_p"));

    expect(done.alliance).toBe(`alliance "zz_del_solo" is disbanded (no other members)`);
    expect(await countOf(`bym.alliance WHERE id = ?`, [allianceId])).toBe(0);
    expect(await countOf(`bym."user" WHERE userid = ?`, [p])).toBe(0);
  });

  test("a member who does not lead just leaves", async () => {
    const p = await player("p");
    const q = await player("q");
    const allianceId = await alliance("qp", q, [p]);
    store = fakeRedis();

    const done = await deleteAccount(orm.em, store.redis, await findAccount(orm.em, "zz_del_p"));

    expect(done.alliance).toBe(`leaves alliance "zz_del_qp"`);
    expect(await one(`SELECT leader_userid FROM bym.alliance WHERE id = ?`, [allianceId])).toEqual({ leader_userid: q });
  });
});
