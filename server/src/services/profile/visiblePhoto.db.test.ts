import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { memoryRedis } from "../../testing/memoryRedis.js";
import { readPhoto, readProfile } from "./profiles.js";
import { visiblePhotos } from "./visiblePhoto.js";

type FriendViews = typeof import("../friends/friendViews.js");

/**
 * Whose uploaded photo other players see (owner, 13 Nov 2026), against a real
 * Postgres: the lists (map, leaderboard, alliance, Map Room 1, Inferno, via
 * `visiblePhotos`), the friends lists (via the card join), the Profile window
 * (`readProfile`) and the photo's own address (`readPhoto`) all agree. A
 * photo hidden by reports, removed or blocked by the owner, or of a banned
 * player, shows nowhere.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `phototest_*`, account numbers from 996301. Everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const SHOWN = 996301;
const HIDDEN = 996302;
const REMOVED = 996303;
const BLOCKED = 996304;
const BANNED = 996305;
const NONE = 996306;
const VIEWER = 996307;
const ALL = [SHOWN, HIDDEN, REMOVED, BLOCKED, BANNED, NONE, VIEWER];
const LIST = ALL.join(",");

describe.skipIf(!dbName)("visible photos on a real database", () => {
  let orm: MikroORM;
  let searchPlayers: FriendViews["searchPlayers"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);

  const cleanUp = async () => {
    await sql(`DELETE FROM bym.player_profile WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    // The friends lists reach the server's Redis (who is online); a stand-in keeps the server from booting.
    mock.module("../../server.js", () => ({ postgres: {}, redis: memoryRedis(new Map()) }));
    ({ searchPlayers } = await import("../friends/friendViews.js"));
    await cleanUp();
    for (const userid of ALL) {
      const name = `phototest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users, banned) VALUES (?, ?, ?, 'x', '[]', ?)`,
        [userid, name, `${name}@test.invalid`, userid === BANNED],
      );
    }
    const profile = (userid: number, photo: Buffer | null, version: number, hidden: boolean, blocked: boolean) =>
      sql(
        `INSERT INTO bym.player_profile (userid, bio, photo, photo_version, photo_at, photo_hidden, upload_blocked, updated_at)
         VALUES (?, '', ?, ?, now(), ?, ?, now())`,
        [userid, photo, version, hidden, blocked],
      );
    await profile(SHOWN, jpegBytes, 3, false, false);
    await profile(HIDDEN, jpegBytes, 2, true, false); // reported to the limit, waiting for review
    await profile(REMOVED, null, 4, false, false); // the owner removed it
    await profile(BLOCKED, null, 5, false, true); // the owner removed it and blocked uploads
    await profile(BANNED, jpegBytes, 1, false, false);
  });

  afterAll(async () => {
    if (!orm) return;
    await cleanUp();
    await orm.close();
  });

  test("the lists' one lookup sends only the photo that may be shown", async () => {
    const photos = await visiblePhotos(orm.em.fork(), ALL);
    expect(photos).toEqual(new Map([[SHOWN, 3]]));
  });

  test("the Profile window and the photo's address follow the same rule", async () => {
    const em = orm.em.fork();
    expect((await readProfile(em, VIEWER, SHOWN))?.photoVersion).toBe(3);
    for (const userid of [HIDDEN, REMOVED, BLOCKED, NONE]) {
      expect((await readProfile(em, VIEWER, userid))?.photoVersion).toBeNull();
    }
    expect(await readProfile(em, VIEWER, BANNED)).toBeNull();

    expect(await readPhoto(em, SHOWN)).not.toBeNull();
    for (const userid of [HIDDEN, REMOVED, BLOCKED, BANNED, NONE]) expect(await readPhoto(em, userid)).toBeNull();
  });

  test("the friends lists' card join sends the photo the same way", async () => {
    const found = await searchPlayers(orm.em.fork(), VIEWER, "phototest_", Math.floor(Date.now() / 1000));
    const byId = new Map(found.map((player) => [player.userid, player.photo]));
    expect(byId.get(SHOWN)).toBe(3);
    for (const userid of [HIDDEN, REMOVED, BLOCKED, NONE]) expect(byId.get(userid)).toBeNull();
    expect(byId.has(BANNED)).toBe(false); // search leaves banned players out
  });
});
