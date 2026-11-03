import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { recordChatFlag } from "../chat/chatFlags.js";
import { insertChatLogLines } from "../chat/chatLog.js";
import { dismissChatFlags, listChatFlags, readChatLog } from "./chatWatchAdmin.js";

/**
 * The dashboard's automatic chat flags and chat log against a real Postgres:
 * one row per flagged player with the count and newest lines, slurs sorted
 * or filtered first, dismissing leaves newer flags, and the chat log read by
 * player, word, room and time, newest first, a page at a time.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `flagtest_*`, account numbers from 996001; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const SWEARER = 996001;
const BIGOT = 996002;
const QUIET = 996003;
const OWNER = 996009;
const ALL = [SWEARER, BIGOT, QUIET, OWNER];
const LIST = ALL.join(",");
const T0 = Date.parse("2026-11-04T10:00:00Z");
const MIN = 60 * 1000;

describe.skipIf(!dbName)("chat flags and the chat log on a real database", () => {
  let orm: MikroORM;
  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);

  const reset = async () => {
    await sql(`DELETE FROM bym.chat_flag WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.chat_log WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
  };

  const flag = (userid: number, message: string, severity: "slur" | "swear", minutes: number, channel = "chat:mr2-global") =>
    recordChatFlag(orm.em.fork(), {
      userid,
      channel,
      message,
      shown: "****",
      words: [message.split(" ").pop()!],
      severity,
      rule: message.includes("1") ? "disguised" : "word",
      ts: T0 + minutes * MIN,
    });

  const flagged = async (options: Parameters<typeof listChatFlags>[1] = {}) =>
    (await listChatFlags(orm.em.fork(), options)).players.filter((p) => ALL.includes(p.userid));

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 4 } });
  });

  beforeEach(async () => {
    await reset();
    for (const userid of ALL) {
      await sql(`INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]')`, [
        userid,
        `flagtest_${userid}`,
        `flagtest_${userid}@test.invalid`,
      ]);
    }
  });

  afterAll(async () => {
    await reset();
    await orm.close();
  });

  test("one row per player: count, slurs, newest lines first, newest player first", async () => {
    for (let i = 0; i < 5; i++) await flag(SWEARER, `line ${i} fuck`, "swear", 10 + i);
    await flag(BIGOT, "you faggot", "slur", 1);
    await flag(BIGOT, "shit", "swear", 2);

    const players = await flagged();
    expect(players.map((p) => [p.username, p.count, p.slurs])).toEqual([
      [`flagtest_${SWEARER}`, 5, 0],
      [`flagtest_${BIGOT}`, 2, 1],
    ]);
    const swearer = players[0]!;
    expect(swearer.lines.map((l) => l.message)).toEqual(["line 4 fuck", "line 3 fuck", "line 2 fuck"]);
    expect(swearer.lines[0]).toMatchObject({ channel: "chat:mr2-global", shown: "****", words: ["fuck"], severity: "swear" });
    expect(swearer.latestAt).toBe(new Date(T0 + 14 * MIN).toISOString());
    expect(swearer.banned).toBe(false);

    // Slurs first, or slurs only.
    expect((await flagged({ sort: "serious" })).map((p) => p.userid)).toEqual([BIGOT, SWEARER]);
    expect((await flagged({ slursOnly: true })).map((p) => p.userid)).toEqual([BIGOT]);
    // One player.
    expect((await flagged({ userid: BIGOT })).map((p) => p.userid)).toEqual([BIGOT]);
  });

  test("dismissing sets aside what the owner saw and leaves a newer flag", async () => {
    await flag(SWEARER, "fuck", "swear", 1);
    await flag(SWEARER, "shit", "swear", 2);
    const [shown] = await flagged();
    await flag(SWEARER, "bitch", "swear", 3);

    expect(await dismissChatFlags(orm.em.fork(), SWEARER, shown!.lastId, OWNER)).toBe(2);
    const [left] = await flagged();
    expect([left!.count, left!.lines.map((l) => l.message)]).toEqual([1, ["bitch"]]);
    const rows = await sql<{ dismissed_by: number | null }>(
      `SELECT dismissed_by FROM bym.chat_flag WHERE userid = ? ORDER BY id`,
      [SWEARER],
    );
    expect(rows.map((r) => r.dismissed_by)).toEqual([OWNER, OWNER, null]);

    // Nothing more to dismiss up to the same flag.
    expect(await dismissChatFlags(orm.em.fork(), SWEARER, shown!.lastId, OWNER)).toBe(0);
  });

  test("a page of flagged players at a time", async () => {
    await flag(SWEARER, "fuck", "swear", 1);
    await flag(BIGOT, "fuck", "swear", 2);
    await flag(QUIET, "fuck", "swear", 3);
    // A throwaway database holds no other open flags.
    const first = await listChatFlags(orm.em.fork(), { limit: 2 });
    expect([first.players.map((p) => p.userid), first.nextOffset]).toEqual([[QUIET, BIGOT], 2]);
    const second = await listChatFlags(orm.em.fork(), { limit: 2, offset: 2 });
    expect([second.players.map((p) => p.userid), second.nextOffset]).toEqual([[SWEARER], null]);
  });

  test("the chat log by player, word, room and time, newest first and paged", async () => {
    const line = (userid: number, message: string, minutes: number, channel = "chat:mr2-global", flaggedAs: "slur" | "swear" | null = null) => ({
      userid,
      channel,
      message,
      shown: flaggedAs ? "****" : message,
      flagged: flaggedAs,
      at: new Date(T0 + minutes * MIN),
    });
    await insertChatLogLines(orm.em.fork(), [
      line(QUIET, "hello all", 1),
      line(SWEARER, "who wants 100% loot_bonus", 2),
      line(SWEARER, "fuck off", 3, "chat:mr2-global", "swear"),
      line(QUIET, "rude!", 4),
      line(SWEARER, "Hello from PH", 5, "chat:country:PH"),
    ]);
    const read = async (query: Parameters<typeof readChatLog>[1]) =>
      (await readChatLog(orm.em.fork(), query)).lines.map((l) => l.message);

    expect(await read({ userid: SWEARER })).toEqual(["Hello from PH", "fuck off", "who wants 100% loot_bonus"]);
    expect(await read({ player: `FLAGTEST_${SWEARER}` })).toEqual(["Hello from PH", "fuck off", "who wants 100% loot_bonus"]);
    expect(await read({ q: "HELLO", userid: QUIET })).toEqual(["hello all"]);
    // % and _ are plain characters in a search.
    expect(await read({ q: "100%", userid: SWEARER })).toEqual(["who wants 100% loot_bonus"]);
    expect(await read({ q: "t_b", userid: SWEARER })).toEqual(["who wants 100% loot_bonus"]);
    expect(await read({ q: "l_t", userid: SWEARER })).toEqual([]);
    expect(await read({ channel: "chat:country:PH", userid: SWEARER })).toEqual(["Hello from PH"]);
    expect(await read({ flagged: true, userid: SWEARER })).toEqual(["fuck off"]);

    // The room around a flagged line: everyone in that room up to just after it.
    const around = await readChatLog(orm.em.fork(), { channel: "chat:mr2-global", until: T0 + 3 * MIN });
    expect(around.lines.filter((l) => ALL.includes(l.userid)).map((l) => [l.username, l.message])).toEqual([
      [`flagtest_${SWEARER}`, "fuck off"],
      [`flagtest_${SWEARER}`, "who wants 100% loot_bonus"],
      [`flagtest_${QUIET}`, "hello all"],
    ]);

    const page1 = await readChatLog(orm.em.fork(), { userid: SWEARER, limit: 2 });
    expect(page1.lines.map((l) => l.message)).toEqual(["Hello from PH", "fuck off"]);
    expect(page1.lines[1]).toMatchObject({ shown: "****", flagged: "swear" });
    const page2 = await readChatLog(orm.em.fork(), { userid: SWEARER, limit: 2, before: page1.nextBefore! });
    expect([page2.lines.map((l) => l.message), page2.nextBefore]).toEqual([["who wants 100% loot_bonus"], null]);
  });
});
