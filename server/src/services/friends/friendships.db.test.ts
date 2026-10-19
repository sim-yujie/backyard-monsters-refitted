import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import ormConfig from "../../mikro-orm.config.js";
import { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The friends core (issue #368, `docs/design/friends.md` §3.1, §3.6, §6.2)
 * against a real Postgres: requests and answers, the list, remove, search,
 * block and unblock, the privacy switches, and every refusal WP1 owns, each
 * with its 409 `reason`. The routes run as functions of the entity manager
 * (`controllers/friends/friends.ts`); Redis (presence) is in memory, and so is
 * `server.js`, so nothing boots.
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and the friends migration applied, and refuses the shared
 * `bym`. Its players are `zz_fr_*`, user ids 994_000 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const friends = await import("../../controllers/friends/friends.js");
const { updateSettings } = await import("../../controllers/auth/updateSettings.js");
const { lastActionKey, lastSeenKey } = await import("../user/online.js");

const A = 994_001;
const B = 994_002;
const C = 994_003;
const D = 994_004;
/** Extra players for the limits: 994_100 to 994_199. */
const CROWD = 994_100;
const CROWD_SIZE = 100;
const DAY = 24 * 60 * 60;
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12) / 1000);

describe.skipIf(!dbName)("the friends core on a real database (issue #368)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;

  const everyone = [A, B, C, D, ...Array.from({ length: CROWD_SIZE }, (_, i) => CROWD + i)];
  const list = everyone.join(",");

  const clear = async () => {
    await sql(`DELETE FROM bym.friend WHERE userid IN (${list}) OR friend_userid IN (${list})`);
    await sql(`DELETE FROM bym.friend_request WHERE from_userid IN (${list}) OR to_userid IN (${list})`);
    await sql(`DELETE FROM bym.notification WHERE userid IN (${list})`);
    await sql(
      `UPDATE bym."user" SET blocked_users = '[]', friendcount = 0, hide_online = false, friend_requests_off = false,
              last_seen_at = NULL, alliance_id = NULL, banned = false
        WHERE userid IN (${list})`
    );
    await sql(`DELETE FROM bym.alliance WHERE name = 'zz_fr_alliance'`);
  };

  /** The 409 reason a call is refused with. */
  const reasonOf = async (call: Promise<unknown>): Promise<unknown> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string } };
      return refusal.status === 409 ? refusal.data?.reason : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };

  const ask = (from: number, to: number, now = T0) => friends.requestAnswer(em(), as(from), { userid: to }, now);
  const requests = (userid: number, now = T0) => friends.requestsAnswer(em(), as(userid), now) as Promise<any>;
  const list_ = (userid: number, now = T0) => friends.friendsAnswer(em(), as(userid), now) as Promise<any>;
  const answer = (userid: number, requestid: number, accept: boolean, now = T0) =>
    friends.answerAnswer(em(), as(userid), { requestid, accept }, now) as Promise<any>;
  const notices = (userid: number) =>
    sql<{ jobs: any[] }>(`SELECT jobs FROM bym.notification WHERE userid = ? AND kind = 'friend' ORDER BY id`, [userid]).then(
      (rows) => rows.map((row) => row.jobs[0])
    );
  const counts = async () =>
    Object.fromEntries(
      (await sql<{ userid: number; friendcount: number }>(`SELECT userid, friendcount FROM bym."user" WHERE userid IN (?, ?, ?)`, [A, B, C])).map(
        (row) => [Number(row.userid), Number(row.friendcount)]
      )
    );

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    const names: Record<number, string> = { [A]: "zz_fr_alice", [B]: "zz_fr_bob", [C]: "zz_fr_carol", [D]: "zz_fr_dave" };
    for (const userid of everyone) {
      const name = names[userid] ?? `zz_fr_crowd${userid - CROWD}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
    }
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`DELETE FROM bym."user" WHERE userid IN (${list})`);
    await orm.close(true);
  });

  test("request, accept, list and remove: both sides, notifications and friendcount", async () => {
    const sent = (await ask(A, B)) as any;
    expect(sent.error).toBe(0);
    expect(sent.request).toMatchObject({ userid: B, username: "zz_fr_bob", status: "pending", at: T0, expires: T0 + 14 * DAY });
    expect(sent.friend).toBeUndefined();

    expect((await requests(A)).outgoing.map((r: any) => r.userid)).toEqual([B]);
    const incoming = (await requests(B)).incoming;
    expect(incoming).toEqual([sent.request.requestid].map((requestid) => ({ ...sent.request, requestid, userid: A, username: "zz_fr_alice" })));
    expect((await list_(B)).requestsIn).toBe(1);
    expect(await notices(B)).toEqual([{ event: "request", userid: A, username: "zz_fr_alice" }]);

    const accepted = await answer(B, sent.request.requestid, true, T0 + 60);
    expect(accepted.friend).toMatchObject({ userid: A, username: "zz_fr_alice", since: T0 + 60, canGiftFrom: T0 + 60 + DAY, help: null });
    expect(await notices(A)).toEqual([{ event: "accepted", userid: B, username: "zz_fr_bob" }]);
    expect((await notices(B)).at(-1)).toEqual({ event: "accepted", userid: A, username: "zz_fr_alice" });

    const listA = await list_(A, T0 + 2 * DAY);
    expect(listA).toMatchObject({ error: 0, max: 100, requestsIn: 0, giftsWaiting: 0, helpsLeft: 20 });
    expect(listA.friends).toEqual([
      {
        userid: B,
        username: "zz_fr_bob",
        pic: null,
        level: 1,
        online: "away",
        since: T0 + 60,
        giftSentToday: false,
        canGiftFrom: null,
        help: null,
      },
    ]);
    expect((await list_(B)).friends.map((f: any) => f.userid)).toEqual([A]);
    expect(await counts()).toMatchObject({ [A]: 1, [B]: 1 });
    expect((await requests(A)).outgoing).toEqual([]);

    expect(await friends.removeAnswer(em(), as(B), { userid: A })).toEqual({ error: 0 });
    expect((await list_(A)).friends).toEqual([]);
    expect((await list_(B)).friends).toEqual([]);
    expect(await counts()).toMatchObject({ [A]: 0, [B]: 0 });
    expect(await reasonOf(friends.removeAnswer(em(), as(A), { userid: B }))).toBe("notFriends");
  });

  test("a decline is silent to the sender, who waits 7 days to ask again", async () => {
    const sent = (await ask(A, B)) as any;
    expect(await answer(B, sent.request.requestid, false, T0 + 100)).toEqual({ error: 0 });
    expect((await requests(A)).outgoing).toEqual([]);
    expect((await requests(B)).incoming).toEqual([]);
    expect(await notices(A)).toEqual([]);

    try {
      await ask(A, B, T0 + DAY);
      throw new Error("not refused");
    } catch (err) {
      expect((err as { data: unknown }).data).toEqual({ reason: "declinedRecently", from: T0 + 100 + 7 * DAY });
    }
    // The other way round is fine at once.
    expect(((await ask(B, A, T0 + DAY)) as any).request.status).toBe("pending");
    await sql(`DELETE FROM bym.friend_request WHERE from_userid = ?`, [B]);
    expect(((await ask(A, B, T0 + 100 + 7 * DAY + 1)) as any).request.status).toBe("pending");
    expect(await reasonOf(answer(B, sent.request.requestid, true))).toBe("noSuchRequest");
  });

  test("a request both ways accepts the first", async () => {
    const first = (await ask(A, B)) as any;
    const second = (await ask(B, A, T0 + 30)) as any;
    expect(second.request).toMatchObject({ requestid: first.request.requestid, userid: A, status: "accepted" });
    expect(second.friend).toMatchObject({ userid: A, since: T0 + 30 });
    expect(await counts()).toMatchObject({ [A]: 1, [B]: 1 });
    expect(await notices(A)).toEqual([{ event: "accepted", userid: B, username: "zz_fr_bob" }]);
    expect(await reasonOf(ask(A, B))).toBe("alreadyFriends");
  });

  test("by username, without case; cancel; and the refusals for the pair", async () => {
    const sent = (await friends.requestAnswer(em(), as(A), { username: "ZZ_FR_Bob" }, T0)) as any;
    expect(sent.request.userid).toBe(B);
    expect(await reasonOf(ask(A, B))).toBe("alreadyRequested");
    expect(await reasonOf(friends.cancelAnswer(em(), as(B), { requestid: sent.request.requestid }, T0))).toBe("noSuchRequest");
    expect(await reasonOf(answer(C, sent.request.requestid, true))).toBe("noSuchRequest");
    expect(await friends.cancelAnswer(em(), as(A), { requestid: sent.request.requestid }, T0)).toEqual({ error: 0 });
    expect((await requests(B)).incoming).toEqual([]);
    expect(await reasonOf(answer(B, sent.request.requestid, true))).toBe("noSuchRequest");

    expect(await reasonOf(ask(A, A))).toBe("self");
    expect(await reasonOf(friends.requestAnswer(em(), as(A), { username: "zz_fr_nobody" }, T0))).toBe("noSuchPlayer");
    expect(await reasonOf(friends.requestAnswer(em(), as(A), {}, T0))).toContain("status undefined");
  });

  test("requests off, and blocks either way, refuse; blocking clears friendship and requests both ways", async () => {
    await sql(`UPDATE bym."user" SET friend_requests_off = true WHERE userid = ?`, [B]);
    expect(await reasonOf(ask(A, B))).toBe("requestsOff");
    // Requests off does not stop B's own request from being accepted by A asking back.
    const fromB = (await ask(B, A)) as any;
    expect(((await ask(A, B)) as any).request).toMatchObject({ requestid: fromB.request.requestid, status: "accepted" });
    await friends.removeAnswer(em(), as(A), { userid: B });
    await sql(`UPDATE bym."user" SET friend_requests_off = false WHERE userid = ?`, [B]);

    await friends.blockAnswer(em(), as(C), { userid: A }, T0);
    expect(await reasonOf(ask(A, C))).toBe("cannotSend");
    expect(await reasonOf(ask(C, A))).toBe("cannotSend");

    const toA = (await ask(D, A)) as any;
    const fromA = (await ask(A, B)) as any;
    await answer(B, fromA.request.requestid, true);
    expect(await counts()).toMatchObject({ [A]: 1, [B]: 1 });
    await friends.blockAnswer(em(), as(B), { userid: A }, T0);
    expect((await list_(A)).friends).toEqual([]);
    expect(await counts()).toMatchObject({ [A]: 0, [B]: 0 });
    // Requests between others stay.
    expect((await requests(A)).incoming.map((r: any) => r.requestid)).toEqual([toA.request.requestid]);

    await ask(D, B);
    await friends.blockAnswer(em(), as(B), { userid: D }, T0);
    expect((await requests(B)).incoming).toEqual([]);
    // D's request to B went; D's request to A stays.
    expect((await requests(D)).outgoing.map((r: any) => r.userid)).toEqual([A]);

    expect(await friends.blockedAnswer(em(), as(B))).toEqual({
      error: 0,
      blocked: [
        { userid: A, username: "zz_fr_alice" },
        { userid: D, username: "zz_fr_dave" },
      ],
    });
    // Blocking twice keeps one entry.
    await friends.blockAnswer(em(), as(B), { userid: A }, T0);
    expect((await sql(`SELECT blocked_users FROM bym."user" WHERE userid = ?`, [B]))[0]!.blocked_users).toEqual([A, D]);

    expect(await friends.unblockAnswer(em(), as(B), { userid: A })).toEqual({ error: 0 });
    expect(((await friends.blockedAnswer(em(), as(B))) as any).blocked).toEqual([{ userid: D, username: "zz_fr_dave" }]);
    expect(((await ask(A, B)) as any).request.status).toBe("pending");
    expect(await reasonOf(friends.blockAnswer(em(), as(B), { userid: B }, T0))).toBe("self");
    expect(await reasonOf(friends.blockAnswer(em(), as(B), { userid: 994_999 }, T0))).toBe("noSuchPlayer");
  });

  test("the friend limit on both sides, open requests, and the daily cap", async () => {
    const crowd = Array.from({ length: CROWD_SIZE }, (_, i) => CROWD + i);
    const rows = crowd.flatMap((other) => [`(${A}, ${other})`, `(${other}, ${A})`]).join(", ");
    await sql(`INSERT INTO bym.friend (userid, friend_userid) VALUES ${rows}`);
    expect(await reasonOf(ask(A, B))).toBe("friendLimit");
    expect(await reasonOf(ask(B, A))).toBe("theirFriendLimit");
    // Accepting is held to the limit too.
    await sql(`INSERT INTO bym.friend_request (from_userid, to_userid, created_at) VALUES (?, ?, ?)`, [B, A, new Date(T0 * 1000)]);
    const [waiting] = await sql<{ id: number }>(`SELECT id FROM bym.friend_request WHERE from_userid = ?`, [B]);
    expect(await reasonOf(answer(A, Number(waiting!.id), true))).toBe("friendLimit");
    await sql(`DELETE FROM bym.friend WHERE userid = ? OR friend_userid = ?`, [A, A]);
    await sql(`DELETE FROM bym.friend_request WHERE from_userid = ?`, [B]);

    // 30 waiting (made yesterday, so today's count is clear) refuse a 31st.
    const yesterday = new Date((T0 - DAY) * 1000);
    await sql(
      `INSERT INTO bym.friend_request (from_userid, to_userid, created_at) VALUES ${crowd.slice(0, 30).map((other) => `(${C}, ${other}, ?)`).join(", ")}`,
      crowd.slice(0, 30).map(() => yesterday)
    );
    expect(await reasonOf(ask(C, D))).toBe("requestLimit");

    // 30 made today, even if cancelled since, refuse a 31st until 00:00 UTC.
    await sql(
      `INSERT INTO bym.friend_request (from_userid, to_userid, status, created_at, answered_at) VALUES ${crowd
        .slice(30, 60)
        .map((other) => `(${D}, ${other}, 'cancelled', ?, ?)`)
        .join(", ")}`,
      crowd.slice(30, 60).flatMap(() => [new Date(T0 * 1000), new Date(T0 * 1000)])
    );
    expect(await reasonOf(ask(D, A))).toBe("dailyCap");
    const tomorrow = T0 - (T0 % DAY) + DAY;
    expect(((await ask(D, A, tomorrow)) as any).request.status).toBe("pending");
  });

  test("a request lapses after 14 days: gone from both lists, and asking again works", async () => {
    await sql(`INSERT INTO bym.friend_request (from_userid, to_userid, created_at) VALUES (?, ?, ?)`, [A, B, new Date((T0 - 15 * DAY) * 1000)]);
    expect((await requests(A)).outgoing).toEqual([]);
    expect((await requests(B)).incoming).toEqual([]);
    expect((await list_(B)).requestsIn).toBe(0);
    expect(((await ask(A, B)) as any).request.status).toBe("pending");
    const statuses = await sql<{ status: string }>(`SELECT status FROM bym.friend_request WHERE from_userid = ? ORDER BY id`, [A]);
    expect(statuses.map((row) => row.status)).toEqual(["expired", "pending"]);
  });

  test("search: 3+ characters, without case, at most 10, exact match first, with each relation", async () => {
    await expect(friends.searchAnswer(em(), as(A), { q: "zz" }, T0)).rejects.toThrow();
    const crowd = ((await friends.searchAnswer(em(), as(A), { q: "ZZ_FR_CROWD" }, T0)) as any).results;
    expect(crowd).toHaveLength(10);

    // Exact match first, then names that start with the text, then shorter names.
    await sql(`UPDATE bym."user" SET username = 'Crowd1' WHERE userid = ?`, [CROWD + 2]);
    await sql(`UPDATE bym."user" SET username = 'crowd1_zz_fr' WHERE userid = ?`, [CROWD + 3]);
    try {
      const ranked = ((await friends.searchAnswer(em(), as(A), { q: "crowd1" }, T0)) as any).results;
      expect(ranked.slice(0, 3).map((r: any) => r.username)).toEqual(["Crowd1", "crowd1_zz_fr", "zz_fr_crowd1"]);
    } finally {
      await sql(`UPDATE bym."user" SET username = 'zz_fr_crowd' || (userid - ?) WHERE userid IN (?, ?)`, [CROWD, CROWD + 2, CROWD + 3]);
    }

    await ask(A, B);
    await ask(C, A);
    const friendship = (await ask(A, D)) as any;
    await answer(D, friendship.request.requestid, true);
    const results = ((await friends.searchAnswer(em(), as(A), { q: "zz_fr_" }, T0)) as any).results as any[];
    const relation = (userid: number) => results.find((r) => r.userid === userid)?.relation;
    expect([relation(A), relation(B), relation(C), relation(D)]).toEqual(["self", "requested", "asked", "friend"]);
    expect(Object.keys(results[0]).sort()).toEqual(["level", "pic", "relation", "userid", "username"]);

    // A player who blocked the searcher shows as none, and a request fails with the neutral refusal.
    await friends.blockAnswer(em(), as(D), { userid: A }, T0);
    const after = ((await friends.searchAnswer(em(), as(A), { q: "zz_fr_dave" }, T0)) as any).results;
    expect(after).toEqual([{ userid: D, username: "zz_fr_dave", pic: null, level: 1, relation: "none" }]);
    expect(await reasonOf(ask(A, D))).toBe("cannotSend");
  });

  test("banned accounts: cannot ask or be asked, cannot be accepted, and are left out of search and suggestions", async () => {
    const fromB = (await ask(B, A)) as any;
    await sql(`UPDATE bym."user" SET banned = true WHERE userid = ?`, [B]);
    // Asked, or asking, either way: the neutral refusal.
    expect(await reasonOf(ask(A, B))).toBe("cannotSend");
    expect(await reasonOf(ask(B, C))).toBe("cannotSend");
    // A request made before the ban cannot be accepted after it.
    expect(await reasonOf(answer(A, fromB.request.requestid, true))).toBe("cannotSend");
    expect(((await list_(A)) as any).friends).toEqual([]);

    const found = ((await friends.searchAnswer(em(), as(A), { q: "zz_fr_bob" }, T0)) as any).results;
    expect(found).toEqual([]);
    const [alliance] = await sql<{ id: number }>(
      `INSERT INTO bym.alliance (name, leader_userid, leader_name, world_id, created_at)
       VALUES ('zz_fr_alliance', ?, 'zz_fr_alice', '00000000-0000-4000-8000-0000000f71e0', now()) RETURNING id`,
      [A]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ? WHERE userid IN (?, ?, ?)`, [Number(alliance!.id), A, B, C]);
    const suggested = ((await friends.suggestionsAnswer(em(), as(A), T0)) as any).results.map((r: any) => r.userid);
    expect(suggested).toEqual([C]);
  });

  test("suggestions: alliance mates not yet friends", async () => {
    expect(await friends.suggestionsAnswer(em(), as(A), T0)).toEqual({ error: 0, results: [] });
    const [alliance] = await sql<{ id: number }>(
      `INSERT INTO bym.alliance (name, leader_userid, leader_name, world_id, created_at)
       VALUES ('zz_fr_alliance', ?, 'zz_fr_alice', '00000000-0000-4000-8000-0000000f71e0', now()) RETURNING id`,
      [A]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ? WHERE userid IN (?, ?, ?)`, [Number(alliance!.id), A, B, C]);
    const friendship = (await ask(A, C)) as any;
    await answer(C, friendship.request.requestid, true);
    await ask(B, A);
    expect(((await friends.suggestionsAnswer(em(), as(A), T0)) as any).results).toEqual([
      { userid: B, username: "zz_fr_bob", pic: null, level: 1, relation: "asked" },
    ]);
  });

  test("online status: hidden is null; online, today, week and away otherwise; last_seen_at never sent", async () => {
    for (const other of [B, C, D]) {
      const sent = (await ask(A, other)) as any;
      await answer(other, sent.request.requestid, true);
    }
    const now = Math.floor(Date.now() / 1000);
    await redis.setex(lastSeenKey(B), 120, String(now));
    await redis.setex(lastActionKey(B), 600, String(now));
    await sql(`UPDATE bym."user" SET last_seen_at = ? WHERE userid = ?`, [new Date((now - 3 * DAY) * 1000), C]);
    await sql(`UPDATE bym."user" SET last_seen_at = ? WHERE userid = ?`, [new Date((now - 3600) * 1000), D]);
    let body = await list_(A, now);
    const online = () => Object.fromEntries(body.friends.map((f: any) => [f.userid, f.online]));
    expect(online()).toEqual({ [B]: "online", [C]: "week", [D]: "today" });
    expect(JSON.stringify(body)).not.toContain("last_seen");

    await sql(`UPDATE bym."user" SET last_seen_at = ? WHERE userid = ?`, [new Date((now - 30 * DAY) * 1000), D]);
    await sql(`UPDATE bym."user" SET hide_online = true WHERE userid = ?`, [B]);
    body = await list_(A, now);
    expect(online()).toEqual({ [B]: null, [C]: "week", [D]: "away" });
  });

  test("the privacy settings: echoed, and requests off refuses with requestsOff", async () => {
    postgres.em = em();
    const user = await (postgres.em as ReturnType<typeof em>).findOneOrFail(User, { userid: B });
    const ctx = { authUser: user, request: { body: { friendRequests: false, hideOnline: true } } } as unknown as Context;
    await updateSettings(ctx);
    expect(ctx.body).toEqual({ error: 0, settings: { shinyLocked: false, hideOnline: true, friendRequests: false } });
    expect(await reasonOf(ask(A, B))).toBe("requestsOff");

    const back = { authUser: user, request: { body: { friendRequests: true } } } as unknown as Context;
    await updateSettings(back);
    expect(back.body).toEqual({ error: 0, settings: { shinyLocked: false, hideOnline: true, friendRequests: true } });
    expect(((await ask(A, B)) as any).request.status).toBe("pending");
  });
});
