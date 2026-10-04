import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  NOTIFICATION_LIMIT,
  notifyAndCount,
  recordNotifications,
  unreadNotificationCount,
} from "./notifications.js";

/**
 * The notification list's SQL against a real Postgres (issue #257): the
 * migration's table, the 20-row and 7-day prune, the order, and that marking
 * read never reaches another player's rows.
 *
 * Opt-in: runs only when NOTIF_TEST_DB names a throwaway database with the
 * `bym` schema and the notification migration applied, and refuses the
 * shared `bym` database. Each test clears its two players' rows first.
 */
const dbName = process.env.NOTIF_TEST_DB;

const PLAYER = 992_001;
const OTHER = 992_002;
const DAY = 24 * 60 * 60 * 1000;
const job = (kind: string, id: number) => ({ kind, id, t: 20, at: 100, detail: { level: 2 } });

describe.skipIf(!dbName)("the notification list on a real database (issue #257)", () => {
  let orm: MikroORM;
  const em = () => orm.em.fork();

  const clear = async () => {
    await em().getConnection().execute(`DELETE FROM bym.notification WHERE userid IN (?, ?)`, [PLAYER, OTHER]);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("NOTIF_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 2 } });
    for (const userid of [PLAYER, OTHER]) {
      await em().getConnection().execute(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users)
         VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, `notif_${userid}`, `notif_${userid}@test.invalid`]
      );
    }
  });

  beforeEach(clear);

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await em().getConnection().execute(`DELETE FROM bym."user" WHERE userid IN (?, ?)`, [PLAYER, OTHER]);
    await orm.close(true);
  });

  test("a live answer writes a row per kind, newest first, with the jobs as they were", async () => {
    const unread = await notifyAndCount(em(), PLAYER, null, "jobs", [job("upgrade", 1), job("build", 2), job("upgrade", 3)]);
    expect(unread).toBe(2);
    const list = await listNotifications(em(), PLAYER);
    // Written in one moment: the later row (the second kind) lists first.
    expect(list.map((one) => one.jobs)).toEqual([[job("build", 2)], [job("upgrade", 1), job("upgrade", 3)]]);
    expect(list.every((one) => one.kind === "jobs" && one.baseid === null && !one.read)).toBe(true);
    expect(list[0]!.id).toBeGreaterThan(list[1]!.id);
  });

  test("keeps the newest 20 and nothing older than 7 days", async () => {
    const now = new Date();
    await recordNotifications(em(), PLAYER, null, "away", [[job("upgrade", 99)]], new Date(now.getTime() - 8 * DAY));
    for (let index = 0; index < 25; index++) {
      await recordNotifications(em(), PLAYER, "3511", "jobs", [[job("upgrade", index)]], new Date(now.getTime() - (25 - index) * 1000));
    }
    const list = await listNotifications(em(), PLAYER);
    expect(list).toHaveLength(NOTIFICATION_LIMIT);
    expect(list.map((one) => (one.jobs[0] as { id: number }).id)).toEqual(
      Array.from({ length: 20 }, (_, index) => 24 - index)
    );
    const [{ count }] = await em().getConnection().execute(`SELECT count(*)::int AS count FROM bym.notification WHERE userid = ?`, [PLAYER]);
    expect(count).toBe(NOTIFICATION_LIMIT);
  });

  test("a row past 7 days is neither listed nor counted before the next write prunes it", async () => {
    await em().getConnection().execute(
      `INSERT INTO bym.notification (userid, kind, jobs, created_at) VALUES (?, 'jobs', '[]', now() - interval '8 days')`,
      [PLAYER]
    );
    expect(await listNotifications(em(), PLAYER)).toEqual([]);
    expect(await unreadNotificationCount(em(), PLAYER)).toBe(0);
  });

  test("marking read is the caller's alone", async () => {
    await notifyAndCount(em(), PLAYER, null, "jobs", [job("upgrade", 1), job("build", 2)]);
    await notifyAndCount(em(), OTHER, null, "jobs", [job("upgrade", 5)]);
    const [first] = await listNotifications(em(), PLAYER);
    const [theirs] = await listNotifications(em(), OTHER);

    // Another player's id marks nothing.
    await markNotificationRead(em(), PLAYER, theirs!.id);
    expect(await unreadNotificationCount(em(), OTHER)).toBe(1);

    await markNotificationRead(em(), PLAYER, first!.id);
    expect(await unreadNotificationCount(em(), PLAYER)).toBe(1);
    expect((await listNotifications(em(), PLAYER)).map((one) => one.read)).toEqual([true, false]);

    await markAllNotificationsRead(em(), PLAYER);
    expect(await unreadNotificationCount(em(), PLAYER)).toBe(0);
    expect(await unreadNotificationCount(em(), OTHER)).toBe(1);
  });
});
