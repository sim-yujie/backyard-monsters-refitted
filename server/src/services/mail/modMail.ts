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
 *   (migrations `20261111_AddModMailLog.ts`, `20261112_AddModMailReplies.ts`),
 *   which nothing but the owner's dashboard reads ("Moderator mail") and
 *   nothing deletes. So are the player's answers in that thread, and a
 *   player's mail to a moderator: the dashboard shows each conversation whole
 *   ({@link logModConversation}).
 * - New conversations a moderator starts are capped ({@link MOD_MAIL_LIMITS}),
 *   on top of everyone's mail limit (`SPAM_LIMITS.playerMail`).
 * - The recipient sees the moderator's light blue Mod badge on the mail
 *   (`getmessagetargets`' `mod`), decided from the list as it is now, like
 *   chat's.
 *
 * Blocks do not apply to moderators or admins, either way (owner, 8 Nov):
 * a player cannot block a warning, and staff can answer anyone
 * ({@link blocksIgnoringStaff}). A block between two players works as before.
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

/**
 * Of a player's `blocked` list, the ones a block still counts for in mail:
 * everyone but moderators (on the list now) and admins (owner, 8 Nov: "blocks
 * don't apply to moderator or admin"). Blocks of staff stay saved, so a
 * moderator taken off the list is blocked again at once.
 */
export const blocksIgnoringStaff = async (em: EntityManager, blocked: readonly number[]): Promise<number[]> => {
  const ids = blocked.filter((id) => Number.isInteger(id) && !isAdminUser(id));
  if (ids.length === 0) return [];
  const mods = await moderatorsAmong(em, ids);
  return ids.filter((id) => !mods.has(id));
};

/** Whether either side of a mail is a moderator or an admin, so blocks between them do not count. */
export const isMailStaff = async (em: EntityManager, userid: number): Promise<boolean> =>
  isAdminUser(userid) || (await isMailModerator(em, userid));

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
      WHERE moderator_id = ? AND sender = 'moderator' AND new_thread AND sent_at > ?`,
    [hourAgo, moderatorId, dayAgo],
  );
  if (Number(row?.day ?? 0) >= MOD_MAIL_LIMITS.perDay) return MOD_MAIL_LIMIT_TEXT.day;
  if (Number(row?.hour ?? 0) >= MOD_MAIL_LIMITS.perHour) return MOD_MAIL_LIMIT_TEXT.hour;
  return null;
};

/** Who wrote a logged message: the conversation's moderator or its player. */
export type ModMailSender = "moderator" | "player";

/**
 * One message of a moderator's conversation, as it is logged. `moderator*`
 * is always the conversation's moderator and `recipient*` its player,
 * whichever of them wrote it (`sender`).
 */
export interface ModMailEntry {
  moderatorId: number;
  moderatorName: string;
  /** The player in the conversation (who got it, or who wrote it when `sender` is "player"). */
  recipientId: number;
  recipientName: string;
  threadid: number;
  /** This message started the thread. */
  newThread: boolean;
  messagetype: string;
  /** What the other side got (after the word filter). */
  subject: string;
  message: string;
  /** What the writer typed, when the word filter changed it; else null. */
  written: string | null;
  /** Who wrote it; a moderator when left out. */
  sender?: ModMailSender;
}

/**
 * Copies one message of a moderator's conversation into the log. A failure
 * is logged loudly but does not undo the send: the message is already saved,
 * and the server log line below keeps who wrote to whom.
 */
export const logModMail = async (em: EntityManager, entry: ModMailEntry, now: Date = new Date()): Promise<void> => {
  const sender = entry.sender ?? "moderator";
  logger.info(
    sender === "moderator"
      ? `Mail: moderator ${entry.moderatorId} wrote to ${entry.recipientId} in thread ${entry.threadid} (${entry.messagetype})`
      : `Mail: player ${entry.recipientId} wrote to moderator ${entry.moderatorId} in thread ${entry.threadid} (${entry.messagetype})`,
  );
  try {
    await em.execute(
      `INSERT INTO bym.mod_mail_log
         (sent_at, moderator_id, moderator_name, recipient_id, recipient_name, threadid, new_thread, messagetype, subject, message, written, sender)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        sender,
      ],
    );
  } catch (err) {
    logger.error(
      `Mail: could not log thread ${entry.threadid}'s mail between moderator ${entry.moderatorId} and ${entry.recipientId}: ${err}`,
    );
  }
};

/** A message just sent, for {@link logModConversation}. */
export interface SentMail {
  threadid: number;
  newThread: boolean;
  senderId: number;
  senderName: string;
  recipientId: number;
  recipientName: string;
  /** Whether the sender is on the moderators list now (the caller has already asked). */
  senderIsModerator: boolean;
  messagetype: string;
  subject: string;
  message: string;
  written: string | null;
}

/**
 * Logs a message when it belongs to a moderator's conversation, on the right
 * side, so the dashboard shows the conversation whole:
 * - a thread already in the log: every message in it, the moderator being
 *   the one logged first (even if since taken off the list);
 * - else a sender on the moderators list writes as the moderator;
 * - else a recipient on the list: the player's mail to a moderator.
 * Anything else (two players) is not logged. A failure never undoes the send.
 */
export const logModConversation = async (em: EntityManager, mail: SentMail, now: Date = new Date()): Promise<void> => {
  let moderatorId: number | null = null;
  try {
    const [logged] = await em.execute<{ moderator_id: number | string }[]>(
      `SELECT moderator_id FROM bym.mod_mail_log WHERE threadid = ? ORDER BY id LIMIT 1`,
      [mail.threadid],
    );
    if (logged) moderatorId = Number(logged.moderator_id);
    else if (mail.senderIsModerator) moderatorId = mail.senderId;
    else if (await isMailModerator(em, mail.recipientId)) moderatorId = mail.recipientId;
  } catch (err) {
    logger.error(`Mail: could not check thread ${mail.threadid} for moderator mail: ${err}`);
    // Never lose a moderator's own mail over the check.
    if (mail.senderIsModerator) moderatorId = mail.senderId;
  }
  if (moderatorId === null) return;
  const byModerator = moderatorId === mail.senderId;
  await logModMail(
    em,
    {
      moderatorId,
      moderatorName: byModerator ? mail.senderName : mail.recipientName,
      recipientId: byModerator ? mail.recipientId : mail.senderId,
      recipientName: byModerator ? mail.recipientName : mail.senderName,
      threadid: mail.threadid,
      newThread: mail.newThread,
      messagetype: mail.messagetype,
      subject: mail.subject,
      message: mail.message,
      written: mail.written,
      sender: byModerator ? "moderator" : "player",
    },
    now,
  );
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

/** One conversation (a thread with a moderator in it) as the dashboard lists it. */
export interface ModConversationSummary {
  threadid: number;
  /** The moderator and the player, named as in the newest message. */
  moderatorId: number;
  moderatorName: string;
  playerId: number;
  playerName: string;
  /** Messages logged, and how many of them the moderator wrote. */
  messages: number;
  fromModerator: number;
  startedAt: string;
  lastAt: string;
  /** The newest message, for the one-line preview. */
  lastSender: ModMailSender;
  lastSubject: string;
  lastMessage: string;
  lastType: string;
  /** The newest message's log id: what orders the list and pages it. */
  lastId: number;
}

/** One logged message of a conversation, as the dashboard shows it. */
export interface ModConversationMessage {
  id: number;
  sentAt: string;
  sender: ModMailSender;
  senderId: number;
  /** The name when it was sent. */
  senderName: string;
  newThread: boolean;
  messagetype: string;
  subject: string;
  message: string;
  /** What the writer typed, when the word filter changed it. */
  written: string | null;
}

/** One conversation whole, oldest first. */
export interface ModConversation {
  threadid: number;
  moderatorId: number;
  moderatorName: string;
  playerId: number;
  playerName: string;
  messages: ModConversationMessage[];
  /** More messages than one answer carries ({@link MOD_CONVERSATION_MAX}): the newest are left out. */
  cut: boolean;
}

/** What the dashboard asked for: a moderator and/or a player (name or account number), and the page. */
export interface ModMailQuery {
  moderator: string | null;
  /** The player side. */
  recipient: string | null;
  /** Conversations whose newest message is older than this log id (the previous page's `next`). */
  before: number | null;
  limit: number;
}

export const MOD_MAIL_PAGE = 50;
const MOD_MAIL_PAGE_MAX = 200;
/** The most messages one conversation answer carries. */
export const MOD_CONVERSATION_MAX = 1000;

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
    recipient: textOf(raw.recipient ?? raw.player),
    before: Number.isSafeInteger(before) && before > 0 ? before : null,
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MOD_MAIL_PAGE_MAX) : MOD_MAIL_PAGE,
  };
};

/** A LIKE pattern matching `text` anywhere, its own % and _ taken literally. */
const containing = (text: string): string => `%${text.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The SQL matching one side (moderator or player) to a typed name or account number. */
const sideMatch = (column: "moderator" | "recipient", text: string, params: unknown[]): string => {
  const number = accountNumber(text);
  params.push(containing(text));
  const byName = `lower(m.${column}_name) LIKE ?`;
  if (number === null) return `(${byName})`;
  params.push(number);
  return `(${byName} OR m.${column}_id = ?)`;
};

const isoOf = (value: Date | string): string => new Date(value).toISOString();

/**
 * The conversations, the one with the newest message first, a page at a
 * time; `next` is the `before` for the page after, or null at the end. A
 * search keeps a conversation when any of its messages matches (a name as it
 * was then, or the account number).
 */
export const listModConversations = async (
  em: EntityManager,
  query: ModMailQuery,
): Promise<{ conversations: ModConversationSummary[]; next: number | null }> => {
  const matches: string[] = [];
  const params: unknown[] = [];
  if (query.moderator) matches.push(sideMatch("moderator", query.moderator, params));
  if (query.recipient) matches.push(sideMatch("recipient", query.recipient, params));
  const where = matches.length
    ? `WHERE l.threadid IN (SELECT m.threadid FROM bym.mod_mail_log m WHERE ${matches.join(" AND ")})`
    : "";
  if (query.before !== null) params.push(query.before);
  params.push(query.limit + 1);
  const rows = await em.execute<
    {
      threadid: number | string;
      last_id: number | string;
      messages: number | string;
      from_moderator: number | string;
      started_at: Date | string;
      sent_at: Date | string;
      moderator_id: number | string;
      moderator_name: string;
      recipient_id: number | string;
      recipient_name: string;
      sender: string;
      messagetype: string;
      subject: string;
      message: string;
    }[]
  >(
    `WITH c AS (
       SELECT l.threadid, max(l.id) AS last_id, count(*) AS messages,
              count(*) FILTER (WHERE l.sender = 'moderator') AS from_moderator,
              min(l.sent_at) AS started_at
         FROM bym.mod_mail_log l
         ${where}
        GROUP BY l.threadid
        ${query.before !== null ? "HAVING max(l.id) < ?" : ""}
        ORDER BY last_id DESC
        LIMIT ?
     )
     SELECT c.threadid, c.last_id, c.messages, c.from_moderator, c.started_at,
            l.sent_at, l.moderator_id, l.moderator_name, l.recipient_id, l.recipient_name,
            l.sender, l.messagetype, l.subject, l.message
       FROM c JOIN bym.mod_mail_log l ON l.id = c.last_id
      ORDER BY c.last_id DESC`,
    params,
  );
  const page = rows.slice(0, query.limit);
  return {
    conversations: page.map((row) => ({
      threadid: Number(row.threadid),
      moderatorId: Number(row.moderator_id),
      moderatorName: row.moderator_name,
      playerId: Number(row.recipient_id),
      playerName: row.recipient_name,
      messages: Number(row.messages),
      fromModerator: Number(row.from_moderator),
      startedAt: isoOf(row.started_at),
      lastAt: isoOf(row.sent_at),
      lastSender: row.sender === "player" ? "player" : "moderator",
      lastSubject: row.subject,
      lastMessage: row.message,
      lastType: row.messagetype,
      lastId: Number(row.last_id),
    })),
    next: rows.length > query.limit ? Number(page[page.length - 1]!.last_id) : null,
  };
};

/** One conversation whole, oldest first, both sides; null when the log has nothing for that thread. */
export const readModConversation = async (em: EntityManager, threadid: number): Promise<ModConversation | null> => {
  if (!Number.isSafeInteger(threadid) || threadid <= 0) return null;
  const rows = await em.execute<
    {
      id: number | string;
      sent_at: Date | string;
      moderator_id: number | string;
      moderator_name: string;
      recipient_id: number | string;
      recipient_name: string;
      new_thread: boolean;
      messagetype: string;
      subject: string;
      message: string;
      written: string | null;
      sender: string;
    }[]
  >(
    `SELECT id, sent_at, moderator_id, moderator_name, recipient_id, recipient_name,
            new_thread, messagetype, subject, message, written, sender
       FROM bym.mod_mail_log
      WHERE threadid = ?
      ORDER BY id
      LIMIT ?`,
    [threadid, MOD_CONVERSATION_MAX + 1],
  );
  if (rows.length === 0) return null;
  const shown = rows.slice(0, MOD_CONVERSATION_MAX);
  const newest = shown[shown.length - 1]!;
  return {
    threadid,
    moderatorId: Number(newest.moderator_id),
    moderatorName: newest.moderator_name,
    playerId: Number(newest.recipient_id),
    playerName: newest.recipient_name,
    messages: shown.map((row): ModConversationMessage => {
      const byPlayer = row.sender === "player";
      return {
        id: Number(row.id),
        sentAt: isoOf(row.sent_at),
        sender: byPlayer ? "player" : "moderator",
        senderId: Number(byPlayer ? row.recipient_id : row.moderator_id),
        senderName: byPlayer ? row.recipient_name : row.moderator_name,
        newThread: row.new_thread === true,
        messagetype: row.messagetype,
        subject: row.subject,
        message: row.message,
        written: row.written,
      };
    }),
    cut: rows.length > MOD_CONVERSATION_MAX,
  };
};
