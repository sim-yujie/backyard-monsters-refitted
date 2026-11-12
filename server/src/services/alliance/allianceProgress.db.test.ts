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
const OUTSIDER = BASE + 3;
const USERS = [LEADER, MEMBER, OUTSIDER];
const ALLIANCE = BASE + 1;
const OUTPOST = BASE * 10 + 7;
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
  await sql(`DELETE FROM bym.alliance_defence_credit WHERE outpost IN (?, ?)`, [OUTPOST, OUTPOST + 1]);
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

  test("daily quests pay no points; each counts 1 towards Finish daily quests and marks the member as helping", async () => {
    await progress.setGoal(em(), LEADER, "dailyQuests", "easy", NOW);
    for (let i = 0; i < 4; i++) await progress.creditDailyQuest(em(), MEMBER, NOW);
    expect(Number((await alliance()).points)).toBe(0);
    const view = await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW);
    expect(view.today).toMatchObject({ contributed: 1, members: 2, points_today: 0 });
    expect(view.goals[0]).toMatchObject({ kind: "dailyQuests", progress: 4, target: 100, points: 15 });
    expect(view.top_helpers[0]).toMatchObject({ userid: MEMBER, quests: 4 });
  });

  test("a goal pays once when reached; members cannot set goals; the menu says who each tier is sized for", async () => {
    await expect(progress.setGoal(em(), MEMBER, "hatch", "easy", NOW)).rejects.toThrow("Leader and Officers");
    await progress.setGoal(em(), LEADER, "hatch", "easy", NOW);
    await expect(progress.setGoal(em(), LEADER, "hatch", "hard", NOW)).rejects.toThrow("already set");
    await progress.addGoalProgress(em(), MEMBER, { hatch: 10_000 }, NOW);
    expect(Number((await alliance()).points)).toBe(0);
    await progress.addGoalProgress(em(), MEMBER, { hatch: 6_000 }, NOW);
    await progress.addGoalProgress(em(), MEMBER, { hatch: 6_000 }, NOW);
    expect(Number((await alliance()).points)).toBe(15);
    const view = await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW);
    expect(view.goals[0]).toMatchObject({ kind: "hatch", progress: 18_000, done: true, removable: false });
    expect(view.top_helpers[0]).toMatchObject({ userid: MEMBER });
    // Paid today by the clock (`done_at` is the database's now()).
    const today = await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, Math.floor(Date.now() / 1000));
    expect(today.today.points_today).toBe(15);
    const hatch = view.goal_menu.find((g) => g.kind === "hatch")!;
    expect(hatch.tiers.map((t) => [t.target, t.points, t.players])).toEqual([
      [18_000, 15, 3],
      [48_000, 37, 8],
      [90_000, 70, 15],
    ]);
  });

  test("a cancelled upgrade takes its count back, never below 0, and never off a goal already done", async () => {
    await progress.setGoal(em(), LEADER, "upgrade", "easy", NOW);
    const goal = async () => (await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW)).goals[0]!;
    await progress.addGoalProgress(em(), MEMBER, { upgrade: 2 }, NOW);
    await progress.addGoalProgress(em(), MEMBER, { upgrade: -1 }, NOW);
    expect((await goal()).progress).toBe(1);
    await progress.addGoalProgress(em(), MEMBER, { upgrade: -5 }, NOW);
    expect((await goal()).progress).toBe(0);
    // Only upgrades go back.
    await progress.setGoal(em(), LEADER, "catapultHit", "easy", NOW);
    await progress.addGoalProgress(em(), MEMBER, { catapultHit: 3 }, NOW);
    await progress.addGoalProgress(em(), MEMBER, { catapultHit: -3 }, NOW);
    const hits = (await progress.progressView(em(), ALLIANCE, AllianceType.MIDAS, NOW)).goals[1]!;
    expect(hits.progress).toBe(3);
    await progress.addGoalProgress(em(), MEMBER, { upgrade: 90 }, NOW);
    await progress.addGoalProgress(em(), MEMBER, { upgrade: -1 }, NOW);
    expect(await goal()).toMatchObject({ progress: 90, done: true });
    expect(Number((await alliance()).points)).toBe(15);
  });

  test("lighting a star spends points and records the members' old factor", async () => {
    await expect(progress.lightStar(em(), LEADER, "wormzer", NOW)).rejects.toThrow("more points");
    await sql(`UPDATE bym.alliance SET points = 100 WHERE id = ?`, [ALLIANCE]);
    await expect(progress.lightStar(em(), MEMBER, "wormzer", NOW)).rejects.toThrow("Leader and Officers");
    await expect(progress.lightStar(em(), LEADER, "fang", NOW)).rejects.toThrow("not your alliance");
    const before = (await productionScheduleOfUser(em(), MEMBER)).current;
    await progress.lightStar(em(), LEADER, "wormzer", NOW);
    const after = await alliance();
    expect(Number(after.points_spent)).toBe(20);
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

  test("an outpost defence counts once per attacker per outpost per day, only if it held, never from a mate", async () => {
    const queued = () => progress.pendingAllianceEvents(MEMBER)?.outpostDefended ?? 0;
    const start = queued();
    const defend = (attacker: number, damage: number, outpost = OUTPOST, now = NOW) =>
      progress.noteOutpostDefended(em(), { userid: MEMBER, outpost }, attacker, damage, now);
    // Lost (the outpost was wrecked): nothing.
    expect(await defend(OUTSIDER, 100)).toBe(false);
    // A mate attacking: nothing.
    expect(await defend(LEADER, 0)).toBe(false);
    expect(queued()).toBe(start);
    // Held against an outsider: once.
    expect(await defend(OUTSIDER, 0)).toBe(true);
    expect(queued()).toBe(start + 1);
    // The same attacker on the same outpost the same day: nothing more.
    expect(await defend(OUTSIDER, 0)).toBe(false);
    expect(queued()).toBe(start + 1);
    // Another outpost, or the next day: counts again.
    expect(await defend(OUTSIDER, 0, OUTPOST + 1)).toBe(true);
    expect(await defend(OUTSIDER, 0, OUTPOST, NOW + 86_400)).toBe(true);
    expect(queued()).toBe(start + 3);
  });

  test("goal progress noted in a rolled-back transaction is dropped; a committed one is queued", async () => {
    const hatches = () => progress.pendingAllianceEvents(MEMBER)?.hatch ?? 0;
    const start = hatches();
    await expect(
      progress.countAfterCommit(() =>
        em().transactional(async () => {
          progress.noteAllianceEvents(MEMBER, { hatch: 5 });
          throw new Error("refused");
        })
      )
    ).rejects.toThrow("refused");
    expect(hatches()).toBe(start);
    await progress.countAfterCommit(() =>
      em().transactional(async () => {
        progress.noteAllianceEvents(MEMBER, { hatch: 5 });
      })
    );
    // Hatching counts housing space: 5 heads with no monster named, a Pokey's 10 each.
    expect(hatches()).toBe(start + 50);
  });
});
