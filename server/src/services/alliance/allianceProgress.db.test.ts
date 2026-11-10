import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceType } from "../../enums/Alliance.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * Alliance points, goals, stars and territory against a real Postgres
 * (`allianceProgress.ts`). Opt-in: runs only when ALLIANCE_TEST_DB names a
 * throwaway copy with the 20261124 migration run; refuses `bym`. Rows use
 * ids 993_900 and up and are deleted after.
 */
const dbName = process.env.ALLIANCE_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 5 } }) : null;

mock.module("../../server.js", () => ({
  postgres: {
    orm,
    get em() {
      if (!orm) throw new Error("ALLIANCE_TEST_DB is not set");
      return orm.em.fork();
    },
  },
  redis: { ...memoryRedis(), publish: async () => 0 },
}));

const progress = await import("./allianceProgress.js");
const { productionScheduleOfUser } = await import("./productionHistory.js");

const BASE = 993_900;
const LEADER = BASE + 1;
const MEMBER = BASE + 2;
const USERS = [LEADER, MEMBER];
const ALLIANCE = BASE + 1;
// A Wednesday, so the week has begun (Monday 2026-11-09).
const NOW = Date.parse("2026-11-11T12:00:00Z") / 1000;

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);
const em = () => orm!.em.fork();

const clear = async () => {
  await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym.save WHERE saveuserid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
  await sql(`DELETE FROM bym.job_run WHERE job = ?`, [progress.TERRITORY_JOB]);
};

const alliance = async () =>
  (await sql<{ points: number; points_spent: number; stars: Record<string, number> }>(
    `SELECT points, points_spent, stars FROM bym.alliance WHERE id = ?`,
    [ALLIANCE]
  ))[0]!;

describe.skipIf(!enabled)("alliance progress", () => {
  beforeEach(async () => {
    await clear();
    for (const userid of USERS) {
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
         VALUES (?, ?, ?, 'x', '[]', now())`,
        [userid, `zz_ap_${userid}`, `zz_ap_${userid}@test.invalid`]
      );
    }
    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at, type)
       VALUES (?, ?, ?, ?, 'w', now(), ?)`,
      [ALLIANCE, `zz_ap_${ALLIANCE}`, LEADER, `zz_ap_${LEADER}`, AllianceType.MIDAS]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [ALLIANCE, LEADER]);
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [ALLIANCE, MEMBER]);
  });

  afterAll(async () => {
    await clear();
    await orm?.close();
  });

  test("daily quests: 1 point each, 3 a member a day", async () => {
    const paid = [];
    for (let i = 0; i < 4; i++) paid.push(await progress.creditDailyQuest(em(), MEMBER, NOW));
    expect(paid).toEqual([true, true, true, false]);
    expect(Number((await alliance()).points)).toBe(3);
    const view = await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW);
    expect(view.today).toMatchObject({ contributed: 1, members: 2, points_today: 3 });
  });

  test("a goal pays once when reached; members cannot set goals", async () => {
    await expect(progress.setGoal(em(), MEMBER, "hatch", "easy", NOW)).rejects.toThrow("Leader and Officers");
    await progress.setGoal(em(), LEADER, "hatch", "easy", NOW);
    await expect(progress.setGoal(em(), LEADER, "hatch", "hard", NOW)).rejects.toThrow("already set");
    await progress.addGoalProgress(em(), MEMBER, { hatch: 100 }, NOW);
    expect(Number((await alliance()).points)).toBe(0);
    await progress.addGoalProgress(em(), MEMBER, { hatch: 60 }, NOW);
    await progress.addGoalProgress(em(), MEMBER, { hatch: 60 }, NOW);
    expect(Number((await alliance()).points)).toBe(10);
    const view = await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW);
    expect(view.goals[0]).toMatchObject({ kind: "hatch", progress: 150, done: true, removable: false });
    expect(view.top_helpers[0]).toMatchObject({ userid: MEMBER });
  });

  test("lighting a step spends points and records the members' old factor", async () => {
    await expect(progress.lightStar(em(), LEADER, "wormzer", NOW)).rejects.toThrow("more points");
    await sql(`UPDATE bym.alliance SET points = 100 WHERE id = ?`, [ALLIANCE]);
    await expect(progress.lightStar(em(), MEMBER, "wormzer", NOW)).rejects.toThrow("Leader and Officers");
    await expect(progress.lightStar(em(), LEADER, "fang", NOW)).rejects.toThrow("not your alliance");
    const before = (await productionScheduleOfUser(em(), MEMBER)).current;
    await progress.lightStar(em(), LEADER, "wormzer", NOW);
    const after = await alliance();
    expect(Number(after.points_spent)).toBe(40);
    expect(after.stars).toEqual({ wormzer: 1 });
    const schedule = await productionScheduleOfUser(em(), MEMBER);
    expect(schedule.past).toEqual([{ until: NOW, factor: before }]);
    expect(schedule.current).toBeGreaterThan(before);
  });

  test("the territory tally counts members' outposts once a day; the board ranks them", async () => {
    await sql(
      `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                             takeover_date, created_at, lastupdate_at, worldid, mapversion, mr2upgraded)
       VALUES (?, ?, ?, 'outpost', 0, '0', 0, 'o', 0, '[]', now(), now(), now(), 'w', 2, true)`,
      [MEMBER, MEMBER, String(BASE * 10 + 1)]
    );
    expect(await progress.runTerritoryTally(em(), NOW)).toBeGreaterThan(0);
    expect(await progress.runTerritoryTally(em(), NOW)).toBeNull();
    const board = await progress.territoryBoard(em(), AllianceType.MIDAS, NOW, 1000);
    expect(board.find((r) => r.alliance_id === ALLIANCE)).toMatchObject({ month: 1, all_time: 1 });
    await sql(`DELETE FROM bym.save WHERE saveuserid = ?`, [MEMBER]);
  });
});
