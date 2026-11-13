import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Gift all (owner, 13 Nov 2026) against a real Postgres: the plan writes
 * nothing; the send gives each friend who can take a gift their first
 * affordable wish (or the sender's pick), takes exactly that from the
 * sender, skips the rest without a short gift, keeps the one-a-day key, and
 * two sends at once never send twice. Also `GET /bm/friends/gift/cost`.
 *
 * Opt-in: runs only when FRIENDS_TEST_DB names a throwaway database with the
 * `bym` schema and the friends migrations applied, and refuses the shared
 * `bym`. Its players are `zz_ga_*`, user ids 994_200 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const { giftAllAnswer } = await import("../../controllers/friends/giftAll.js");
const { giftCostAnswer, sendGiftAnswer, collectGiftsAnswer } = await import("../../controllers/friends/gift.js");
const { friendsAnswer } = await import("../../controllers/friends/friends.js");

const S = 994_201;
/** Friends who can all take a gift; named so the plan's order (by name) is theirs. */
const F1 = 994_202;
const F2 = 994_203;
const F3 = 994_204;
const F4 = 994_205;
/** Friends for an hour only: the 12-hour gate holds. */
const NEW = 994_206;
/** Below level 5. */
const LOW = 994_207;
/** An account that cannot be friended. */
const BOT = 994_208;
/** Blocks the sender. */
const BLOCKER = 994_209;
const OPEN = [F1, F2, F3, F4];
const FRIENDS = [...OPEN, NEW, LOW, BOT, BLOCKER];
const EVERYONE = [S, ...FRIENDS];
const LIST = EVERYONE.join(",");

const DAY = 24 * 60 * 60;
const T0 = Math.floor(Date.UTC(2026, 9, 19, 12) / 1000);
const LEVEL_5_POINTS = "20000";
const HALL = { id: 0, t: 14, x: -70, y: 0, l: 1 };
/** Base storage only: every gift is 3% of 10,000. */
const AMOUNT = 300;

describe.skipIf(!dbName)("Gift all on a real database (owner, 13 Nov 2026)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;

  const plan = (body: unknown = {}, now = T0) => giftAllAnswer(em() as never, as(S), body, now, false) as Promise<any>;
  const sendAll = (body: unknown = {}, now = T0) => giftAllAnswer(em() as never, as(S), body, now, true) as Promise<any>;

  const held = async (userid = S) => {
    const [row] = await sql(`SELECT resources FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
    return row!.resources;
  };
  const setHeld = (resources: Record<string, number>) =>
    sql(`UPDATE bym.save SET resources = ? WHERE userid = ? AND type = 'main'`, [JSON.stringify(resources), S]);
  const wish = (userid: number, wishes: string | null) => sql(`UPDATE bym."user" SET gift_wishes = ? WHERE userid = ?`, [wishes, userid]);
  const giftRows = () => sql(`SELECT to_userid, resource, amount FROM bym.friend_gift WHERE from_userid = ? ORDER BY to_userid`, [S]);
  const befriend = (a: number, b: number, since = T0 - 2 * DAY) =>
    sql(`INSERT INTO bym.friend (userid, friend_userid, created_at) VALUES (?, ?, ?), (?, ?, ?) ON CONFLICT DO NOTHING`, [
      a,
      b,
      new Date(since * 1000),
      b,
      a,
      new Date(since * 1000),
    ]);

  const reset = async () => {
    await sql(`DELETE FROM bym.friend_gift WHERE from_userid IN (${LIST}) OR to_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.notification WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET blocked_users = '[]', banned = false, gift_wishes = NULL WHERE userid IN (${LIST})`);
    await sql(
      `UPDATE bym.save SET buildingdata = ?, buildinghealthdata = '{}', resources = '{"r1":0,"r2":0,"r3":0,"r4":0}', outposts = '[]',
              savetime = ?, createtime = ?, points = ?, basevalue = '0', type = 'main', attackid = 0, attacks = '[]', damage = 0
        WHERE userid IN (${LIST})`,
      [JSON.stringify({ "0": HALL }), T0, T0 - 30 * DAY, LEVEL_5_POINTS]
    );
    await sql(`UPDATE bym.save SET points = '0' WHERE userid = ?`, [LOW]);
    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([S]), BLOCKER]);
    for (const friend of FRIENDS) await befriend(S, friend, friend === NEW ? T0 - 3600 : T0 - 2 * DAY);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 10 } });
    for (const [index, userid] of EVERYONE.entries()) {
      // zz_ga_0 is the sender; the friends sort by name in id order.
      const name = `zz_ga_${index}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `zz_ga_${userid}@test.invalid`]
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
      [BOT]
    );
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`DELETE FROM bym.friend WHERE userid IN (${LIST}) OR friend_userid IN (${LIST})`);
    await sql(`DELETE FROM bym.bot WHERE userid = ?`, [BOT]);
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("the plan: each friend who can take a gift gets their first wish, the rest the most held; nothing is written", async () => {
    await setHeld({ r1: 1000, r2: 5000, r3: 1000, r4: 1000 });
    await wish(F1, "r4,r1");
    await wish(F3, "r3");
    const answer = await plan();
    expect(answer).toEqual({
      error: 0,
      fallback: "r2",
      gifts: [
        { userid: F1, username: "zz_ga_1", resource: "r4", amount: AMOUNT, wish: 1 },
        { userid: F2, username: "zz_ga_2", resource: "r2", amount: AMOUNT, wish: 0 },
        { userid: F3, username: "zz_ga_3", resource: "r3", amount: AMOUNT, wish: 1 },
        { userid: F4, username: "zz_ga_4", resource: "r2", amount: AMOUNT, wish: 0 },
      ],
      skipped: [],
      cost: { r1: 0, r2: 2 * AMOUNT, r3: AMOUNT, r4: AMOUNT },
      resources: { r1: 1000, r2: 5000, r3: 1000, r4: 1000 },
      noWish: 2,
    });
    // NEW (an hour's friendship), LOW (level), BOT and BLOCKER are left out by the single gift's gate.
    expect(await giftRows()).toEqual([]);
    expect(await held()).toMatchObject({ r1: 1000, r2: 5000, r3: 1000, r4: 1000 });
  });

  test("the sender's pick for friends with no wish", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const answer = await plan({ fallback: "r3" });
    expect(answer.fallback).toBe("r3");
    expect(new Set(answer.gifts.map((gift: any) => gift.resource))).toEqual(new Set(["r3"]));
  });

  test("sending takes exactly the plan's cost, one gift each, with a notice, and the list says Sent", async () => {
    await setHeld({ r1: 1000, r2: 5000, r3: 1000, r4: 1000 });
    await wish(F1, "r4,r1");
    const answer = await sendAll();
    expect(answer.gifts).toHaveLength(4);
    expect(answer.gifts.every((gift: any) => Number.isInteger(gift.giftid))).toBe(true);
    expect(answer.cost).toEqual({ r1: 0, r2: 3 * AMOUNT, r3: 0, r4: AMOUNT });
    expect(answer.resources).toEqual({ r1: 1000, r2: 5000 - 3 * AMOUNT, r3: 1000, r4: 1000 - AMOUNT });
    expect(await held()).toMatchObject(answer.resources);
    expect(await giftRows()).toEqual([
      { to_userid: F1, resource: "r4", amount: AMOUNT },
      { to_userid: F2, resource: "r2", amount: AMOUNT },
      { to_userid: F3, resource: "r2", amount: AMOUNT },
      { to_userid: F4, resource: "r2", amount: AMOUNT },
    ]);
    const notices = await sql(`SELECT userid FROM bym.notification WHERE userid IN (${OPEN.join(",")}) AND kind = 'friend'`);
    expect(notices).toHaveLength(4);
    const list = (await friendsAnswer(em() as never, as(S), T0)) as any;
    for (const friend of list.friends) expect(friend.giftSentToday).toBe(OPEN.includes(friend.userid));

    // Already gifted today: a second Gift all has no one to send to and takes nothing.
    const again = await sendAll({}, T0 + 60);
    expect(again.gifts).toEqual([]);
    expect(await held()).toMatchObject(answer.resources);
  });

  test("short of stock: the next affordable wish, counting earlier gifts; else skipped, never a short gift", async () => {
    // Goo for one gift only; Twigs for one more; no Pebbles.
    await setHeld({ r1: AMOUNT, r2: 0, r3: 0, r4: AMOUNT + 10 });
    await wish(F1, "r4");
    await wish(F2, "r4,r1");
    await wish(F3, "r4,r1");
    // F4 has no wish and gets the pick, Pebbles, which the sender has none of.
    const answer = await sendAll({ fallback: "r2" });
    expect(answer.gifts.map((gift: any) => [gift.userid, gift.resource, gift.wish])).toEqual([
      [F1, "r4", 1],
      [F2, "r1", 2],
    ]);
    expect(answer.skipped).toEqual([
      { userid: F3, username: "zz_ga_3", reason: "notEnough", lacking: ["r4", "r1"], amount: AMOUNT },
      { userid: F4, username: "zz_ga_4", reason: "notEnough", lacking: ["r2"], amount: AMOUNT },
    ]);
    expect(await held()).toMatchObject({ r1: 0, r2: 0, r3: 0, r4: 10 });
    expect((await giftRows()).map((row) => row.to_userid)).toEqual([F1, F2]);
  });

  test("sends to the confirmed friends only", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const answer = await sendAll({ fallback: "r1", userids: [F2, F4, NEW] });
    expect(answer.gifts.map((gift: any) => gift.userid)).toEqual([F2, F4]);
    expect((await giftRows()).map((row) => row.to_userid)).toEqual([F2, F4]);
  });

  test("a friend already sent a gift today one at a time is left out", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    await sendGiftAnswer(em() as never, as(S), { userid: F1, resource: "r1" }, T0);
    const answer = await sendAll({ fallback: "r1" }, T0 + 5);
    expect(answer.gifts.map((gift: any) => gift.userid)).toEqual([F2, F3, F4]);
    expect(answer.skipped).toEqual([]);
    expect(await held()).toMatchObject({ r1: 5000 - 4 * AMOUNT });
  });

  test("a confirmed friend gifted since the plan is said as already sent, and not paid for", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const shown = await plan({ fallback: "r1" });
    expect(shown.gifts.map((gift: any) => gift.userid)).toEqual(OPEN);
    await sendGiftAnswer(em() as never, as(S), { userid: F3, resource: "r1" }, T0);
    const answer = await sendAll({ fallback: "r1", userids: OPEN }, T0 + 5);
    expect(answer.gifts.map((gift: any) => gift.userid)).toEqual([F1, F2, F4]);
    expect(answer.skipped).toEqual([{ userid: F3, username: "zz_ga_3", reason: "giftSentToday", lacking: [], amount: 0 }]);
    expect(await held()).toMatchObject({ r1: 5000 - 4 * AMOUNT });
  });

  test("a receiver who has collected all they can today is still sent one (it waits, as a single gift does)", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    await sql(
      `INSERT INTO bym.friend_gift (from_userid, to_userid, resource, amount, gift_day, created_at, expires_at, collected_at)
       SELECT ?, ?, 'r1', 1, (?::date - g), ?, ?, ? FROM generate_series(1, 10) AS g`,
      [F2, F1, new Date(T0 * 1000).toISOString().slice(0, 10), new Date(T0 * 1000), new Date((T0 + 7 * DAY) * 1000), new Date(T0 * 1000)]
    );
    const answer = await sendAll({ fallback: "r1" });
    expect(answer.gifts.map((gift: any) => gift.userid)).toContain(F1);
    // F1 cannot collect it today; it waits.
    const collect = await collectGiftsAnswer(em() as never, as(F1), { all: true }, T0 + 10).catch((err: any) => err.data?.reason);
    expect(collect).toBe("collectLimit");
  });

  test("two sends at once send each gift once and take it once", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const [first, second] = await Promise.all([sendAll({ fallback: "r1" }), sendAll({ fallback: "r1" })]);
    expect(first.gifts.length + second.gifts.length).toBe(4);
    expect(await giftRows()).toHaveLength(4);
    expect(await held()).toMatchObject({ r1: 5000 - 4 * AMOUNT });
  });

  test("refused while the sender's yard is under attack", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    await sql(`UPDATE bym.save SET attackid = 1, attacks = ? WHERE userid = ?`, [
      JSON.stringify([{ starttime: Math.floor(Date.now() / 1000) }]),
      S,
    ]);
    const reason = await sendAll().then(
      () => "not refused",
      (err: any) => err.data?.reason ?? String(err)
    );
    expect(reason).toBe("underAttack");
    expect(await giftRows()).toEqual([]);
  });

  test("the plan is refused under attack too", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    await sql(`UPDATE bym.save SET attackid = 1, attacks = ? WHERE userid = ?`, [
      JSON.stringify([{ starttime: Math.floor(Date.now() / 1000) }]),
      S,
    ]);
    const reason = await plan().then(
      () => "not refused",
      (err: any) => err.data?.reason ?? String(err)
    );
    expect(reason).toBe("underAttack");
  });

  test("the plan only reads: hours after the last save it leaves the yard row untouched, and never waits for its lock", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const row = () => sql(`SELECT xmin::text AS version, savetime FROM bym.save WHERE userid = ? AND type = 'main'`, [S]);
    const before = await row();
    // Another request holds the yard's lock (a save, a gift): the plan still answers.
    const answer = await orm.em.fork().transactional(async (holder) => {
      await holder.execute(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main' FOR UPDATE`, [S]);
      return plan({}, T0 + 6 * 3600);
    });
    expect(answer.gifts).toHaveLength(4);
    expect(await row()).toEqual(before);
    expect(await giftRows()).toEqual([]);
    expect(await sql(`SELECT 1 FROM bym.notification WHERE userid IN (${LIST})`)).toEqual([]);
  });

  test("a confirmed friend who cannot take a gift any more is said, not silently dropped", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const shown = await plan({ fallback: "r1" });
    expect(shown.gifts.map((gift: any) => gift.userid)).toEqual(OPEN);
    // Since the plan: F2 blocked the sender, F3 unfriended them.
    await sql(`UPDATE bym."user" SET blocked_users = ? WHERE userid = ?`, [JSON.stringify([S]), F2]);
    await sql(`DELETE FROM bym.friend WHERE (userid = ? AND friend_userid = ?) OR (userid = ? AND friend_userid = ?)`, [S, F3, F3, S]);
    const answer = await sendAll({ fallback: "r1", userids: OPEN }, T0 + 5);
    expect(answer.gifts.map((gift: any) => gift.userid)).toEqual([F1, F4]);
    expect(answer.skipped).toEqual([
      { userid: F2, username: "zz_ga_2", reason: "cannotSend", lacking: [], amount: 0 },
      { userid: F3, username: "", reason: "cannotSend", lacking: [], amount: 0 },
    ]);
    expect(await held()).toMatchObject({ r1: 5000 - 2 * AMOUNT });
    expect((await giftRows()).map((row) => row.to_userid)).toEqual([F1, F4]);
  });

  test("each gift is the single gift's: the same amount, and a second send the same day adds nothing", async () => {
    await setHeld({ r1: 5000, r2: 5000, r3: 5000, r4: 5000 });
    const single = (await sendGiftAnswer(em() as never, as(S), { userid: F1, resource: "r2" }, T0)) as any;
    const answer = await sendAll({ fallback: "r1" }, T0 + 5);
    expect(answer.gifts.map((gift: any) => gift.amount)).toEqual([single.gift.amount, single.gift.amount, single.gift.amount]);
    const again = await sendAll({ fallback: "r1", userids: OPEN }, T0 + 9);
    expect(again.gifts).toEqual([]);
    expect(again.cost).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(again.skipped.map((skip: any) => [skip.userid, skip.reason])).toEqual(OPEN.map((userid) => [userid, "giftSentToday"]));
    expect(await giftRows()).toHaveLength(4);
    expect(await held()).toMatchObject({ r1: 5000 - 3 * AMOUNT, r2: 5000 - AMOUNT });
  });

  test("only the resources a gift was taken from are written", async () => {
    // A yard row with no Putty or Goo entry at all: the send must not invent them.
    await setHeld({ r1: 5000, r2: 40 });
    const answer = await sendAll({ fallback: "r1" });
    expect(answer.gifts).toHaveLength(4);
    expect(answer.resources).toEqual({ r1: 5000 - 4 * AMOUNT, r2: 40, r3: 0, r4: 0 });
    const stored = await held();
    expect(stored.r1).toBe(5000 - 4 * AMOUNT);
    expect(stored.r2).toBe(40);
    expect("r3" in stored).toBe(false);
    expect("r4" in stored).toBe(false);
  });

  test("the cost of one gift and what the sender holds", async () => {
    await setHeld({ r1: 7, r2: 8, r3: 9, r4: 10 });
    const answer = (await giftCostAnswer(em() as never, as(S), { userid: String(F1) })) as any;
    expect(answer).toEqual({ error: 0, amount: AMOUNT, resources: { r1: 7, r2: 8, r3: 9, r4: 10 } });
    const stranger = await giftCostAnswer(em() as never, as(F1), { userid: String(F2) }).catch((err: any) => err.data?.reason);
    expect(stranger).toBe("notFriends");
  });
});
