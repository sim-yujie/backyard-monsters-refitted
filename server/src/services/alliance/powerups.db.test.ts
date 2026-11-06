import { afterAll, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { POWERUP_RULES } from "../../config/AllianceConfig.js";

/**
 * Two power-up purchases sent at once against a real Postgres (security audit
 * 2026-10-29, M1): with Shiny for one, exactly one is charged, and with Shiny
 * for both, both charges and both hours stick.
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when POWERUPS_TEST_DB
 * names a throwaway copy of the `bym` schema, and refuses the shared `bym`.
 * The purchases commit for real (two transactions cannot share a rollback),
 * so the rows are made with ids well clear of a copy's and deleted after.
 * Run this file on its own, as the `server.js` stand-in stays for files run
 * after it.
 */
const dbName = process.env.POWERUPS_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } }) : null;

// Stood in even when skipped: the real `server.js` would start a server.
mock.module("../../server.js", () => ({
  postgres: {
    orm,
    // A request's own entity manager, as each request has one.
    get em() {
      if (!orm) throw new Error("POWERUPS_TEST_DB is not set");
      return orm.em.fork();
    },
  },
  redis: { del: async () => 0 },
}));
mock.module("./allianceMessages.js", () => ({ announceShout: async () => {} }));

const { reducePowerupCharge } = await import("./powerups.js");

const USERID = 994_100;
const ALLIANCE = 994_100;
const ARMAMENT = POWERUP_RULES[0]!;
const HOUR = 3600;

const sql = () => orm!.em.fork().getConnection();

const setUp = async (credits: number) => {
  await tearDown();
  await sql().execute(
    `INSERT INTO bym."user" (userid, username, email, password, blocked_users, last_seen_at)
     VALUES (?, ?, ?, 'x', '[]', now())`,
    [USERID, `pu_${USERID}`, `pu_${USERID}@test.invalid`]
  );
  await sql().execute(
    `INSERT INTO bym.alliance (id, name, leader_userid, world_id, created_at) VALUES (?, ?, ?, 'w', now())`,
    [ALLIANCE, `pu_${ALLIANCE}`, USERID]
  );
  const [save] = await sql().execute<{ basesaveid: number }[]>(
    `INSERT INTO bym.save (userid, saveuserid, baseid, type, mapversion, points, basevalue,
                           createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
     VALUES (?, ?, ?, 'main', 1, '0', '0', 0, 'yard', ?, '[]', now(), now(), now())
     RETURNING basesaveid`,
    [USERID, USERID, `${USERID}00`, credits]
  );
  const now = Math.floor(Date.now() / 1000);
  for (const rules of POWERUP_RULES) {
    await sql().execute(
      `INSERT INTO bym.alliance_powerup (alliance_id, powerup, active, end_time, updated_at)
       VALUES (?, ?, false, ?, now())`,
      [ALLIANCE, rules.type, rules === ARMAMENT ? now + 10 * HOUR : now + rules.recharge_time]
    );
  }
  return { basesaveid: save!.basesaveid, chargedUntil: now + 10 * HOUR };
};

const tearDown = async () => {
  await sql().execute(`DELETE FROM bym.alliance WHERE id = ?`, [ALLIANCE]);
  await sql().execute(`DELETE FROM bym.save WHERE userid = ?`, [USERID]);
  await sql().execute(`DELETE FROM bym."user" WHERE userid = ?`, [USERID]);
};

const state = async () => {
  const [save] = await sql().execute<{ credits: number }[]>(`SELECT credits FROM bym.save WHERE userid = ?`, [USERID]);
  const [powerup] = await sql().execute<{ end_time: number }[]>(
    `SELECT end_time FROM bym.alliance_powerup WHERE alliance_id = ? AND powerup = ?`,
    [ALLIANCE, ARMAMENT.type]
  );
  return { credits: Number(save!.credits), endTime: Number(powerup!.end_time) };
};

const buy = (basesaveid: number, hours: number) =>
  reducePowerupCharge({
    allianceId: ALLIANCE,
    author: { userid: USERID } as never,
    basesaveid,
    powerupId: ARMAMENT.powerup_id,
    hours,
  }).then(
    () => "ok",
    (error: Error) => error.message
  );

describe.skipIf(!enabled)("two power-up purchases at once, on Postgres (security audit 2026-10-29, M1)", () => {
  afterAll(async () => {
    await tearDown();
    await orm?.close(true);
  });

  test("Shiny for one: exactly one is charged", async () => {
    const { basesaveid, chargedUntil } = await setUp(100);

    const outcomes = await Promise.all([buy(basesaveid, 4), buy(basesaveid, 4), buy(basesaveid, 4)]);

    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(1);
    expect(await state()).toEqual({ credits: 100 - 4 * ARMAMENT.hourly_cost, endTime: chargedUntil - 4 * HOUR });
  });

  test("Shiny for both: both are charged and both hours count", async () => {
    const { basesaveid, chargedUntil } = await setUp(200);

    const outcomes = await Promise.all([buy(basesaveid, 3), buy(basesaveid, 2)]);

    expect(outcomes).toEqual(["ok", "ok"]);
    expect(await state()).toEqual({ credits: 200 - 5 * ARMAMENT.hourly_cost, endTime: chargedUntil - 5 * HOUR });
  });
});
