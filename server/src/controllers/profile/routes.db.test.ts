import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import Router from "@koa/router";
import { MikroORM } from "@mikro-orm/postgresql";
import type { Server } from "node:http";
import Koa, { type Context, type Next } from "koa";
import bodyParser from "koa-bodyparser";
import jpeg from "jpeg-js";

import ormConfig from "../../mikro-orm.config.js";
import { getGameVersion } from "../../config/VersionManifestConfig.js";
import { Status } from "../../enums/StatusCodes.js";
import { jsonBodyCompat } from "../../middleware/jsonBody.js";
import { makeAdminGuard } from "../../services/admin/adminGuard.js";
import { makeWordFilter } from "../../services/chat/badWords.js";
import { playerLevel } from "../../services/profile/profiles.js";
import { PHOTO_CHANGE_MS } from "../../services/profile/profileRules.js";
import { mountProfileRoutes } from "./routes.js";

/**
 * The profile routes over HTTP against a real Postgres: bios are filtered,
 * photos are re-encoded at 128x128 and limited to level 10 and once a day,
 * three players' reports hide a photo, and the owner's dashboard keeps,
 * removes or blocks.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `proftest_*`, account numbers from 996201. Everything is
 * deleted afterwards. The sign-in is a stand-in: `Authorization: Bearer <userid>`.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const PLAYER = 996201;
const LOW = 996202;
const R1 = 996203;
const R2 = 996204;
const R3 = 996205;
const OWNER = 996209;
const ALL = [PLAYER, LOW, R1, R2, R3, OWNER];
const LIST = ALL.join(",");

const fakeSignIn = async (ctx: Context, next: Next) => {
  const userid = Number(/^Bearer (\d+)$/.exec(ctx.get("Authorization"))?.[1]);
  if (!userid) ctx.throw(Status.UNAUTHORIZED, "Sign in");
  ctx.authUser = { userid } as Context["authUser"];
  await next();
};

const photoUpload = (width = 300, height = 200, comment = "secret-gps"): string => {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i / 4) % width;
    data[i + 1] = 90;
    data[i + 2] = 200;
    data[i + 3] = 255;
  }
  const encoded = Buffer.from(jpeg.encode({ data, width, height, comments: [comment] }, 90).data);
  return `data:image/jpeg;base64,${encoded.toString("base64")}`;
};

describe.skipIf(!dbName)("the profile routes on a real database", () => {
  let orm: MikroORM;
  let server: Server;
  let base = "";
  let now = new Date("2026-11-10T12:00:00Z");

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const call = async (method: string, path: string, as: number | null, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(as !== null && { Authorization: `Bearer ${as}` }),
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const type = response.headers.get("content-type") ?? "";
    return {
      status: response.status,
      type,
      cache: response.headers.get("cache-control"),
      body: type.includes("json") ? ((await response.json()) as any) : Buffer.from(await response.arrayBuffer()),
    };
  };

  const profileOf = async (userid: number, as: number) => {
    const answer = await call("GET", `/api/v/bm/profile/${userid}`, as);
    expect(answer.status).toBe(200);
    return answer.body.profile;
  };

  const reset = async () => {
    await sql(`DELETE FROM bym.photo_report WHERE reported_id IN (${LIST}) OR reporter_id IN (${LIST})`);
    await sql(`DELETE FROM bym.player_profile WHERE userid IN (${LIST})`);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    await sql(`DELETE FROM bym.photo_report WHERE reported_id IN (${LIST}) OR reporter_id IN (${LIST})`);
    for (const userid of ALL) {
      const name = `proftest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const [row] = existing
        ? [existing]
        : await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', ?, '0', 0, 'yard', 0, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, userid === LOW ? "0" : "50000000"],
          );
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [row!.basesaveid, userid]);
    }
    const version = getGameVersion();
    const app = new Koa();
    const router = new Router();
    const pass = async (_ctx: Context, next: Next) => next();
    const filter = makeWordFilter({});
    mountProfileRoutes(router, {
      em: () => orm.em.fork(),
      signedIn: [fakeSignIn],
      adminOnly: makeAdminGuard(fakeSignIn, (userid) => userid === OWNER),
      limiters: { read: pass, write: pass, upload: pass, report: pass, image: pass },
      filter: () => filter,
      now: () => now,
    });
    app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "2mb" }));
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
    now = new Date("2026-11-10T12:00:00Z");
    await reset();
  });

  afterAll(async () => {
    server?.close();
    if (!orm) return;
    await reset();
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("the test players' levels", async () => {
    expect(await playerLevel(orm.em.fork(), PLAYER)).toBeGreaterThanOrEqual(10);
    expect(await playerLevel(orm.em.fork(), LOW)).toBeLessThan(10);
  });

  test("a profile shows the stats; only the player's own has the photo rules", async () => {
    const own = await profileOf(PLAYER, PLAYER);
    expect(own.username).toBe(`proftest_${PLAYER}`);
    expect(own.own).toBe(true);
    expect(own.bio).toBe("");
    expect(own.photoVersion).toBeNull();
    expect(own.stats.level).toBeGreaterThanOrEqual(10);
    expect(own.stats.friends).toBe(0);
    expect(own.photoState).toMatchObject({ canUpload: true, blocked: false, hidden: false, minLevel: 10 });

    const other = await profileOf(PLAYER, R1);
    expect(other.own).toBe(false);
    expect(other.photoState).toBeNull();

    expect((await profileOf(LOW, LOW)).photoState).toMatchObject({ canUpload: false, reason: "lowLevel" });
    expect((await call("GET", `/api/v/bm/profile/99999999`, PLAYER)).status).toBe(404);
    expect((await call("GET", `/api/v/bm/profile/${PLAYER}`, null)).status).toBe(401);
  });

  test("bios are trimmed, capped and word-filtered", async () => {
    const saved = await call("POST", "/api/v/bm/profile/bio", PLAYER, { bio: "  Goo farmer\n\n\nfrom PH  " });
    expect(saved.status).toBe(200);
    expect(saved.body.bio).toBe("Goo farmer\nfrom PH");
    expect((await profileOf(PLAYER, R1)).bio).toBe("Goo farmer\nfrom PH");

    const bad = await call("POST", "/api/v/bm/profile/bio", PLAYER, { bio: "fuck you" });
    expect(bad.status).toBe(400);
    expect(bad.body.reason).toBe("badWords");
    const long = await call("POST", "/api/v/bm/profile/bio", PLAYER, { bio: "x".repeat(151) });
    expect(long.body.reason).toBe("tooLong");
    expect((await profileOf(PLAYER, PLAYER)).bio).toBe("Goo farmer\nfrom PH");
  });

  test("a photo is stored re-encoded at 128x128, without its metadata, and served", async () => {
    const upload = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    expect(upload.status).toBe(200);
    expect(upload.body.profile.photoVersion).toBe(1);
    expect(upload.body.profile.photoState).toMatchObject({ canUpload: false, reason: "tooSoon" });

    const image = await call("GET", `/api/v/profile/photos/${PLAYER}?v=1`, null);
    expect(image.status).toBe(200);
    expect(image.type).toBe("image/jpeg");
    expect(image.cache).toContain("private");
    const bytes = image.body as Buffer;
    expect(bytes.includes(Buffer.from("secret-gps"))).toBe(false);
    const decoded = jpeg.decode(bytes);
    expect([decoded.width, decoded.height]).toEqual([128, 128]);
    expect(bytes.length).toBeLessThan(16 * 1024);

    const [row] = await sql<{ size: number }>(`SELECT octet_length(photo) AS size FROM bym.player_profile WHERE userid = ?`, [PLAYER]);
    expect(Number(row!.size)).toBe(bytes.length);
  });

  test("uploads: level 10, once a day, pictures only", async () => {
    const low = await call("POST", "/api/v/bm/profile/photo", LOW, { photo: photoUpload() });
    expect(low.status).toBe(409);
    expect(low.body.reason).toBe("lowLevel");

    const notImage = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: "data:image/jpeg;base64,PGh0bWw+" });
    expect(notImage.status).toBe(400);
    expect(notImage.body.reason).toBe("notImage");

    expect((await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() })).status).toBe(200);
    const again = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("tooSoon");
    expect(again.body.nextAt).toBe(new Date(now.getTime() + PHOTO_CHANGE_MS).toISOString());

    now = new Date(now.getTime() + PHOTO_CHANGE_MS);
    const next = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload(200, 300) });
    expect(next.status).toBe(200);
    expect(next.body.profile.photoVersion).toBe(2);
  });

  test("the player can take their photo down; the day's upload stays used", async () => {
    await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    const removed = await call("POST", "/api/v/bm/profile/photo/remove", PLAYER, {});
    expect(removed.status).toBe(200);
    expect(removed.body.profile.photoVersion).toBeNull();
    expect(removed.body.profile.photoState.reason).toBe("tooSoon");
    expect((await call("GET", `/api/v/profile/photos/${PLAYER}`, null)).status).toBe(404);
  });

  test("three different players' reports hide the photo until the owner looks", async () => {
    await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });

    expect((await call("POST", `/api/v/bm/profile/${PLAYER}/report`, PLAYER, {})).body.reason).toBe("self");
    const first = await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R1, {});
    expect(first.status).toBe(200);
    expect(first.body.already).toBe(false);
    expect((await profileOf(PLAYER, R1)).reported).toBe(true);
    // The same player twice counts once.
    expect((await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R1, {})).body.already).toBe(true);
    await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R2, {});
    expect((await profileOf(PLAYER, LOW)).photoVersion).toBe(1);

    await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R3, {});
    expect((await profileOf(PLAYER, LOW)).photoVersion).toBeNull();
    expect((await call("GET", `/api/v/profile/photos/${PLAYER}`, null)).status).toBe(404);
    const own = await profileOf(PLAYER, PLAYER);
    expect(own.photoState).toMatchObject({ hidden: true, canUpload: false });

    // Not even the next day: the owner sees the reported photo first.
    now = new Date(now.getTime() + 2 * PHOTO_CHANGE_MS);
    const swap = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    expect(swap.body.reason).toBe("underReview");
    expect((await call("POST", `/api/v/bm/profile/${PLAYER}/report`, LOW, {})).status).toBe(409);
  });

  test("the dashboard: a hidden photo's case, keep, remove and block", async () => {
    await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    for (const reporter of [R1, R2, R3]) await call("POST", `/api/v/bm/profile/${PLAYER}/report`, reporter, {});

    expect((await call("GET", "/api/v/admin/photoreports", PLAYER)).status).toBe(404);
    const list = await call("GET", "/api/v/admin/photoreports", OWNER);
    expect(list.status).toBe(200);
    expect(list.body.open).toBeGreaterThanOrEqual(1);
    expect(list.body.hideAt).toBe(3);
    const mine = list.body.cases.find((entry: any) => entry.userid === PLAYER);
    expect(mine).toMatchObject({ hidden: true, blocked: false, photoVersion: 1 });
    expect(mine.photo).toStartWith("data:image/jpeg;base64,");
    expect(mine.reporters.map((r: any) => r.userid)).toEqual([R1, R2, R3]);

    // Keep: shown again, and these reports no longer hide this upload.
    const kept = await call("POST", `/api/v/admin/photoreports/${PLAYER}/act`, OWNER, { action: "keep" });
    expect(kept.status).toBe(200);
    expect(kept.body.case).toMatchObject({ hidden: false, kept: true, reporters: [] });
    expect((await profileOf(PLAYER, LOW)).photoVersion).toBe(1);
    await call("POST", `/api/v/bm/profile/${PLAYER}/report`, LOW, {});
    expect((await profileOf(PLAYER, R1)).photoVersion).toBe(1);
    const closed = await call("GET", "/api/v/admin/photoreports?status=closed", OWNER);
    expect(closed.body.cases.find((entry: any) => entry.userid === PLAYER).closed).toMatchObject({ outcome: "kept", by: OWNER });

    // Block: the photo goes, and so do uploads.
    const blocked = await call("POST", `/api/v/admin/photoreports/${PLAYER}/act`, OWNER, { action: "block" });
    expect(blocked.body.case).toMatchObject({ photo: null, blocked: true, reporters: [] });
    expect((await call("GET", `/api/v/profile/photos/${PLAYER}`, null)).status).toBe(404);
    now = new Date(now.getTime() + 2 * PHOTO_CHANGE_MS);
    expect((await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() })).body.reason).toBe("blocked");
    expect((await profileOf(PLAYER, PLAYER)).photoState).toMatchObject({ blocked: true, reason: "blocked" });

    // Unblock: uploads again.
    await call("POST", `/api/v/admin/photoreports/${PLAYER}/act`, OWNER, { action: "unblock" });
    const back = await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    expect(back.status).toBe(200);
    expect(back.body.profile.photoVersion).toBe(2);

    // Remove: the photo goes, uploads stay allowed.
    const removed = await call("POST", `/api/v/admin/photoreports/${PLAYER}/act`, OWNER, { action: "remove" });
    expect(removed.body.case).toMatchObject({ photo: null, blocked: false });
    expect((await profileOf(PLAYER, R1)).photoVersion).toBeNull();

    expect((await call("POST", `/api/v/admin/photoreports/${PLAYER}/act`, OWNER, { action: "nuke" })).status).toBe(400);
  });

  test("a new upload closes reports of the old photo that did not hide it", async () => {
    await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R1, {});
    now = new Date(now.getTime() + PHOTO_CHANGE_MS);
    await call("POST", "/api/v/bm/profile/photo", PLAYER, { photo: photoUpload() });
    const [row] = await sql<{ outcome: string }>(`SELECT outcome FROM bym.photo_report WHERE reported_id = ? AND reporter_id = ?`, [PLAYER, R1]);
    expect(row!.outcome).toBe("replaced");
    // A report of the new photo is a new report.
    expect((await call("POST", `/api/v/bm/profile/${PLAYER}/report`, R1, {})).body.already).toBe(false);
  });
});
