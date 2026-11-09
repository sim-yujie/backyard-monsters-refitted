import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import Router from "@koa/router";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Server } from "node:http";
import Koa, { type Context, type Next } from "koa";
import bodyParser from "koa-bodyparser";

import ormConfig from "../../mikro-orm.config.js";
import { getGameVersion } from "../../config/VersionManifestConfig.js";
import { Status } from "../../enums/StatusCodes.js";
import { jsonBodyCompat } from "../../middleware/jsonBody.js";
import { makeWordFilter } from "../../services/chat/badWords.js";
import { OUTPOST_PINS_MAX } from "../../services/outposts/outpostLabelRules.js";
import { outpostLabelsOnLoad } from "../../services/outposts/outpostLabels.js";
import { mountOutpostLabelRoutes } from "./labelRoutes.js";

/**
 * Outpost names and pins over HTTP against a real Postgres: a player names
 * and pins only their own outposts, names are checked, pins keep their order
 * and stop at the limit, and an outpost lost to someone else drops out.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `oltest_*`, account numbers from 996301; their outposts are
 * baseids 99630100xx. Everything is deleted afterwards. The sign-in is a
 * stand-in: `Authorization: Bearer <userid>`.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const ME = 996301;
const OTHER = 996302;
const ALL = [ME, OTHER];
const LIST = ALL.join(",");
/** The outposts ME owns: enough to pass the pin limit. */
const MINE = Array.from({ length: OUTPOST_PINS_MAX + 2 }, (_, i) => `99630100${String(i).padStart(2, "0")}`);
const THEIRS = "9963020001";

const fakeSignIn = async (ctx: Context, next: Next) => {
  const userid = Number(/^Bearer (\d+)$/.exec(ctx.get("Authorization"))?.[1]);
  if (!userid) ctx.throw(Status.UNAUTHORIZED, "Sign in");
  ctx.authUser = { userid } as Context["authUser"];
  await next();
};

describe.skipIf(!dbName)("the outpost label routes on a real database", () => {
  let orm: MikroORM;
  let server: Server;
  let base = "";

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const call = async (method: string, path: string, as: number, body?: unknown) => {
    const response = await fetch(`${base}/api/v/bm/outposts/${path}`, {
      method,
      headers: { Authorization: `Bearer ${as}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };
  const name = (as: number, baseid: string, text: unknown) => call("POST", "name", as, { baseid, name: text });
  const pin = (as: number, baseid: string, on: boolean) => call("POST", "pin", as, { baseid, pin: on });

  const addOutpost = (userid: number, baseid: string) =>
    sql(
      `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                             takeover_date, created_at, lastupdate_at)
       VALUES (?, ?, ?, 'outpost', 0, '0', 0, 'outpost', 0, '[]', now(), now(), now())`,
      [userid, userid, baseid],
    );

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    for (const userid of ALL) {
      const username = `oltest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, username, `${username}@test.invalid`],
      );
    }
    for (const baseid of MINE) await addOutpost(ME, baseid);
    await addOutpost(OTHER, THEIRS);

    const version = getGameVersion();
    const app = new Koa();
    const router = new Router();
    const filter = makeWordFilter({});
    mountOutpostLabelRoutes(router, {
      em: () => orm.em.fork(),
      signedIn: [fakeSignIn],
      limiter: async (_ctx: Context, next: Next) => next(),
      filter: () => filter,
    });
    app.use(bodyParser({ enableTypes: ["json"] }));
    app.use(jsonBodyCompat);
    app.use(async (ctx, next) => {
      ctx.path = ctx.path.replace(/^\/api\/v\//, `/api/${version ?? "v"}/`);
      await next();
    });
    app.use(router.routes());
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.outpost_label WHERE userid IN (${LIST})`);
    // Every outpost back with its first owner.
    await sql(`UPDATE bym.save SET userid = ?, saveuserid = ? WHERE baseid IN (${MINE.map(() => "?").join(",")})`, [
      ME,
      ME,
      ...MINE,
    ]);
  });

  afterAll(async () => {
    server?.close();
    if (!orm) return;
    await sql(`DELETE FROM bym.outpost_label WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("names an own outpost, trimmed; an empty name clears it and drops the row", async () => {
    const named = await name(ME, MINE[0]!, "  Gold   mine ");
    expect(named.status).toBe(200);
    expect(named.body.labels).toEqual({ names: { [MINE[0]!]: "Gold mine" }, pins: [] });
    expect((await call("GET", "labels", ME)).body.labels.names[MINE[0]!]).toBe("Gold mine");

    const cleared = await name(ME, MINE[0]!, "");
    expect(cleared.body.labels).toEqual({ names: {}, pins: [] });
    expect(await sql(`SELECT 1 FROM bym.outpost_label WHERE userid = ?`, [ME])).toHaveLength(0);
  });

  test("refuses another player's outpost, a main yard and a bad id", async () => {
    expect(await name(ME, THEIRS, "Mine now")).toMatchObject({ status: 404, body: { reason: "notOwner" } });
    expect(await pin(ME, THEIRS, true)).toMatchObject({ status: 404, body: { reason: "notOwner" } });
    expect(await name(ME, "0", "Home")).toMatchObject({ status: 400, body: { reason: "badRequest" } });
    expect(await name(ME, "abc", "Home")).toMatchObject({ status: 400, body: { reason: "badRequest" } });
    expect(await call("POST", "pin", ME, { baseid: MINE[0], pin: "yes" })).toMatchObject({ status: 400 });
    expect(await sql(`SELECT 1 FROM bym.outpost_label WHERE baseid = ?`, [THEIRS])).toHaveLength(0);
  });

  test("refuses long names and filtered words", async () => {
    expect(await name(ME, MINE[0]!, "x".repeat(25))).toMatchObject({ status: 400, body: { reason: "tooLong" } });
    expect(await name(ME, MINE[0]!, "fuck it")).toMatchObject({ status: 400, body: { reason: "badWords" } });
  });

  test("pins list in the order pinned; unpinning keeps the name", async () => {
    await pin(ME, MINE[2]!, true);
    await pin(ME, MINE[0]!, true);
    await name(ME, MINE[1]!, "Third");
    const third = await pin(ME, MINE[1]!, true);
    expect(third.body.labels.pins).toEqual([MINE[2], MINE[0], MINE[1]]);

    // Pinning again changes nothing; unpinning and re-pinning goes last.
    expect((await pin(ME, MINE[2]!, true)).body.labels.pins).toEqual([MINE[2], MINE[0], MINE[1]]);
    await pin(ME, MINE[2]!, false);
    expect((await pin(ME, MINE[2]!, true)).body.labels.pins).toEqual([MINE[0], MINE[1], MINE[2]]);

    const unpinned = await pin(ME, MINE[1]!, false);
    expect(unpinned.body.labels).toEqual({ names: { [MINE[1]!]: "Third" }, pins: [MINE[0], MINE[2]] });
  });

  test(`stops at ${OUTPOST_PINS_MAX} pins`, async () => {
    for (const baseid of MINE.slice(0, OUTPOST_PINS_MAX)) expect((await pin(ME, baseid, true)).status).toBe(200);
    expect(await pin(ME, MINE[OUTPOST_PINS_MAX]!, true)).toMatchObject({ status: 409, body: { reason: "pinLimit" } });
    await pin(ME, MINE[0]!, false);
    expect((await pin(ME, MINE[OUTPOST_PINS_MAX]!, true)).status).toBe(200);
  });

  test("an outpost lost to another player drops out of the list and the pin count", async () => {
    await name(ME, MINE[0]!, "Lost one");
    await pin(ME, MINE[0]!, true);
    await sql(`UPDATE bym.save SET userid = ?, saveuserid = ? WHERE baseid = ?`, [OTHER, OTHER, MINE[0]]);
    expect((await call("GET", "labels", ME)).body.labels).toEqual({ names: {}, pins: [] });
    // The new owner does not inherit it.
    expect((await call("GET", "labels", OTHER)).body.labels).toEqual({ names: {}, pins: [] });
    expect(await name(ME, MINE[0]!, "Back")).toMatchObject({ status: 404 });
  });

  test("the yard load's copy: null with none, the set with some", async () => {
    expect(await outpostLabelsOnLoad(() => orm.em.fork(), ME)).toBeNull();
    await name(ME, MINE[3]!, "Farm");
    expect(await outpostLabelsOnLoad(() => orm.em.fork(), ME)).toEqual({ names: { [MINE[3]!]: "Farm" }, pins: [] });
  });
});
