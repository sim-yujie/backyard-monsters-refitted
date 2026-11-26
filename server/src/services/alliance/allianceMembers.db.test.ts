import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The alliance Members tab's "last seen" (owner, 25 Nov 2026 grilling, beta
 * 9) against a real Postgres: every member carries a step, a member who hides
 * their online status shows only 1-4 weeks or over a month, `last_seen_at`
 * itself is never sent, and the roster costs the same few reads at 60
 * members as at 3 (one query per list, built for 4,000-40,000 daily players).
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when ALLIANCE_TEST_DB names
 * a throwaway copy of the `bym` schema, and refuses the shared `bym`. Rows use
 * ids 993_800 and up and are deleted after.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

let queries = 0;
const orm = enabled
  ? await MikroORM.init({
      ...ormConfig,
      dbName,
      debug: ["query"],
      logger: () => {
        queries += 1;
      },
      pool: { min: 0, max: 4 },
    })
  : null;

const redis = memoryRedis();
mock.module("../../server.js", () => ({
  postgres: {
    orm,
    get em() {
      if (!orm) throw new Error("ALLIANCE_TEST_DB is not set");
      return orm.em.fork();
    },
  },
  redis: { ...redis, publish: async () => 0 },
}));

const { getAllianceMembers } = await import("./allianceMembers.js");
const { lastActionKey, lastSeenKey } = await import("../user/online.js");

const BASE = 993_800;
const ALLIANCE = BASE + 1;
const LEADER = BASE + 1;
const CROWD = 60;
const USERS = Array.from({ length: CROWD }, (_, i) => BASE + 1 + i);
const DAY = 24 * 60 * 60;

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm!.em.fork().execute<R[]>(query, params);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
  await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.save WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
};

/** A member with a main yard, last seen `days` ago (null: never). */
const addMember = async (userid: number, days: number | null, hidden = false) => {
  const now = Math.floor(Date.now() / 1000);
  await sql(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at, hide_online, alliance_id, alliance_role)
     VALUES (?, ?, ?, 'x', '[]', ?, ?, ?, ?)`,
    [
      userid,
      `zz_ls_${userid}`,
      `zz_ls_${userid}@test.invalid`,
      days === null ? null : new Date((now - days * DAY) * 1000),
      hidden,
      ALLIANCE,
      userid === LEADER ? "leader" : "member",
    ]
  );
  const [save] = await sql<{ basesaveid: number }>(
    `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                           takeover_date, created_at, lastupdate_at, worldid, mapversion, mr2upgraded, buildingdata)
     VALUES (?, ?, ?, 'main', 0, '0', 0, 'main', 0, '[]', now(), now(), now(), 'w', 2, true, '{}'::jsonb)
     RETURNING basesaveid`,
    [userid, userid, String(userid)]
  );
  await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [save!.basesaveid, userid]);
};

const markOnline = async (userid: number) => {
  const now = Math.floor(Date.now() / 1000);
  await redis.setex(lastSeenKey(userid), 120, String(now));
  await redis.setex(lastActionKey(userid), 600, String(now));
};

describe.skipIf(!enabled)("the alliance Members tab's last seen", () => {
  beforeEach(async () => {
    await clear();
    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at) VALUES (?, 'zz_ls_alliance', ?, ?, 'w', now())`,
      [ALLIANCE, LEADER, `zz_ls_${LEADER}`]
    );
  });

  afterAll(async () => {
    if (!orm) return;
    await clear();
    await orm.close(true);
  });

  const seenBy = async () => Object.fromEntries((await getAllianceMembers(ALLIANCE)).map((m) => [m.user_id, m.seen]));

  test("each member's step; hidden shows only 1-4 weeks and over a month; last_seen_at never sent", async () => {
    const [online, today, week, weeks, month, never, hidden3, hidden10, hidden40, hiddenOnline] = USERS;
    await addMember(online!, 40);
    await addMember(today!, 0.1);
    await addMember(week!, 3);
    await addMember(weeks!, 10);
    await addMember(month!, 40);
    await addMember(never!, null);
    await addMember(hidden3!, 3, true);
    await addMember(hidden10!, 10, true);
    await addMember(hidden40!, 40, true);
    await addMember(hiddenOnline!, 40, true);
    await markOnline(online!);
    await markOnline(hiddenOnline!);

    expect(await seenBy()).toEqual({
      [online!]: "online",
      [today!]: "today",
      [week!]: "week",
      [weeks!]: "weeks",
      [month!]: "month",
      [never!]: "month",
      [hidden3!]: null,
      [hidden10!]: "weeks",
      [hidden40!]: "month",
      [hiddenOnline!]: null,
    });

    const body = JSON.stringify(await getAllianceMembers(ALLIANCE));
    expect(body).not.toContain("last_seen");
    expect(body).not.toContain("hide_online");
    // The online flag the row's dot reads is unchanged.
    const members = await getAllianceMembers(ALLIANCE);
    expect(members.find((m) => m.user_id === online)?.status.online).toBe(true);
  });

  test("the same number of database reads for 3 members as for 60", async () => {
    for (const userid of USERS.slice(0, 3)) await addMember(userid, 2);
    queries = 0;
    await getAllianceMembers(ALLIANCE);
    const few = queries;

    for (const userid of USERS.slice(3)) await addMember(userid, 12);
    queries = 0;
    const roster = await getAllianceMembers(ALLIANCE);
    expect(roster).toHaveLength(CROWD);
    expect(queries).toBe(few);
    expect(few).toBeGreaterThan(0);
    expect(few).toBeLessThanOrEqual(3);
  });
});
