import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { LockMode } from "@mikro-orm/core";
import { MikroORM } from "@mikro-orm/postgresql";

import ormConfig from "../../mikro-orm.config.js";
import { Save } from "../../database/models/save.model.js";
import type { Context } from "koa";
import { creditsAsDelta } from "../base/creditsDelta.js";
import { purchaseHandler } from "../../controllers/base/save/handlers/purchaseHandler.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import { SUPPORT_SENDER } from "../mail/systemSender.js";
import { getBugReport, listBugReports } from "./bugReportsAdmin.js";
import { giveShiny, listShinyAwards, searchPlayers, type ShinyAwardRequest } from "./shinyAwards.js";
import { mayAnswerTeam } from "../mail/teamThreads.js";
import { replyToReport, TEAM_MESSAGE, TEAM_NOTICE } from "./supportMail.js";

/**
 * The dashboard's support tools against a real Postgres: replies to a bug
 * report in the game's mail, the player's answers, and Shiny awards, above
 * all that an award is neither lost nor doubled when the player's own save
 * or a yard action changes Shiny at the same time.
 *
 * Opt-in, like the other database tests: runs only when DASHBOARD_TEST_DB
 * names a throwaway database with every migration applied (never `bym`).
 * Players are `supporttest_*`, account numbers from 996001; everything is
 * deleted afterwards.
 */

const dbName = process.env.DASHBOARD_TEST_DB;

const PLAYER = 996001;
const OTHER = 996002;
const NO_YARD = 996003;
const OWNER = 996009;
const ALL = [PLAYER, OTHER, NO_YARD, OWNER];
const LIST = ALL.join(",");
const START = 1000;
const NOW = 1_790_000_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let requests = 0;
const request = () => `supporttest-${Date.now()}-${++requests}`;

describe.skipIf(!dbName)("the dashboard's replies and Shiny on a real database", () => {
  let orm: MikroORM;
  const saves = new Map<number, number>();

  const sql = <R = Record<string, any>>(query: string, params: unknown[] = []) => orm.em.fork().execute<R[]>(query, params);
  const credits = async (userid: number) =>
    Number((await sql<{ credits: number }>(`SELECT credits FROM bym.save WHERE basesaveid = ?`, [saves.get(userid)]))[0]!.credits);
  const report = async (userid: number | null, message = "supporttest the map is blank") => {
    const [row] = await sql<{ id: string }>(`INSERT INTO bym.bug_report (userid, message) VALUES (?, ?) RETURNING id`, [userid, message]);
    return Number(row!.id);
  };
  const award = (overrides: Partial<ShinyAwardRequest> = {}): ShinyAwardRequest => ({
    userid: PLAYER,
    amount: 500,
    reason: "Thanks for the report",
    bugReportId: null,
    requestId: request(),
    ...overrides,
  });
  const mailTo = (userid: number) =>
    sql<{ threadid: number; userid: number; messagetype: string; message: string; subject: string; target_unread: number }>(
      `SELECT threadid, userid, messagetype, message, subject, target_unread FROM bym.message WHERE targetid = ? ORDER BY updatetime, created_at`,
      [userid]
    );

  const reset = async () => {
    await sql(`DELETE FROM bym.shiny_award WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.bug_report WHERE userid IN (${LIST}) OR message LIKE 'supporttest%'`);
    await sql(`UPDATE bym.thread SET last_message_id = NULL WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.message WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`DELETE FROM bym.thread WHERE userid IN (${LIST}) OR targetid IN (${LIST})`);
    await sql(`UPDATE bym.save SET credits = ?, unreadmessages = 0 WHERE userid IN (${LIST})`, [START]);
  };

  beforeAll(async () => {
    if (dbName === "bym") throw new Error("DASHBOARD_TEST_DB must be a throwaway database, not bym");
    orm = await MikroORM.init({ ...ormConfig, dbName, debug: false, pool: { min: 0, max: 8 } });
    for (const userid of ALL) {
      const name = `supporttest_${userid}`;
      await sql(
        `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
        [userid, name, `${name}@test.invalid`]
      );
      if (userid === NO_YARD) continue;
      const [existing] = await sql(`SELECT basesaveid FROM bym.save WHERE userid = ? AND type = 'main'`, [userid]);
      const basesaveid =
        existing?.basesaveid ??
        (
          await sql(
            `INSERT INTO bym.save (userid, saveuserid, baseid, type, points, basevalue, createtime, name, credits, attacks,
                                   takeover_date, created_at, lastupdate_at)
             VALUES (?, ?, ?, 'main', '0', '0', 0, 'yard', ?, '[]', now(), now(), now()) RETURNING basesaveid`,
            [userid, userid, `${userid}00`, START]
          )
        )[0]!.basesaveid;
      saves.set(userid, Number(basesaveid));
      await sql(`UPDATE bym."user" SET save_basesaveid = ? WHERE userid = ?`, [basesaveid, userid]);
    }
  });

  beforeEach(reset);

  afterAll(async () => {
    if (!orm) return;
    await reset();
    await sql(`UPDATE bym."user" SET save_basesaveid = NULL WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym.save WHERE userid IN (${LIST})`);
    await sql(`DELETE FROM bym."user" WHERE userid IN (${LIST})`);
    await orm.close();
  });

  describe("replies to a bug report", () => {
    test("the first reply starts a thread from the game team, the next ones join it", async () => {
      const id = await report(PLAYER);
      expect(await replyToReport(orm.em.fork(), id, "Thanks, we are looking at it.", OWNER, NOW)).toBe("sent");
      expect(await replyToReport(orm.em.fork(), id, "Fixed in the next update.", OWNER, NOW + 60)).toBe("sent");

      const mail = await mailTo(PLAYER);
      expect(mail.map(({ userid, messagetype, message, subject }) => ({ userid, messagetype, message, subject }))).toEqual([
        { userid: SUPPORT_SENDER, messagetype: TEAM_MESSAGE, message: "Thanks, we are looking at it.", subject: "About your bug report" },
        { userid: SUPPORT_SENDER, messagetype: TEAM_MESSAGE, message: "Fixed in the next update.", subject: "About your bug report" },
      ]);
      expect(new Set(mail.map((one) => one.threadid)).size).toBe(1);
      expect((await sql(`SELECT unreadmessages FROM bym.save WHERE basesaveid = ?`, [saves.get(PLAYER)]))[0]!.unreadmessages).toBe(2);

      const detail = await getBugReport(orm.em.fork(), id);
      expect(detail!.cannotReply).toBeNull();
      expect(detail!.thread.map(({ from, text }) => ({ from, text }))).toEqual([
        { from: "team", text: "Thanks, we are looking at it." },
        { from: "team", text: "Fixed in the next update." },
      ]);
      // The owner's own account is nowhere in the player's mail.
      expect(mail.some((one) => one.userid === OWNER)).toBe(false);
    });

    test("a report sent signed out cannot be answered in the game", async () => {
      const signedOut = await report(null);
      expect(await replyToReport(orm.em.fork(), signedOut, "Hello", OWNER, NOW)).toBe("signedOut");
      expect((await getBugReport(orm.em.fork(), signedOut))!.cannotReply).toBe("signedOut");
      expect(await mailTo(PLAYER)).toEqual([]);
      expect(await replyToReport(orm.em.fork(), 99_999_999, "Hello", OWNER, NOW)).toBe("notFound");
    });

    test("the player may answer only in their own report's thread; the owner sees the answer once as new", async () => {
      const id = await report(PLAYER);
      await replyToReport(orm.em.fork(), id, "Which screen was it?", OWNER, NOW);
      const { threadid } = (await mailTo(PLAYER))[0]!;

      expect(await mayAnswerTeam(orm.em.fork(), PLAYER, threadid)).toBe(true);
      expect(await mayAnswerTeam(orm.em.fork(), OTHER, threadid)).toBe(false);

      // The player's answer, as sendMessage stores it.
      await sql(
        `INSERT INTO bym.message (id, threadid, updatetime, userid, targetid, messagetype, user_unread, target_unread, message, subject, created_at)
         VALUES (gen_random_uuid()::text, ?, ?, ?, ?, 'message', 0, 1, 'The map room', 'About your bug report', now())`,
        [threadid, NOW + 10, PLAYER, SUPPORT_SENDER]
      );
      const listed = (await listBugReports(orm.em.fork())).reports.find((one) => one.id === id)!;
      expect(listed.unreadReplies).toBe(1);

      const first = await getBugReport(orm.em.fork(), id);
      expect(first!.thread.map(({ from, text, unread }) => ({ from, text, unread }))).toEqual([
        { from: "team", text: "Which screen was it?", unread: false },
        { from: "player", text: "The map room", unread: true },
      ]);
      const again = await getBugReport(orm.em.fork(), id);
      expect(again!.thread[1]!.unread).toBe(false);
      expect(again!.unreadReplies).toBe(0);
    });

    test("a Shiny notice given outside a report cannot be answered", async () => {
      const done = await giveShiny(orm.em.fork(), award(), OWNER, NOW);
      expect(done.outcome).toBe("given");
      const [notice] = await mailTo(PLAYER);
      expect(notice!.messagetype).toBe(TEAM_NOTICE);
      expect(await mayAnswerTeam(orm.em.fork(), PLAYER, notice!.threadid)).toBe(false);
    });
  });

  describe("giving Shiny", () => {
    test("lands on the main yard, is kept in the log and told to the player", async () => {
      const done = await giveShiny(orm.em.fork(), award({ amount: 250, reason: "Lost a fight to a bug" }), OWNER, NOW);
      expect(done).toMatchObject({ outcome: "given", award: { userid: PLAYER, username: `supporttest_${PLAYER}`, amount: 250, by: OWNER } });
      expect(await credits(PLAYER)).toBe(START + 250);

      const [mail] = await mailTo(PLAYER);
      expect(mail).toMatchObject({ userid: SUPPORT_SENDER, subject: "A gift of 250 Shiny", target_unread: 1 });
      expect(mail!.message).toContain("Why: Lost a fight to a bug");

      const log = await listShinyAwards(orm.em.fork());
      expect(log.awards[0]).toMatchObject({ userid: PLAYER, amount: 250, reason: "Lost a fight to a bug", bugReportId: null });
    });

    test("from a report: into the report's thread, shown on the report; another player's report is refused", async () => {
      const id = await report(PLAYER);
      const done = await giveShiny(orm.em.fork(), award({ amount: 300, bugReportId: id }), OWNER, NOW);
      expect(done.outcome).toBe("given");
      const detail = await getBugReport(orm.em.fork(), id);
      expect(detail!.awards.map((one) => one.amount)).toEqual([300]);
      expect(detail!.thread).toHaveLength(1);
      expect((await mailTo(PLAYER))[0]!.messagetype).toBe(TEAM_MESSAGE);

      const refused = await giveShiny(orm.em.fork(), award({ userid: OTHER, bugReportId: id }), OWNER, NOW);
      expect(refused.outcome).toBe("notTheirReport");
      expect(await credits(OTHER)).toBe(START);
    });

    test("no player, or a player with no yard yet: nothing is given or kept", async () => {
      expect((await giveShiny(orm.em.fork(), award({ userid: 996888 }), OWNER, NOW)).outcome).toBe("noPlayer");
      expect((await giveShiny(orm.em.fork(), award({ userid: NO_YARD }), OWNER, NOW)).outcome).toBe("noMainYard");
      expect(await sql(`SELECT 1 FROM bym.shiny_award WHERE userid IN (${LIST})`)).toEqual([]);
    });

    test("one press sent twice, one after the other or both at once, gives once", async () => {
      const once = award();
      expect((await giveShiny(orm.em.fork(), once, OWNER, NOW)).outcome).toBe("given");
      expect((await giveShiny(orm.em.fork(), once, OWNER, NOW)).outcome).toBe("already");

      const twice = award({ amount: 100 });
      const both = await Promise.all([giveShiny(orm.em.fork(), twice, OWNER, NOW), giveShiny(orm.em.fork(), twice, OWNER, NOW)]);
      expect(both.map((one) => one.outcome).sort()).toEqual(["already", "given"]);

      expect(await credits(PLAYER)).toBe(START + 500 + 100);
      expect((await sql(`SELECT count(*)::int AS n FROM bym.shiny_award WHERE userid = ?`, [PLAYER]))[0]!.n).toBe(2);
      expect(await mailTo(PLAYER)).toHaveLength(2);
    });
  });

  describe("an award racing the player's own save and the yard actions", () => {
    test("a purchase in a save read before the award keeps the award (credits written as an addition)", async () => {
      // The save request reads the row when it starts...
      const request = orm.em.fork();
      const save = (await request.findOne(Save, { basesaveid: saves.get(PLAYER)! }))!;
      expect(save.credits).toBe(START);
      // ...the owner gives 500 meanwhile...
      expect((await giveShiny(orm.em.fork(), award(), OWNER, NOW)).outcome).toBe("given");
      // ...then the save spends 100 of the balance it read, and flushes.
      save.credits -= 100;
      creditsAsDelta(save);
      await request.flush();

      expect(await credits(PLAYER)).toBe(START + 500 - 100);
      // The answer to the client carries the balance as it is now.
      expect(save.credits).toBe(START + 500 - 100);
    });

    test("without it, the same save would put back the balance from before the award (the race the fix closes)", async () => {
      const request = orm.em.fork();
      const save = (await request.findOne(Save, { basesaveid: saves.get(PLAYER)! }))!;
      await giveShiny(orm.em.fork(), award(), OWNER, NOW);
      save.credits -= 100;
      await request.flush();
      expect(await credits(PLAYER)).toBe(START - 100);
    });

    test("a save that does not touch Shiny writes no Shiny at all", async () => {
      const request = orm.em.fork();
      const save = (await request.findOne(Save, { basesaveid: saves.get(PLAYER)! }))!;
      await giveShiny(orm.em.fork(), award(), OWNER, NOW);
      creditsAsDelta(save);
      save.name = "yard ";
      await request.flush();
      expect(await credits(PLAYER)).toBe(START + 500);
    });

    test("a normal purchase, with no award, still charges the store price once", async () => {
      const request = orm.em.fork();
      const save = (await request.findOne(Save, { basesaveid: saves.get(PLAYER)! }))!;
      save.storedata = {};
      // The game's own save, as baseSave runs it: the purchase, then the change as an addition.
      const ctx = { authUser: { shiny_locked: false, save } } as unknown as Context;
      purchaseHandler(ctx, ["PRO1", 1], save);
      creditsAsDelta(save);
      await request.flush();

      const price = storeItems.PRO1!.c[0]!;
      expect(price).toBeGreaterThan(0);
      expect(await credits(PLAYER)).toBe(START - price);
      expect(save.credits).toBe(START - price);
      // A second save with nothing bought changes nothing more.
      creditsAsDelta(save);
      await request.flush();
      expect(await credits(PLAYER)).toBe(START - price);
    });

    test("a yard action holding the row lock: the award waits for it, and both land", async () => {
      let locked!: () => void;
      const lockTaken = new Promise<void>((resolve) => (locked = resolve));
      const yardAction = orm.em.fork().transactional(async (tx) => {
        const row = (await tx.findOne(Save, { basesaveid: saves.get(PLAYER)! }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }))!;
        locked();
        await sleep(200);
        row.credits -= 50;
        await tx.flush();
      });
      await lockTaken;
      const given = giveShiny(orm.em.fork(), award(), OWNER, NOW);
      await Promise.all([yardAction, given]);
      expect(await credits(PLAYER)).toBe(START - 50 + 500);
    });

    test("many awards at once all land", async () => {
      const results = await Promise.all([1, 2, 3, 4, 5].map((n) => giveShiny(orm.em.fork(), award({ amount: n * 10 }), OWNER, NOW)));
      expect(results.every((one) => one.outcome === "given")).toBe(true);
      expect(await credits(PLAYER)).toBe(START + 150);
    });
  });

  describe("player search", () => {
    // Account numbers from 996011; the names are the owner's real case (26 Oct): "Smash_N_Dash" not found.
    const SMASH = 996011;
    const LOOKALIKE = 996012;
    const WILDCARD = 996013;
    const RENAMED = 996014;
    const BOT = 996015;
    const SEEDED = 996016;
    const CROWD = Array.from({ length: 11 }, (_, n) => 996020 + n);
    const NAMES = new Map<number, string>([
      [SMASH, "Smash_N_Dash"],
      [LOOKALIKE, "SmashNDash"],
      [WILDCARD, "SmashXNXDash"],
      [RENAMED, "supporttest_renamed"],
      [BOT, "supporttest_smash_bot"],
      [SEEDED, "supporttest_smash_seed"],
      // Names that sort before "smash_n_dash" and hold it: they must not push the exact name out.
      ...CROWD.map((userid, n): [number, string] => [userid, `a_smash_n_dash_${n}`]),
    ]);
    const SEARCHED = [...NAMES.keys()].join(",");
    const ids = async (query: string) => (await searchPlayers(orm.em.fork(), query)).map((one) => one.userid);

    beforeAll(async () => {
      for (const [userid, name] of NAMES) {
        await sql(
          `INSERT INTO bym."user" (userid, username, email, password, blocked_users) VALUES (?, ?, ?, 'x', '[]') ON CONFLICT DO NOTHING`,
          [userid, name, `supporttest_${userid}@test.invalid`]
        );
      }
      for (const [userid, state] of [[BOT, "active"], [SEEDED, "seeded"]] as const) {
        await sql(
          `INSERT INTO bym.bot (userid, seed, persona, level, level_since, state) VALUES (?, 1, 'economy', 20, now(), ?) ON CONFLICT DO NOTHING`,
          [userid, state]
        );
      }
      // The renamed player's bug report keeps the name they had when they sent it.
      await sql(`INSERT INTO bym.bug_report (userid, username, message) VALUES (?, 'Old_Smasher', 'supporttest renamed')`, [RENAMED]);
    });

    afterAll(async () => {
      await sql(`DELETE FROM bym.bug_report WHERE userid IN (${SEARCHED})`);
      await sql(`DELETE FROM bym.bot WHERE userid IN (${SEARCHED})`);
      await sql(`DELETE FROM bym."user" WHERE userid IN (${SEARCHED})`);
    });

    test("an exact name comes first, in any case and with spaces around it", async () => {
      for (const query of ["Smash_N_Dash", "smash_n_dash", "SMASH_N_DASH", "  Smash_N_Dash  "]) {
        expect((await ids(query))[0]).toBe(SMASH);
      }
    });

    test("an exact name is never pushed out by ten names that sort before it", async () => {
      const found = await ids("smash_n_dash");
      expect(found).toHaveLength(10);
      expect(found[0]).toBe(SMASH);
    });

    test("an underscore is an underscore, not any letter", async () => {
      expect(await ids("Smash_N_Dash")).not.toContain(WILDCARD);
      expect(await ids("SmashXNXDash")).toEqual([WILDCARD]);
    });

    test("spaces, dashes or no underscores at all still find the name", async () => {
      for (const query of ["Smash N Dash", "smash-n-dash", "Smash.N.Dash"]) {
        expect((await ids(query))[0]).toBe(SMASH);
      }
      // The lookalike's own exact name first, the same name with underscores next.
      expect((await ids("SmashNDash")).slice(0, 2)).toEqual([LOOKALIKE, SMASH]);
    });

    test("a name copied from chat or with an @ in front", async () => {
      for (const query of ["@Smash_N_Dash", "[12] Smash_N_Dash", "“Smash_N_Dash”"]) {
        expect((await ids(query))[0]).toBe(SMASH);
      }
    });

    test("part of a name from the middle", async () => {
      expect(await ids("N_Dash")).toContain(SMASH);
    });

    test("a player who has since changed their name, by the name on an old bug report", async () => {
      const [found] = await searchPlayers(orm.em.fork(), "old_smasher");
      expect(found).toEqual(expect.objectContaining({ userid: RENAMED, username: "supporttest_renamed", formerName: "Old_Smasher" }));
      expect((await searchPlayers(orm.em.fork(), "supporttest_renamed"))[0]!.formerName).toBeNull();
    });

    test("by account number; bots left out, seeded dev players kept", async () => {
      expect((await ids(String(OTHER)))[0]).toBe(OTHER);
      expect(await ids("supporttest_smash_bot")).toEqual([]);
      expect(await ids("supporttest_smash_seed")).toEqual([SEEDED]);
      expect(await searchPlayers(orm.em.fork(), "   ")).toEqual([]);
      expect(await searchPlayers(orm.em.fork(), "%")).toEqual([]);
    });
  });
});
