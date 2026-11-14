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
import { makeAdminGuard } from "../../services/admin/adminGuard.js";
import { mountAnnouncementRoutes } from "./routes.js";

/**
 * The announcement routes over HTTP against a real Postgres: only the owner
 * writes, players see only published announcements in date, newest first,
 * "Got it" sticks to the account, a gift gives its Shiny once per account,
 * and a draft's pictures stay private.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `anntest_*`, account numbers from 996101; announcements are
 * titled `anntest ...`. Everything is deleted afterwards.
 *
 * The sign-in is a stand-in: `Authorization: Bearer <userid>`. The owner-only
 * check is the real one (`makeAdminGuard`) around it.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const PLAYER = 996101;
const OTHER = 996102;
const OWNER = 996109;
const ALL = [PLAYER, OTHER, OWNER];
const LIST = ALL.join(",");
const HOUR = 3_600_000;
const START_SHINY = 50;

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const fakeSignIn = async (ctx: Context, next: Next) => {
  const userid = Number(/^Bearer (\d+)$/.exec(ctx.get("Authorization"))?.[1]);
  // Like the real check, a missing sign-in throws.
  if (!userid) ctx.throw(Status.UNAUTHORIZED, "Sign in");
  ctx.authUser = { userid } as Context["authUser"];
  await next();
};

describe.skipIf(!dbName)("the announcement routes on a real database", () => {
  let orm: MikroORM;
  let server: Server;
  let base = "";
  let now = new Date("2026-11-01T12:00:00Z");

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
      body: type.includes("json") ? ((await response.json()) as any) : await response.text(),
    };
  };

  const form = (title: string, overrides: Record<string, unknown> = {}) => ({
    title: `anntest ${title}`,
    body: "Hello\nplayers",
    status: "published",
    startsAt: null,
    endsAt: null,
    images: [],
    ...overrides,
  });

  const write = async (title: string, overrides: Record<string, unknown> = {}) => {
    const answer = await call("POST", "/api/v/admin/announcements", OWNER, form(title, overrides));
    expect(answer.status).toBe(200);
    return answer.body.announcement as { id: number; imageIds: number[]; status: string; live: boolean };
  };

  const playerList = async (as = PLAYER) => {
    const answer = await call("GET", "/api/v/bm/announcements", as);
    expect(answer.status).toBe(200);
    return answer.body.announcements as { id: number; title: string; dismissed: boolean; imageIds: number[] }[];
  };

  const reset = async () => {
    await sql(`DELETE FROM bym.announcement WHERE title LIKE 'anntest%'`);
    await sql(`UPDATE bym.save SET credits = ? WHERE userid IN (${PLAYER}, ${OTHER})`, [START_SHINY]);
    await sql(`DELETE FROM bym.event_coin_log WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.event_coins WHERE userid IN (${LIST})`);
  };

  /** The player's Glimmers (event coins), 0 with no row. */
  const glimmersOf = async (userid: number) => {
    const [row] = await sql<{ balance: number }>(`SELECT balance FROM bym.event_coins WHERE userid = ?`, [userid]);
    return Number(row?.balance ?? 0);
  };

  const shinyOf = async (userid: number) => {
    const [row] = await sql<{ credits: number }>(`SELECT credits FROM bym.save WHERE userid = ?`, [userid]);
    return Number(row!.credits);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `anntest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
    }
    for (const userid of [PLAYER, OTHER]) {
      const [row] = await sql(
        `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                               takeover_date, created_at, lastupdate_at)
         VALUES (?, ?, ?, 'main', '0', '0', 0, 'yard', ?, '[]', now(), now(), now()) RETURNING basesaveid`,
        [userid, userid, `${userid}00`, START_SHINY]
      );
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [row!.basesaveid, userid]);
    }
    const version = getGameVersion();
    const app = new Koa();
    const router = new Router();
    mountAnnouncementRoutes(router, {
      em: () => orm.em.fork(),
      signedIn: [fakeSignIn],
      adminOnly: makeAdminGuard(fakeSignIn, (userid) => userid === OWNER),
      imageLimiter: async (_ctx, next) => next(),
      now: () => now,
    });
    app.use(bodyParser({ enableTypes: ["json"], jsonLimit: "8mb" }));
    app.use(jsonBodyCompat);
    // The routes take the version in the path; this stands in for the client's.
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
    now = new Date("2026-11-01T12:00:00Z");
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

  describe("only the owner writes", () => {
    test("a player, or no one signed in, gets a plain 404 on every dashboard route and nothing is written", async () => {
      const id = (await write("existing")).id;
      for (const as of [PLAYER, null]) {
        expect((await call("GET", "/api/v/admin/announcements", as)).status).toBe(404);
        expect((await call("POST", "/api/v/admin/announcements", as, form("sneaky"))).status).toBe(404);
        expect((await call("PUT", `/api/v/admin/announcements/${id}`, as, form("changed"))).status).toBe(404);
        expect((await call("DELETE", `/api/v/admin/announcements/${id}`, as)).status).toBe(404);
      }
      const rows = await sql<{ title: string }>(`SELECT title FROM bym.announcement WHERE title LIKE 'anntest%'`);
      expect(rows.map((r) => r.title)).toEqual(["anntest existing"]);
    });

    test("the owner can list, change and delete", async () => {
      const id = (await write("first", { status: "draft" })).id;
      const listed = await call("GET", "/api/v/admin/announcements", OWNER);
      expect(listed.body.announcements.find((a: { id: number }) => a.id === id)).toMatchObject({ status: "draft", live: false });
      expect(listed.body.limits.images).toBe(3);

      const changed = await call("PUT", `/api/v/admin/announcements/${id}`, OWNER, form("first, changed"));
      expect(changed.status).toBe(200);
      expect(changed.body.announcement).toMatchObject({ title: "anntest first, changed", status: "published", live: true });
      expect(changed.body.announcement.publishedAt).toBe(now.toISOString());

      expect((await call("DELETE", `/api/v/admin/announcements/${id}`, OWNER)).status).toBe(200);
      expect((await call("DELETE", `/api/v/admin/announcements/${id}`, OWNER)).status).toBe(404);
      expect((await call("PUT", `/api/v/admin/announcements/${id}`, OWNER, form("gone"))).status).toBe(404);
    });

    test("a bad form is refused with the reason", async () => {
      const answer = await call("POST", "/api/v/admin/announcements", OWNER, form("x", { title: "" }));
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ error: "Give it a title.", reason: "badAnnouncement" });
    });
  });

  describe("what players see", () => {
    test("needs a sign-in", async () => {
      expect((await call("GET", "/api/v/bm/announcements", null)).status).toBe(401);
    });

    test("only published ones in date, newest first", async () => {
      await write("draft", { status: "draft" });
      await write("not yet", { startsAt: new Date(now.getTime() + HOUR).toISOString() });
      await write("over", { startsAt: new Date(now.getTime() - 3 * HOUR).toISOString(), endsAt: new Date(now.getTime() - HOUR).toISOString() });
      await write("older", { startsAt: new Date(now.getTime() - 2 * HOUR).toISOString() });
      await write("running", { endsAt: new Date(now.getTime() + HOUR).toISOString() });

      const titles = (await playerList()).map((a) => a.title).filter((t) => t.startsWith("anntest"));
      expect(titles).toEqual(["anntest running", "anntest older"]);

      // Two hours on: "not yet" has started and "running" has ended.
      now = new Date(now.getTime() + 2 * HOUR);
      const later = (await playerList()).map((a) => a.title).filter((t) => t.startsWith("anntest"));
      expect(later).toEqual(["anntest not yet", "anntest older"]);
    });

    test("\"Got it\" sticks to the account, on every device, and only for that player", async () => {
      const id = (await write("free")).id;
      expect((await playerList()).find((a) => a.id === id)?.dismissed).toBe(false);

      const done = await call("POST", `/api/v/bm/announcements/${id}/dismiss`, PLAYER);
      expect(done.status).toBe(200);
      expect((await call("POST", `/api/v/bm/announcements/${id}/dismiss`, PLAYER)).status).toBe(200);

      expect((await playerList(PLAYER)).find((a) => a.id === id)?.dismissed).toBe(true);
      expect((await playerList(OTHER)).find((a) => a.id === id)?.dismissed).toBe(false);
      const admin = await call("GET", "/api/v/admin/announcements", OWNER);
      expect(admin.body.announcements.find((a: { id: number }) => a.id === id)?.dismissals).toBe(1);
    });

    test("\"Got it\" on a draft, an unknown or a bad id is a 404", async () => {
      const draft = (await write("draft", { status: "draft" })).id;
      expect((await call("POST", `/api/v/bm/announcements/${draft}/dismiss`, PLAYER)).status).toBe(404);
      expect((await call("POST", `/api/v/bm/announcements/999999999/dismiss`, PLAYER)).status).toBe(404);
      expect((await call("POST", `/api/v/bm/announcements/abc/dismiss`, PLAYER)).status).toBe(404);
    });

    test("a gift gives its Shiny once per account, and counts as \"Got it\"", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      const before = (await call("GET", "/api/v/bm/announcements", PLAYER)).body.announcements[0];
      expect(before).toMatchObject({ id, shiny: 200, claimed: false, dismissed: false });

      const first = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ id, shiny: 200, already: false });
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 200);

      const second = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(second.body).toMatchObject({ shiny: 200, already: true });
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 200);
      expect(await shinyOf(OTHER)).toBe(START_SHINY);

      const after = (await call("GET", "/api/v/bm/announcements", PLAYER)).body.announcements[0];
      expect(after).toMatchObject({ claimed: true, dismissed: true });
      const admin = await call("GET", "/api/v/admin/announcements", OWNER);
      expect(admin.body.announcements.find((a: { id: number }) => a.id === id)).toMatchObject({ shiny: 200, claims: 1, dismissals: 1 });
    });

    test("many presses at once give one gift", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      const answers = await Promise.all(
        Array.from({ length: 8 }, () => call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER))
      );
      expect(answers.map((a) => a.status)).toEqual(Array(8).fill(200));
      expect(answers.filter((a) => a.body.already === false)).toHaveLength(1);
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 200);
    });

    test("closing a gift without claiming it brings it back", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      await call("POST", `/api/v/bm/announcements/${id}/dismiss`, PLAYER);
      expect((await playerList()).find((a) => a.id === id)?.dismissed).toBe(false);
      await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect((await playerList()).find((a) => a.id === id)?.dismissed).toBe(true);
    });

    test("only a current gift can be claimed, and the claim's answer stays after it ends", async () => {
      const plain = (await write("no gift")).id;
      const draft = (await write("draft", { status: "draft", shiny: 200 })).id;
      const ending = (await write("ending", { shiny: 200, endsAt: new Date(now.getTime() + HOUR).toISOString() })).id;
      await call("POST", `/api/v/bm/announcements/${ending}/claim`, OTHER);

      expect((await call("POST", `/api/v/bm/announcements/${plain}/claim`, PLAYER)).status).toBe(409);
      expect((await call("POST", `/api/v/bm/announcements/${draft}/claim`, PLAYER)).status).toBe(404);
      expect((await call("POST", `/api/v/bm/announcements/abc/claim`, PLAYER)).status).toBe(404);

      now = new Date(now.getTime() + 2 * HOUR);
      const late = await call("POST", `/api/v/bm/announcements/${ending}/claim`, PLAYER);
      expect(late.status).toBe(404);
      expect(await shinyOf(PLAYER)).toBe(START_SHINY);
      expect((await call("POST", `/api/v/bm/announcements/${ending}/claim`, OTHER)).body.already).toBe(true);
      expect(await shinyOf(OTHER)).toBe(START_SHINY + 200);
    });

    test("a player with no yard is refused and no claim is kept", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      expect((await call("POST", `/api/v/bm/announcements/${id}/claim`, OWNER)).status).toBe(409);
      const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.announcement_claim WHERE announcement_id = ?`, [id]);
      expect(row!.n).toBe(0);
    });

    test("a gift's amount changes only until the first claim; the words can change after it", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      const put = (overrides: Record<string, unknown>) =>
        call("PUT", `/api/v/admin/announcements/${id}`, OWNER, form("thanks", overrides));
      expect((await put({ shiny: 300 })).status).toBe(200);
      await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      const refused = await put({ shiny: 400 });
      expect(refused.status).toBe(409);
      expect(refused.body.reason).toBe("giftClaimed");
      expect((await put({ shiny: 300, body: "New words" })).status).toBe(200);
      expect((await call("POST", `/api/v/bm/announcements/${id}/claim`, OTHER)).body.shiny).toBe(300);
    });

    test("deleting an announcement takes its \"Got it\" records with it", async () => {
      const id = (await write("short-lived")).id;
      await call("POST", `/api/v/bm/announcements/${id}/dismiss`, PLAYER);
      await call("DELETE", `/api/v/admin/announcements/${id}`, OWNER);
      const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.announcement_dismissal WHERE announcement_id = ?`, [id]);
      expect(row!.n).toBe(0);
    });
  });

  describe("a Glimmers gift", () => {
    test("gives its Glimmers once per account, logged under the announcement, with the purse in the answer", async () => {
      const id = (await write("glimmers", { glimmers: 100 })).id;
      const before = (await playerList()).find((a) => a.id === id);
      expect(before).toMatchObject({ shiny: 0, glimmers: 100, claimed: false, dismissed: false });

      const first = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        id,
        shiny: 0,
        glimmers: 100,
        already: false,
        eventcoins: 100,
        coinsGained: [{ amount: 100, reason: "announcement" }],
      });
      expect(await glimmersOf(PLAYER)).toBe(100);
      expect(await shinyOf(PLAYER)).toBe(START_SHINY);

      const second = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(second.body).toMatchObject({ glimmers: 100, already: true, eventcoins: 100 });
      expect(second.body.coinsGained).toBeUndefined();
      expect(await glimmersOf(PLAYER)).toBe(100);
      expect(await glimmersOf(OTHER)).toBe(0);

      const log = await sql<{ amount: number; reason: string; award_key: string }>(
        `SELECT amount, reason, award_key FROM bym.event_coin_log WHERE userid = ?`,
        [PLAYER]
      );
      expect(log).toEqual([{ amount: 100, reason: "announcement", award_key: `announcement:${id}` }]);
      const [claim] = await sql<{ amount: number; glimmers: number }>(
        `SELECT amount, glimmers FROM bym.announcement_claim WHERE userid = ? AND announcement_id = ?`,
        [PLAYER, id]
      );
      expect(claim).toEqual({ amount: 0, glimmers: 100 });
      expect((await playerList()).find((a) => a.id === id)).toMatchObject({ claimed: true, dismissed: true });
      const admin = await call("GET", "/api/v/admin/announcements", OWNER);
      expect(admin.body.announcements.find((a: { id: number }) => a.id === id)).toMatchObject({
        shiny: 0,
        glimmers: 100,
        claims: 1,
      });
      expect(admin.body.limits).toMatchObject({ glimmersMax: 1000 });
    });

    test("one Claim gives the Shiny and the Glimmers together", async () => {
      const id = (await write("both", { shiny: 200, glimmers: 100 })).id;
      const first = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(first.body).toMatchObject({ shiny: 200, glimmers: 100, already: false, eventcoins: 100 });
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 200);
      expect(await glimmersOf(PLAYER)).toBe(100);
      await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 200);
      expect(await glimmersOf(PLAYER)).toBe(100);
    });

    test("many presses at once give the Glimmers once", async () => {
      const id = (await write("glimmers", { shiny: 20, glimmers: 100 })).id;
      const answers = await Promise.all(
        Array.from({ length: 8 }, () => call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER))
      );
      expect(answers.map((a) => a.status)).toEqual(Array(8).fill(200));
      expect(answers.filter((a) => a.body.already === false)).toHaveLength(1);
      expect(await glimmersOf(PLAYER)).toBe(100);
      expect(await shinyOf(PLAYER)).toBe(START_SHINY + 20);
      const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.event_coin_log WHERE userid = ?`, [PLAYER]);
      expect(row!.n).toBe(1);
    });

    test("adds to Glimmers the player already has", async () => {
      await sql(`INSERT INTO bym.event_coins (userid, balance, earned) VALUES (?, 40, 40)`, [PLAYER]);
      const id = (await write("glimmers", { glimmers: 100 })).id;
      expect((await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER)).body.eventcoins).toBe(140);
      expect(await glimmersOf(PLAYER)).toBe(140);
    });

    test("an older Shiny-only claim stays as it was: no Glimmers, no purse", async () => {
      const id = (await write("thanks", { shiny: 200 })).id;
      await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      const again = await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      expect(again.body).toMatchObject({ shiny: 200, glimmers: 0, already: true });
      expect(again.body.eventcoins).toBeUndefined();
      expect(await glimmersOf(PLAYER)).toBe(0);
    });

    test("the Glimmers change only until the first claim", async () => {
      const id = (await write("glimmers", { glimmers: 100 })).id;
      const put = (overrides: Record<string, unknown>) =>
        call("PUT", `/api/v/admin/announcements/${id}`, OWNER, form("glimmers", overrides));
      expect((await put({ glimmers: 150 })).status).toBe(200);
      await call("POST", `/api/v/bm/announcements/${id}/claim`, PLAYER);
      const refused = await put({ glimmers: 300 });
      expect(refused.status).toBe(409);
      expect(refused.body.reason).toBe("giftClaimed");
      // Adding Shiny to a claimed Glimmers gift is a change too.
      expect((await put({ glimmers: 150, shiny: 10 })).status).toBe(409);
      expect((await put({ glimmers: 150, body: "New words" })).status).toBe(200);
      expect((await call("POST", `/api/v/bm/announcements/${id}/claim`, OTHER)).body.glimmers).toBe(150);
    });

    test("too many Glimmers are refused", async () => {
      const answer = await call("POST", "/api/v/admin/announcements", OWNER, form("too many", { glimmers: 1001 }));
      expect(answer.status).toBe(400);
      expect(answer.body.error).toContain("Glimmers");
    });
  });

  describe("pictures", () => {
    test("a draft's picture is the dashboard's alone until it is published", async () => {
      const draft = await write("pictured", { status: "draft", images: [{ data: PNG }] });
      const [imageId] = draft.imageIds;
      expect(imageId).toBeGreaterThan(0);

      expect((await call("GET", `/api/v/announcements/images/${imageId}`, null)).status).toBe(404);
      const own = await call("GET", `/api/v/admin/announcements/images/${imageId}`, OWNER);
      expect(own.status).toBe(200);
      expect(own.type).toBe("image/png");
      expect((await call("GET", `/api/v/admin/announcements/images/${imageId}`, PLAYER)).status).toBe(404);

      await call("PUT", `/api/v/admin/announcements/${draft.id}`, OWNER, form("pictured", { images: [{ keep: imageId }] }));
      const open = await call("GET", `/api/v/announcements/images/${imageId}`, null);
      expect(open.status).toBe(200);
      expect(open.type).toBe("image/png");
      expect(open.cache).toContain("immutable");
      expect((await playerList()).find((a) => a.id === draft.id)?.imageIds).toEqual([imageId!]);
    });

    test("an edit keeps, reorders, drops and adds pictures", async () => {
      const first = await write("album", { images: [{ data: PNG }, { data: PNG }] });
      const [a, b] = first.imageIds;
      const changed = await call("PUT", `/api/v/admin/announcements/${first.id}`, OWNER, form("album", { images: [{ keep: b }, { data: PNG }] }));
      expect(changed.status).toBe(200);
      const ids: number[] = changed.body.announcement.imageIds;
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(b!);
      expect(ids).not.toContain(a!);
      expect((await call("GET", `/api/v/announcements/images/${a}`, null)).status).toBe(404);
    });

    test("an edit cannot take another announcement's picture", async () => {
      const other = await write("other", { images: [{ data: PNG }] });
      const mine = await write("mine");
      const answer = await call("PUT", `/api/v/admin/announcements/${mine.id}`, OWNER, form("mine", { images: [{ keep: other.imageIds[0] }] }));
      expect(answer.status).toBe(400);
      expect(answer.body.reason).toBe("badImage");
      const [row] = await sql<{ n: number }>(`SELECT count(*)::int AS n FROM bym.announcement_image WHERE announcement_id = ?`, [other.id]);
      expect(row!.n).toBe(1);
    });
  });
});
