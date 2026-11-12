import type { EntityManager } from "@mikro-orm/postgresql";

import { isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";
import type { FlagRule, FlagSeverity } from "../chat/chatFlags.js";
import {
  CASE_MUTE_HOURS,
  completeSnapshots,
  getChatCase,
  snapshotFromLog,
  type Snapshot,
  type SnapshotLine,
} from "../admin/chatCases.js";
import { FLAG_LINES_MAX, listChatFlags } from "../admin/chatWatchAdmin.js";
import { MAX_MODERATION_REASON, playerModeration, type ModerationEffects, type ModerationKind } from "../admin/moderation.js";
import {
  actOnInboxPlayer,
  inboxPlayer,
  listClosed,
  listInbox,
  type ClosedDecision,
  type InboxAction,
  type InboxPlayer,
  type InboxSeen,
  type InboxSource,
} from "../admin/moderationInbox.js";
import { isMailModerator } from "../mail/modMail.js";

/**
 * The game's Reports window for moderators (owner, 12 Nov 2026, Review Desk
 * "mod-reports-b"): the dashboard's moderation inbox (`admin/moderationInbox.ts`),
 * in the game, for players on the moderators list (`bym.chat_moderator`).
 *
 * What a moderator may do is narrower than the dashboard:
 * - Close (nothing happens to the player), Warn, or Mute chat for 1 hour,
 *   1 day, 3 days or 7 days ({@link MOD_MUTE_HOURS}). No ban, no other length.
 * - Never on a moderator, a game team account, or themselves: those players
 *   are left out of the lists and every step on them is refused. An admin
 *   decides on them on the dashboard.
 * - Only players with something open, or a decision in the last 30 days: no
 *   searching other players, no attack log, no mail, no Shiny for reporters.
 * - The chat around a word-filter line only while that line is open.
 *
 * Every step is the dashboard's own (`actOnInboxPlayer`), so it lands in the
 * same places: the player's moderation log with the moderator as `admin_id`,
 * the case's `closed_by`, the word-filter lines' `dismissed_by`, the server
 * log. Admins see who did what on the dashboard as for their own steps.
 *
 * Admins may use the window too (they are moderators and more); the same
 * limits hold in it, and the dashboard keeps all their other powers.
 */

/** Mute lengths a moderator may pick, in hours: 1 hour, 1 day, 3 days, 7 days (the dashboard's case lengths). */
export const MOD_MUTE_HOURS: readonly number[] = CASE_MUTE_HOURS;

/** The longest mute a moderator may give: 7 days. */
export const MOD_MAX_MUTE_HOURS = Math.max(...MOD_MUTE_HOURS);

/** Who may open the Reports window: a moderator, an admin, or nobody. */
export type ModRole = "moderator" | "admin";

export const modRoleOf = async (em: EntityManager, userid: number): Promise<ModRole | null> => {
  if (isAdminUser(userid)) return "admin";
  return (await isMailModerator(em, userid)) ? "moderator" : null;
};

/** Why a player is not for the Reports window. */
export type TargetRefusal = "self" | "gameTeam" | "moderator";

/** Why `actor` may not decide on `target` here, or null when they may. */
export const targetRefusal = async (em: EntityManager, actor: number, target: number): Promise<TargetRefusal | null> => {
  if (target === actor) return "self";
  if (isAdminUser(target)) return "gameTeam";
  if (await isMailModerator(em, target)) return "moderator";
  return null;
};

/** One player in the list, as the window shows them. */
export interface ModQueueRow {
  userid: number;
  username: string | null;
  muted: boolean;
  banned: boolean;
  /** Their open chat case, or null. */
  caseId: number | null;
  /** Different chat lines open against them, each counted once. */
  messages: number;
  reportedMessages: number;
  reports: number;
  uniqueReporters: number;
  filterOnlyLines: number;
  slurs: number;
  /** The newest open word-filter line: a step closes up to it. */
  flagsUpTo: number | null;
  oldestAt: string;
  latestAt: string;
  preview: { text: string; source: "report" | "filter" } | null;
}

const queueRow = (row: InboxPlayer): ModQueueRow => ({
  userid: row.userid,
  username: row.username,
  muted: row.muted,
  banned: row.banned,
  caseId: row.caseId,
  messages: row.messages,
  reportedMessages: row.reportedMessages,
  reports: row.reports,
  uniqueReporters: row.uniqueReporters,
  filterOnlyLines: row.filterOnlyLines,
  slurs: row.slurs,
  flagsUpTo: row.flagsUpTo,
  oldestAt: row.oldestAt,
  latestAt: row.latestAt,
  preview: row.preview,
});

/** One decision in the Closed list. */
export interface ModClosedRow {
  userid: number;
  username: string | null;
  closedAt: string;
  closedByName: string | null;
  outcome: "warn" | "mute" | "ban" | "dismiss";
  hours: number | null;
  note: string | null;
  messages: number;
  reports: number;
  filterOnlyLines: number;
  preview: { text: string; source: "report" | "filter" } | null;
}

const closedRow = (row: ClosedDecision): ModClosedRow => ({
  userid: row.userid,
  username: row.username,
  closedAt: row.closedAt,
  closedByName: row.closedByName,
  outcome: row.outcome,
  hours: row.hours,
  note: row.note,
  messages: row.messages,
  reports: row.reports,
  filterOnlyLines: row.filterOnlyLines,
  preview: row.preview,
});

export type ModFilter = InboxSource | "closed";

export interface ModCounts {
  all: number;
  reports: number;
  filter: number;
  closed: number;
}

export interface ModList {
  filter: ModFilter;
  /** The open players (filters All, Reports, Word filter); empty for Closed. */
  players: ModQueueRow[];
  /** The decisions (filter Closed); empty otherwise. */
  closed: ModClosedRow[];
  nextOffset: number | null;
  counts: ModCounts;
}

/** The longest page the window asks for. */
export const MOD_PAGE = 50;

/** The list for one filter, moderators and game team accounts left out. */
export const listModReports = async (
  em: EntityManager,
  options: { filter?: ModFilter; offset?: number } = {},
  now: Date = new Date(),
): Promise<ModList> => {
  const filter = options.filter ?? "all";
  const closedWanted = filter === "closed";
  const open = await listInbox(
    em,
    { source: closedWanted ? "all" : filter, offset: closedWanted ? 0 : options.offset, limit: closedWanted ? 1 : MOD_PAGE, hideStaff: true },
    now,
  );
  const closed = await listClosed(
    em,
    { offset: closedWanted ? options.offset : 0, limit: closedWanted ? MOD_PAGE : 1, hideStaff: true },
    now,
  );
  return {
    filter,
    players: closedWanted ? [] : open.players.map(queueRow),
    closed: closedWanted ? closed.decisions.map(closedRow) : [],
    nextOffset: closedWanted ? closed.nextOffset : open.nextOffset,
    counts: { ...open.counts, closed: closed.count },
  };
};

/** How many players have something open: the number on the Reports button. */
export const countOpenReports = async (em: EntityManager, now: Date = new Date()): Promise<number> =>
  (await listInbox(em, { limit: 1, hideStaff: true }, now)).counts.all;

/** One chat line in the room around a line. */
export interface AroundLine {
  userid: number;
  name: string | null;
  text: string;
  at: number;
  reported?: true;
  flagged?: FlagSeverity;
}

const aroundOf = (snapshot: Snapshot): AroundLine[] =>
  snapshot.lines.map((line: SnapshotLine) => ({
    userid: line.userid,
    name: line.name,
    text: line.text,
    at: line.at,
    ...(line.reported ? { reported: true as const } : {}),
    ...(line.flagged ? { flagged: line.flagged } : {}),
  }));

/** One open line against the player: reported, caught by the word filter, or both (counted once). */
export interface ModLine {
  ts: number;
  channel: string;
  /** The player's own words. */
  message: string;
  report: {
    /** Who reported it, first first. */
    reporters: string[];
    /** The words are the chat server's own copy. */
    verified: boolean;
    /** The room around it when it was reported; empty when no copy was kept. */
    around: AroundLine[];
  } | null;
  filter: {
    /** The word-filter line: "Show the chat around it" asks for this one. */
    id: number;
    severity: FlagSeverity;
    rule: FlagRule;
    words: string[];
    /** What other players saw. */
    shown: string;
  } | null;
}

/** One step in the player's moderation log. */
export interface ModLogEntry {
  action: ModerationKind;
  reason: string;
  until: string | null;
  byName: string | null;
  seenAt: string | null;
  at: string;
}

export interface ModPlayerView {
  userid: number;
  username: string;
  lastSeenAt: string | null;
  muteUntil: string | null;
  banned: boolean;
  /** What is open against them now, or null. */
  open: ModQueueRow | null;
  /** The open lines, newest first. */
  lines: ModLine[];
  log: ModLogEntry[];
  /** Their decisions in the last 30 days, newest first. */
  decisions: ModClosedRow[];
}

/**
 * One player, as the window opens them: their open lines (each with who
 * reported it and the room around it), their moderation log and their
 * decisions of the last 30 days. Null for a player the window does not show:
 * a moderator or game team account, the moderator themselves, or a player
 * with nothing open and no decision in the last 30 days.
 */
export const modPlayer = async (
  em: EntityManager,
  actor: number,
  userid: number,
  now: Date = new Date(),
): Promise<ModPlayerView | null> => {
  if (await targetRefusal(em, actor, userid)) return null;
  const row = await inboxPlayer(em, userid, now);
  const decisions = (await listClosed(em, { userid, limit: 20 }, now)).decisions.map(closedRow);
  if (!row && decisions.length === 0) return null;
  const player = await playerModeration(em, userid, now);
  if (!player) return null;

  const byTs = new Map<number, ModLine>();
  if (row?.caseId) {
    await completeSnapshots(em, [row.caseId], now);
    const chatCase = await getChatCase(em, row.caseId, now);
    const names = new Map((chatCase?.reporters ?? []).map((r) => [r.userid, r.username ?? `#${r.userid}`]));
    for (const message of chatCase?.messages ?? []) {
      byTs.set(message.ts, {
        ts: message.ts,
        channel: message.channel,
        message: message.message,
        report: {
          reporters: message.reporters.map((id) => names.get(id) ?? `#${id}`),
          verified: message.verified,
          around: aroundOf(message.snapshot),
        },
        filter: null,
      });
    }
  }
  if (row?.filterLines) {
    const [flagged] = (await listChatFlags(em, { userid, lines: FLAG_LINES_MAX }, now)).players;
    for (const line of flagged?.lines ?? []) {
      const filter = { id: line.id, severity: line.severity, rule: line.rule, words: line.words, shown: line.shown };
      const same = byTs.get(line.ts);
      if (same) {
        if (!same.filter) {
          same.filter = filter;
          // No server copy of the reported words: the filter's record is one.
          if (same.report && !same.report.verified) same.message = line.message;
        }
        continue;
      }
      byTs.set(line.ts, { ts: line.ts, channel: line.channel, message: line.message, report: null, filter });
    }
  }

  return {
    userid,
    username: player.username,
    lastSeenAt: player.lastSeenAt,
    muteUntil: player.muteUntil,
    banned: player.banned,
    open: row ? queueRow(row) : null,
    lines: [...byTs.values()].sort((a, b) => b.ts - a.ts),
    log: player.log
      .filter((entry) => entry.action !== "unban" && entry.action !== "unmute")
      .map((entry) => ({
        action: entry.action,
        reason: entry.reason,
        until: entry.until,
        byName: entry.byName,
        seenAt: entry.seenAt,
        at: entry.at,
      })),
    decisions,
  };
};

export type AroundOutcome = { outcome: "done"; lines: AroundLine[] } | { outcome: "notOpen" };

/**
 * The chat log around one word-filter line (7 lines before it, 2 after, as a
 * report's copy): only while the line is open, and never a moderator's or a
 * game team account's line, nor the moderator's own. Read from the log on
 * each ask; nothing is kept.
 */
export const modLineAround = async (em: EntityManager, actor: number, flagId: number): Promise<AroundOutcome> => {
  const [flag] = await em.execute<{ userid: number; channel: string; message_ts: string | number }[]>(
    `SELECT userid, channel, message_ts FROM bym.chat_flag WHERE id = ? AND dismissed_at IS NULL`,
    [flagId],
  );
  if (!flag) return { outcome: "notOpen" };
  if (await targetRefusal(em, actor, Number(flag.userid))) return { outcome: "notOpen" };
  const snapshot = await snapshotFromLog(em, flag.channel, Number(flag.userid), Number(flag.message_ts));
  return { outcome: "done", lines: aroundOf(snapshot) };
};

/** A moderator's step: Close (nothing done to the player), Warn, or Mute. */
export type ModAction =
  | { kind: "close"; note: string | null }
  | { kind: "warn"; reason: string }
  | { kind: "mute"; reason: string; hours: number };

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const wholeOrNull = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;

/**
 * Reads `{ action: "close" | "warn" | "mute", reason?, note?, hours?, caseId,
 * reports, flagsUpTo }`. Anything else (a ban, an unmute) is refused. Warn and
 * Mute need the reason the player sees; a mute is one of {@link MOD_MUTE_HOURS}.
 */
export const parseModAction = (raw: unknown): Parsed<{ action: ModAction; seen: InboxSeen }> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const seen: InboxSeen = {
    caseId: wholeOrNull(body.caseId),
    reports: typeof body.reports === "number" && Number.isSafeInteger(body.reports) && body.reports >= 0 ? body.reports : 0,
    flagsUpTo: wholeOrNull(body.flagsUpTo),
  };
  if (body.action === "close") {
    const note = text(body.note);
    if (note.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the note to ${MAX_MODERATION_REASON} characters.` };
    return { ok: true, value: { action: { kind: "close", note: note || null }, seen } };
  }
  if (body.action !== "warn" && body.action !== "mute") return { ok: false, message: "Pick Close, Warn or Mute." };
  const reason = text(body.reason);
  if (!reason) return { ok: false, message: "Write a reason: the player sees it." };
  if (reason.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the reason to ${MAX_MODERATION_REASON} characters.` };
  if (body.action === "warn") return { ok: true, value: { action: { kind: "warn", reason }, seen } };
  const hours = body.hours;
  if (typeof hours !== "number" || !MOD_MUTE_HOURS.includes(hours)) {
    return { ok: false, message: "A mute is 1 hour, 1 day, 3 days or 7 days." };
  }
  return { ok: true, value: { action: { kind: "mute", reason, hours }, seen } };
};

export type ModActionOutcome =
  | { outcome: "done"; closed: { reports: number; filterLines: number; filterOnlyLines: number }; player: ModQueueRow | null }
  | { outcome: TargetRefusal | "changed" | "nothingOpen" | "noPlayer" };

/**
 * A moderator's step on a player: refused on a moderator, a game team account
 * or themselves; else the dashboard's own inbox step, which closes what the
 * moderator was shown.
 */
export const actAsModerator = async (
  em: EntityManager,
  actor: number,
  userid: number,
  action: ModAction,
  seen: InboxSeen,
  effects: ModerationEffects,
  now: Date = new Date(),
): Promise<ModActionOutcome> => {
  const refused = await targetRefusal(em, actor, userid);
  if (refused) {
    logger.warn(`Moderator: ${action.kind} on user ${userid} by ${actor} refused (${refused})`);
    return { outcome: refused };
  }
  const step: InboxAction =
    action.kind === "close"
      ? { kind: "dismiss", note: action.note }
      : action.kind === "warn"
        ? { kind: "warn", reason: action.reason }
        : { kind: "mute", reason: action.reason, hours: Math.min(action.hours, MOD_MAX_MUTE_HOURS) };
  const done = await actOnInboxPlayer(em, userid, step, seen, actor, effects, now);
  if (done.outcome !== "done") {
    return { outcome: done.outcome === "gameTeam" ? "gameTeam" : done.outcome };
  }
  logger.info(
    `Moderator: ${action.kind}${action.kind === "mute" ? ` ${action.hours}h` : ""} user ${userid} by ${actor} in the game's Reports window: ` +
      `${done.closed.reports} reports, ${done.closed.filterLines} filter lines closed`,
  );
  return {
    outcome: "done",
    closed: { reports: done.closed.reports, filterLines: done.closed.filterLines, filterOnlyLines: done.closed.filterOnlyLines },
    player: done.player ? queueRow(done.player) : null,
  };
};
