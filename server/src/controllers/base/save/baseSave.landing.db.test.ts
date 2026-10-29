import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Context } from "koa";

import ormConfig from "../../../mikro-orm.config.js";
import { User } from "../../../database/models/user.model.js";
import { memoryRedis } from "../../../testing/memoryRedis.js";

/**
 * The save that ends an attack, against a real Postgres (audit 2026-10-29,
 * P1 and P2): its result lands in one transaction with the attack closed, so
 * a failure part-way lands nothing and the same save sent again pays once; and
 * it lands on the rows as they stand when it writes, under their lock, so a
 * change made to them while the battle was replayed is kept.
 *
 * Opt-in: runs only when SAVE_TEST_DB names a throwaway database with the
 * `bym` schema and migrations applied, and refuses the shared `bym`. Its
 * players are `zz_ls_*`, user ids 994_100 and up.
 */
const dbName = process.env.SAVE_TEST_DB;

const redis = { ...memoryRedis(), sadd: async () => 1, srem: async () => 0, smembers: async () => [] as string[] };
const postgres = { em: null as unknown };
mock.module("../../../server.js", () => ({ postgres, redis }));

mock.module("../../../scripts/anticheat/anticheat.js", () => ({
  initAnticheat: async () => {},
  validateSave: async () => {},
}));

/** Runs while the server replays the battle, between its read of the rows and its write. */
let duringReplay: (() => Promise<void>) | null = null;
const REAL_RUNNER = "../../../services/base/combat/replayRunner.ts?real";
const realRunner = (await import(REAL_RUNNER)) as typeof import("../../../services/base/combat/replayRunner.js");
mock.module("../../../services/base/combat/replayRunner.js", () => ({
  ...realRunner,
  replayAbandonedInWorker: async (...args: Parameters<typeof realRunner.replayAbandonedInWorker>) => {
    const outcome = await realRunner.replayAbandonedInWorker(...args);
    if (duringReplay) await duringReplay();
    return outcome;
  },
}));

/** A step after the loot is worked out and before the attack is closed fails, as a database blip would. */
let noticeFails = false;
const REAL_NOTICES = "../../../services/maproom/v2/outpostNotices.ts?real";
const realNotices = (await import(REAL_NOTICES)) as typeof import("../../../services/maproom/v2/outpostNotices.js");
mock.module("../../../services/maproom/v2/outpostNotices.js", () => ({
  ...realNotices,
  noticeOutpostAttack: async (...args: Parameters<typeof realNotices.noticeOutpostAttack>) => {
    if (noticeFails) throw new Error("connection reset");
    return realNotices.noticeOutpostAttack(...args);
  },
}));

const { baseSave } = await import("./baseSave.js");
const { startAttackSession } = await import("../../../services/base/attackSessionStore.js");
const { combatConfig } = await import("../../../config/CombatConfig.js");
/** The save's figures are the client's own guess; the battle is the server's either way (C7). */
const MODE = combatConfig.mode;
const setMode = (mode: typeof MODE) => {
  (combatConfig as { mode: typeof MODE }).mode = mode;
};

const ATTACKER = 994_101;
const OWNER = 994_102;
const EVERYONE = [ATTACKER, OWNER];
const LIST = EVERYONE.join(",");
const ATTACK_ID = 4242;
const HOME = `${ATTACKER}00`;
const CAMP = "99410299";

/** A small wild monster camp, so the replay is quick (as `baseSave.attack.test.ts`). */
const YARD = {
  "0": { id: 0, t: 14, l: 1, X: 0, Y: 0 },
  "1": { id: 1, t: 20, l: 1, X: 200, Y: 200 },
};
const LOG = {
  v: 1,
  seed: 5,
  events: [{ kind: "fling", t: 80, x: 400, y: 400, r: 200, monsters: { C4: 12 } }],
};
const ENTRY = { [HOME]: { C4: 12, C1: 4 } };
const CLAIM = { r1: 1e9, r2: 1e9, r3: 1e9, r4: 1e9 };
const START = { r1: 100, r2: 100, r3: 100, r4: 100 };
const CAMP_POOL = { r1: 5000, r2: 0, r3: 0, r4: 0 };

describe.skipIf(!dbName)("the save that ends an attack, on a real database (audit P1, P2)", () => {
  let orm: MikroORM;
  let homeSaveId = 0;
  let campSaveId = 0;
  const em = () => orm.em.fork();
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => em().execute<R[]>(query, params);

  const rowOf = async (basesaveid: number) => {
    const [row] = await sql(`SELECT resources, attackid, damage FROM bym.save WHERE basesaveid = ?`, [basesaveid]);
    return row as { resources: Record<string, number>; attackid: number; damage: number };
  };
  const addTo = async (basesaveid: number, key: string, amount: number) => {
    const { resources } = await rowOf(basesaveid);
    await sql(`UPDATE bym.save SET resources = ? WHERE basesaveid = ?`, [
      JSON.stringify({ ...resources, [key]: Number(resources[key] ?? 0) + amount }),
      basesaveid,
    ]);
  };

  /** The final save of the attack, as the web client sends it: in a request context of its own. */
  const finalSave = async () => {
    const context = em();
    postgres.em = context;
    const user = await context.findOneOrFail(User, { userid: ATTACKER });
    const ctx = {
      authUser: user,
      request: {
        body: {
          baseid: CAMP,
          basesaveid: String(campSaveId),
          attackid: String(ATTACK_ID),
          over: "1",
          attackloot: JSON.stringify(CLAIM),
          flinglog: JSON.stringify(LOG),
        },
      },
      ip: "127.0.0.1",
      path: "/base/save",
    } as unknown as Context;
    await baseSave(ctx, async () => {});
    return ctx.body as { lootcredited?: Record<string, number> };
  };

  const reset = async () => {
    duringReplay = null;
    noticeFails = false;
    redis.clear();
    await sql(
      `UPDATE bym.save SET resources = ?, buildingdata = '{}', buildinghealthdata = '{}', monsters = NULL, champion = '[]',
              savetime = ?, attackid = 0, damage = 0, mapversion = 1
        WHERE basesaveid = ?`,
      [JSON.stringify(START), Math.floor(Date.now() / 1000), homeSaveId]
    );
    await sql(
      `UPDATE bym.save SET resources = ?, buildingdata = ?, buildinghealthdata = '{}', savetime = ?, attackid = ?, damage = 0,
              destroyed = 0, type = 'tribe', wmid = 11
        WHERE basesaveid = ?`,
      [JSON.stringify(CAMP_POOL), JSON.stringify(YARD), Math.floor(Date.now() / 1000), ATTACK_ID, campSaveId]
    );
    await startAttackSession(campSaveId, {
      attackerid: ATTACKER,
      attackid: ATTACK_ID,
      startedat: Math.floor(Date.now() / 1000),
      entryHoused: ENTRY,
      defenderResources: CAMP_POOL,
    } as never);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("SAVE_TEST_DB must be a throwaway database, not bym");
    setMode("log");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 6 } });
    for (const userid of EVERYONE) {
      const name = `zz_ls_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
    }
    const insertSave = async (userid: number, baseid: string, type: string) => {
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE baseid = ?`, [baseid]);
      if (existing) return Number(existing.basesaveid);
      const [row] = await sql(
        `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                               takeover_date, created_at, lastupdate_at)
         VALUES (?, ?, ?, ?, '0', '0', ?, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
        [userid, userid, baseid, type, Math.floor(Date.now() / 1000) - 86_400]
      );
      return Number(row!.basesaveid);
    };
    homeSaveId = await insertSave(ATTACKER, HOME, "main");
    campSaveId = await insertSave(OWNER, CAMP, "tribe");
    await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [homeSaveId, ATTACKER]);
  });

  beforeEach(reset);

  afterAll(async () => {
    setMode(MODE);
    if (!orm) return;
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("a save that fails after its loot is worked out lands nothing, and sent again it pays once (P1)", async () => {
    noticeFails = true;
    await expect(finalSave()).rejects.toThrow("connection reset");

    // Nothing of it landed: the attack is still open, and nobody was paid.
    expect((await rowOf(homeSaveId)).resources).toEqual(START);
    const open = await rowOf(campSaveId);
    expect(open.attackid).toBe(ATTACK_ID);
    expect(open.resources).toEqual(CAMP_POOL);

    // The same save again (the page-close copy, or the client's retry) lands it, once.
    noticeFails = false;
    const answer = await finalSave();
    const credited = answer.lootcredited!;
    expect(credited.r1).toBeGreaterThan(0);
    expect((await rowOf(homeSaveId)).resources).toEqual({ ...START, r1: START.r1 + credited.r1 });
    const closed = await rowOf(campSaveId);
    expect(closed.attackid).toBe(0);
    expect(closed.resources.r1).toBeLessThan(CAMP_POOL.r1);

    // And once more: the attack is closed, so it is refused and pays nothing.
    await expect(finalSave()).rejects.toThrow();
    expect((await rowOf(homeSaveId)).resources).toEqual({ ...START, r1: START.r1 + credited.r1 });
    expect((await rowOf(campSaveId)).resources).toEqual(closed.resources);
  });

  test("a change to either row while the battle is replayed is kept beside the loot (P2)", async () => {
    // A gift collected by the attacker, and something added to the camp, both
    // written by other requests after this save read the rows.
    duringReplay = async () => {
      await addTo(homeSaveId, "r2", 777);
      await addTo(campSaveId, "r3", 55);
    };

    const answer = await finalSave();
    const credited = answer.lootcredited!;
    expect(credited.r1).toBeGreaterThan(0);

    expect((await rowOf(homeSaveId)).resources).toEqual({ ...START, r1: START.r1 + credited.r1, r2: START.r2 + 777 });
    const camp = await rowOf(campSaveId);
    expect(camp.attackid).toBe(0);
    expect(camp.resources.r3).toBe(55);
    expect(camp.resources.r1).toBeLessThan(CAMP_POOL.r1);
  });
});
