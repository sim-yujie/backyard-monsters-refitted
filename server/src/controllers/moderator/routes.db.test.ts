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
import { recordChatReport } from "../../services/chat/chatReports.js";
import { mountModReportsRoutes } from "./routes.js";

/**
 * The game's Reports window for moderators over HTTP against a real
 * Postgres: only moderators (and admins) get in; a moderator sees players
 * with something open, never moderators, game team accounts or themselves;
 * the chat around a word-filter line only while it is open; and Close, Warn
 * and Mute up to 7 days, logged under the moderator's account number.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `modreptest_*`, account numbers from 996301. Everything is
 * deleted afterwards. The sign-in is a stand-in: `Authorization: Bearer <userid>`.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const MOD = 996301;
const MOD2 = 996302;
const OFFENDER = 996303;
const SWEARER = 996304;
const REPORTER_A = 996305;
const REPORTER_B = 996306;
const PLAYER = 996307;
const ADMIN = 996309;
const ALL = [MOD, MOD2, OFFENDER, SWEARER, REPORTER_A, REPORTER_B, PLAYER, ADMIN];
const LIST = ALL.join(",");
const ROOM = "chat:test-modreports";
const ALLIANCE_ROOM = "chat:alliance:test-modreports";
const T0 = Date.parse("2026-11-12T09:00:00Z");
const NOW = new Date("2026-11-12T12:00:00Z");

const fakeSignIn = async (ctx: Context, next: Next) => {
  const userid = Number(/^Bearer (\d+)$/.exec(ctx.get("Authorization"))?.[1]);
  if (!userid) ctx.throw(Status.UNAUTHORIZED, "Sign in");
  ctx.authUser = { userid } as Context["authUser"];
  await next();
};

describe.skipIf(!dbName)("the moderators' Reports routes on a real database", () => {
  let orm: MikroORM;
  let server: Server;
  let base = "";
  const calls: string[] = [];
  const effects: ModerationEffects = {
    endSessions: async (user) => void calls.push(`endSessions ${user.userid}`),
    kickFromChat: async (userid) => void calls.push(`kick ${userid}`),
    muteInChat: async (userid, until) => void calls.push(`mute ${userid} ${until}`),
    nudge: async (userid) => void calls.push(`nudge ${userid}`),
  };
  const savedAdmins = process.env.ADMIN_USER_IDS;

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const call = async (method: string, path: string, as: number, body?: unknown) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${as}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as any };
  };

  /** A line in the chat log, said at `T0 + i` seconds. */
  const say = (userid: number, i: number, message: string, room = ROOM) =>
    sql(`INSERT INTO bym.chat_log (userid, channel, message, shown, flagged, created_at) VALUES (?, ?, ?, ?, NULL, ?)`, [
      userid,
      room,
      message,
      message,
      new Date(T0 + i * 1000),
    ]);
  const report = (reporter: number, reported: number, i: number, room = ROOM) =>
    recordChatReport(orm.em.fork(), { reporter, reported, channel: room, message: `rude line ${i}`, ts: T0 + i * 1000 }, []);
  const flag = (userid: number, i: number, room = ROOM) =>
    recordChatFlag(orm.em.fork(), {
      userid,
      channel: room,
      message: `bad word ${i}`,
      shown: "bad ****",
      words: ["word"],
      severity: "swear",
      rule: "word",
      ts: T0 + i * 1000,
    });
  const flagId = async (userid: number) =>
    Number((await sql<{ id: string }>(`SELECT max(id) AS id FROM bym.chat_flag WHERE userid = ?`, [userid]))[0]!.id);
  const listed = async (filter = "all") => {
    const answer = await call("GET", `/api/v/mod/reports?filter=${filter}`, MOD);
    expect(answer.status).toBe(200);
    return answer.body;
  };
  const ours = (rows: { userid: number }[]) => rows.map((r) => r.userid).filter((id) => ALL.includes(id));
  const seenOf = async (userid: number) => {
    const row = (await listed()).players.find((p: { userid: number }) => p.userid === userid);
    return { caseId: row.caseId, reports: row.reports, flagsUpTo: row.flagsUpTo };
  };

  const reset = async () => {
    await sql(`DELETE FROM bym.chat_case_message WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_case WHERE reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_report WHERE reporter_id IN (${LIST}) OR reported_id IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_log WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.moderation_action WHERE userid IN (${LIST})`);
    await sql(`UPDATE bym.thread SET last_message_id = NULL WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.message WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`UPDATE bym."user" SET banned = false, ban_until = NULL, ban_reason = NULL, mute_until = NULL WHERE userid IN (${LIST})`);
    calls.length = 0;
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
    for (const userid of ALL) {
      const name = `modreptest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`],
      );
    }
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`INSERT INTO bym.chat_moderator (userid, added_by, created_at) VALUES (?, ?, now()), (?, ?, now())`, [MOD, ADMIN, MOD2, ADMIN]);

    const version = getGameVersion();
    const app = new Koa();
    const router = new Router();
    mountModReportsRoutes(router, { em: () => orm.em.fork(), signedIn: [fakeSignIn], effects, now: () => NOW });
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
    process.env.ADMIN_USER_IDS = String(ADMIN);
    await reset();
  });

  afterAll(async () => {
    server?.close();
    if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
    else process.env.ADMIN_USER_IDS = savedAdmins;
    if (!orm) return;
    await reset();
    await sql(`DELETE FROM bym.chat_moderator WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  test("a normal player is refused everything but the status, which says no and counts nothing", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    const status = await call("GET", "/api/v/mod/status", PLAYER);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ error: 0, moderator: 0 });

    for (const [method, path, body] of [
      ["GET", "/api/v/mod/reports"],
      ["GET", `/api/v/mod/reports/players/${OFFENDER}`],
      ["GET", "/api/v/mod/reports/lines/1/around"],
      ["POST", `/api/v/mod/reports/players/${OFFENDER}/act`, { action: "close" }],
    ] as const) {
      const answer = await call(method, path, PLAYER, body);
      expect(answer.status).toBe(403);
      expect(answer.body.reason).toBe("notModerator");
    }
    expect(Number((await sql(`SELECT count(*) AS n FROM bym.chat_case WHERE reported_id = ? AND status = 'open'`, [OFFENDER]))[0]!.n)).toBe(1);
  });

  test("a moderator and an admin get the status with the open count", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    for (const who of [MOD, ADMIN]) {
      const status = await call("GET", "/api/v/mod/status", who);
      expect(status.body.moderator).toBe(1);
      expect(status.body.open).toBeGreaterThanOrEqual(1);
    }
  });

  test("the list leaves out moderators, game team accounts and the moderator themselves", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await report(REPORTER_B, OFFENDER, 2, ALLIANCE_ROOM);
    await flag(SWEARER, 3);
    await report(REPORTER_A, MOD, 4);
    await report(REPORTER_A, MOD2, 5);
    await report(REPORTER_A, ADMIN, 6);
    await flag(MOD2, 7);

    const all = await listed();
    expect(ours(all.players).sort()).toEqual([OFFENDER, SWEARER].sort());
    const offender = all.players.find((p: { userid: number }) => p.userid === OFFENDER);
    expect(offender).toMatchObject({ messages: 2, reports: 2, uniqueReporters: 2 });
    expect(offender).not.toHaveProperty("suggest");
    expect(ours((await listed("reports")).players)).toEqual([OFFENDER]);
    expect(ours((await listed("filter")).players)).toEqual([SWEARER]);

    for (const hidden of [MOD, MOD2, ADMIN]) {
      const answer = await call("GET", `/api/v/mod/reports/players/${hidden}`, MOD);
      expect(answer.status).toBe(404);
    }
  });

  test("a player shows their open lines with who reported them and the room around them", async () => {
    await say(PLAYER, 0, "hello all");
    await say(OFFENDER, 1, "rude line 1");
    await say(REPORTER_A, 2, "that was rude");
    await report(REPORTER_A, OFFENDER, 1);
    await report(REPORTER_B, OFFENDER, 1);
    await say(OFFENDER, 3, "bad word 3");
    await flag(OFFENDER, 3);

    const answer = await call("GET", `/api/v/mod/reports/players/${OFFENDER}`, MOD);
    expect(answer.status).toBe(200);
    const player = answer.body.player;
    expect(player.username).toBe(`modreptest_${OFFENDER}`);
    expect(player.open).toMatchObject({ messages: 2, reports: 2 });
    expect(player.lines.map((l: { ts: number }) => l.ts)).toEqual([T0 + 3000, T0 + 1000]);
    const [caught, reported] = player.lines;
    expect(caught.report).toBeNull();
    expect(caught.filter).toMatchObject({ severity: "swear", words: ["word"], shown: "bad ****" });
    expect(reported.report.reporters).toEqual([`modreptest_${REPORTER_A}`, `modreptest_${REPORTER_B}`]);
    expect(reported.report.around.map((l: { text: string }) => l.text)).toEqual(["hello all", "rude line 1", "that was rude", "bad word 3"]);
    expect(reported.report.around[1].reported).toBe(true);
    // Nothing the dashboard keeps for admins only.
    expect(JSON.stringify(player)).not.toContain("@test.invalid");
    expect(player).not.toHaveProperty("questPace");
  });

  test("the chat around a word-filter line only while it is open, and never a moderator's line", async () => {
    await say(PLAYER, 0, "who is online");
    await say(SWEARER, 1, "bad word 1");
    await say(PLAYER, 2, "language!");
    await flag(SWEARER, 1);
    const id = await flagId(SWEARER);

    const open = await call("GET", `/api/v/mod/reports/lines/${id}/around`, MOD);
    expect(open.status).toBe(200);
    expect(open.body.lines.map((l: { text: string }) => l.text)).toEqual(["who is online", "bad word 1", "language!"]);

    await say(MOD2, 5, "bad word 5");
    await flag(MOD2, 5);
    const modLine = await call("GET", `/api/v/mod/reports/lines/${await flagId(MOD2)}/around`, MOD);
    expect(modLine.status).toBe(409);
    expect(modLine.body.reason).toBe("notOpen");

    await sql(`UPDATE bym.chat_flag SET dismissed_at = now(), dismissed_by = ? WHERE id = ?`, [ADMIN, id]);
    const closed = await call("GET", `/api/v/mod/reports/lines/${id}/around`, MOD);
    expect(closed.status).toBe(409);
    expect(closed.body.reason).toBe("notOpen");
    expect(closed.body).not.toHaveProperty("lines");
  });

  test("Mute is 1 hour, 1 day, 3 days or 7 days; a ban and other lengths are refused", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    const seen = await seenOf(OFFENDER);
    for (const body of [
      { action: "ban", reason: "spam", days: 1 },
      { action: "mute", reason: "spam", hours: 720 },
      { action: "mute", reason: "spam", hours: 169 },
      { action: "mute", reason: "spam", hours: 2 },
      { action: "mute", reason: "", hours: 24 },
      { action: "unmute" },
    ]) {
      const answer = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, { ...body, ...seen });
      expect(answer.status).toBe(400);
    }
    const [user] = await sql(`SELECT banned, mute_until FROM bym."user" WHERE userid = ?`, [OFFENDER]);
    expect(user).toMatchObject({ banned: false, mute_until: null });

    const done = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, {
      action: "mute",
      reason: "Insults in chat.",
      hours: 168,
      ...seen,
    });
    expect(done.status).toBe(200);
    expect(done.body.closed.reports).toBe(1);
    const [muted] = await sql<{ mute_until: Date }>(`SELECT mute_until FROM bym."user" WHERE userid = ?`, [OFFENDER]);
    expect(new Date(muted!.mute_until).getTime()).toBe(NOW.getTime() + 168 * 3600_000);
    // Logged like an admin's step, under the moderator.
    const steps = await sql(`SELECT action, admin_id, reason FROM bym.moderation_action WHERE userid = ?`, [OFFENDER]);
    expect(steps).toEqual([{ action: "mute", admin_id: MOD, reason: "Insults in chat." }]);
    const [closedCase] = await sql(`SELECT status, outcome, mute_hours, closed_by FROM bym.chat_case WHERE reported_id = ?`, [OFFENDER]);
    expect(closedCase).toMatchObject({ status: "actioned", outcome: "mute", mute_hours: 168, closed_by: MOD });
    expect(calls).toContain(`nudge ${OFFENDER}`);
  });

  test("never on a moderator, a game team account or themselves", async () => {
    await report(REPORTER_A, MOD, 1);
    await report(REPORTER_A, MOD2, 2);
    await report(REPORTER_A, ADMIN, 3);
    for (const [target, reason] of [
      [MOD, "self"],
      [MOD2, "moderator"],
      [ADMIN, "gameTeam"],
    ] as const) {
      for (const body of [{ action: "close" }, { action: "warn", reason: "x" }, { action: "mute", reason: "x", hours: 1 }]) {
        const answer = await call("POST", `/api/v/mod/reports/players/${target}/act`, MOD, body);
        expect(answer.status).toBe(403);
        expect(answer.body.reason).toBe(reason);
      }
    }
    expect(Number((await sql(`SELECT count(*) AS n FROM bym.chat_case WHERE reported_id IN (${MOD}, ${MOD2}, ${ADMIN}) AND status = 'open'`))[0]!.n)).toBe(3);
    expect(Number((await sql(`SELECT count(*) AS n FROM bym.moderation_action WHERE userid IN (${LIST})`))[0]!.n)).toBe(0);
  });

  test("Close and Warn close what was shown; the decision shows under Closed with who took it", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    await flag(SWEARER, 2);
    const closeSeen = await seenOf(OFFENDER);
    const warnSeen = await seenOf(SWEARER);

    const closed = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, { action: "close", note: "Banter", ...closeSeen });
    expect(closed.status).toBe(200);
    expect(closed.body.player).toBeNull();
    const warned = await call("POST", `/api/v/mod/reports/players/${SWEARER}/act`, MOD, {
      action: "warn",
      reason: "Please keep chat friendly.",
      ...warnSeen,
    });
    expect(warned.status).toBe(200);
    expect(warned.body.closed.filterLines).toBe(1);

    // A second press finds nothing open.
    const again = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, { action: "close", ...closeSeen });
    expect(again.status).toBe(409);
    expect(again.body.reason).toBe("nothingOpen");

    const decisions = (await listed("closed")).closed.filter((d: { userid: number }) => ALL.includes(d.userid));
    expect(decisions.map((d: { userid: number; outcome: string }) => [d.userid, d.outcome]).sort()).toEqual(
      [
        [OFFENDER, "dismiss"],
        [SWEARER, "warn"],
      ].sort(),
    );
    expect(decisions.every((d: { closedByName: string }) => d.closedByName === `modreptest_${MOD}`)).toBe(true);

    // A closed player still opens, with the decision and the warning in their log.
    const swearer = (await call("GET", `/api/v/mod/reports/players/${SWEARER}`, MOD)).body.player;
    expect(swearer.open).toBeNull();
    expect(swearer.lines).toEqual([]);
    expect(swearer.log[0]).toMatchObject({ action: "warn", byName: `modreptest_${MOD}` });
    expect(swearer.decisions[0]).toMatchObject({ outcome: "warn" });
    // A player with nothing open and no decision does not.
    expect((await call("GET", `/api/v/mod/reports/players/${PLAYER}`, MOD)).status).toBe(404);
  });

  test("a moderator's mute never shortens a longer one; Warn and Close leave mutes and bans alone", async () => {
    const thirtyDays = new Date(NOW.getTime() + 30 * 24 * 3600_000);
    const banUntil = new Date(NOW.getTime() + 5 * 24 * 3600_000);
    await sql(`UPDATE bym."user" SET mute_until = ? WHERE userid = ?`, [thirtyDays, OFFENDER]);
    await sql(`UPDATE bym."user" SET mute_until = ?, banned = true, ban_until = ?, ban_reason = 'spam' WHERE userid = ?`, [
      thirtyDays,
      banUntil,
      SWEARER,
    ]);
    await report(REPORTER_A, OFFENDER, 1);
    await flag(SWEARER, 2);
    const state = async (userid: number) =>
      (await sql(`SELECT mute_until, banned, ban_until FROM bym."user" WHERE userid = ?`, [userid]))[0]!;

    for (const hours of [1, 24, 72, 168]) {
      const muted = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, {
        action: "mute",
        reason: "x",
        hours,
        ...(await seenOf(OFFENDER)),
      });
      expect(muted.status).toBe(409);
      expect(muted.body.reason).toBe("longerMute");
    }
    expect(new Date((await state(OFFENDER)).mute_until).getTime()).toBe(thirtyDays.getTime());
    expect(Number((await sql(`SELECT count(*) AS n FROM bym.chat_case WHERE reported_id = ? AND status = 'open'`, [OFFENDER]))[0]!.n)).toBe(1);

    const warned = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, {
      action: "warn",
      reason: "Please keep chat friendly.",
      ...(await seenOf(OFFENDER)),
    });
    expect(warned.status).toBe(200);
    expect(new Date((await state(OFFENDER)).mute_until).getTime()).toBe(thirtyDays.getTime());

    const closed = await call("POST", `/api/v/mod/reports/players/${SWEARER}/act`, MOD, { action: "close", ...(await seenOf(SWEARER)) });
    expect(closed.status).toBe(200);
    const swearer = await state(SWEARER);
    expect(new Date(swearer.mute_until).getTime()).toBe(thirtyDays.getTime());
    expect(swearer.banned).toBe(true);
    expect(new Date(swearer.ban_until).getTime()).toBe(banUntil.getTime());
    expect(calls.some((c) => c.startsWith("mute ") || c.startsWith("kick "))).toBe(false);
  });

  test("a moderator's mute may lengthen a shorter one", async () => {
    await sql(`UPDATE bym."user" SET mute_until = ? WHERE userid = ?`, [new Date(NOW.getTime() + 3600_000), OFFENDER]);
    await report(REPORTER_A, OFFENDER, 1);
    const muted = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, {
      action: "mute",
      reason: "x",
      hours: 24,
      ...(await seenOf(OFFENDER)),
    });
    expect(muted.status).toBe(200);
    const [row] = await sql(`SELECT mute_until FROM bym."user" WHERE userid = ?`, [OFFENDER]);
    expect(new Date(row!.mute_until).getTime()).toBe(NOW.getTime() + 24 * 3600_000);
  });

  test("new reports since the moderator looked are not closed under the old decision", async () => {
    await report(REPORTER_A, OFFENDER, 1);
    const seen = await seenOf(OFFENDER);
    await report(REPORTER_B, OFFENDER, 2);
    const answer = await call("POST", `/api/v/mod/reports/players/${OFFENDER}/act`, MOD, { action: "warn", reason: "x", ...seen });
    expect(answer.status).toBe(409);
    expect(answer.body.reason).toBe("changed");
  });
});
