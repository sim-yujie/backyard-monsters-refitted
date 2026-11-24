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
import type { ModerationEffects } from "../../services/admin/moderation.js";
import { recordChatFlag } from "../../services/chat/chatFlags.js";
import type { LineRef } from "../../services/chat/removeChatLines.js";
import { addWatchWord, readWatchWords, removeWatchWord } from "../../services/chat/watchWords.js";
import { mountModReportsRoutes } from "./routes.js";

/**
 * The chat filter's side of the Reports window against a real Postgres
 * (owner, 24 Nov 2026): a filter flag really lands with its tags, line id
 * and yard age; the window shows them, groups a repeated line and the
 * player's yard age ("New · 30h"); Remove takes lines out of chat, is
 * refused on staff, and is marked on the line. The watched words table is
 * seeded and editable.
 *
 * Opt-in like the other database tests: DASHBOARD_TEST_DB names a throwaway
 * database with every migration applied (never `bym`). Players are
 * `cfiltertest_*`, account numbers from 996401; deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const MOD = 996401;
const SPAMMER = 996402;
const MOD2 = 996403;
const ADMIN = 996404;
const ALL = [MOD, SPAMMER, MOD2, ADMIN];
const LIST = ALL.join(",");
const ROOM = "chat:country:PH";
const NOW = new Date("2026-11-24T12:00:00Z");
const T0 = NOW.getTime() - 3_600_000;

const fakeSignIn = async (ctx: Context, next: Next) => {
  const userid = Number(/^Bearer (\d+)$/.exec(ctx.get("Authorization"))?.[1]);
  if (!userid) ctx.throw(Status.UNAUTHORIZED, "Sign in");
  ctx.authUser = { userid } as Context["authUser"];
  await next();
};

describe.skipIf(!dbName)("the chat filter in the Reports window, on a real database", () => {
  let orm: MikroORM;
  let server: Server;
  let base = "";
  const removed: { channel: string; line: LineRef }[] = [];
  const effects: ModerationEffects = { endSessions: async () => {}, kickFromChat: async () => {}, muteInChat: async () => {}, nudge: async () => {} };
  const savedAdmins = process.env.ADMIN_USER_IDS;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const call = async (method: string, path: string, as: number, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${as}`, ...(body !== undefined && { "Content-Type": "application/json" }) },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  const filterFlag = (i: number, message: string, tags: string[], extra: { hidden?: boolean; shown?: string } = {}) =>
    recordChatFlag(orm.em.fork(), {
      userid: SPAMMER,
      channel: ROOM,
      message,
      shown: extra.shown ?? message,
      words: [],
      severity: "filter",
      rule: "word",
      ts: T0 + i * 1000,
      tags,
      hidden: extra.hidden ?? false,
      lineId: `line${i}`,
      yardAgeHours: 30,
    });

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `cfiltertest_${userid}`;
      await sql(`INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`, [
        userid,
        name,
        `${name}@test.invalid`,
      ]);
    }
    // The spammer's main yard is 30 hours old.
    const [save] = await sql<{ basesaveid: number }>(
      `INSERT INTO bym.save (userid, saveuserid, createtime, name, credits, attacks, takeover_date, created_at, lastupdate_at)
       VALUES (?, ?, 0, 'cfiltertest', 0, '[]', now(), ?, ?) RETURNING basesaveid`,
      [SPAMMER, SPAMMER, new Date(NOW.getTime() - 30 * 3_600_000), NOW],
    );
    await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [save!.basesaveid, SPAMMER]);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`INSERT INTO bym.chat_moderator (userid, added_by, created_at) VALUES (?, ?, now()), (?, ?, now())`, [MOD, ADMIN, MOD2, ADMIN]);

    const version = getGameVersion();
    const app = new Koa();
    const router = new Router();
    mountModReportsRoutes(router, {
      em: () => orm.em.fork(),
      signedIn: [fakeSignIn],
      effects,
      removeLine: async (channel, line) => {
        removed.push({ channel, line });
        return 1;
      },
      now: () => NOW,
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
    process.env.ADMIN_USER_IDS = String(ADMIN);
  });

  beforeEach(async () => {
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_line_removal WHERE userid IN (${LIST})`);
    removed.length = 0;
  });

  afterAll(async () => {
    if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdmins;
    server?.close();
    if (!orm) return;
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_line_removal WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close(true);
  });

  test("a filter flag lands with its tags, line id and yard age, and the window shows them", async () => {
    await filterFlag(1, "sali na t.me/abc", ["newLink", "invite"], { shown: "sali na [link removed]" });
    await filterFlag(2, "private server dito", ["watched", "hidden"], { hidden: true, shown: "" });
    const [row] = await sql(`SELECT severity, tags, hidden, line_id, yard_age_h FROM bym.chat_flag WHERE userid = ? ORDER BY id LIMIT 1`, [SPAMMER]);
    expect(row).toEqual({ severity: "filter", tags: "newLink,invite", hidden: false, line_id: "line1", yard_age_h: 30 });

    const list = await call("GET", "/api/v/mod/reports", MOD);
    const listed = list.body.players.find((p: { userid: number }) => p.userid === SPAMMER);
    expect(listed).toMatchObject({ newHours: 30, filterTags: ["newLink", "invite", "watched", "hidden"] });

    const player = (await call("GET", `/api/v/mod/reports/players/${SPAMMER}`, MOD)).body.player;
    expect(player.newHours).toBe(30);
    expect(player.lines.map((l: any) => [l.message, l.filter.tags, l.filter.hidden, l.lineId, l.filter.yardAgeHours])).toEqual([
      ["private server dito", ["watched", "hidden"], true, "line2", 30],
      ["sali na t.me/abc", ["newLink", "invite"], false, "line1", 30],
    ]);
  });

  test("the same line said again is grouped under the newest, with every copy for Remove", async () => {
    for (const i of [1, 2, 3]) await filterFlag(i, "sali na t.me/abc", ["newLink", "invite"]);
    const player = (await call("GET", `/api/v/mod/reports/players/${SPAMMER}`, MOD)).body.player;
    expect(player.lines).toHaveLength(1);
    expect(player.lines[0].ts).toBe(T0 + 3000);
    expect(player.lines[0].copies).toEqual([
      { channel: ROOM, ts: T0 + 2000, lineId: "line2" },
      { channel: ROOM, ts: T0 + 1000, lineId: "line1" },
    ]);
  });

  test("Remove takes the lines out of chat and marks them removed, by whom", async () => {
    await filterFlag(1, "sali na t.me/abc", ["newLink", "invite"]);
    const answer = await call("POST", `/api/v/mod/players/${SPAMMER}/lines/remove`, MOD, { lines: [{ channel: ROOM, ts: T0 + 1000, lineId: "line1" }] });
    expect(answer).toEqual({ status: 200, body: { error: 0, removed: 1 } });
    expect(removed).toEqual([{ channel: ROOM, line: { userId: SPAMMER, ts: T0 + 1000, id: "line1" } }]);
    const player = (await call("GET", `/api/v/mod/reports/players/${SPAMMER}`, MOD)).body.player;
    expect(player.lines[0].removed).toMatchObject({ byName: `cfiltertest_${MOD}` });
    // A second Remove of the same line is harmless.
    expect((await call("POST", `/api/v/mod/players/${SPAMMER}/lines/remove`, MOD, { lines: [{ channel: ROOM, ts: T0 + 1000 }] })).status).toBe(200);
  });

  test("Remove is refused on a moderator, the game team, oneself; alliance rooms and nonsense are refused", async () => {
    const line = { lines: [{ channel: ROOM, ts: T0 }] };
    expect((await call("POST", `/api/v/mod/players/${MOD2}/lines/remove`, MOD, line)).status).toBe(403);
    expect((await call("POST", `/api/v/mod/players/${ADMIN}/lines/remove`, MOD, line)).status).toBe(403);
    expect((await call("POST", `/api/v/mod/players/${MOD}/lines/remove`, MOD, line)).status).toBe(403);
    expect((await call("POST", `/api/v/mod/players/${SPAMMER}/lines/remove`, SPAMMER, line)).status).toBe(403);
    expect((await call("POST", `/api/v/mod/players/${SPAMMER}/lines/remove`, MOD, { lines: [{ channel: "chat:alliance:4", ts: T0 }] })).status).toBe(400);
    expect((await call("POST", `/api/v/mod/players/${SPAMMER}/lines/remove`, MOD, { lines: [] })).status).toBe(400);
    expect(removed).toEqual([]);
  });

  test("the watched words are seeded with the owner's list and can be changed", async () => {
    const words = await readWatchWords(orm.em.fork());
    expect(words.filter((w) => w.kind === "always").map((w) => w.word)).toEqual(
      expect.arrayContaining(["private server", "telegram", "tele", "tg", "t.me"]),
    );
    expect(words.filter((w) => w.kind === "near").map((w) => w.word)).toEqual(expect.arrayContaining(["fb", "facebook"]));
    const added = await addWatchWord(orm.em.fork(), { word: "cfiltertest phrase", kind: "always" }, ADMIN);
    expect(added.outcome).toBe("added");
    expect((await addWatchWord(orm.em.fork(), { word: "cfiltertest phrase", kind: "always" }, ADMIN)).outcome).toBe("already");
    if (added.outcome === "added") expect(await removeWatchWord(orm.em.fork(), added.row.id, ADMIN)).toBe(true);
  });
});
