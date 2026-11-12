import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { AllianceMessageType, AllianceRole, AllianceType } from "../../enums/Alliance.js";
import { Alliance } from "../../database/models/alliance.model.js";
import { User } from "../../database/models/user.model.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The production factor steps (`productionHistory.ts`) that a join, a leave
 * and a type switch write, against a real Postgres, and the catch-up they
 * drive (security review of 78c9156be, 10 Nov 2026).
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when ALLIANCE_TEST_DB names
 * a throwaway copy of the `bym` schema (with the 20261123 migration run), and
 * refuses the shared `bym`. Rows use ids 993_800 and up and are deleted after.
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

const { addAllianceMember, removeAllianceMember } = await import("./membership.js");
const { switchAllianceType } = await import("./allianceSettings.js");
const { productionScheduleOfUser, settleProductionHistory } = await import("./productionHistory.js");
const { catchUpHarvesters } = await import("../yard/catchUpHarvesters.js");

const BASE = 993_800;
const LEADER = BASE + 1;
const JOINER = BASE + 2;
const USERS = [LEADER, JOINER];
const ALLIANCE = BASE + 1;

const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) =>
  orm!.em.fork().execute<R[]>(query, params);

const clear = async () => {
  await sql(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
  await sql(`DELETE FROM bym."user" WHERE userid IN (${USERS.join(",")})`);
};

const addUser = async (userid: number) =>
  sql(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', now())`,
    [userid, `zz_ph_${userid}`, `zz_ph_${userid}@test.invalid`]
  );

const load = async (userid: number) => orm!.em.fork().findOneOrFail(User, { userid });
const loadAlliance = async () => orm!.em.fork().findOneOrFail(Alliance, { id: ALLIANCE });
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** A level 1 Twig Snapper's buffer after `from`..`to` at `factor`. */
const snapperAfter = (from: number, to: number, factor: Parameters<typeof catchUpHarvesters>[5]) => {
  const save = { buildinghealthdata: {}, storedata: {}, buildingdata: { "1": { id: 1, t: 1, x: 0, y: 0, st: 0, pr: 1, cP: 10 } } };
  catchUpHarvesters(save, from, to, [], "main", factor);
  return Number(save.buildingdata["1"].st);
};

describe.skipIf(!enabled)("production factor steps", () => {
  beforeEach(async () => {
    await clear();
    for (const userid of USERS) await addUser(userid);
    await sql(
      `INSERT INTO bym.alliance (id, name, leader_userid, leader_name, world_id, created_at, type)
       VALUES (?, ?, ?, ?, 'w', now(), ?)`,
      [ALLIANCE, `zz_ph_${ALLIANCE}`, LEADER, `zz_ph_${LEADER}`, AllianceType.MIDAS]
    );
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'leader' WHERE userid = ?`, [ALLIANCE, LEADER]);
  });

  afterAll(async () => {
    await clear();
    await orm?.close();
  });

  test("away, then joined: the time away is paid at no bonus", async () => {
    const away = nowSeconds() - 300;
    await orm!.em.fork().transactional(async (em) => {
      await addAllianceMember(await load(JOINER), await loadAlliance(), AllianceRole.MEMBER, null, em);
    });
    const schedule = await productionScheduleOfUser(orm!.em.fork(), JOINER);
    expect(schedule.current).toBeGreaterThan(1);
    expect(schedule.past).toHaveLength(1);
    expect(schedule.past[0]!.factor).toBe(1);
    // The load right after: the 300 s away at factor 1.
    const at = schedule.past[0]!.until;
    expect(snapperAfter(away, at, schedule)).toBe(snapperAfter(away, at, 1));
  });

  test("leaving keeps the bonus for the time before it", async () => {
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [ALLIANCE, JOINER]);
    const midas = (await productionScheduleOfUser(orm!.em.fork(), JOINER)).current;
    const away = nowSeconds() - 300;
    await removeAllianceMember(await load(JOINER), await loadAlliance(), AllianceMessageType.LEFT);
    const schedule = await productionScheduleOfUser(orm!.em.fork(), JOINER);
    expect(schedule.current).toBe(1);
    expect(schedule.past).toEqual([{ until: expect.any(Number), factor: midas }]);
    const at = schedule.past[0]!.until;
    expect(snapperAfter(away, at, schedule)).toBe(snapperAfter(away, at, midas));
  });

  test("a type switch writes a step for every member; a catch-up past it drops it", async () => {
    await sql(`UPDATE bym."user" SET alliance_id = ?, alliance_role = 'member' WHERE userid = ?`, [ALLIANCE, JOINER]);
    const midas = (await productionScheduleOfUser(orm!.em.fork(), JOINER)).current;
    await switchAllianceType(await load(LEADER), await loadAlliance(), AllianceType.FORTRESS, new Date());
    for (const userid of USERS) {
      const schedule = await productionScheduleOfUser(orm!.em.fork(), userid);
      expect(schedule.past.map((s) => s.factor)).toEqual([midas]);
      expect(schedule.current).toBeLessThan(1);
    }
    const schedule = await productionScheduleOfUser(orm!.em.fork(), JOINER);
    await settleProductionHistory(orm!.em.fork(), JOINER, schedule, nowSeconds() + 1);
    expect((await productionScheduleOfUser(orm!.em.fork(), JOINER)).past).toEqual([]);
    expect((await productionScheduleOfUser(orm!.em.fork(), LEADER)).past).toHaveLength(1);
  });
});
