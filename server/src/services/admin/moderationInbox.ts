import type { EntityManager } from "@mikro-orm/postgresql";

import { adminUserIds, isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";
import { suggestAction, type CaseSuggestion } from "./chatCases.js";
import { dismissChatFlags, type FlagLine } from "./chatWatchAdmin.js";
import {
  MAX_BAN_DAYS,
  MAX_MODERATION_REASON,
  MAX_MUTE_HOURS,
  moderate,
  type ModerationEffects,
  type ModerationKind,
  type ModerationOutcome,
  type ModerationRequest,
} from "./moderation.js";

/**
 * One moderation inbox (owner, 8 Nov 2026; Codex's dashboard review): every
 * open item against a player, from every source, as one row per player.
 *
 * The sources are a player's open chat case (`chatCases.ts`: the lines other
 * players reported, with each report) and their open word-filter lines
 * (`chatWatchAdmin.ts`). Acting on a player closes all of them together: a
 * warning, a chat pause or a ban closes the open case with that step and
 * sets their word-filter lines aside, and so does a dismissal (with nothing
 * done to the player). This holds wherever the step is taken: the inbox, a
 * chat case, or the player's own panel (`moderatePlayer`).
 *
 * Evidence that came in while the owner was reading is never closed under
 * an older decision: the inbox sends what it showed (the case, how many
 * reports, the newest word-filter line), a case with more reports than that
 * is refused as changed, and word-filter lines newer than the one shown stay
 * open.
 */

export type InboxSource = "all" | "reports" | "filter";

export const INBOX_PAGE = 30;

/** A player with open items, as the inbox lists them. */
export interface InboxPlayer {
  userid: number;
  username: string | null;
  banned: boolean;
  muted: boolean;
  /** One of `ADMIN_USER_IDS`: cannot be warned, paused or banned. */
  gameTeam: boolean;
  /** Their open chat case, or null. */
  caseId: number | null;
  /** Chat lines other players reported, in the open case. */
  reportedMessages: number;
  /** Reports of those lines (one per reporter per line). */
  reports: number;
  /** Different players who reported them. */
  uniqueReporters: number;
  /** Open lines caught by the word filter (some may be reported lines too: see `alsoReported`). */
  filterLines: number;
  /**
   * Of those, lines players reported too: the same chat line, already one of
   * `reportedMessages`. Shown and counted once (owner, 8 Nov 2026).
   */
  alsoReported: number;
  /** Lines only the word filter caught: `filterLines - alsoReported`. */
  filterOnlyLines: number;
  /** Different chat lines open against them, each counted once: `reportedMessages + filterOnlyLines`. */
  messages: number;
  /** Of those, lines with a slur. */
  slurs: number;
  /** The newest open word-filter line: acting closes up to it, never a newer one. */
  flagsUpTo: number | null;
  /** Earlier warnings, chat pauses and bans. */
  previousActions: number;
  /** The latest of those, or null. */
  lastAction: { action: ModerationKind; at: string } | null;
  /** The oldest open item. */
  oldestAt: string;
  /** The newest open item. */
  latestAt: string;
  /** The newest line against them, and where it came from. */
  preview: { text: string; source: "report" | "filter" } | null;
  /** What the page offers first (the chat cases' rule). */
  suggest: CaseSuggestion;
}

export interface InboxList {
  players: InboxPlayer[];
  nextOffset: number | null;
  /**
   * Players with open items. Each player counts once: under `reports` when
   * players reported any of their lines, else under `filter`, so
   * `reports + filter === all` always.
   */
  counts: { all: number; reports: number; filter: number };
}

interface InboxRow {
  userid: number;
  username: string | null;
  banned: boolean | null;
  mute_until: Date | string | null;
  case_id: string | number | null;
  messages: string | number | null;
  reports: string | number | null;
  reporters: string | number | null;
  case_first: Date | string | null;
  case_last: Date | string | null;
  case_preview: string | null;
  lines: string | number | null;
  slurs: string | number | null;
  up_to: string | number | null;
  flag_first: Date | string | null;
  flag_last: Date | string | null;
  flag_preview: string | null;
  also_reported: string | number | null;
  warnings: string | number;
  mutes: string | number;
  bans: string | number;
  last_action: ModerationKind | null;
  last_action_at: Date | string | null;
}

/** Every player with an open case or open word-filter lines, one row each. */
const OPEN_ITEMS = `
  WITH c AS (
    SELECT c.id AS case_id, c.reported_id AS userid, c.first_report_at AS case_first, c.last_report_at AS case_last,
           (SELECT count(*) FROM bym.chat_case_message m WHERE m.case_id = c.id) AS messages,
           (SELECT count(*) FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id
             WHERE m.case_id = c.id) AS reports,
           (SELECT count(DISTINCT r.reporter_id) FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id
             WHERE m.case_id = c.id) AS reporters,
           (SELECT m.message FROM bym.chat_case_message m WHERE m.case_id = c.id ORDER BY m.message_ts DESC, m.id DESC LIMIT 1)
             AS case_preview
      FROM bym.chat_case c WHERE c.status = 'open'
  ), f AS (
    SELECT fl.userid, count(*) AS lines, count(*) FILTER (WHERE fl.severity = 'slur') AS slurs, max(fl.id) AS up_to,
           min(fl.created_at) AS flag_first, max(fl.created_at) AS flag_last,
           (array_agg(fl.message ORDER BY fl.id DESC))[1] AS flag_preview,
           -- The same chat line reported by players too: one item, counted once (owner, 8 Nov 2026).
           count(*) FILTER (WHERE EXISTS (
             SELECT 1 FROM bym.chat_case_message m JOIN bym.chat_case oc ON oc.id = m.case_id AND oc.status = 'open'
              WHERE m.reported_id = fl.userid AND m.message_ts = fl.message_ts)) AS also_reported
      FROM bym.chat_flag fl WHERE fl.dismissed_at IS NULL GROUP BY fl.userid
  ), p AS (
    SELECT coalesce(c.userid, f.userid) AS userid, c.case_id, c.messages, c.reports, c.reporters, c.case_first, c.case_last,
           c.case_preview, f.lines, f.slurs, f.up_to, f.flag_first, f.flag_last, f.flag_preview, f.also_reported
      FROM c FULL OUTER JOIN f ON f.userid = c.userid
  )
  SELECT p.*, u.username, u.banned, u.mute_until,
         (SELECT count(*) FROM bym.moderation_action a WHERE a.userid = p.userid AND a.action = 'warn') AS warnings,
         (SELECT count(*) FROM bym.moderation_action a WHERE a.userid = p.userid AND a.action = 'mute') AS mutes,
         (SELECT count(*) FROM bym.moderation_action a WHERE a.userid = p.userid AND a.action = 'ban') AS bans,
         la.action AS last_action, la.created_at AS last_action_at
    FROM p
    LEFT JOIN bym."user" u ON u.userid = p.userid
    LEFT JOIN LATERAL (
      SELECT a.action, a.created_at FROM bym.moderation_action a
       WHERE a.userid = p.userid AND a.action IN ('warn', 'mute', 'ban')
       ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ) la ON true`;

const iso = (value: Date | string): string => new Date(value).toISOString();
const num = (value: string | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const latest = (...values: (Date | string | null)[]): Date | string =>
  values.filter((v): v is Date | string => v !== null).reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
const earliest = (...values: (Date | string | null)[]): Date | string =>
  values.filter((v): v is Date | string => v !== null).reduce((a, b) => (new Date(a) < new Date(b) ? a : b));

const viewRow = (row: InboxRow, now: Date): InboxPlayer => {
  const userid = Number(row.userid);
  const mute = row.mute_until ? new Date(row.mute_until) : null;
  const caseLast = row.case_last ? new Date(row.case_last) : null;
  const flagLast = row.flag_last ? new Date(row.flag_last) : null;
  const fromReport = caseLast !== null && (flagLast === null || caseLast >= flagLast);
  const warnings = num(row.warnings);
  const mutes = num(row.mutes);
  const bans = num(row.bans);
  const messages = num(row.messages);
  const lines = num(row.lines);
  const alsoReported = Math.min(lines, num(row.also_reported));
  const filterOnly = lines - alsoReported;
  return {
    userid,
    username: row.username,
    banned: Boolean(row.banned),
    muted: mute !== null && mute > now,
    gameTeam: isAdminUser(userid),
    caseId: row.case_id === null ? null : Number(row.case_id),
    reportedMessages: messages,
    reports: num(row.reports),
    uniqueReporters: num(row.reporters),
    filterLines: lines,
    alsoReported,
    filterOnlyLines: filterOnly,
    messages: messages + filterOnly,
    slurs: num(row.slurs),
    flagsUpTo: row.up_to === null ? null : Number(row.up_to),
    previousActions: warnings + mutes + bans,
    lastAction: row.last_action && row.last_action_at ? { action: row.last_action, at: iso(row.last_action_at) } : null,
    oldestAt: iso(earliest(row.case_first, row.flag_first)),
    latestAt: iso(latest(row.case_last, row.flag_last)),
    preview:
      fromReport && row.case_preview !== null
        ? { text: row.case_preview, source: "report" }
        : row.flag_preview !== null
          ? { text: row.flag_preview, source: "filter" }
          : null,
    suggest: suggestAction(messages, { cases: 0, flags: filterOnly, warnings, mutes, bans }),
  };
};

/**
 * Each player is in one list: Player reports when players reported any of
 * their lines (word-filter lines of theirs show there too), Word filter when
 * only the filter caught them. A line both reported and caught is never in
 * the Word filter list, and no player is counted in both.
 */
/**
 * Leaves out moderators and game team accounts when asked (`hideStaff`): the
 * game's Reports window for moderators (`services/moderator/modReports.ts`)
 * never shows them, as only an admin decides on them. Two parameters:
 * {@link staffParams}.
 */
const staffFilter = (alias: string): string =>
  `(NOT ?::boolean OR (${alias}.userid NOT IN (SELECT cm.userid FROM bym.chat_moderator cm) AND NOT (${alias}.userid = ANY(?::int[]))))`;

const staffParams = (hide: boolean | undefined): [boolean, string] => [Boolean(hide), `{${[...adminUserIds()].join(",")}}`];

const SOURCE_WHERE: Record<InboxSource, string> = {
  all: "TRUE",
  reports: "case_id IS NOT NULL",
  filter: "case_id IS NULL AND lines IS NOT NULL",
};

/**
 * The inbox, a page at a time: players with a slur first, then players with
 * earlier warnings, pauses or bans, then the newest. `source` keeps only
 * players with an open case (`reports`) or players only the word filter
 * caught (`filter`).
 */
export const listInbox = async (
  em: EntityManager,
  options: { source?: InboxSource; userid?: number; offset?: number; limit?: number; hideStaff?: boolean } = {},
  now: Date = new Date(),
): Promise<InboxList> => {
  const source = options.source ?? "all";
  const limit = Math.min(100, Math.max(1, options.limit ?? INBOX_PAGE));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await em.execute<InboxRow[]>(
    `SELECT * FROM (${OPEN_ITEMS}) x
      WHERE ${SOURCE_WHERE[source]} AND (?::int IS NULL OR x.userid = ?::int) AND ${staffFilter("x")}
      ORDER BY (coalesce(x.slurs, 0) > 0) DESC, ((x.warnings + x.mutes + x.bans) > 0) DESC,
               greatest(x.case_last, x.flag_last) DESC, x.userid
      LIMIT ${limit + 1} OFFSET ${offset}`,
    [options.userid ?? null, options.userid ?? null, ...staffParams(options.hideStaff)],
  );
  const [counts] = await em.execute<{ all: string | number; reports: string | number; filter: string | number }[]>(
    `SELECT count(*) AS all, count(*) FILTER (WHERE case_id IS NOT NULL) AS reports,
            count(*) FILTER (WHERE case_id IS NULL AND lines IS NOT NULL) AS filter
       FROM (${OPEN_ITEMS}) x WHERE ${staffFilter("x")}`,
    staffParams(options.hideStaff),
  );
  return {
    players: rows.slice(0, limit).map((row) => viewRow(row, now)),
    nextOffset: rows.length > limit ? offset + limit : null,
    counts: { all: num(counts?.all), reports: num(counts?.reports), filter: num(counts?.filter) },
  };
};

/** One player's row, or null when nothing of theirs is open. */
export const inboxPlayer = async (em: EntityManager, userid: number, now: Date = new Date()): Promise<InboxPlayer | null> =>
  (await listInbox(em, { userid, limit: 1 }, now)).players[0] ?? null;

/** What closing a player's items did. */
export interface ClosedItems {
  /** The chat case closed, or null. */
  caseId: number | null;
  /** Reports in that case. */
  reports: number;
  /** Word-filter lines set aside. */
  filterLines: number;
  /** Of those, lines not in the closed case: the rest were reported lines, already counted. */
  filterOnlyLines: number;
}

export interface CloseRequest {
  outcome: "warn" | "mute" | "ban" | "dismiss";
  /** A chat pause's length. */
  hours: number | null;
  /** The reason the player saw, or the owner's note on a dismissal. */
  note: string | null;
  /** The step in the player's moderation log, or null for a dismissal. */
  actionId: number | null;
  /** Close up to this word-filter line; null: every open one. */
  flagsUpTo?: number | null;
}

/**
 * Closes everything open against a player: their open chat case (with the
 * step, or dismissed) and their word-filter lines up to `flagsUpTo`.
 */
export const closeOpenItems = async (
  em: EntityManager,
  userid: number,
  request: CloseRequest,
  adminId: number,
  now: Date = new Date(),
): Promise<ClosedItems> => {
  const [closed] = await em.execute<{ id: string | number }[]>(
    `UPDATE bym.chat_case SET status = ?, outcome = ?, mute_hours = ?, note = ?, closed_by = ?, closed_at = ?,
            moderation_action_id = coalesce(moderation_action_id, ?)
      WHERE reported_id = ? AND status = 'open' RETURNING id`,
    [
      request.outcome === "dismiss" ? "dismissed" : "actioned",
      request.outcome,
      request.outcome === "mute" ? request.hours : null,
      request.note,
      adminId,
      now,
      request.actionId,
      userid,
    ],
  );
  const caseId = closed ? Number(closed.id) : null;
  let reports = 0;
  if (caseId !== null) {
    const [row] = await em.execute<{ n: string | number }[]>(
      `SELECT count(*) AS n FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id WHERE m.case_id = ?`,
      [caseId],
    );
    reports = num(row?.n);
  }
  const upTo = request.flagsUpTo ?? Number.MAX_SAFE_INTEGER;
  const [only] = await em.execute<{ n: string | number }[]>(
    `SELECT count(*) AS n FROM bym.chat_flag f
      WHERE f.userid = ? AND f.dismissed_at IS NULL AND f.id <= ?
        AND NOT EXISTS (SELECT 1 FROM bym.chat_case_message m WHERE m.case_id = ? AND m.message_ts = f.message_ts)`,
    [userid, upTo, caseId ?? 0],
  );
  const filterLines = await dismissChatFlags(em, userid, upTo, adminId, now);
  const filterOnlyLines = Math.min(filterLines, num(only?.n));
  if (caseId !== null || filterLines > 0) {
    logger.info(
      `Dashboard: ${request.outcome} closed user ${userid}'s open items by ${adminId}: case ${caseId ?? "none"}, ${filterLines} filter lines`,
    );
  }
  return { caseId, reports, filterLines, filterOnlyLines };
};

/** The first report in a player's open case, for the moderation log's link. */
const firstOpenReport = async (em: EntityManager, userid: number): Promise<number | null> => {
  const [row] = await em.execute<{ id: string | number | null }[]>(
    `SELECT min(r.id) AS id FROM bym.chat_report r
       JOIN bym.chat_case_message m ON m.id = r.case_message_id
       JOIN bym.chat_case c ON c.id = m.case_id
      WHERE c.reported_id = ? AND c.status = 'open'`,
    [userid],
  );
  return row?.id === null || row?.id === undefined ? null : Number(row.id);
};

/**
 * A moderation step from anywhere on the dashboard (the player panel, the
 * inbox): the moderation tools' own step, then a warning, pause or ban
 * closes everything open against the player. Lifting a pause or a ban
 * closes nothing.
 */
export const moderatePlayer = async (
  em: EntityManager,
  userid: number,
  request: ModerationRequest,
  adminId: number,
  effects: ModerationEffects,
  now: Date = new Date(),
  flagsUpTo: number | null = null,
): Promise<{ done: ModerationOutcome; closed: ClosedItems | null }> => {
  const closes = request.kind === "warn" || request.kind === "mute" || request.kind === "ban";
  const linked = closes && request.chatReportId === null ? { ...request, chatReportId: await firstOpenReport(em, userid) } : request;
  const done = await moderate(em, userid, linked, adminId, effects, now);
  if (done.outcome !== "done" || !closes) return { done, closed: null };
  const closed = await closeOpenItems(
    em,
    userid,
    {
      outcome: request.kind as "warn" | "mute" | "ban",
      hours: request.kind === "mute" ? request.length : null,
      note: request.reason,
      actionId: done.actionId,
      flagsUpTo,
    },
    adminId,
    now,
  );
  return { done, closed };
};

/** The owner's step on a player in the inbox. */
export type InboxAction =
  | { kind: "warn"; reason: string }
  | { kind: "mute"; reason: string; hours: number }
  | { kind: "ban"; reason: string; days: number | null }
  | { kind: "dismiss"; note: string | null };

/** What the inbox showed when the owner decided. */
export interface InboxSeen {
  caseId: number | null;
  /** Reports in that case. */
  reports: number;
  /** The newest word-filter line shown. */
  flagsUpTo: number | null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

const wholeOrNull = (raw: unknown): number | null =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;

/**
 * Reads `{ action, reason?, hours?, days?, note?, caseId, reports, flagsUpTo }`.
 * Warn, pause and ban need the reason the player sees; a pause is 1 to
 * {@link MAX_MUTE_HOURS} hours; a ban names `days` (or null for good).
 */
export const parseInboxAction = (raw: unknown): Parsed<{ action: InboxAction; seen: InboxSeen }> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  const seen: InboxSeen = {
    caseId: wholeOrNull(body.caseId),
    reports: typeof body.reports === "number" && Number.isSafeInteger(body.reports) && body.reports >= 0 ? body.reports : 0,
    flagsUpTo: wholeOrNull(body.flagsUpTo),
  };
  if (body.action === "dismiss") {
    const note = text(body.note);
    if (note.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the note to ${MAX_MODERATION_REASON} characters.` };
    return { ok: true, value: { action: { kind: "dismiss", note: note || null }, seen } };
  }
  if (body.action !== "warn" && body.action !== "mute" && body.action !== "ban") {
    return { ok: false, message: "Pick warn, pause chat, ban or dismiss." };
  }
  const reason = text(body.reason);
  if (!reason) return { ok: false, message: "Write a reason: the player sees it." };
  if (reason.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the reason to ${MAX_MODERATION_REASON} characters.` };
  if (body.action === "warn") return { ok: true, value: { action: { kind: "warn", reason }, seen } };
  if (body.action === "mute") {
    const hours = body.hours;
    if (typeof hours !== "number" || !Number.isSafeInteger(hours) || hours < 1 || hours > MAX_MUTE_HOURS) {
      return { ok: false, message: `A chat pause is 1 to ${MAX_MUTE_HOURS} hours.` };
    }
    return { ok: true, value: { action: { kind: "mute", reason, hours }, seen } };
  }
  if (!("days" in body)) return { ok: false, message: "Pick how long the ban lasts." };
  const days = body.days;
  if (days !== null && (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > MAX_BAN_DAYS)) {
    return { ok: false, message: `A ban is 1 to ${MAX_BAN_DAYS} days, or for good.` };
  }
  return { ok: true, value: { action: { kind: "ban", reason, days: days as number | null }, seen } };
};

export type InboxActionOutcome =
  | { outcome: "done"; closed: ClosedItems; /** What is still open (newer lines), or null. */ player: InboxPlayer | null }
  | { outcome: "changed" | "nothingOpen" | "noPlayer" | "gameTeam" };

/**
 * Acts on a player from the inbox and closes everything open against them
 * that the owner was shown. Refused as `changed` when their case has new
 * reports (or another case) since; `nothingOpen` when it was already closed
 * (a second press).
 */
export const actOnInboxPlayer = async (
  em: EntityManager,
  userid: number,
  action: InboxAction,
  seen: InboxSeen,
  adminId: number,
  effects: ModerationEffects,
  now: Date = new Date(),
): Promise<InboxActionOutcome> => {
  const before = await inboxPlayer(em, userid, now);
  if (!before) return { outcome: "nothingOpen" };
  // Another case, a case closed elsewhere, or new reports: show the owner first.
  if (before.caseId !== seen.caseId || (before.caseId !== null && before.reports > seen.reports)) return { outcome: "changed" };
  // Only lines the owner saw: a newer one stays open. None shown: none closed.
  const flagsUpTo = seen.flagsUpTo ?? 0;
  if (before.caseId === null) {
    const [shown] = await em.execute<{ n: string | number }[]>(
      `SELECT count(*) AS n FROM bym.chat_flag WHERE userid = ? AND id <= ? AND dismissed_at IS NULL`,
      [userid, flagsUpTo],
    );
    // What the owner saw was closed already; what is open now came after.
    if (num(shown?.n) === 0) return { outcome: "changed" };
  }

  if (action.kind === "dismiss") {
    const closed = await closeOpenItems(em, userid, { outcome: "dismiss", hours: null, note: action.note, actionId: null, flagsUpTo }, adminId, now);
    return { outcome: "done", closed, player: await inboxPlayer(em, userid, now) };
  }
  const request: ModerationRequest = {
    kind: action.kind,
    reason: action.reason,
    length: action.kind === "mute" ? action.hours : action.kind === "ban" ? action.days : null,
    chatReportId: null,
  };
  const { done, closed } = await moderatePlayer(em, userid, request, adminId, effects, now, flagsUpTo);
  if (done.outcome !== "done" || !closed) return { outcome: done.outcome === "gameTeam" ? "gameTeam" : "noPlayer" };
  return { outcome: "done", closed, player: await inboxPlayer(em, userid, now) };
};

/**
 * Counts chat lines once (owner, 8 Nov 2026): a line players reported that
 * the word filter also caught is one line, not two. Lines are matched by the
 * time chat stamped them (the same stamp in a report and in a filter catch,
 * `chatReports.ts` and `chatFlags.ts`); a player says at most one line per
 * stamp.
 */
export const countOnce = (
  reportedStamps: readonly number[],
  filterStamps: readonly number[],
): { messages: number; alsoReported: number; filterOnly: number } => {
  const reported = new Set(reportedStamps);
  const filter = new Set(filterStamps);
  let alsoReported = 0;
  for (const ts of filter) if (reported.has(ts)) alsoReported += 1;
  const filterOnly = filter.size - alsoReported;
  return { messages: reported.size + filterOnly, alsoReported, filterOnly };
};

/** How far back the Closed list goes. */
export const CLOSED_DAYS = 30;

/**
 * One decision in the Closed list: a closed chat case and the word-filter
 * lines set aside with it (the same step closes both at the same moment), or
 * word-filter lines set aside on their own.
 */
export interface ClosedDecision {
  userid: number;
  username: string | null;
  closedAt: string;
  closedBy: number | null;
  closedByName: string | null;
  /** The closed chat case, or null when only word-filter lines were closed. */
  caseId: number | null;
  outcome: "warn" | "mute" | "ban" | "dismiss";
  /** A chat pause's length, when known. */
  hours: number | null;
  /** The reason the player saw, or the note on a dismissal. */
  note: string | null;
  /** Different chat lines closed, each counted once. */
  messages: number;
  reportedMessages: number;
  reports: number;
  uniqueReporters: number;
  /** Word-filter lines that were reported lines too (already in `reportedMessages`). */
  alsoReported: number;
  filterOnlyLines: number;
  preview: { text: string; source: "report" | "filter" } | null;
  /** The word-filter lines closed, oldest first. */
  flagLines: FlagLine[];
}

export interface ClosedList {
  decisions: ClosedDecision[];
  nextOffset: number | null;
  /** Decisions in the last {@link CLOSED_DAYS} days. */
  count: number;
}

interface ClosedRow {
  userid: number;
  closed_at: Date | string;
  closed_by: number | null;
  case_id: string | number | null;
  outcome: "warn" | "mute" | "ban" | "dismiss" | null;
  mute_hours: number | null;
  note: string | null;
  flag_lines: unknown;
  username: string | null;
  closed_by_name: string | null;
  messages: string | number | null;
  reports: string | number | null;
  reporters: string | number | null;
  case_stamps: unknown;
  case_preview: string | null;
  step_action: "warn" | "mute" | "ban" | null;
  step_reason: string | null;
  step_until: Date | string | null;
}

const CLOSED_DECISIONS = `
  WITH cc AS (
    SELECT c.id AS case_id, c.reported_id AS userid, c.outcome, c.mute_hours, c.note, c.closed_by, c.closed_at
      FROM bym.chat_case c WHERE c.status <> 'open' AND c.closed_at IS NOT NULL AND c.closed_at >= ?
  ), fg AS (
    SELECT fl.userid, fl.dismissed_at, min(fl.dismissed_by) AS dismissed_by,
           json_agg(json_build_object('id', fl.id, 'channel', fl.channel, 'message', fl.message, 'shown', fl.shown,
             'words', fl.words, 'severity', fl.severity, 'rule', fl.rule, 'created_at', fl.created_at,
             'message_ts', fl.message_ts) ORDER BY fl.id) AS flag_lines
      FROM bym.chat_flag fl WHERE fl.dismissed_at IS NOT NULL AND fl.dismissed_at >= ?
     GROUP BY fl.userid, fl.dismissed_at
  )
  SELECT coalesce(cc.userid, fg.userid) AS userid, coalesce(cc.closed_at, fg.dismissed_at) AS closed_at,
         coalesce(cc.closed_by, fg.dismissed_by) AS closed_by, cc.case_id, cc.outcome, cc.mute_hours, cc.note, fg.flag_lines
    FROM cc FULL OUTER JOIN fg ON fg.userid = cc.userid AND fg.dismissed_at = cc.closed_at`;

const parsed = (raw: unknown): unknown => (typeof raw === "string" ? JSON.parse(raw) : (raw ?? []));

const asFlagLines = (raw: unknown): FlagLine[] =>
  (
    parsed(raw) as {
      id: string | number;
      channel: string;
      message: string;
      shown: string;
      words: string;
      severity: FlagLine["severity"];
      rule: string;
      created_at: string;
      message_ts: string | number;
    }[]
  ).map((line) => ({
    id: Number(line.id),
    channel: line.channel,
    message: line.message,
    shown: line.shown,
    words: line.words ? line.words.split(",") : [],
    severity: line.severity,
    rule: line.rule === "disguised" ? "disguised" : "word",
    at: iso(line.created_at),
    ts: Number(line.message_ts),
  }));

const asStamps = (raw: unknown): number[] => (parsed(raw) as (string | number)[]).map(Number);

/**
 * The Closed list, newest first: what was decided in the last
 * {@link CLOSED_DAYS} days, one row per decision, its lines counted once.
 */
export const listClosed = async (
  em: EntityManager,
  options: { offset?: number; limit?: number; userid?: number; hideStaff?: boolean } = {},
  now: Date = new Date(),
): Promise<ClosedList> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? INBOX_PAGE));
  const offset = Math.max(0, options.offset ?? 0);
  const since = new Date(now.getTime() - CLOSED_DAYS * 24 * 3600 * 1000);
  const who = [options.userid ?? null, options.userid ?? null];
  const rows = await em.execute<ClosedRow[]>(
    `SELECT d.*, u.username, b.username AS closed_by_name,
            (SELECT count(*) FROM bym.chat_case_message m WHERE m.case_id = d.case_id) AS messages,
            (SELECT count(*) FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id
              WHERE m.case_id = d.case_id) AS reports,
            (SELECT count(DISTINCT r.reporter_id) FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id
              WHERE m.case_id = d.case_id) AS reporters,
            (SELECT json_agg(m.message_ts) FROM bym.chat_case_message m WHERE m.case_id = d.case_id) AS case_stamps,
            (SELECT m.message FROM bym.chat_case_message m WHERE m.case_id = d.case_id ORDER BY m.message_ts DESC, m.id DESC LIMIT 1)
              AS case_preview,
            st.action AS step_action, st.reason AS step_reason, st.until AS step_until
       FROM (${CLOSED_DECISIONS}) d
       LEFT JOIN bym."user" u ON u.userid = d.userid
       LEFT JOIN bym."user" b ON b.userid = d.closed_by
       LEFT JOIN LATERAL (
         SELECT a.action, a.reason, a.until FROM bym.moderation_action a
          WHERE a.userid = d.userid AND a.created_at = d.closed_at AND a.action IN ('warn', 'mute', 'ban')
          ORDER BY a.id DESC LIMIT 1
       ) st ON true
      WHERE (?::int IS NULL OR d.userid = ?::int) AND ${staffFilter("d")}
      ORDER BY d.closed_at DESC, d.userid
      LIMIT ${limit + 1} OFFSET ${offset}`,
    [since, since, ...who, ...staffParams(options.hideStaff)],
  );
  const [counted] = await em.execute<{ n: string | number }[]>(
    `SELECT count(*) AS n FROM (${CLOSED_DECISIONS}) d WHERE (?::int IS NULL OR d.userid = ?::int) AND ${staffFilter("d")}`,
    [since, since, ...who, ...staffParams(options.hideStaff)],
  );
  const decisions = rows.slice(0, limit).map((row): ClosedDecision => {
    const flagLines = asFlagLines(row.flag_lines);
    const once = countOnce(
      asStamps(row.case_stamps),
      flagLines.map((line) => line.ts),
    );
    const closedAt = new Date(row.closed_at);
    const outcome = row.outcome ?? row.step_action ?? "dismiss";
    const untilHours =
      row.step_action === "mute" && row.step_until
        ? Math.round((new Date(row.step_until).getTime() - closedAt.getTime()) / 3_600_000)
        : null;
    const lastFlag = flagLines[flagLines.length - 1];
    return {
      userid: Number(row.userid),
      username: row.username,
      closedAt: closedAt.toISOString(),
      closedBy: row.closed_by === null ? null : Number(row.closed_by),
      closedByName: row.closed_by_name,
      caseId: row.case_id === null ? null : Number(row.case_id),
      outcome,
      hours: outcome === "mute" ? (row.mute_hours ?? untilHours) : null,
      note: row.note ?? row.step_reason,
      messages: once.messages,
      reportedMessages: num(row.messages),
      reports: num(row.reports),
      uniqueReporters: num(row.reporters),
      alsoReported: once.alsoReported,
      filterOnlyLines: once.filterOnly,
      preview:
        row.case_preview !== null
          ? { text: row.case_preview, source: "report" }
          : lastFlag
            ? { text: lastFlag.message, source: "filter" }
            : null,
      flagLines,
    };
  });
  return { decisions, nextOffset: rows.length > limit ? offset + limit : null, count: num(counted?.n) };
};
