import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import type { Context } from "koa";
import { MikroORM, type EntityManager } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { PLACEHOLDER_PIC_SQUARE } from "../../game-data/avatars.js";
import { memoryRedis } from "../../testing/memoryRedis.js";

/**
 * The old Flash Inferno routes, closed until the new Inferno ships
 * (`config/InfernoConfig.ts`). Each test sends requests those routes used to
 * accept; each must now be refused, and leave both yards as they were.
 *
 * The real routes run against a real Postgres, as a player's requests would.
 * The player signed up and loaded their yard; a Flash-era Inferno yard is made
 * for them directly, as some players still have one.
 *
 * Opt-in, like the other `*.db.test.ts`: runs only when INFERNO_TEST_DB names
 * a throwaway database with the `bym` schema, and refuses the shared `bym`.
 * Redis is a stand-in in memory, and so is `server.js`, so nothing boots; run
 * this file on its own, as the stand-in stays for files run after it.
 */
const dbName = process.env.INFERNO_TEST_DB;
const enabled = Boolean(dbName) && dbName !== "bym";

const PREFIX = "zz_cir";

const orm = enabled ? await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } }) : null;

/** The entity manager of the request being handled. */
let current: EntityManager | null = null;

/** `memoryRedis` plus the sets the attack checkpoint index keeps (`finaliseAttack.ts`). */
const sets = new Map<string, Set<string>>();
const redis = {
  ...memoryRedis(),
  sadd: async (key: string, ...members: (string | string[])[]) => {
    const set = sets.get(key) ?? new Set<string>();
    members.flat().forEach((member) => set.add(String(member)));
    sets.set(key, set);
    return members.flat().length;
  },
  smembers: async (key: string) => [...(sets.get(key) ?? [])],
  srem: async (key: string, ...members: (string | string[])[]) =>
    members.flat().filter((member) => sets.get(key)?.delete(String(member))).length,
};

if (enabled) {
  mock.module("../../server.js", () => ({
    postgres: {
      orm,
      get em() {
        if (!current) throw new Error("No request running");
        return current;
      },
    },
    redis,
  }));
}

/** Keys the Flash client sent with every save. */
const FLASH_KEYS = { points: "0", basevalue: "0", empirevalue: "0" };

type Controller = (ctx: Context) => Promise<void>;
type Body = Record<string, unknown>;

describe.skipIf(!enabled)("the old Inferno routes refuse every cheat on a real database", () => {
  const db = orm!;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => db.em.fork().execute<R[]>(query, params);

  let routes: {
    baseLoad: Controller;
    baseSave: Controller;
    infernoSave: Controller;
    infernoMonsters: Controller;
    updateSaved: Controller;
    getNeighbours: Controller;
  };

  let player: User;
  let infernoBasesaveid = 0;
  let infernoBaseid = "";

  /** Runs a route as the player's request, as `verifyUserAuth` would hand it over; answers its status and body or the error it threw. */
  const call = async (controller: Controller, body: Body = {}) => {
    current = db.em.fork();
    const authUser = await current.findOneOrFail(User, { email: player.email });
    const ctx = {
      authUser,
      meetsDiscordAgeCheck: true,
      request: { body },
      query: {},
      path: "/test",
      ip: "127.0.0.1",
      status: 0,
      body: undefined as unknown,
    };
    try {
      await controller(ctx as unknown as Context);
      return { status: ctx.status, body: ctx.body as Body, error: null as any };
    } catch (error) {
      return { status: (error as any)?.status ?? 500, body: undefined, error: error as any };
    } finally {
      current = null;
    }
  };

  const load = (type: string, baseid = "0") => call(routes.baseLoad, { type, userid: "0", baseid, mapversion: "1" });

  /** The player's two rows, as stored. */
  const rows = async () => {
    const [main] = await sql(
      `SELECT monsters, lockerdata, academy, iresources, wmstatus, resources FROM bym.save WHERE userid = ? AND type = 'main'`,
      [player.userid],
    );
    const [inferno] = await sql(
      `SELECT monsters, lockerdata, resources, buildingdata FROM bym.save WHERE userid = ? AND type = 'inferno'`,
      [player.userid],
    );
    const [maproom] = await sql(`SELECT tribedata FROM bym.maproom_inferno WHERE userid = ?`, [player.userid]);
    return { main, inferno, maproom: maproom ?? null };
  };

  /** A refusal of the closed Inferno: 403 with `reason: "infernoClosed"`. */
  const expectClosed = (answer: Awaited<ReturnType<typeof call>>) => {
    expect(answer.error?.data?.reason).toBe("infernoClosed");
    expect(answer.status).toBe(403);
  };

  const cleanUp = async () => {
    const users = await sql<{ userid: number }>(`SELECT userid FROM bym."user" WHERE username LIKE ?`, [`${PREFIX}%`]);
    for (const { userid } of users) {
      await sql(`DELETE FROM bym.maproom_inferno WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.maproom WHERE userid = ?`, [userid]);
      await sql(`UPDATE bym."user" SET save_basesaveid = NULL, infernosave_basesaveid = NULL WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym.save WHERE userid = ?`, [userid]);
      await sql(`DELETE FROM bym."user" WHERE userid = ?`, [userid]);
    }
  };

  beforeAll(async () => {
    routes = {
      baseLoad: (await import("../base/load/baseLoad.js")).baseLoad,
      baseSave: (await import("../base/save/baseSave.js")).baseSave,
      infernoSave: (await import("./infernoSave.js")).infernoSave,
      infernoMonsters: (await import("./infernoMonsters.js")).infernoMonsters,
      updateSaved: (await import("../base/save/updateSaved.js")).updateSaved,
      getNeighbours: (await import("../maproom/getNeighbours.js")).getNeighbours,
    };
    await cleanUp();

    const em = db.em.fork();
    player = em.create(User, {
      username: `${PREFIX}player`,
      email: `${PREFIX}player@test.com`,
      password: "x",
      pic_square: PLACEHOLDER_PIC_SQUARE,
      terms_accepted_at: new Date(),
    });
    await em.flush();

    const built = await load("build");
    expect(built.error).toBeNull();

    // A Flash-era Inferno yard, as some players still have.
    const forInferno = db.em.fork();
    const owner = await forInferno.findOneOrFail(User, { userid: player.userid }, { populate: ["save"] });
    const inferno = await Save.createInfernoSave(forInferno, owner);
    infernoBasesaveid = inferno.basesaveid;
    infernoBaseid = inferno.baseid;
  }, 120_000);

  afterAll(async () => {
    await cleanUp();
    await db.close(true);
  });

  test("the main yard still loads", async () => {
    const built = await load("build");
    expect(built.error).toBeNull();
    expect(built.body?.error).toBe(0);
  });

  test("the Moloch tribe requests leave the main yard as it was", async () => {
    // As for a player with no Inferno yard.
    await sql(`UPDATE bym."user" SET infernosave_basesaveid = NULL WHERE userid = ?`, [player.userid]);
    const before = await rows();

    expectClosed(await load("idescent"));
    expectClosed(await load("iwmview", "201"));
    expectClosed(
      await call(routes.infernoSave, {
        baseid: "201",
        basesaveid: "999999999",
        ...FLASH_KEYS,
        attackcreatures: JSON.stringify({ C12: 250 }),
        destroyed: "0",
      }),
    );

    const after = await rows();
    expect(after.main).toEqual(before.main);
    expect(after.maproom).toBeNull();

    await sql(`UPDATE bym."user" SET infernosave_basesaveid = ? WHERE userid = ?`, [infernoBasesaveid, player.userid]);
  });

  test("the Inferno owner saves and build load leave both yards as they were", async () => {
    const before = await rows();
    const forged = { lockerdata: JSON.stringify({ C19: 1, IC5: 1 }), academy: JSON.stringify({ IC5: { level: 6 } }) };

    expectClosed(await call(routes.infernoSave, { baseid: infernoBaseid, basesaveid: String(infernoBasesaveid), ...FLASH_KEYS, ...forged }));
    expectClosed(await call(routes.baseSave, { baseid: infernoBaseid, basesaveid: String(infernoBasesaveid), ...FLASH_KEYS, ...forged }));
    expectClosed(await load("ibuild"));

    const after = await rows();
    expect(after.main).toEqual(before.main);
    expect(after.inferno).toEqual(before.inferno);
    expect((after.main?.lockerdata ?? {}).C19).toBeUndefined();
  });

  test("the Inferno save and monsters routes write nothing", async () => {
    const before = await rows();

    expectClosed(
      await call(routes.infernoSave, {
        baseid: infernoBaseid,
        basesaveid: String(infernoBasesaveid),
        ...FLASH_KEYS,
        resources: JSON.stringify({ r1: 50_000_000, r2: 50_000_000, r3: 50_000_000, r4: 50_000_000 }),
        buildingdata: JSON.stringify({ "1": { t: 14, X: 0, Y: 0, l: 10 } }),
        purchase: JSON.stringify(["IC1", 50]),
      }),
    );
    expectClosed(await call(routes.infernoMonsters, { type: "set", imonsters: JSON.stringify({ IC1: 500 }) }));
    expectClosed(await call(routes.infernoMonsters, { type: "get" }));

    const after = await rows();
    expect(after.main).toEqual(before.main);
    expect(after.inferno).toEqual(before.inferno);
  });

  test("every other Inferno mode and the Inferno neighbour list are refused too", async () => {
    for (const mode of ["iview", "iattack", "iwmattack", "ihelp"]) expectClosed(await load(mode, infernoBaseid));
    expectClosed(await call(routes.updateSaved, { type: "iview", baseid: infernoBaseid, version: "1", lastupdate: "0", mapversion: "1" }));
    expectClosed(await call(routes.updateSaved, { type: "iattack", baseid: infernoBaseid, version: "1", lastupdate: "0", mapversion: "1" }));
    expectClosed(await call(routes.getNeighbours, { type: "inferno" }));
  });

  test("the Inferno save route writes no main yard either", async () => {
    const before = await rows();
    const [{ basesaveid }] = await sql<{ basesaveid: number }>(
      `SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`,
      [player.userid],
    );
    expectClosed(
      await call(routes.infernoSave, {
        baseid: "0",
        basesaveid: String(basesaveid),
        ...FLASH_KEYS,
        lockerdata: JSON.stringify({ C19: 1 }),
      }),
    );
    expect((await rows()).main).toEqual(before.main);
  });
});
