import type { EntityManager } from "@mikro-orm/postgresql";

import { isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";
import { TEAM_NOTICE, writeTeamMessage } from "./supportMail.js";
import { readPace, type QuestPace } from "../quests/state.js";

/**
 * The owner's moderation tools on the dashboard: chat reports, warnings,
 * chat mutes and bans, each kept in `bym.moderation_action` (the player's
 * moderation log). Migration `20261104_AddModeration.ts`.
 *
 * What the player sees:
 * - A warning: a mail from "The game team" with the owner's words, and a
 *   pop-up the next time the game opens (at once if they are online; their
 *   chat connection nudges the game, `chat/chatModeration.ts`).
 * - A mute: the same mail and pop-up, saying for how long; chat refuses
 *   their lines until then (`chat/chatGameTeam.ts`).
 * - A ban: signed out at once everywhere (`endAllSessions`), chat closed with
 *   the reason, and sign-in refused saying why and until when
 *   (`controllers/auth/login.ts`). A ban for some days lifts itself at the
 *   first sign-in after it ends.
 *
 * Every insert sets each NOT NULL column itself: the live database was not
 * made by migrations for every table, so no column default is relied on.
 * The side effects outside the database (sessions, chat) are passed in as
 * {@link ModerationEffects}, so tests can watch them.
 */

export type ModerationKind = "warn" | "mute" | "unmute" | "ban" | "unban";

export const MODERATION_KINDS: readonly ModerationKind[] = ["warn", "mute", "unmute", "ban", "unban"];

/** The longest reason the owner can type. */
export const MAX_MODERATION_REASON = 300;
/** A timed ban is 1 to this many days. */
export const MAX_BAN_DAYS = 3650;
/** A mute is 1 to this many hours. */
export const MAX_MUTE_HOURS = 24 * 30;

/** The mail subject of a warning, and of a mute. */
export const WARNING_SUBJECT = "A warning from the game team";
export const MUTE_SUBJECT = "Your chat is paused";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface ModerationRequest {
  readonly kind: ModerationKind;
  readonly reason: string;
  /** Ban: days, or null for good. Mute: hours. Otherwise null. */
  readonly length: number | null;
  /** The chat report it was done from, if any. */
  readonly chatReportId: number | null;
  /**
   * A mute that never shortens one already on (a moderator's step): the
   * player stays muted until the later of the two. Read under the row lock,
   * so an admin's longer mute landing at the same moment is kept.
   */
  readonly neverShorten?: boolean;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const wholeIn = (raw: unknown, min: number, max: number): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= min && raw <= max ? raw : null;

/**
 * Reads a warn, mute, unmute, ban or unban request from the dashboard. A
 * reason is required for warn, mute and ban; a ban names `days` (a number,
 * or null for good); a mute names `hours`.
 */
export const parseModeration = (kind: ModerationKind, raw: unknown): Parsed<ModerationRequest> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if ((kind === "warn" || kind === "mute" || kind === "ban") && reason === "") {
    return { ok: false, message: "Write a reason: the player sees it." };
  }
  if (reason.length > MAX_MODERATION_REASON) {
    return { ok: false, message: `Keep the reason to ${MAX_MODERATION_REASON} characters.` };
  }
  const report = body.chatReportId === undefined || body.chatReportId === null ? null : wholeIn(body.chatReportId, 1, Number.MAX_SAFE_INTEGER);
  if (report === null && body.chatReportId !== undefined && body.chatReportId !== null) {
    return { ok: false, message: "That chat report number is not right." };
  }

  let length: number | null = null;
  if (kind === "ban") {
    if (!("days" in body)) return { ok: false, message: "Pick how long the ban lasts." };
    if (body.days !== null) {
      length = wholeIn(body.days, 1, MAX_BAN_DAYS);
      if (length === null) return { ok: false, message: `A ban is 1 to ${MAX_BAN_DAYS} days, or for good.` };
    }
  }
  if (kind === "mute") {
    length = wholeIn(body.hours, 1, MAX_MUTE_HOURS);
    if (length === null) return { ok: false, message: `A mute is 1 to ${MAX_MUTE_HOURS} hours.` };
  }
  return { ok: true, value: { kind, reason, length, chatReportId: report } };
};

/** "3 days", "1 hour": the length in the player's mail. */
export const lengthWords = (n: number, unit: "day" | "hour"): string => `${n} ${unit}${n === 1 ? "" : "s"}`;

/** What a sign-in is told about a ban. `until` null is for good. */
export const banText = (until: Date | null, reason: string | null): string => {
  const when = until
    ? `until ${until.toISOString().slice(0, 16).replace("T", " ")} UTC`
    : "for good";
  return `Your account is banned ${when}.${reason ? ` Reason: ${reason}` : ""}`;
};

/** The effects outside the database: ending sessions and telling the chat server. */
export interface ModerationEffects {
  /** Signs the account out everywhere (`services/auth/sessions.ts` `endAllSessions`). */
  endSessions(user: { email: string; userid: number }): Promise<void>;
  /** Closes the player's chat connection, telling them why. */
  kickFromChat(userid: number, until: number | null, text: string, reason: string): Promise<void>;
  /** Sets the player's mute on their open chat connection (0 lifts it). */
  muteInChat(userid: number, until: number): Promise<void>;
  /** Tells the player's game there is a warning or mute to show. */
  nudge(userid: number): Promise<void>;
}

export type ModerationOutcome =
  | { outcome: "done"; until: Date | null; /** The step's row in the moderation log. */ actionId: number }
  | { outcome: "noPlayer" | "gameTeam" | "notBanned" | "notMuted" };

interface TargetRow {
  userid: number;
  email: string;
  username: string;
  banned: boolean;
  ban_until: Date | string | null;
  mute_until: Date | string | null;
}

const asDate = (value: Date | string | null | undefined): Date | null => (value ? new Date(value) : null);

/**
 * Does one moderation step to `userid` by `adminId`, records it in the log,
 * and then applies its effects. Game team accounts (`ADMIN_USER_IDS`) cannot
 * be warned, muted or banned.
 */
export const moderate = async (
  em: EntityManager,
  userid: number,
  request: ModerationRequest,
  adminId: number,
  effects: ModerationEffects,
  now: Date = new Date(),
): Promise<ModerationOutcome> => {
  if (isAdminUser(userid) && request.kind !== "unban" && request.kind !== "unmute") return { outcome: "gameTeam" };

  const done = await em.transactional(async (tx): Promise<ModerationOutcome & { target?: TargetRow }> => {
    const [target] = await tx.execute<TargetRow[]>(
      `SELECT userid, email, username, banned, ban_until, mute_until FROM bym."user" WHERE userid = ? FOR UPDATE`,
      [userid],
    );
    if (!target) return { outcome: "noPlayer" };

    let until: Date | null = null;
    switch (request.kind) {
      case "ban":
        until = request.length === null ? null : new Date(now.getTime() + request.length * DAY_MS);
        await tx.execute(`UPDATE bym."user" SET banned = true, ban_until = ?, ban_reason = ? WHERE userid = ?`, [
          until,
          request.reason,
          userid,
        ]);
        break;
      case "unban":
        if (!target.banned) return { outcome: "notBanned" };
        await tx.execute(`UPDATE bym."user" SET banned = false, ban_until = NULL, ban_reason = NULL WHERE userid = ?`, [
          userid,
        ]);
        break;
      case "mute":
        until = new Date(now.getTime() + (request.length ?? 1) * HOUR_MS);
        if (request.neverShorten) {
          const current = asDate(target.mute_until);
          if (current && current > until) until = current;
        }
        await tx.execute(`UPDATE bym."user" SET mute_until = ? WHERE userid = ?`, [until, userid]);
        break;
      case "unmute": {
        const muted = asDate(target.mute_until);
        if (!muted || muted <= now) return { outcome: "notMuted" };
        await tx.execute(`UPDATE bym."user" SET mute_until = NULL WHERE userid = ?`, [userid]);
        break;
      }
      case "warn":
        break;
    }

    const [logged] = await tx.execute<{ id: string | number }[]>(
      `INSERT INTO bym.moderation_action (userid, admin_id, action, reason, until, chat_report_id, seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?) RETURNING id`,
      [userid, adminId, request.kind, request.reason, until, request.chatReportId, now],
    );

    if (request.kind === "warn" || request.kind === "mute") {
      await writeTeamMessage(tx, {
        userid,
        threadid: null,
        subject: request.kind === "warn" ? WARNING_SUBJECT : MUTE_SUBJECT,
        text:
          request.kind === "warn"
            ? request.reason
            : `You can't use chat for ${lengthWords(request.length ?? 1, "hour")}. ${request.reason}`,
        type: TEAM_NOTICE,
        now: Math.floor(now.getTime() / 1000),
      });
    }
    return { outcome: "done", until, actionId: Number(logged!.id), target };
  });

  if (done.outcome !== "done" || !done.target) return { outcome: done.outcome } as ModerationOutcome;
  const target = done.target;
  const until = done.until;
  const actionId = done.actionId;

  logger.info(`Dashboard: ${request.kind} user ${userid} by ${adminId}`);
  switch (request.kind) {
    case "ban":
      await effects.endSessions({ email: target.email, userid });
      await effects.kickFromChat(userid, until?.getTime() ?? null, banText(until, request.reason), request.reason);
      break;
    case "mute":
      await effects.muteInChat(userid, until!.getTime());
      await effects.nudge(userid);
      break;
    case "unmute":
      await effects.muteInChat(userid, 0);
      break;
    case "warn":
      await effects.nudge(userid);
      break;
    case "unban":
      break;
  }
  return { outcome: "done", until, actionId };
};

/** One step in a player's moderation log, as the dashboard shows it. */
export interface ModerationEntry {
  id: number;
  action: ModerationKind;
  reason: string;
  until: string | null;
  by: number;
  byName: string | null;
  chatReportId: number | null;
  /** When the player closed the pop-up (warnings and mutes). */
  seenAt: string | null;
  at: string;
}

/** A player as the dashboard's moderation view shows them. */
export interface PlayerModeration {
  userid: number;
  username: string;
  lastSeenAt: string | null;
  /** The Style the player's game last sent (`modern`/`classic`), null before beta 6 or on other clients. */
  look: string | null;
  banned: boolean;
  /** Null with `banned`: for good. */
  banUntil: string | null;
  banReason: string | null;
  /** Only while the mute lasts. */
  muteUntil: string | null;
  /** One of `ADMIN_USER_IDS`: cannot be warned, muted or banned. */
  gameTeam: boolean;
  /** How many chat reports name them. */
  reportsAgainst: number;
  /** Their weekly quests' pace (owner, 9 Nov): Fighting and Resources multipliers; null before they had one. */
  questPace: QuestPace | null;
  log: ModerationEntry[];
}

const iso = (value: Date | string | null | undefined): string | null => asDate(value)?.toISOString() ?? null;

interface LogRow {
  id: string | number;
  action: ModerationKind;
  reason: string;
  until: Date | string | null;
  admin_id: number;
  admin_name: string | null;
  chat_report_id: string | number | null;
  seen_at: Date | string | null;
  created_at: Date | string;
}

const LOG_LIMIT = 100;

/** The player's state and log, newest first; null when there is no such player. */
export const playerModeration = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
): Promise<PlayerModeration | null> => {
  const [player] = await em.execute<
    (TargetRow & {
      last_seen_at: Date | string | null;
      look_style: string | null;
      ban_reason: string | null;
      reports: string | number;
      quest_pace: unknown;
    })[]
  >(
    `SELECT u.userid, u.email, u.username, u.banned, u.ban_until, u.ban_reason, u.mute_until, u.last_seen_at, u.look_style,
            (SELECT count(*) FROM bym.chat_report r WHERE r.reported_id = u.userid) AS reports,
            (SELECT s.dailyquests->'pace' FROM bym.save s WHERE s.basesaveid = u.save_basesaveid) AS quest_pace
       FROM bym."user" u WHERE u.userid = ?`,
    [userid],
  );
  if (!player) return null;
  const rows = await em.execute<LogRow[]>(
    `SELECT m.id, m.action, m.reason, m.until, m.admin_id, a.username AS admin_name, m.chat_report_id, m.seen_at, m.created_at
       FROM bym.moderation_action m LEFT JOIN bym."user" a ON a.userid = m.admin_id
      WHERE m.userid = ? ORDER BY m.created_at DESC, m.id DESC LIMIT ${LOG_LIMIT}`,
    [userid],
  );
  const muteUntil = asDate(player.mute_until);
  return {
    userid: Number(player.userid),
    username: player.username,
    lastSeenAt: iso(player.last_seen_at),
    look: player.look_style ?? null,
    banned: Boolean(player.banned),
    banUntil: player.banned ? iso(player.ban_until) : null,
    banReason: player.banned ? player.ban_reason : null,
    muteUntil: muteUntil && muteUntil > now ? muteUntil.toISOString() : null,
    gameTeam: isAdminUser(Number(player.userid)),
    reportsAgainst: Number(player.reports),
    questPace: player.quest_pace !== null && typeof player.quest_pace === "object" ? readPace(player.quest_pace) : null,
    log: rows.map((row) => ({
      id: Number(row.id),
      action: row.action,
      reason: row.reason,
      until: iso(row.until),
      by: Number(row.admin_id),
      byName: row.admin_name,
      chatReportId: row.chat_report_id === null ? null : Number(row.chat_report_id),
      seenAt: iso(row.seen_at),
      at: iso(row.created_at)!,
    })),
  };
};

/** One chat report, as the dashboard lists them. */
export interface ChatReportView {
  id: number;
  reporter: { userid: number; username: string | null };
  reported: { userid: number; username: string | null; banned: boolean; muted: boolean };
  channel: string;
  message: string;
  /** When the line was said (ms). */
  messageTs: number;
  /** The words are the chat server's own copy of the line. */
  verified: boolean;
  /** How many reports name the reported player in all. */
  reportsAgainst: number;
  /** The steps taken from this report (`warn`, `ban`...), oldest first. */
  actions: ModerationKind[];
  at: string;
}

interface ReportRow {
  id: string | number;
  reporter_id: number;
  reporter_name: string | null;
  reported_id: number;
  reported_name: string | null;
  reported_banned: boolean | null;
  reported_mute_until: Date | string | null;
  channel: string;
  message: string;
  message_ts: string | number;
  verified: boolean;
  reports_against: string | number;
  actions: string | null;
  created_at: Date | string;
}

export const CHAT_REPORT_PAGE = 30;

/** Chat reports, newest first, a page at a time (`before`: the last id of the page before). */
export const listChatReports = async (
  em: EntityManager,
  options: { before?: number; limit?: number } = {},
  now: Date = new Date(),
): Promise<{ reports: ChatReportView[]; nextBefore: number | null }> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? CHAT_REPORT_PAGE));
  const before = options.before !== undefined && options.before > 0 ? options.before : null;
  const rows = await em.execute<ReportRow[]>(
    `SELECT r.id, r.reporter_id, rp.username AS reporter_name, r.reported_id, rd.username AS reported_name,
            rd.banned AS reported_banned, rd.mute_until AS reported_mute_until,
            r.channel, r.message, r.message_ts, r.verified, r.created_at,
            (SELECT count(*) FROM bym.chat_report x WHERE x.reported_id = r.reported_id) AS reports_against,
            (SELECT string_agg(m.action, ',' ORDER BY m.created_at) FROM bym.moderation_action m
              WHERE m.chat_report_id = r.id) AS actions
       FROM bym.chat_report r
       LEFT JOIN bym."user" rp ON rp.userid = r.reporter_id
       LEFT JOIN bym."user" rd ON rd.userid = r.reported_id
      WHERE (?::bigint IS NULL OR r.id < ?::bigint)
      ORDER BY r.id DESC
      LIMIT ${limit + 1}`,
    [before, before],
  );
  const page = rows.slice(0, limit);
  return {
    reports: page.map((row) => {
      const muted = asDate(row.reported_mute_until);
      return {
        id: Number(row.id),
        reporter: { userid: Number(row.reporter_id), username: row.reporter_name },
        reported: {
          userid: Number(row.reported_id),
          username: row.reported_name,
          banned: Boolean(row.reported_banned),
          muted: muted !== null && muted > now,
        },
        channel: row.channel,
        message: row.message,
        messageTs: Number(row.message_ts),
        verified: Boolean(row.verified),
        reportsAgainst: Number(row.reports_against),
        actions: (row.actions ? row.actions.split(",") : []) as ModerationKind[],
        at: iso(row.created_at)!,
      };
    }),
    nextBefore: rows.length > limit ? Number(page[page.length - 1]!.id) : null,
  };
};

/** A warning or mute the player has not closed yet, as their game shows it. */
export interface ModerationNotice {
  id: number;
  kind: "warn" | "mute";
  text: string;
  /** A mute's end. */
  until: string | null;
  at: string;
}

/**
 * The oldest warning or still-running mute the player has not closed, or
 * null. A failed read (a database without the table, say) is null too: the
 * pop-up is extra.
 */
export const pendingNotice = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
): Promise<ModerationNotice | null> => {
  try {
    const [row] = await em.execute<
      { id: string | number; action: "warn" | "mute"; reason: string; until: Date | string | null; created_at: Date | string }[]
    >(
      `SELECT id, action, reason, until, created_at FROM bym.moderation_action
        WHERE userid = ? AND seen_at IS NULL AND (action = 'warn' OR (action = 'mute' AND until > ?))
        ORDER BY created_at, id LIMIT 1`,
      [userid, now],
    );
    if (!row) return null;
    return { id: Number(row.id), kind: row.action, text: row.reason, until: iso(row.until), at: iso(row.created_at)! };
  } catch (err) {
    logger.warn(`Moderation notice read failed for ${userid}: ${err}`);
    return null;
  }
};

/** Marks the player's notice `id` closed; false when it is not theirs or already closed. */
export const markNoticeSeen = async (em: EntityManager, userid: number, id: number, now: Date = new Date()): Promise<boolean> => {
  const rows = await em.execute<{ id: string }[]>(
    `UPDATE bym.moderation_action SET seen_at = ? WHERE id = ? AND userid = ? AND seen_at IS NULL RETURNING id`,
    [now, id, userid],
  );
  return rows.length > 0;
};

/** A ban as sign-in reads it. */
export interface BanState {
  /** Null: for good. */
  until: Date | null;
  reason: string | null;
}

/**
 * The ban on a `banned` account at sign-in, or null when it has run out (and
 * is lifted now). A failed read (a database without the columns) is a ban
 * for good with no reason, as before these tools.
 */
export const banAtSignIn = async (em: EntityManager, userid: number, now: Date = new Date()): Promise<BanState | null> => {
  let row: { ban_until: Date | string | null; ban_reason: string | null } | undefined;
  try {
    [row] = await em.execute<{ ban_until: Date | string | null; ban_reason: string | null }[]>(
      `SELECT ban_until, ban_reason FROM bym."user" WHERE userid = ?`,
      [userid],
    );
  } catch {
    return { until: null, reason: null };
  }
  const until = asDate(row?.ban_until);
  if (until && until <= now) {
    await em.execute(
      `UPDATE bym."user" SET banned = false, ban_until = NULL, ban_reason = NULL WHERE userid = ? AND ban_until <= ?`,
      [userid, now],
    );
    logger.info(`Ban on user ${userid} ran out; lifted at sign-in`);
    return null;
  }
  return { until, reason: row?.ban_reason ?? null };
};
