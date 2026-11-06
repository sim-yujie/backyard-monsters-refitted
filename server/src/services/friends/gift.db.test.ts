import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import { ZodError } from "zod";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Daily gifts (issue #375, `docs/design/friends.md` §3.4, §5 and §7) against
 * a real Postgres: sending, the one-a-day key, the lower-cap amount, the
 * waiting list, collecting with its daily limit and the storage-cap clamp,
 * lapsing, the gates, blocks, and the friends list's gift fields.
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and the friends migrations applied, and refuses the shared
 * `bym`. Its players are `zz_fg_*`, user ids 994_000 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const { sendGiftAnswer, giftsAnswer, collectGiftsAnswer } = await import("../../controllers/friends/gift.js");
const { friendsAnswer } = await import("../../controllers/friends/friends.js");
const { blockPlayer } = await import("./friendships.js");

const A = 994_001;
const B = 994_002;
/** Five more friends of B's, so B has six gifts to collect. */
const OTHERS = [994_003, 994_004, 994_005, 994_006, 994_007];
const STRANGER = 994_010;
/** An account that cannot be friended (§6.2). */
const HIDDEN = 994_011;
const EVERYONE = [A, B, ...OTHERS, STRANGER, HIDDEN];
const LIST = EVERYONE.join(",");

const DAY = 24 * 60 * 60;
/** 12:00 UTC on a day well after every account was made. */
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12) / 1000);
/** Level 5 needs 7,500 points (`experiencePoints`). */
const LEVEL_5_POINTS = "20000";
/** No silos and no outposts: the base storage. 3% of it is 300. */
const BASE_CAP = 10_000;
/** One outpost adds 2,000,000 to the cap. */
const BIG_CAP = BASE_CAP + 2_000_000;
const HALL = { id: 0, t: 14, x: -70, y: 0, l: 1 };

describe.skipIf(!dbName)("daily gifts on a real database (issue #375)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;

  const send = (from: number, to: number, resource = "r1", now = T0) =>
    sendGiftAnswer(em() as never, as(from), { userid: to, resource }, now) as Promise<any>;
  const list = (userid: number, now = T0) => giftsAnswer(em() as never, as(userid), now) as Promise<any>;
  const collect = (userid: number, body: unknown, now = T0) => collectGiftsAnswer(em() as never, as(userid), body, now) as Promise<any>;

  /** `reason` (and `from`) of a 409, or what else happened. */
  const refusalOf = async (call: Promise<unknown>): Promise<any> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string; from?: number } };
      return refusal.status === 409 ? refusal.data : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };
  const reasonOf = async (call: Promise<unknown>) => {
    const refusal = await refusalOf(call);
    return refusal?.reason ?? refusal;
  };

  const resourcesOf = async (userid: number) => {
    const [row] = await sql(`SELECT resources FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
    return row!.resources;
  };
  const giftRows = (from: number) => sql(`SELECT * FROM bym.friend_gift WHERE from_userid = ? ORDER BY id`, [from]);
  const setSave = (userid: number, fields: Record<string, unknown>) => {
    const sets = Object.keys(fields).map((key) => `${key} = ?`);
    const values = Object.values(fields).map((value) => (typeof value === "object" && value !== null ? JSON.stringify(value) : value));
    return sql(`UPDATE bym.save SET ${sets.join(", ")} WHERE userid = ? AND type = 'main'`, [...values, userid]);
  };
  const befriend = (a: number, b: number, since = T0 - 2 * DAY) =>
    sql(`INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`, [
      a,
      b,
      new Date(since * 1000),
      b,
      a,
      new Date(since * 1000),
    ]);
  const unfriend = (a: number, b: number) =>
    sql(`DELETE FROM bym.friend WHERE (userid = ? AND friend_userid = ?) OR (userid = ? AND friend_userid = ?)`, [a, b, b, a]);

  const reset = async () => {
    await sql(`DELETE FROM bym.friend_gift WHERE from_userid IN (${LIST}) OR to_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.notification WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET blocked_users = '[]', banned = false WHERE userid IN (${LIST})`);
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = '{}', resources = '{"r1":0,"r2":0,"r3":0,"r4":0}', outposts = '[]',
              savetime = ?, createtime = ?, points = ?, basevalue = '0', type = 'main', attackid = 0, attacks = '[]', damage = 0
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), T0, T0 - 30 * DAY, LEVEL_5_POINTS]
    );
    await befriend(A, B);
    for (const other of OTHERS) await befriend(other, B);
    await befriend(A, HIDDEN);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const userid of EVERYONE) {
      const name = `zz_fg_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', ?, '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, LEVEL_5_POINTS, T0 - 30 * DAY]
          )
        )[0]!.basesaveid;
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
    }
    await sql(
      `INSERT INTO bym.bot (userid, seed, persona, level, level_since) VALUES (?, 1, 'towers', 10, now()) ON CONFLICT DO NOTHING`,
      [HIDDEN]
    );
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.bot WHERE userid = ?`, [HIDDEN]);
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("a gift is free, worth 3% of the cap, waits 7 days and leaves the receiver a notice", async () => {
    const answer = await send(A, B, "r3");
    expect(answer).toMatchObject({ error: 0, gift: { resource: "r3", amount: 300, userid: B, username: `zz_fg_${B}`, createdAt: T0, expiresAt: T0 + 7 * DAY } });
    expect(await resourcesOf(A)).toMatchObject({ r1: 0, r2: 0, r3: 0, r4: 0 });

    const [row] = await giftRows(A);
    expect(row).toMatchObject({ to_userid: B, resource: "r3", amount: 300, collected_at: null });

    const [notice] = await sql(`SELECT jobs FROM bym.notification WHERE userid = ? AND kind = 'friend'`, [B]);
    expect(notice!.jobs[0]).toEqual({ event: "gift", userid: A, username: `zz_fg_${A}`, giftid: answer.gift.giftid, resource: "r3", amount: 300 });

    const waiting = await list(B);
    expect(waiting).toMatchObject({ error: 0, collectsLeft: 5 });
    expect(waiting.gifts).toEqual([
      {
        giftid: answer.gift.giftid,
        userid: A,
        username: `zz_fg_${A}`,
        pic: null,
        level: expect.any(Number),
        resource: "r3",
        amount: 300,
        createdAt: T0,
        expiresAt: T0 + 7 * DAY,
        canSendBack: true,
      },
    ]);
  });

  test("the friends list says who was gifted today and counts the gifts waiting", async () => {
    await send(A, B);
    const mine = await friendsAnswer(em() as never, as(A), T0);
    expect((mine.friends as any[]).find((friend) => friend.userid === B)).toMatchObject({ giftSentToday: true });
    const theirs = await friendsAnswer(em() as never, as(B), T0);
    expect(theirs).toMatchObject({ giftsWaiting: 1 });
    expect((theirs.friends as any[]).find((friend) => friend.userid === A)).toMatchObject({ giftSentToday: false });
    expect((await list(B)).gifts[0].canSendBack).toBe(true);

    await send(B, A);
    expect((await list(B)).gifts[0].canSendBack).toBe(false);
  });

  test("a second gift to the same friend the same UTC day is refused; the next day is fine", async () => {
    await send(A, B, "r1");
    expect(await reasonOf(send(A, B, "r2", T0 + 60))).toBe("giftSentToday");
    expect(await reasonOf(send(A, B, "r2", T0 + 11 * 60 * 60))).toBe("giftSentToday");
    expect((await send(A, B, "r2", T0 + 12 * 60 * 60)).gift.amount).toBe(300);
    expect(await giftRows(A)).toHaveLength(2);
  });

  test("two sends at once give one gift", async () => {
    const answers = await Promise.all([refusalOf(send(A, B, "r1")), refusalOf(send(A, B, "r2"))]);
    expect(answers.filter((answer) => answer === "not refused")).toHaveLength(1);
    expect(answers.filter((answer) => answer?.reason === "giftSentToday")).toHaveLength(1);
    expect(await giftRows(A)).toHaveLength(1);
  });

  test("removing and re-adding a friend the same day does not give a second gift", async () => {
    await send(A, B);
    await unfriend(A, B);
    expect(await reasonOf(send(A, B))).toBe("notFriends");
    // Re-added, and (to reach the day rule) as if the 24 hours had passed.
    await befriend(A, B, T0 - 3 * DAY);
    expect(await reasonOf(send(A, B, "r1", T0 + 60))).toBe("giftSentToday");
  });

  test("the amount uses the lower of the two caps, and is fixed when sent", async () => {
    await setSave(A, { outposts: [[1, 1]] });
    expect((await send(A, B)).gift.amount).toBe(Math.floor(BASE_CAP * 0.03));
    await setSave(B, { outposts: [[1, 1]] });
    expect((await send(B, A)).gift.amount).toBe(Math.floor(BIG_CAP * 0.03));
    await setSave(A, { outposts: [] });
    expect((await list(A)).gifts[0].amount).toBe(Math.floor(BIG_CAP * 0.03));
  });

  test("collecting credits the main yard and marks the gift collected", async () => {
    const { gift } = await send(A, B, "r2");
    const answer = await collect(B, { giftid: gift.giftid }, T0 + 60);
    expect(answer).toEqual({ error: 0, collected: 1, resources: { r1: 0, r2: 300, r3: 0, r4: 0 }, collectsLeft: 4, giftsWaiting: 0 });
    expect(await resourcesOf(B)).toMatchObject({ r2: 300 });
    const [row] = await giftRows(A);
    expect(row!.collected_at).not.toBeNull();
    expect(await reasonOf(collect(B, { giftid: gift.giftid }, T0 + 120))).toBe("noSuchGift");
  });

  test("a gift is collected only by its receiver", async () => {
    const { gift } = await send(A, B);
    expect(await reasonOf(collect(A, { giftid: gift.giftid }))).toBe("noSuchGift");
    expect(await reasonOf(collect(STRANGER, { giftid: gift.giftid }))).toBe("noSuchGift");
    expect((await list(B)).gifts).toHaveLength(1);
  });

  test("at most 5 gifts are collected a day; the rest wait for tomorrow", async () => {
    for (const from of [A, ...OTHERS]) await send(from, B, "r4");
    const first = await collect(B, { all: true }, T0 + 60);
    expect(first).toMatchObject({ collected: 5, resources: { r4: 1500 }, collectsLeft: 0, giftsWaiting: 1 });
    // The oldest first: the last one sent is the one left.
    expect((await list(B, T0 + 60)).gifts.map((gift: any) => gift.userid)).toEqual([OTHERS[4]]);

    expect(await reasonOf(collect(B, { all: true }, T0 + 120))).toBe("collectLimit");
    const [left] = (await list(B, T0 + 120)).gifts;
    expect(await reasonOf(collect(B, { giftid: left.giftid }, T0 + 120))).toBe("collectLimit");
    expect((await list(B, T0 + 120)).collectsLeft).toBe(0);

    const tomorrow = T0 + 12 * 60 * 60;
    expect(await collect(B, { all: true }, tomorrow)).toMatchObject({ collected: 1, collectsLeft: 4, giftsWaiting: 0 });
    expect(await resourcesOf(B)).toMatchObject({ r4: 1800 });
  });

  test("collecting with nothing waiting collects nothing", async () => {
    expect(await collect(B, { all: true })).toEqual({ error: 0, collected: 0, resources: { r1: 0, r2: 0, r3: 0, r4: 0 }, collectsLeft: 5, giftsWaiting: 0 });
  });

  test("a gift lapses after 7 days", async () => {
    const { gift } = await send(A, B);
    expect((await list(B, T0 + 7 * DAY - 1)).gifts).toHaveLength(1);
    expect((await list(B, T0 + 7 * DAY)).gifts).toEqual([]);
    expect(await friendsAnswer(em() as never, as(B), T0 + 7 * DAY)).toMatchObject({ giftsWaiting: 0 });
    expect(await reasonOf(collect(B, { giftid: gift.giftid }, T0 + 7 * DAY))).toBe("noSuchGift");
    expect(await collect(B, { all: true }, T0 + 7 * DAY)).toMatchObject({ collected: 0 });
  });

  test("the credit is clamped to the storage cap; the gift is still used up", async () => {
    await send(A, B, "r1");
    await setSave(B, { resources: { r1: BASE_CAP - 100, r2: 0, r3: 0, r4: 0 } });
    expect(await collect(B, { all: true })).toMatchObject({ collected: 1, resources: { r1: 100 } });
    expect(await resourcesOf(B)).toMatchObject({ r1: BASE_CAP });
    expect((await list(B)).gifts).toEqual([]);
  });

  test("collecting is refused while the yard is under attack", async () => {
    await send(A, B);
    // The attack check reads the real clock.
    await setSave(B, { attackid: 1, attacks: [{ starttime: Math.floor(Date.now() / 1000) }] });
    expect(await reasonOf(collect(B, { all: true }))).toBe("underAttack");
    expect((await list(B)).gifts).toHaveLength(1);
  });

  test("the gates: self, unknown, not friends, hidden accounts, blocks, bans, the 12 hours and level (no account age)", async () => {
    expect(await reasonOf(send(A, A))).toBe("self");
    expect(await reasonOf(send(A, 994_999))).toBe("noSuchPlayer");
    expect(await reasonOf(send(A, STRANGER))).toBe("notFriends");
    expect(await reasonOf(send(A, HIDDEN))).toBe("notFriends");
    expect(await reasonOf(send(HIDDEN, A))).toBe("notFriends");

    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([A]), B]);
    expect(await reasonOf(send(A, B))).toBe("cannotSend");
    expect(await reasonOf(send(B, A))).toBe("cannotSend");
    await sql(`UPDATE bym."user" SET blocked_users = '[]', banned = true WHERE userid = ?`, [B]);
    expect(await reasonOf(send(A, B))).toBe("cannotSend");
    await sql(`UPDATE bym."user" SET banned = false WHERE userid = ?`, [B]);

    await unfriend(A, B);
    await befriend(A, B, T0 - 60 * 60);
    expect(await refusalOf(send(A, B))).toEqual({ reason: "tooNew", from: T0 - 60 * 60 + 12 * 60 * 60, rule: "friendship" });

    await unfriend(A, B);
    await befriend(A, B);
    // A day-old account is no bar (owner 2026-10-29): only its low level is named.
    await setSave(B, { createtime: T0 - DAY, points: "0" });
    expect(await refusalOf(send(A, B))).toEqual({ reason: "tooNew", rule: "level" });

    expect(await giftRows(A)).toHaveLength(0);
    expect(await sql(`SELECT 1 FROM bym.notification WHERE userid IN (${LIST})`)).toHaveLength(0);
  });

  test("a bad body is a 400", async () => {
    await expect(send(A, B, "r5")).rejects.toBeInstanceOf(ZodError);
    await expect(collect(B, { giftid: "x" })).rejects.toBeInstanceOf(ZodError);
    await expect(collect(B, { all: false })).rejects.toBeInstanceOf(ZodError);
  });

  test("blocking drops the blocked player's waiting gifts to you, and only those", async () => {
    await send(A, B);
    await send(B, A);
    await blockPlayer(em() as never, B, A, T0 + 60);
    expect((await list(B, T0 + 120)).gifts).toEqual([]);
    expect((await list(A, T0 + 120)).gifts).toHaveLength(1);
    // The row stays for the audit and the one-a-day key.
    expect(await giftRows(A)).toHaveLength(1);
  });
});
