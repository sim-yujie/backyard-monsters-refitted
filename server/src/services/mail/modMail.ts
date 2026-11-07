import type { EntityManager } from "@mikro-orm/postgresql";

import { isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";

/**
 * Moderator mail (owner, beta 7: "allow moderators to send mail to any player
 * but ensure my admin dashboard can see it to prevent abuse").
 *
 * - A player on the chat moderators list (`bym.chat_moderator`, the
 *   dashboard's "Chat moderators") may find any player by name or account
 *   number to write to (`/player/mail/findplayer`); everyone else writes only
 *   to friends, past contacts and players they found on the map, as before.
 *   The list is read from Postgres on every send and lookup, so a moderator
 *   taken off it loses this at once.
 * - Every mail a moderator sends is copied into `bym.mod_mail_log`
 *   (migration `20261111_AddModMailLog.ts`), which nothing but the owner's
 *   dashboard reads ("Moderator mail") and nothing deletes.
 * - New conversations a moderator starts are capped ({@link MOD_MAIL_LIMITS}),
 *   on top of everyone's mail limit (`SPAM_LIMITS.playerMail`).
 * - The recipient sees the moderator's light blue Mod badge on the mail
 *   (`getmessagetargets`' `mod`), decided from the list as it is now, like
 *   chat's.
 *
 * Blocks still apply to moderators both ways.
 */

/** New conversations a moderator may start: per hour and per day. Replies are not counted here. */
export const MOD_MAIL_LIMITS = { perHour: 20, perDay: 60 } as const;

/** What a moderator is told when they reach a limit. */
export const MOD_MAIL_LIMIT_TEXT = {
  hour: "You have started a lot of conversations. Please wait a while before starting another.",
  day: "You have started a lot of conversations today. Please try again tomorrow.",
} as const;

/** Whether `userid` is on the moderators list now. A game team account never counts. */
export const isMailModerator = async (em: EntityManager, userid: number): Promise<boolean> => {
  if (!Number.isInteger(userid) || userid <= 0 || isAdminUser(userid)) return false;
  const rows = await em.execute<{ userid: number | string }[]>(
    `SELECT userid FROM bym.chat_moderator WHERE userid = ? LIMIT 1`,
    [userid],
  );
  return rows.length > 0;
};

/** Those of `ids` on the moderators list now (game team accounts left out): for the Mod badge. */
export const moderatorsAmong = async (em: EntityManager, ids: readonly number[]): Promise<Set<number>> => {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && !isAdminUser(id)))];
  if (wanted.length === 0) return new Set();
  const rows = await em.execute<{ userid: number | string }[]>(
    `SELECT userid FROM bym.chat_moderator WHERE userid IN (${wanted.map(() => "?").join(", ")})`,
    wanted,
  );
  return new Set(rows.map((row) => Number(row.userid)));
};

/**
 * Why a moderator may not start another conversation now, or null when they
 * may: {@link MOD_MAIL_LIMITS}, counted from the log.
 */
export const modNewThreadRefusal = async (
  em: EntityManager,
  moderatorId: number,
  now: Date = new Date(),
): Promise<string | null> => {
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const [row] = await em.execute<{ hour: number | string; day: number | string }[]>(
    `SELECT count(*) FILTER (WHERE sent_at > ?) AS hour, count(*) AS day
       FROM bym.mod_mail_log
      WHERE moderator_id = ? AND new_thread AND sent_at > ?`,
    [hourAgo, moderatorId, dayAgo],
  );
  if (Number(row?.day ?? 0) >= MOD_MAIL_LIMITS.perDay) return MOD_MAIL_LIMIT_TEXT.day;
  if (Number(row?.hour ?? 0) >= MOD_MAIL_LIMITS.perHour) return MOD_MAIL_LIMIT_TEXT.hour;
  return null;
};

/** One mail a moderator sent, as it is logged. */
export interface ModMailEntry {
  moderatorId: number;
  moderatorName: string;
  recipientId: number;
  recipientName: string;
  threadid: number;
  newThread: boolean;
  messagetype: string;
  /** What the recipient got (after the word filter). */
  subject: string;
  message: string;
  /** What the moderator typed, when the word filter changed it; else null. */
  written: string | null;
}

/**
 * Copies a moderator's mail into the log. A failure is logged loudly but does
 * not undo the send: the message is already saved, and the server log line
 * below keeps who wrote to whom.
 */
export const logModMail = async (em: EntityManager, entry: ModMailEntry, now: Date = new Date()): Promise<void> => {
  logger.info(
    `Mail: moderator ${entry.moderatorId} wrote to ${entry.recipientId} in thread ${entry.threadid} (${entry.messagetype})`,
  );
  try {
    await em.execute(
      `INSERT INTO bym.mod_mail_log
         (sent_at, moderator_id, moderator_name, recipient_id, recipient_name, threadid, new_thread, messagetype, subject, message, written)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        now,
        entry.moderatorId,
        entry.moderatorName,
        entry.recipientId,
        entry.recipientName,
        entry.threadid,
        entry.newThread,
        entry.messagetype,
        entry.subject,
        entry.message,
        entry.written,
      ],
    );
  } catch (err) {
    logger.error(`Mail: could not log moderator ${entry.moderatorId}'s mail to ${entry.recipientId}: ${err}`);
  }
};

/** The longest text the find box takes: a username is at most 12 characters, an account number 9 digits. */
const MAX_PLAYER_TEXT = 40;

/** `2503` or `#2503` as an account number, else null. */
const accountNumber = (text: string): number | null => {
  const match = /^#?(\d{1,9})$/.exec(text);
  return match ? Number(match[1]) : null;
};

/** A player a moderator may write to. */
export interface MailRecipient {
  userid: number;
  username: string;
}

/**
 * The player a moderator typed: a whole name (any case) or an account
 * number. Null for no such player, an empty or too long text, or the
 * moderator themself.
 */
export const findMailRecipient = async (
  em: EntityManager,
  raw: unknown,
  moderatorId: number,
): Promise<MailRecipient | null> => {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "" || text.length > MAX_PLAYER_TEXT) return null;
  const number = accountNumber(text);
  const [row] = await em.execute<{ userid: number | string; username: string }[]>(
    number !== null
      ? `SELECT userid, username FROM bym."user" WHERE userid = ? OR lower(username) = lower(?) ORDER BY (userid = ?) DESC LIMIT 1`
      : `SELECT userid, username FROM bym."user" WHERE lower(username) = lower(?) LIMIT 1`,
    number !== null ? [number, text, number] : [text],
  );
  if (!row) return null;
  const userid = Number(row.userid);
  if (userid === moderatorId) return null;
  return { userid, username: row.username };
};

/* ── The owner's dashboard ─────────────────────────────────────────────── */

/** One logged mail as the dashboard lists it. */
export interface ModMailView {
  id: number;
  sentAt: string;
  moderatorId: number;
  /** The name when it was sent. */
  moderatorName: string;
  recipientId: number;
  recipientName: string;
  threadid: number;
  newThread: boolean;
  messagetype: string;
  subject: string;
  message: string;
  written: string | null;
}

/** What the dashboard asked for: a moderator and/or a recipient (name or account number), and the page. */
export interface ModMailQuery {
  moderator: string | null;
  recipient: string | null;
  /** Rows older than this id (the previous page's `next`). */
  before: number | null;
  limit: number;
}

export const MOD_MAIL_PAGE = 50;
const MOD_MAIL_PAGE_MAX = 200;

const textOf = (value: unknown): string | null => {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text.slice(0, MAX_PLAYER_TEXT);
};

/** Reads the dashboard's query string; anything odd falls back to the first page of everything. */
export const parseModMailQuery = (raw: Record<string, unknown>): ModMailQuery => {
  const before = Number(raw.before);
  const limit = Number(raw.limit);
  return {
    moderator: textOf(raw.moderator),
    recipient: textOf(raw.recipient),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MOD_MAIL_PAGE_MAX) : MOD_MAIL_PAGE,
  };
};

/** A LIKE pattern matching `text` anywhere, its own % and _ taken literally. */
const containing = (text: string): string => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The SQL matching one side (moderator or recipient) to a typed name or account number. */
const sideMatch = (column: "moderator" | "recipient", text: string, params: unknown[]): string => {
  const number = accountNumber(text);
  params.push(containing(text));
  const byName = `lower(l.${column}_name) LIKE ?`;
  if (number === null) return `(${byName})`;
  params.push(number);
  return `(${byName} OR l.${column}_id = ?)`;
};

/** The log, newest first, a page at a time; `next` is the `before` for the page after, or null at the end. */
export const listModMail = async (
  em: EntityManager,
  query: ModMailQuery,
): Promise<{ mails: ModMailView[]; next: number | null }> => {
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.moderator) where.push(sideMatch("moderator", query.moderator, params));
  if (query.recipient) where.push(sideMatch("recipient", query.recipient, params));
  if (query.before !== null) {
    where.push(`l.id < ?`);
    params.push(query.before);
  }
  params.push(query.limit + 1);
  const rows = await em.execute<
    {
      id: number | string;
      sent_at: Date | string;
      moderator_id: number | string;
      moderator_name: string;
      recipient_id: number | string;
      recipient_name: string;
      threadid: number | string;
      new_thread: boolean;
      messagetype: string;
      subject: string;
      message: string;
      written: string | null;
    }[]
  >(
    `SELECT l.* FROM bym.mod_mail_log l
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY l.id DESC
      LIMIT ?`,
    params,
  );
  const page = rows.slice(0, query.limit);
  return {
    mails: page.map((row) => ({
      id: Number(row.id),
      sentAt: new Date(row.sent_at).toISOString(),
      moderatorId: Number(row.moderator_id),
      moderatorName: row.moderator_name,
      recipientId: Number(row.recipient_id),
      recipientName: row.recipient_name,
      threadid: Number(row.threadid),
      newThread: row.new_thread === true,
      messagetype: row.messagetype,
      subject: row.subject,
      message: row.message,
      written: row.written,
    })),
    next: rows.length > query.limit ? Number(page[page.length - 1]!.id) : null,
  };
};
