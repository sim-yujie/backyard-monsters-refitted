import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";

/**
 * The friend flag and the friend-only visit load (issue #369,
 * `docs/design/friends.md` §6.2) against a real Postgres: `friendsAmong`,
 * `mayVisit` and `baseModeHelp`'s refusals. Opt-in like the friends core test:
 * runs only when FRIENDS_TEST_DB names a throwaway database with the friends
 * migration applied. Its players are `zz_fv_*`, user ids 995_001 to 995_004.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres }));

const { friendsAmong, mayVisit } = await import("./friendFlags.js");
const { baseModeHelp } = await import("../../controllers/base/load/modes/baseModeHelp.js");

const A = 995_001;
const B = 995_002;
const C = 995_003;
const D = 995_004;
const all = [A, B, C, D];
const list = all.join(",");

describe.skipIf(!dbName)("the friend flag and the visit load on a real database (issue #369)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid }) as unknown as User;
  const befriend = (a: number, b: number) =>
    sql(`INSERT INTO bym.friend (userid, friend_userid) VALUES (?, ?), (?, ?)`, [a, b, b, a]);

  const clear = async () => {
    await sql(`DELETE FROM bym.friend WHERE userid IN (${list}) OR friend_userid IN (${list})`);
    await sql(`UPDATE bym."user" SET blocked_users = '[]', banned = false WHERE userid IN (${list})`);
  };

  /** The refusal reason a call ends in. */
  const reasonOf = async (call: Promise<unknown>): Promise<unknown> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string } };
      return refusal.status === 409 ? refusal.data?.reason : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of all) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `zz_fv_${userid}`, `zz_fv_${userid}@test.invalid`]
      );
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(
        `INSERT INTO bym.save (userid, saveuserid, baseid, type, mapversion, points, basevalue,
                               createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
         VALUES (?, ?, ?, 'main', 2, 0, '0', 0, 'yard', 0, '[]', now(), now(), now())`,
        [userid, userid, `${userid}00`]
      );
    }
    // A's outpost: not a main yard.
    await sql(
      `INSERT INTO bym.save (userid, saveuserid, baseid, type, mapversion, points, basevalue,
                             createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
       VALUES (?, ?, ?, 'outpost', 2, 0, '0', 0, 'post', 0, '[]', now(), now(), now())`,
      [A, A, `${A}01`]
    );
    postgres.em = em();
  });

  beforeEach(async () => {
    await clear();
    postgres.em = em();
  });

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await sql(`DELETE FROM bym.save WHERE userid IN (${list})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${list})`);
    await orm.close(true);
  });

  test("friendsAmong flags real friends only, both ways, never the viewer", async () => {
    await befriend(A, B);
    expect([...(await friendsAmong(em(), A, [A, B, C, D]))]).toEqual([B]);
    expect([...(await friendsAmong(em(), B, [A, C]))]).toEqual([A]);
    expect((await friendsAmong(em(), C, [A, B, D])).size).toBe(0);
    expect((await friendsAmong(em(), undefined, [A, B])).size).toBe(0);
    expect((await friendsAmong(em(), A, [])).size).toBe(0);
  });

  test("a friend may visit; a stranger, a self-visit and a one-sided row may not", async () => {
    await befriend(A, B);
    expect(await mayVisit(em(), B, A)).toBe(true);
    expect(await mayVisit(em(), A, B)).toBe(true);
    expect(await mayVisit(em(), C, A)).toBe(false);
    expect(await mayVisit(em(), A, A)).toBe(false);
    await sql(`DELETE FROM bym.friend WHERE userid = ? AND friend_userid = ?`, [A, B]);
    expect(await mayVisit(em(), B, A)).toBe(true);
    expect(await mayVisit(em(), A, B)).toBe(false);
  });

  test("a block either way, or a banned account, ends the visit", async () => {
    await befriend(A, B);
    await sql(`UPDATE bym."user" SET blocked_users = '[${B}]' WHERE userid = ?`, [A]);
    expect(await mayVisit(em(), B, A)).toBe(false);
    expect(await mayVisit(em(), A, B)).toBe(false);
    await sql(`UPDATE bym."user" SET blocked_users = '[]' WHERE userid = ?`, [A]);
    await sql(`UPDATE bym."user" SET blocked_users = '[${A}]' WHERE userid = ?`, [B]);
    expect(await mayVisit(em(), B, A)).toBe(false);
    await sql(`UPDATE bym."user" SET blocked_users = '[]' WHERE userid = ?`, [B]);
    expect(await mayVisit(em(), B, A)).toBe(true);
    await sql(`UPDATE bym."user" SET banned = true WHERE userid = ?`, [A]);
    expect(await mayVisit(em(), B, A)).toBe(false);
  });

  test("help mode: a friend's main yard loads", async () => {
    await befriend(A, B);
    const save = await baseModeHelp(as(B), `${A}00`);
    expect(save?.userid).toBe(A);
  });

  test("help mode: a stranger, a blocked pair and an unknown id are refused alike", async () => {
    expect(await reasonOf(baseModeHelp(as(C), `${A}00`))).toBe("notFriends");
    expect(await reasonOf(baseModeHelp(as(C), "no-such-base"))).toBe("notFriends");
    await befriend(A, B);
    await sql(`UPDATE bym."user" SET blocked_users = '[${B}]' WHERE userid = ?`, [A]);
    expect(await reasonOf(baseModeHelp(as(B), `${A}00`))).toBe("notFriends");
  });

  test("help mode: a friend's outpost id is not served, a stranger's is refused", async () => {
    await befriend(A, B);
    expect(await baseModeHelp(as(B), `${A}01`)).toBeNull();
    expect(await reasonOf(baseModeHelp(as(C), `${A}01`))).toBe("notFriends");
  });

  test("help mode does not change the owner's yard", async () => {
    await befriend(A, B);
    const before = await sql(`SELECT protected, attackid, locked, lastupdate_at FROM bym.save WHERE baseid = ?`, [`${A}00`]);
    await baseModeHelp(as(B), `${A}00`);
    const after = await sql(`SELECT protected, attackid, locked, lastupdate_at FROM bym.save WHERE baseid = ?`, [`${A}00`]);
    expect(after).toEqual(before);
  });
});
