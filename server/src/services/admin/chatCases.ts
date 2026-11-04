import type { EntityManager } from "@mikro-orm/postgresql";

import type { HistoryEntry } from "../../chat/chatProtocol.js";
import { chatReportAward, isAdminUser } from "../../config/AdminConfig.js";
import { logger } from "../../utils/logger.js";
import type { FlagSeverity } from "../chat/chatFlags.js";
import { MAX_MODERATION_REASON, MAX_MUTE_HOURS, moderate, type ModerationEffects } from "./moderation.js";
import { MAX_AWARD_REASON, MAX_SHINY_AWARD, giveShiny } from "./shinyAwards.js";

/**
 * Chat report cases (owner, 4 Nov 2026): every report of the same chat line,
 * and every reported line of the same player while the owner has not acted
 * yet, make one case. A case shows the offender, each reported line with a
 * text copy of the room around it (taken when it was reported, so it stays
 * after the 90-day chat log has gone), who reported it and when, and the
 * player's earlier offences. The owner closes it with one step: a warning,
 * a warning with chat paused for some hours, or "dismiss"; and can give the
 * genuine reporters Shiny, once per reporter per case.
 *
 * Tables: `bym.chat_case`, `bym.chat_case_message`, `chat_report.case_message_id`
 * (migration `20261106_AddChatCases.ts`). The warning and the pause are the
 * moderation tools' own steps (`moderation.ts` `moderate`), and the Shiny is
 * `shinyAwards.ts` `giveShiny`, with the press id `chatcase-<case>-<reporter>`,
 * which the award log keeps once: a second award to the same reporter for the
 * same case gives nothing.
 *
 * A case is kept as long as chat reports (`CHAT_REPORT_RETENTION_DAYS`,
 * default 365 days, counted from its last report).
 */

/**
 * The room copy: lines kept before the reported line, and after it. The
 * owner's choice (4 Nov 2026): 10 lines in all, 7 before, the line, 2 after.
 */
export const SNAPSHOT_BEFORE = 7;
export const SNAPSHOT_AFTER = 2;

/** The reason in a reporter's Shiny mail when the owner writes none. */
export const DEFAULT_AWARD_REASON = "Thank you for reporting a chat message that broke the rules.";

/** Chat pause lengths offered with a warning, in hours. */
export const CASE_MUTE_HOURS: readonly number[] = [1, 24, 72, 168];

export type CaseStatus = "open" | "actioned" | "dismissed";
export type CaseOutcome = "warn" | "mute" | "dismiss";

/** One chat line in a case's copy of the room. */
export interface SnapshotLine {
  userid: number;
  /** The name when the copy was taken. */
  name: string | null;
  text: string;
  /** When it was said (ms). */
  at: number;
  /** The reported line. */
  reported?: true;
  flagged?: FlagSeverity;
}

/**
 * A text copy of the room around a reported line. `log`: from the chat log,
 * the players' own words; `room`: from the room's last 100 lines, the words as
 * players saw them (starred out); `none`: neither held the line any more.
 */
export interface Snapshot {
  source: "log" | "room" | "none";
  lines: SnapshotLine[];
}

const EMPTY_SNAPSHOT: Snapshot = { source: "none", lines: [] };

/** Lines after the reported one in a copy; -1 when the reported line is not in it. */
export const linesAfter = (snapshot: Snapshot): number => {
  const at = snapshot.lines.findIndex((line) => line.reported);
  return at < 0 ? -1 : snapshot.lines.length - 1 - at;
};

/** Whether `next` should replace `old`: it holds the line where `old` did not, has the own words, or more lines after it. */
export const betterSnapshot = (old: Snapshot, next: Snapshot): boolean => {
  const oldAfter = linesAfter(old);
  const nextAfter = linesAfter(next);
  if (nextAfter < 0) return false;
  if (oldAfter < 0) return true;
  if (old.source !== "log" && next.source === "log") return true;
  if (old.source === "log" && next.source !== "log") return false;
  return nextAfter > oldAfter;
};

/** Cuts lines (oldest first) to the window around the reported line, marking it. */
export const windowAround = (lines: readonly SnapshotLine[], isReported: (line: SnapshotLine) => boolean): SnapshotLine[] => {
  const at = lines.findIndex(isReported);
  if (at < 0) return [];
  return lines
    .slice(Math.max(0, at - SNAPSHOT_BEFORE), at + 1 + SNAPSHOT_AFTER)
    .map((line) => (line === lines[at] ? { ...line, reported: true as const } : line));
};

/** The room's own last lines (Redis, starred out) around the reported line. */
export const snapshotFromRoom = (history: readonly HistoryEntry[], reported: number, ts: number): Snapshot => {
  const lines: SnapshotLine[] = history.map((entry) => ({
    userid: entry.userId,
    name: entry.displayName,
    text: entry.body,
    at: entry.ts,
  }));
  const kept = windowAround(lines, (line) => line.userid === reported && line.at === ts);
  return kept.length ? { source: "room", lines: kept } : EMPTY_SNAPSHOT;
};

interface LogRow {
  id: string | number;
  userid: number;
  username: string | null;
  message: string;
  flagged: FlagSeverity | null;
  created_at: Date | string;
}

/** The chat log (the players' own words) around the reported line; `none` when the log does not hold it. */
export const snapshotFromLog = async (em: EntityManager, channel: string, reported: number, ts: number): Promise<Snapshot> => {
  const at = new Date(ts);
  const rows = await em.execute<LogRow[]>(
    `(SELECT c.id, c.userid, u.username, c.message, c.flagged, c.created_at
        FROM bym.chat_log c LEFT JOIN bym."user" u ON u.userid = c.userid
       WHERE c.channel = ? AND c.created_at <= ?
       ORDER BY c.created_at DESC, c.id DESC LIMIT ${SNAPSHOT_BEFORE + 3})
     UNION ALL
     (SELECT c.id, c.userid, u.username, c.message, c.flagged, c.created_at
        FROM bym.chat_log c LEFT JOIN bym."user" u ON u.userid = c.userid
       WHERE c.channel = ? AND c.created_at > ?
       ORDER BY c.created_at, c.id LIMIT ${SNAPSHOT_AFTER})`,
    [channel, at, channel, at],
  );
  const lines = rows
    .map((row) => ({ id: Number(row.id), at: new Date(row.created_at).getTime(), row }))
    .sort((a, b) => a.at - b.at || a.id - b.id)
    .map(({ at: when, row }): SnapshotLine => ({
      userid: Number(row.userid),
      name: row.username,
      text: row.message,
      at: when,
      ...(row.flagged ? { flagged: row.flagged } : {}),
    }));
  const kept = windowAround(lines, (line) => line.userid === reported && line.at === ts);
  return kept.length ? { source: "log", lines: kept } : EMPTY_SNAPSHOT;
};

/**
 * The best copy of the room around a line: the chat log's when it holds the
 * line, else the room's own last lines when given, else none.
 */
export const takeSnapshot = async (
  em: EntityManager,
  line: { channel: string; reported: number; ts: number },
  history?: readonly HistoryEntry[],
): Promise<Snapshot> => {
  const fromLog = await snapshotFromLog(em, line.channel, line.reported, line.ts);
  if (fromLog.source === "log") return fromLog;
  return history ? snapshotFromRoom(history, line.reported, line.ts) : EMPTY_SNAPSHOT;
};

const asSnapshot = (raw: unknown): Snapshot => {
  const value = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  if (!value || typeof value !== "object" || !Array.isArray((value as Snapshot).lines)) return EMPTY_SNAPSHOT;
  return value as Snapshot;
};

/** A report just stored, as {@link fileChatReport} files it. */
export interface FiledReport {
  reportId: number;
  reported: number;
  channel: string;
  ts: number;
  /** The words kept on the report. */
  message: string;
  verified: boolean;
}

/**
 * Puts a new report into its case: the case that already holds this line
 * (even a closed one: a late report joins it), else the player's open case,
 * else a new case. A new line gets its copy of the room now; a line already
 * in a case gets a better copy when one can be had (more lines after it, or
 * the own words). Returns the case id.
 */
export const fileChatReport = async (
  em: EntityManager,
  report: FiledReport,
  history?: readonly HistoryEntry[],
  now: Date = new Date(),
): Promise<number> => {
  const findLine = async () =>
    (
      await em.execute<{ id: string | number; case_id: string | number; snapshot: unknown }[]>(
        `SELECT id, case_id, snapshot FROM bym.chat_case_message WHERE reported_id = ? AND channel = ? AND message_ts = ?`,
        [report.reported, report.channel, report.ts],
      )
    )[0];

  let line = await findLine();
  if (line) {
    const old = asSnapshot(line.snapshot);
    if (linesAfter(old) < SNAPSHOT_AFTER || old.source !== "log") {
      const next = await takeSnapshot(em, { channel: report.channel, reported: report.reported, ts: report.ts }, history);
      if (betterSnapshot(old, next)) await saveSnapshot(em, Number(line.id), next, now);
    }
  } else {
    const openCase = async () =>
      (
        await em.execute<{ id: string | number }[]>(
          `SELECT id FROM bym.chat_case WHERE reported_id = ? AND status = 'open'`,
          [report.reported],
        )
      )[0];
    let caseRow = await openCase();
    if (!caseRow) {
      [caseRow] = await em.execute<{ id: string | number }[]>(
        `INSERT INTO bym.chat_case (reported_id, status, first_report_at, last_report_at, created_at)
         VALUES (?, 'open', ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
        [report.reported, now, now, now],
      );
      // Another report opened it at the same moment.
      caseRow ??= await openCase();
    }
    const snapshot = await takeSnapshot(em, { channel: report.channel, reported: report.reported, ts: report.ts }, history);
    await em.execute(
      `INSERT INTO bym.chat_case_message (case_id, reported_id, channel, message_ts, message, verified, snapshot, snapshot_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?) ON CONFLICT DO NOTHING`,
      [
        Number(caseRow!.id),
        report.reported,
        report.channel,
        report.ts,
        report.message,
        report.verified,
        JSON.stringify(snapshot),
        snapshot.source === "none" ? null : now,
        now,
      ],
    );
    line = await findLine();
  }

  const caseId = Number(line!.case_id);
  await em.execute(`UPDATE bym.chat_report SET case_message_id = ? WHERE id = ?`, [Number(line!.id), report.reportId]);
  await em.execute(
    `UPDATE bym.chat_case SET last_report_at = GREATEST(last_report_at, ?) WHERE id = ?`,
    [now, caseId],
  );
  return caseId;
};

const saveSnapshot = (em: EntityManager, messageId: number, snapshot: Snapshot, now: Date) =>
  em.execute(`UPDATE bym.chat_case_message SET snapshot = ?::jsonb, snapshot_at = ? WHERE id = ?`, [
    JSON.stringify(snapshot),
    now,
    messageId,
  ]);

/**
 * Takes the copy again for a case's lines that have fewer than
 * {@link SNAPSHOT_AFTER} lines after them, from the chat log, keeping the
 * better one. Lines said after the report come in this way while the case is
 * open. Never throws: the copy is extra.
 */
export const completeSnapshots = async (em: EntityManager, caseIds: readonly number[], now: Date = new Date()): Promise<void> => {
  if (caseIds.length === 0) return;
  try {
    const rows = await em.execute<
      { id: string | number; reported_id: number; channel: string; message_ts: string | number; snapshot: unknown }[]
    >(
      `SELECT id, reported_id, channel, message_ts, snapshot FROM bym.chat_case_message WHERE case_id = ANY(?::bigint[])`,
      [`{${caseIds.join(",")}}`],
    );
    for (const row of rows) {
      const old = asSnapshot(row.snapshot);
      if (linesAfter(old) >= SNAPSHOT_AFTER && old.source === "log") continue;
      const next = await snapshotFromLog(em, row.channel, Number(row.reported_id), Number(row.message_ts));
      if (betterSnapshot(old, next)) await saveSnapshot(em, Number(row.id), next, now);
    }
  } catch (err) {
    logger.warn(`Chat case copies not completed: ${err}`);
  }
};

/** A player's earlier record, as a case shows it. */
export interface CaseHistory {
  /** Earlier cases closed with a warning or pause. */
  cases: number;
  /** Lines the word filter caught (kept a year), dismissed or not. */
  flags: number;
  warnings: number;
  /** Chat pauses. */
  mutes: number;
  bans: number;
}

/** What the page offers first: a warning alone, or a warning with chat paused for `hours`. */
export interface CaseSuggestion {
  action: "warn" | "mute";
  hours: number | null;
}

/**
 * The owner's rule (4 Nov 2026): "If multiple offending messages were
 * received, I do issue a warning and temporary chat ban." One line from a
 * player with a clean record: a warning. More than one line (in the case, or
 * caught by the word filter), or any earlier warning, pause or ban: a warning
 * with chat paused, longer for each earlier step (1 day, 3 days, 7 days).
 */
export const suggestAction = (messages: number, history: CaseHistory): CaseSuggestion => {
  const earlier = history.warnings + history.mutes + history.bans;
  if (earlier === 0 && messages <= 1 && history.flags === 0) return { action: "warn", hours: null };
  const hours = earlier === 0 ? 24 : earlier === 1 ? 72 : 168;
  return { action: "mute", hours };
};

export interface CaseReporter {
  userid: number;
  username: string | null;
  /** Their first report in this case. */
  at: string;
  /** The first to report anything in this case. */
  first: boolean;
  /** Reported after the case was closed. */
  late: boolean;
  /** Shiny given for this case, or null. */
  award: { amount: number; at: string } | null;
}

export interface CaseMessage {
  id: number;
  channel: string;
  message: string;
  /** When it was said (ms). */
  ts: number;
  /** The words are the chat server's own copy. */
  verified: boolean;
  /** Who reported this line (account numbers), first first. */
  reporters: number[];
  snapshot: Snapshot;
}

export interface CaseClosed {
  outcome: CaseOutcome;
  hours: number | null;
  /** The reason the player saw, or the owner's note on a dismissal. */
  note: string | null;
  by: number;
  byName: string | null;
  at: string;
}

export interface ChatCaseView {
  id: number;
  status: CaseStatus;
  reported: { userid: number; username: string | null; banned: boolean; muted: boolean; gameTeam: boolean };
  /** Oldest first. */
  messages: CaseMessage[];
  /** Everyone who reported a line in the case, first first. */
  reporters: CaseReporter[];
  /** Reports in all (one per reporter per line). */
  reports: number;
  firstReportAt: string;
  lastReportAt: string;
  history: CaseHistory;
  suggest: CaseSuggestion;
  closed: CaseClosed | null;
}

interface CaseRow {
  id: string | number;
  reported_id: number;
  status: CaseStatus;
  outcome: CaseOutcome | null;
  mute_hours: number | null;
  note: string | null;
  moderation_action_id: string | number | null;
  closed_by: number | null;
  closed_by_name: string | null;
  closed_at: Date | string | null;
  first_report_at: Date | string;
  last_report_at: Date | string;
  username: string | null;
  banned: boolean | null;
  mute_until: Date | string | null;
}

const iso = (value: Date | string): string => new Date(value).toISOString();
const ids = (values: readonly number[]): string => `{${values.join(",")}}`;

/** The award log's press id for one reporter's Shiny from one case. */
export const awardRequestId = (caseId: number, reporter: number): string => `chatcase-${caseId}-${reporter}`;

/** Builds the views of these case rows. */
const viewCases = async (em: EntityManager, cases: readonly CaseRow[], now: Date): Promise<ChatCaseView[]> => {
  if (cases.length === 0) return [];
  const caseIds = cases.map((row) => Number(row.id));
  const players = [...new Set(cases.map((row) => Number(row.reported_id)))];

  const messages = await em.execute<
    {
      id: string | number;
      case_id: string | number;
      channel: string;
      message: string;
      message_ts: string | number;
      verified: boolean;
      snapshot: unknown;
    }[]
  >(
    `SELECT id, case_id, channel, message, message_ts, verified, snapshot FROM bym.chat_case_message
      WHERE case_id = ANY(?::bigint[]) ORDER BY message_ts, id`,
    [ids(caseIds)],
  );
  const reports = await em.execute<
    { case_message_id: string | number; case_id: string | number; reporter_id: number; username: string | null; created_at: Date | string }[]
  >(
    `SELECT r.case_message_id, m.case_id, r.reporter_id, u.username, r.created_at
       FROM bym.chat_report r
       JOIN bym.chat_case_message m ON m.id = r.case_message_id
       LEFT JOIN bym."user" u ON u.userid = r.reporter_id
      WHERE m.case_id = ANY(?::bigint[])
      ORDER BY r.created_at, r.id`,
    [ids(caseIds)],
  );
  const requestIds = reports.map((r) => awardRequestId(Number(r.case_id), Number(r.reporter_id)));
  const awards = requestIds.length
    ? await em.execute<{ request_id: string; amount: number; awarded_at: Date | string }[]>(
        `SELECT request_id, amount, awarded_at FROM bym.shiny_award WHERE request_id = ANY(?::text[])`,
        [`{${[...new Set(requestIds)].join(",")}}`],
      )
    : [];
  const awardBy = new Map(awards.map((a) => [a.request_id, { amount: Number(a.amount), at: iso(a.awarded_at) }]));

  const actioned = await em.execute<{ reported_id: number; id: string | number }[]>(
    `SELECT reported_id, id FROM bym.chat_case WHERE reported_id = ANY(?::int[]) AND status = 'actioned'`,
    [ids(players)],
  );
  const flags = await em.execute<{ userid: number; n: string | number }[]>(
    `SELECT userid, count(*) AS n FROM bym.chat_flag WHERE userid = ANY(?::int[]) GROUP BY userid`,
    [ids(players)],
  );
  const steps = await em.execute<{ userid: number; id: string | number; action: string; created_at: Date | string }[]>(
    `SELECT userid, id, action, created_at FROM bym.moderation_action
      WHERE userid = ANY(?::int[]) AND action IN ('warn', 'mute', 'ban')`,
    [ids(players)],
  );
  const flagCount = new Map(flags.map((f) => [Number(f.userid), Number(f.n)]));

  return cases.map((row): ChatCaseView => {
    const id = Number(row.id);
    const userid = Number(row.reported_id);
    const closedAt = row.closed_at ? new Date(row.closed_at) : null;
    const ownStep = row.moderation_action_id === null ? null : Number(row.moderation_action_id);
    // Earlier: before this case was closed (or now, while open), and not its own step.
    const cutoff = closedAt ?? now;
    const priorSteps = steps.filter(
      (s) => Number(s.userid) === userid && Number(s.id) !== ownStep && new Date(s.created_at) <= cutoff,
    );
    const history: CaseHistory = {
      cases: actioned.filter((c) => Number(c.reported_id) === userid && Number(c.id) < id).length,
      flags: flagCount.get(userid) ?? 0,
      warnings: priorSteps.filter((s) => s.action === "warn").length,
      mutes: priorSteps.filter((s) => s.action === "mute").length,
      bans: priorSteps.filter((s) => s.action === "ban").length,
    };

    const ownReports = reports.filter((r) => Number(r.case_id) === id);
    const reporters: CaseReporter[] = [];
    for (const report of ownReports) {
      const reporter = Number(report.reporter_id);
      if (reporters.some((r) => r.userid === reporter)) continue;
      const at = new Date(report.created_at);
      reporters.push({
        userid: reporter,
        username: report.username,
        at: at.toISOString(),
        first: reporters.length === 0,
        late: closedAt !== null && at > closedAt,
        award: awardBy.get(awardRequestId(id, reporter)) ?? null,
      });
    }

    const ownMessages = messages
      .filter((m) => Number(m.case_id) === id)
      .map(
        (m): CaseMessage => ({
          id: Number(m.id),
          channel: m.channel,
          message: m.message,
          ts: Number(m.message_ts),
          verified: Boolean(m.verified),
          reporters: [
            ...new Set(ownReports.filter((r) => Number(r.case_message_id) === Number(m.id)).map((r) => Number(r.reporter_id))),
          ],
          snapshot: asSnapshot(m.snapshot),
        }),
      );

    const mute = row.mute_until ? new Date(row.mute_until) : null;
    return {
      id,
      status: row.status,
      reported: {
        userid,
        username: row.username,
        banned: Boolean(row.banned),
        muted: mute !== null && mute > now,
        gameTeam: isAdminUser(userid),
      },
      messages: ownMessages,
      reporters,
      reports: ownReports.length,
      firstReportAt: iso(row.first_report_at),
      lastReportAt: iso(row.last_report_at),
      history,
      suggest: suggestAction(ownMessages.length, history),
      closed:
        row.status === "open" || !row.outcome || closedAt === null
          ? null
          : {
              outcome: row.outcome,
              hours: row.mute_hours === null ? null : Number(row.mute_hours),
              note: row.note,
              by: Number(row.closed_by),
              byName: row.closed_by_name,
              at: closedAt.toISOString(),
            },
    };
  });
};

const CASE_SELECT = `SELECT c.id, c.reported_id, c.status, c.outcome, c.mute_hours, c.note, c.moderation_action_id,
         c.closed_by, a.username AS closed_by_name, c.closed_at, c.first_report_at, c.last_report_at,
         u.username, u.banned, u.mute_until
    FROM bym.chat_case c
    LEFT JOIN bym."user" u ON u.userid = c.reported_id
    LEFT JOIN bym."user" a ON a.userid = c.closed_by`;

export const CASE_PAGE = 30;

/**
 * Open cases (most recently reported first) or closed ones (most recently
 * closed first), a page at a time, with how many are open in all. Open
 * cases' copies of the room are completed first.
 */
export const listChatCases = async (
  em: EntityManager,
  options: { status?: "open" | "closed"; offset?: number; limit?: number } = {},
  now: Date = new Date(),
): Promise<{ cases: ChatCaseView[]; nextOffset: number | null; open: number; award: { each: number; first: number } }> => {
  const closed = options.status === "closed";
  const limit = Math.min(100, Math.max(1, options.limit ?? CASE_PAGE));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await em.execute<CaseRow[]>(
    `${CASE_SELECT}
      WHERE ${closed ? "c.status <> 'open'" : "c.status = 'open'"}
      ORDER BY ${closed ? "c.closed_at DESC" : "c.last_report_at DESC"}, c.id DESC
      LIMIT ${limit + 1} OFFSET ${offset}`,
  );
  const page = rows.slice(0, limit);
  if (!closed) {
    await completeSnapshots(em, page.map((row) => Number(row.id)), now);
  }
  const [{ n } = { n: 0 }] = await em.execute<{ n: string | number }[]>(
    `SELECT count(*) AS n FROM bym.chat_case WHERE status = 'open'`,
  );
  return {
    cases: await viewCases(em, page, now),
    nextOffset: rows.length > limit ? offset + limit : null,
    open: Number(n),
    award: chatReportAward(),
  };
};

/** One case, or null. */
export const getChatCase = async (em: EntityManager, id: number, now: Date = new Date()): Promise<ChatCaseView | null> => {
  const rows = await em.execute<CaseRow[]>(`${CASE_SELECT} WHERE c.id = ?`, [id]);
  const [view] = await viewCases(em, rows, now);
  return view ?? null;
};

/** The owner's step on a case. */
export type CaseAction =
  | { kind: "warn"; reason: string }
  | { kind: "mute"; reason: string; hours: number }
  | { kind: "dismiss"; note: string | null };

type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Reads `{ action: "warn" | "mute" | "dismiss", reason?, hours?, note? }`. A
 * warning and a pause need the reason the player sees; a pause is 1 to
 * {@link MAX_MUTE_HOURS} hours; a dismissal's note is optional.
 */
export const parseCaseAction = (raw: unknown): Parsed<CaseAction> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  if (body.action === "dismiss") {
    const note = text(body.note);
    if (note.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the note to ${MAX_MODERATION_REASON} characters.` };
    return { ok: true, value: { kind: "dismiss", note: note || null } };
  }
  if (body.action !== "warn" && body.action !== "mute") return { ok: false, message: "Pick warn, warn and pause chat, or dismiss." };
  const reason = text(body.reason);
  if (!reason) return { ok: false, message: "Write a reason: the player sees it." };
  if (reason.length > MAX_MODERATION_REASON) return { ok: false, message: `Keep the reason to ${MAX_MODERATION_REASON} characters.` };
  if (body.action === "warn") return { ok: true, value: { kind: "warn", reason } };
  const hours = body.hours;
  if (typeof hours !== "number" || !Number.isSafeInteger(hours) || hours < 1 || hours > MAX_MUTE_HOURS) {
    return { ok: false, message: `A chat pause is 1 to ${MAX_MUTE_HOURS} hours.` };
  }
  return { ok: true, value: { kind: "mute", reason, hours } };
};

export type CaseActionOutcome =
  | { outcome: "done"; case: ChatCaseView }
  | { outcome: "notFound" | "closed" | "noPlayer" | "gameTeam" };

/**
 * Closes an open case with the owner's step. A warning or pause is the
 * moderation tools' own step (mail, pop-up, chat paused, logged in the
 * player's moderation log, linked to the case's first report). The case is
 * claimed first, so two presses close it once; a step the moderation tools
 * refuse (a game team account, a player gone) leaves it open.
 */
export const actOnCase = async (
  em: EntityManager,
  caseId: number,
  action: CaseAction,
  adminId: number,
  effects: ModerationEffects,
  now: Date = new Date(),
): Promise<CaseActionOutcome> => {
  const status: CaseStatus = action.kind === "dismiss" ? "dismissed" : "actioned";
  const note = action.kind === "dismiss" ? action.note : action.reason;
  const hours = action.kind === "mute" ? action.hours : null;
  const [claimed] = await em.execute<{ reported_id: number }[]>(
    `UPDATE bym.chat_case SET status = ?, outcome = ?, mute_hours = ?, note = ?, closed_by = ?, closed_at = ?
      WHERE id = ? AND status = 'open' RETURNING reported_id`,
    [status, action.kind, hours, note, adminId, now, caseId],
  );
  if (!claimed) {
    const [exists] = await em.execute<{ id: string }[]>(`SELECT id FROM bym.chat_case WHERE id = ?`, [caseId]);
    return { outcome: exists ? "closed" : "notFound" };
  }

  if (action.kind !== "dismiss") {
    const [first] = await em.execute<{ id: string | number | null }[]>(
      `SELECT min(r.id) AS id FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id WHERE m.case_id = ?`,
      [caseId],
    );
    const done = await moderate(
      em,
      Number(claimed.reported_id),
      {
        kind: action.kind,
        reason: action.reason,
        length: action.kind === "mute" ? action.hours : null,
        chatReportId: first?.id === null || first?.id === undefined ? null : Number(first.id),
      },
      adminId,
      effects,
      now,
    );
    if (done.outcome !== "done") {
      await em.execute(
        `UPDATE bym.chat_case SET status = 'open', outcome = NULL, mute_hours = NULL, note = NULL, closed_by = NULL, closed_at = NULL
          WHERE id = ?`,
        [caseId],
      );
      return { outcome: done.outcome === "gameTeam" ? "gameTeam" : "noPlayer" };
    }
    await em.execute(`UPDATE bym.chat_case SET moderation_action_id = ? WHERE id = ?`, [done.actionId, caseId]);
  }
  logger.info(`Dashboard: chat case ${caseId} closed (${action.kind}) by ${adminId}`);
  await completeSnapshots(em, [caseId], now);
  return { outcome: "done", case: (await getChatCase(em, caseId, now))! };
};

export interface CaseAwardRequest {
  awards: { userid: number; amount: number }[];
  reason: string;
}

/** Reads `{ awards: [{ userid, amount }], reason? }`: whole amounts of 1 to {@link MAX_SHINY_AWARD}, each reporter once. */
export const parseCaseAward = (raw: unknown): Parsed<CaseAwardRequest> => {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!Array.isArray(body.awards) || body.awards.length === 0) return { ok: false, message: "Tick at least one reporter." };
  if (body.awards.length > 100) return { ok: false, message: "Too many reporters at once." };
  const awards: { userid: number; amount: number }[] = [];
  for (const item of body.awards as unknown[]) {
    const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const { userid, amount } = entry;
    if (typeof userid !== "number" || !Number.isSafeInteger(userid) || userid < 1) return { ok: false, message: "Pick a reporter." };
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 1 || amount > MAX_SHINY_AWARD) {
      return { ok: false, message: `Give a whole number of Shiny from 1 to ${MAX_SHINY_AWARD.toLocaleString("en-US")}.` };
    }
    if (awards.some((a) => a.userid === userid)) return { ok: false, message: "Each reporter once." };
    awards.push({ userid, amount });
  }
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : DEFAULT_AWARD_REASON;
  if (reason.length > MAX_AWARD_REASON) return { ok: false, message: `Keep the reason to ${MAX_AWARD_REASON} characters.` };
  return { ok: true, value: { awards, reason } };
};

export type AwardFailure = "notReporter" | "noPlayer" | "noMainYard";

export type CaseAwardOutcome =
  | {
      outcome: "done";
      /** Given now. */
      given: { userid: number; amount: number }[];
      /** Already given for this case before: nothing more given. */
      already: number[];
      failed: { userid: number; reason: AwardFailure }[];
      case: ChatCaseView;
    }
  | { outcome: "notFound" };

/**
 * Gives each ticked reporter of the case their Shiny, with a mail saying why
 * (`giveShiny`). Each reporter gets Shiny from a case once: a second award,
 * even with another amount, gives nothing and is reported as `already`.
 */
export const awardReporters = async (
  em: EntityManager,
  caseId: number,
  request: CaseAwardRequest,
  adminId: number,
  now: Date = new Date(),
): Promise<CaseAwardOutcome> => {
  const [exists] = await em.execute<{ id: string }[]>(`SELECT id FROM bym.chat_case WHERE id = ?`, [caseId]);
  if (!exists) return { outcome: "notFound" };
  const reporterRows = await em.execute<{ reporter_id: number }[]>(
    `SELECT DISTINCT r.reporter_id FROM bym.chat_report r JOIN bym.chat_case_message m ON m.id = r.case_message_id WHERE m.case_id = ?`,
    [caseId],
  );
  const reporters = new Set(reporterRows.map((r) => Number(r.reporter_id)));

  const given: { userid: number; amount: number }[] = [];
  const already: number[] = [];
  const failed: { userid: number; reason: AwardFailure }[] = [];
  for (const { userid, amount } of request.awards) {
    if (!reporters.has(userid)) {
      failed.push({ userid, reason: "notReporter" });
      continue;
    }
    const done = await giveShiny(
      em,
      { userid, amount, reason: request.reason, bugReportId: null, requestId: awardRequestId(caseId, userid) },
      adminId,
      Math.floor(now.getTime() / 1000),
    );
    if (done.outcome === "given") given.push({ userid, amount });
    else if (done.outcome === "already") already.push(userid);
    else failed.push({ userid, reason: done.outcome === "noPlayer" ? "noPlayer" : "noMainYard" });
  }
  logger.info(`Dashboard: chat case ${caseId} reporters given Shiny by ${adminId}: ${given.length} given, ${already.length} already`);
  return { outcome: "done", given, already, failed, case: (await getChatCase(em, caseId, now))! };
};
