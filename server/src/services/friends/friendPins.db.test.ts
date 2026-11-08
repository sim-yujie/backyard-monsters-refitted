import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import type { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Pinned friends (beta 7) against a real Postgres: `POST /bm/friends/pin`
 * pins and unpins, refuses the 11th pin (`pinLimit`), a player who is not a
 * friend (`notFriends`) and the caller (`self`); `GET /bm/friends` says who is
 * pinned; the map flags (`friendMarksAmong`) see the pins; ending the
 * friendship takes the pin with it.
 *
 * Opt-in like the other friends database tests: runs only when
 * FRIENDS_TEST_DB names a throwaway database with the `bym` schema and the
 * migrations applied, and refuses the shared `bym`. Its players are
 * `zz_pin_*`, user ids 996_000 and up.
 */
const dbName = process.env.FRIENDS_TEST_DB;

const redis = memoryRedis();
const postgres = { em: null as unknown };
mock.module("../../server.js", () => ({ postgres, redis }));

const friends = await import("../../controllers/friends/friends.js");
const { friendMarksAmong } = await import("./friendFlags.js");

const ME = 996_000;
/** My friends: 996_001 to 996_012. */
const FRIEND = 996_001;
const FRIENDS = 12;
const STRANGER = 996_050;
const T0 = Math.floor(Date.UTC(2026, 10, 10, 12) / 1000);

describe.skipIf(!dbName)("pinned friends on a real database (beta 7)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);
  const as = (userid: number) => ({ userid, blockedUsers: [] }) as unknown as User;
  const friendIds = Array.from({ length: FRIENDS }, (_, i) => FRIEND + i);
  const everyone = [ME, STRANGER, ...friendIds];
  const list = everyone.join(",");

  const pin = (userid: number, pinned = true, now = T0) => friends.pinAnswer(em(), as(ME), { userid, pinned }, now) as Promise<any>;
  const listMine = () => friends.friendsAnswer(em(), as(ME), T0) as Promise<any>;
  const reasonOf = async (call: Promise<unknown>): Promise<unknown> => {
    try {
      await call;
    } catch (err) {
      const refusal = err as { status?: number; data?: { reason?: string } };
      return refusal.status === 409 ? refusal.data?.reason : `status ${refusal.status}: ${String(err)}`;
    }
    return "not refused";
  };

  const clear = async () => {
    await sql(`DELETE FROM bym.friend WHERE userid IN (${list}) OR friend_userid IN (${list})`);
    for (const other of friendIds) {
      await sql(`INSERT INTO bym.friend (userid, friend_userid) VALUES (?, ?), (?, ?)`, [ME, other, other, ME]);
    }
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("FRIENDS_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of everyone) {
      const name = userid === ME ? "zz_pin_me" : userid === STRANGER ? "zz_pin_stranger" : `zz_pin_f${userid - FRIEND}`;
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
    await sql(`DELETE FROM bym.friend WHERE userid IN (${list}) OR friend_userid IN (${list})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${list})`);
    await orm.close(true);
  });

  test("pin, list and unpin: the list says who is pinned and since when", async () => {
    expect(await pin(FRIEND)).toMatchObject({ error: 0, userid: FRIEND, pinned: true, pinnedCount: 1, maxPinned: 10 });
    const listed = await listMine();
    expect(listed.maxPinned).toBe(10);
    const byId = new Map(listed.friends.map((f: any) => [f.userid, f]));
    expect((byId.get(FRIEND) as any).pinnedAt).toBe(T0);
    expect((byId.get(FRIEND + 1) as any).pinnedAt).toBeNull();

    // Pinning again changes nothing and is not refused.
    expect(await pin(FRIEND, true, T0 + 60)).toMatchObject({ pinned: true, pinnedCount: 1 });
    expect(((await listMine()).friends.find((f: any) => f.userid === FRIEND) as any).pinnedAt).toBe(T0);

    expect(await pin(FRIEND, false)).toMatchObject({ pinned: false, pinnedCount: 0 });
    expect(((await listMine()).friends.find((f: any) => f.userid === FRIEND) as any).pinnedAt).toBeNull();
    // Unpinning one who is not pinned is not refused either.
    expect(await pin(FRIEND, false)).toMatchObject({ pinned: false, pinnedCount: 0 });
  });

  test("the 11th pin is refused with pinLimit; unpinning one makes room again", async () => {
    for (let i = 0; i < 10; i++) expect((await pin(FRIEND + i)).pinnedCount).toBe(i + 1);
    expect(await reasonOf(pin(FRIEND + 10))).toBe("pinLimit");
    const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.friend WHERE userid = ? AND pinned_at IS NOT NULL`, [ME]);
    expect(Number(row?.n)).toBe(10);
    // A friend already pinned can still be "pinned" at the limit.
    expect(await pin(FRIEND)).toMatchObject({ pinned: true, pinnedCount: 10 });
    await pin(FRIEND + 3, false);
    expect(await pin(FRIEND + 10)).toMatchObject({ pinned: true, pinnedCount: 10 });
  });

  test("ten pins at once never make eleven", async () => {
    for (let i = 0; i < 9; i++) await pin(FRIEND + i);
    const results = await Promise.all([pin(FRIEND + 9), pin(FRIEND + 10), pin(FRIEND + 11)].map(reasonOf));
    expect(results.filter((r) => r === "not refused")).toHaveLength(1);
    expect(results.filter((r) => r === "pinLimit")).toHaveLength(2);
  });

  test("a player who is not a friend cannot be pinned or unpinned; nor can the caller", async () => {
    expect(await reasonOf(pin(STRANGER))).toBe("notFriends");
    expect(await reasonOf(pin(STRANGER, false))).toBe("notFriends");
    expect(await reasonOf(pin(ME))).toBe("self");
    expect(await reasonOf(friends.pinAnswer(em(), as(ME), { userid: FRIEND }, T0))).toMatch(/status 400|ZodError|status undefined/);
  });

  test("the map flags see the pins, and a friendship that ends takes its pin", async () => {
    await pin(FRIEND);
    const marks = await friendMarksAmong(em(), ME, [FRIEND, FRIEND + 1, STRANGER]);
    expect([...marks.friends].sort()).toEqual([FRIEND, FRIEND + 1]);
    expect([...marks.pinned]).toEqual([FRIEND]);
    // The friend's own side carries no pin: pinning is one-sided.
    expect([...(await friendMarksAmong(em(), FRIEND, [ME])).pinned]).toEqual([]);

    await friends.removeAnswer(em(), as(ME), { userid: FRIEND });
    expect(await reasonOf(pin(FRIEND, false))).toBe("notFriends");
    expect((await friendMarksAmong(em(), ME, [FRIEND])).pinned.size).toBe(0);
  });
});
