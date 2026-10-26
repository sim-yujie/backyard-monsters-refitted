import { LockMode, UniqueConstraintViolationException } from "@mikro-orm/core";
import type { EntityManager } from "@mikro-orm/postgresql";

import { Save } from "../../database/models/save.model.js";
import { BaseType } from "../../enums/Base.js";
import { logger } from "../../utils/logger.js";
import { escapeLike } from "../friends/friendRules.js";
import { REPORT_SUBJECT, TEAM_MESSAGE, TEAM_NOTICE, writeTeamMessage } from "./supportMail.js";

/**
 * The owner giving a player Shiny from the dashboard (`docs/design/admin-dashboard-api.md`,
 * "Replies and Shiny"). Every award is kept in `bym.shiny_award` and told to
 * the player in the game's mail, from "The game team".
 *
 * The Shiny lands the way the yard actions credit it (`yardAction.ts`): on the
 * player's main yard row, re-read under its row lock (`SELECT … FOR UPDATE`),
 * so no locked writer can work from a balance read before it. The one save
 * that changes Shiny without that lock, the game's own save, writes its change
 * as an addition (`services/base/creditsDelta.ts`), so it cannot put back a
 * balance from before the award either. `request_id` makes one press of Give
 * give once, however often it is sent.
 */

/** The most one award may give. */
export const MAX_SHINY_AWARD = 10_000;
/** Above this the dashboard asks the owner to confirm first (the page's own check). */
export const CONFIRM_SHINY_ABOVE = 500;
/** The longest reason, which goes into the player's mail. */
export const MAX_AWARD_REASON = 200;

export interface ShinyAwardRequest {
  readonly userid: number;
  readonly amount: number;
  readonly reason: string;
  /** The report it was given from, or null from the Shiny section. */
  readonly bugReportId: number | null;
  /** The dashboard's id for this press of Give. */
  readonly requestId: string;
}

export interface ShinyAwardView {
  readonly id: number;
  readonly userid: number;
  readonly username: string;
  readonly amount: number;
  readonly reason: string;
  readonly bugReportId: number | null;
  /** The owner's account number. */
  readonly by: number | null;
  readonly at: string;
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

const positiveId = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;

/**
 * An award from a request body `{ userid, amount, reason, bugReportId?, requestId }`:
 * a whole amount from 1 to {@link MAX_SHINY_AWARD} (a number, not text), a
 * reason of 1 to {@link MAX_AWARD_REASON} characters, and the press's id.
 */
export const parseShinyAward = (
  body: unknown
): { readonly ok: true; readonly value: ShinyAwardRequest } | { readonly ok: false; readonly message: string } => {
  const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const userid = positiveId(raw.userid);
  if (userid === null) return { ok: false, message: "Pick a player." };
  const { amount } = raw;
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_SHINY_AWARD) {
    return { ok: false, message: `Give a whole number of Shiny from 1 to ${MAX_SHINY_AWARD.toLocaleString("en-US")}.` };
  }
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  if (reason === "") return { ok: false, message: "Say why, in a few words." };
  if (reason.length > MAX_AWARD_REASON) return { ok: false, message: `Keep the reason to ${MAX_AWARD_REASON} characters.` };
  const bugReportId = raw.bugReportId === undefined || raw.bugReportId === null ? null : positiveId(raw.bugReportId);
  if (raw.bugReportId !== undefined && raw.bugReportId !== null && bugReportId === null) {
    return { ok: false, message: "That bug report number is not right." };
  }
  if (typeof raw.requestId !== "string" || !REQUEST_ID.test(raw.requestId)) {
    return { ok: false, message: "Reload the page and try again." };
  }
  return { ok: true, value: { userid, amount, reason, bugReportId, requestId: raw.requestId } };
};

/** The player's mail about an award. */
export const awardMail = (amount: number, reason: string): { subject: string; text: string } => {
  const shiny = `${amount.toLocaleString("en-US")} Shiny`;
  return {
    subject: `A gift of ${shiny}`,
    text: `We have added ${shiny} to your account.\nWhy: ${reason}\nThank you for playing!`,
  };
};

interface AwardRow {
  id: number | string;
  userid: number;
  username: string;
  amount: number;
  reason: string;
  bug_report_id: number | string | null;
  awarded_by: number | null;
  awarded_at: Date | string;
}

const AWARD_COLUMNS = `id, userid, username, amount, reason, bug_report_id, awarded_by, awarded_at`;

const viewOf = (row: AwardRow): ShinyAwardView => ({
  id: Number(row.id),
  userid: Number(row.userid),
  username: row.username,
  amount: Number(row.amount),
  reason: row.reason,
  bugReportId: row.bug_report_id === null ? null : Number(row.bug_report_id),
  by: row.awarded_by === null ? null : Number(row.awarded_by),
  at: new Date(row.awarded_at).toISOString(),
});

/** What {@link giveShiny} did: `given` now, `already` given by an earlier send of the same press. */
export type AwardOutcome =
  | { readonly outcome: "given" | "already"; readonly award: ShinyAwardView }
  | { readonly outcome: "noPlayer" | "noMainYard" | "notTheirReport" };

const byRequest = async (em: EntityManager, requestId: string): Promise<ShinyAwardView | null> => {
  const [row] = await em.execute<AwardRow[]>(`SELECT ${AWARD_COLUMNS} FROM bym.shiny_award WHERE request_id = ?`, [requestId]);
  return row ? viewOf(row) : null;
};

/**
 * Gives `award.amount` Shiny to the player's main yard, keeps the award, and
 * mails the player: into the report's thread when given from a report (which
 * must be the player's own), otherwise as a notice of its own. All of it lands
 * together or not at all.
 */
export const giveShiny = async (
  em: EntityManager,
  award: ShinyAwardRequest,
  by: number,
  now: number
): Promise<AwardOutcome> => {
  const earlier = await byRequest(em, award.requestId);
  if (earlier) return { outcome: "already", award: earlier };

  try {
    const done = await em.transactional(async (tx): Promise<AwardOutcome> => {
      const [player] = await tx.execute<{ username: string; save_basesaveid: number | null }[]>(
        `SELECT username, save_basesaveid FROM bym."user" WHERE userid = ?`,
        [award.userid]
      );
      if (!player) return { outcome: "noPlayer" };

      let reportThread: number | null = null;
      if (award.bugReportId !== null) {
        const [report] = await tx.execute<{ userid: number | null; mail_thread_id: number | null }[]>(
          `SELECT userid, mail_thread_id FROM bym.bug_report WHERE id = ? FOR UPDATE`,
          [award.bugReportId]
        );
        if (!report || report.userid === null || Number(report.userid) !== award.userid) return { outcome: "notTheirReport" };
        reportThread = report.mail_thread_id === null ? null : Number(report.mail_thread_id);
      }

      if (player.save_basesaveid === null) return { outcome: "noMainYard" };
      const save = await tx.findOne(
        Save,
        { basesaveid: Number(player.save_basesaveid) },
        { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
      );
      if (!save || save.type !== BaseType.MAIN || save.userid !== award.userid) return { outcome: "noMainYard" };
      save.credits += award.amount;
      await tx.flush();

      const mail = awardMail(award.amount, award.reason);
      const threadid = await writeTeamMessage(tx, {
        userid: award.userid,
        threadid: reportThread,
        subject: award.bugReportId === null ? mail.subject : REPORT_SUBJECT,
        text: mail.text,
        type: award.bugReportId === null ? TEAM_NOTICE : TEAM_MESSAGE,
        now,
      });
      if (award.bugReportId !== null && threadid !== reportThread) {
        await tx.execute(`UPDATE bym.bug_report SET mail_thread_id = ? WHERE id = ?`, [threadid, award.bugReportId]);
      }

      const [row] = await tx.execute<AwardRow[]>(
        `INSERT INTO bym.shiny_award (request_id, userid, username, amount, reason, bug_report_id, thread_id, awarded_by, awarded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, to_timestamp(?)) RETURNING ${AWARD_COLUMNS}`,
        [award.requestId, award.userid, player.username, award.amount, award.reason, award.bugReportId, threadid, by, now]
      );
      return { outcome: "given", award: viewOf(row!) };
    });
    if (done.outcome === "given") {
      logger.info(`Dashboard: ${award.amount} Shiny given to ${award.userid} by ${by} (award ${done.award.id})`);
    }
    return done;
  } catch (err) {
    // The same press sent twice at once: the other one gave it, and this one rolled back.
    if (err instanceof UniqueConstraintViolationException) {
      const other = await byRequest(em, award.requestId);
      if (other) return { outcome: "already", award: other };
    }
    throw err;
  }
};

/** Awards newest first, a page at a time (at most 100). */
export const listShinyAwards = async (
  em: EntityManager,
  query: { before?: number; limit?: number } = {}
): Promise<{ awards: ShinyAwardView[]; nextBefore: number | null; total: { awards: number; shiny: number } }> => {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50) || 50));
  const before = query.before !== undefined && Number.isSafeInteger(query.before) ? query.before : null;
  const rows = await em.execute<AwardRow[]>(
    `SELECT ${AWARD_COLUMNS} FROM bym.shiny_award ${before === null ? "" : "WHERE id < ?"}
      ORDER BY id DESC LIMIT ${limit + 1}`,
    before === null ? [] : [before]
  );
  const [sum] = await em.execute<{ awards: string | number; shiny: string | number | null }[]>(
    `SELECT count(*) AS awards, sum(amount) AS shiny FROM bym.shiny_award`
  );
  const awards = rows.slice(0, limit).map(viewOf);
  return {
    awards,
    nextBefore: rows.length > limit ? awards[awards.length - 1]!.id : null,
    total: { awards: Number(sum?.awards ?? 0), shiny: Number(sum?.shiny ?? 0) },
  };
};

/** The awards given from one report, oldest first. */
export const awardsForReport = async (em: EntityManager, bugReportId: number): Promise<ShinyAwardView[]> => {
  const rows = await em.execute<AwardRow[]>(
    `SELECT ${AWARD_COLUMNS} FROM bym.shiny_award WHERE bug_report_id = ? ORDER BY id`,
    [bugReportId]
  );
  return rows.map(viewOf);
};

export interface PlayerMatch {
  readonly userid: number;
  readonly username: string;
  /** The name the query matched when it is not the player's name now (from an old bug report or award). */
  readonly formerName: string | null;
  /** A computer-run Map Room 1 neighbour (`bym.bot`), shown so the owner never gives to one by mistake. */
  readonly bot: boolean;
  readonly lastSeenAt: string | null;
}

/** Search results a query gives at most. */
export const PLAYER_SEARCH_LIMIT = 10;

/**
 * The characters players and the owner use between the words of a name: `_`,
 * space, `-` and `.`, and `*`, which Discord shows for a name's underscores
 * when it reads them as italics.
 */
const SEPARATORS = /[\s_.*-]+/g;
const SQL_SEPARATORS = `'[[:space:]_.*-]+'`;

/**
 * The name in a query as the owner may paste it: no spaces around, no `@` or
 * quotes in front, no chat level tag ("[12] Smash_N_Dash") and no Discord
 * escapes ("Smash\_N\_Dash").
 */
export const searchedName = (query: string): string =>
  query
    .replace(/\\/g, "")
    .trim()
    .replace(/^\[\d{1,3}\]\s*/, "")
    .replace(/^[@"'‘“]+|["'’”]+$/g, "")
    .trim()
    .slice(0, 40);

/**
 * Players for the Shiny section's search, at most {@link PLAYER_SEARCH_LIMIT}.
 * Bots are never hidden, only marked and put after the players that match as
 * well (seeded dev players are players). A name matches without
 * case, anywhere in the name, with `_`, spaces, `-` and `.` all the same
 * (or left out), and `%` and `_` meaning only themselves. Also by account
 * number, and by a name the player had before (the name kept on their bug
 * reports and on awards). Best first: the account number, the exact name,
 * the name with other separators, a former name, the name without
 * separators, names that start with it as typed, then without separators,
 * names that hold it as typed, then the rest; shorter first.
 */
export const searchPlayers = async (em: EntityManager, query: string): Promise<PlayerMatch[]> => {
  const text = searchedName(query);
  const exact = text.toLowerCase();
  const spaced = exact.replace(SEPARATORS, "_");
  const joined = exact.replace(SEPARATORS, "");
  if (joined === "") return [];
  const number = /^\d{1,9}$/.test(text) ? Number(text) : -1;
  const spacedName = `regexp_replace(lower(u.username), ${SQL_SEPARATORS}, '_', 'g')`;
  const joinedName = `regexp_replace(lower(u.username), ${SQL_SEPARATORS}, '', 'g')`;
  const rows = await em.execute<
    { userid: number; username: string; former_name: string | null; bot: boolean; last_seen_at: Date | string | null }[]
  >(
    `WITH former AS (
       SELECT DISTINCT ON (userid) userid, name FROM (
         SELECT userid, username AS name FROM bym.bug_report WHERE userid IS NOT NULL AND lower(username) = ?
         UNION ALL
         SELECT userid, username AS name FROM bym.shiny_award WHERE lower(username) = ?
       ) names ORDER BY userid
     )
     SELECT u.userid, u.username, u.last_seen_at,
            CASE WHEN lower(u.username) <> lower(f.name) THEN f.name END AS former_name,
            (b.userid IS NOT NULL AND b.state <> 'seeded') AS bot
       FROM bym."user" u
       LEFT JOIN former f ON f.userid = u.userid
       LEFT JOIN bym.bot b ON b.userid = u.userid
      WHERE (lower(u.username) LIKE ? OR ${joinedName} LIKE ? OR u.userid = ? OR f.userid IS NOT NULL)
      ORDER BY (u.userid = ?) DESC,
               (lower(u.username) = ?) DESC,
               (${spacedName} = ?) DESC,
               (f.userid IS NOT NULL AND lower(u.username) <> lower(f.name)) DESC,
               (${joinedName} = ?) DESC,
               (lower(u.username) LIKE ?) DESC,
               (${joinedName} LIKE ?) DESC,
               (lower(u.username) LIKE ?) DESC,
               (b.userid IS NOT NULL AND b.state <> 'seeded'),
               length(u.username), lower(u.username), u.userid
      LIMIT ${PLAYER_SEARCH_LIMIT}`,
    [
      exact,
      exact,
      `%${escapeLike(exact)}%`,
      `%${escapeLike(joined)}%`,
      number,
      number,
      exact,
      spaced,
      joined,
      `${escapeLike(exact)}%`,
      `${escapeLike(joined)}%`,
      `%${escapeLike(exact)}%`,
    ]
  );
  return rows.map((row) => ({
    userid: Number(row.userid),
    username: row.username,
    formerName: row.former_name ?? null,
    bot: row.bot === true,
    lastSeenAt: row.last_seen_at === null ? null : new Date(row.last_seen_at).toISOString(),
  }));
};
