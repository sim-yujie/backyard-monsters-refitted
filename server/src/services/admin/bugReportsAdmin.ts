import type { EntityManager } from "@mikro-orm/postgresql";

import { logger } from "../../utils/logger.js";
import { awardsForReport, type ShinyAwardView } from "./shinyAwards.js";
import { noReplyReason, readSupportThread, UNREAD_REPLIES, type NoReplyReason, type SupportMessage } from "./supportMail.js";

/**
 * The dashboard's bug reports (`bym.bug_report`, `services/bugReports`):
 * the list, one report, its pictures, and the owner's ticket on each report:
 * a status and notes, changed only by the owner, with every change kept with
 * its time in `bym.bug_report_change`. Nothing here leaves the server.
 */

/** Where the owner is with a report: `new` until looked at, then `working`, `fixed` or `wontfix`. */
export const TICKET_STATUSES = ["new", "working", "fixed", "wontfix"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const isTicketStatus = (value: unknown): value is TicketStatus =>
  typeof value === "string" && (TICKET_STATUSES as readonly string[]).includes(value);

/** The longest owner notes kept, in characters. */
export const MAX_OWNER_NOTES = 4000;

export interface BugReportSummary {
  readonly id: number;
  readonly createdAt: string;
  readonly userid: number | null;
  readonly username: string | null;
  /** The first line of the player's words, cut to 140 characters. */
  readonly preview: string;
  readonly gameVersion: string;
  readonly screen: string;
  readonly device: string;
  readonly hasScreenshot: boolean;
  readonly hasPicture: boolean;
  readonly emailed: boolean;
  readonly status: TicketStatus;
  /** When the status last changed; null while it was never changed. */
  readonly statusChangedAt: string | null;
  readonly hasNotes: boolean;
  /** The player's answers in the report's mail thread the owner has not opened yet. */
  readonly unreadReplies: number;
}

/** One change to a report's ticket, oldest first in {@link BugReportDetail.changes}. */
export interface TicketChange {
  readonly at: string;
  /** The account number of the owner who made it. */
  readonly by: number | null;
  /** Set when the status changed: from and to. */
  readonly status: { readonly from: TicketStatus | null; readonly to: TicketStatus } | null;
  /** Set when the notes changed: the notes as they were after this change. */
  readonly notes: string | null;
}

export interface BugReportDetail extends Omit<BugReportSummary, "preview"> {
  readonly message: string;
  /** The email a signed-out player typed for a reply; null when signed in. */
  readonly contactEmail: string | null;
  readonly userAgent: string;
  readonly screenSize: string;
  readonly errors: readonly string[];
  readonly screenshotType: string | null;
  readonly pictureType: string | null;
  readonly emailedAt: string | null;
  /** "Chrome 130 on Android", from the user agent. */
  readonly browser: string;
  readonly ownerNotes: string;
  readonly notesChangedAt: string | null;
  readonly changes: readonly TicketChange[];
  /** The mail between the player and "The game team" about this report, oldest first (`supportMail.ts`). */
  readonly thread: readonly SupportMessage[];
  /** Why the owner cannot write to the player in the game, or null when they can. */
  readonly cannotReply: NoReplyReason | null;
  /** The Shiny given to the player from this report, oldest first (`shinyAwards.ts`). */
  readonly awards: readonly ShinyAwardView[];
}

export interface BugReportListQuery {
  /** Only reports with an id below this (the next page). */
  readonly before?: number;
  readonly limit?: number;
  /** `open`: new or working; `closed`: fixed or won't fix; or one status. */
  readonly filter?: BugReportFilter;
}

export type BugReportFilter = "all" | "open" | "closed" | TicketStatus;

export const isBugReportFilter = (value: unknown): value is BugReportFilter =>
  value === "all" || value === "open" || value === "closed" || isTicketStatus(value);

const preview = (message: string): string => {
  const first = (message.split(/\r?\n/).find((line) => line.trim() !== "") ?? "").trim();
  return first.length > 140 ? `${first.slice(0, 139)}…` : first;
};

const iso = (raw: Date | string | null): string | null => (raw === null ? null : new Date(raw).toISOString());

interface SummaryRow {
  id: number | string;
  created_at: Date | string;
  userid: number | null;
  username: string | null;
  message: string;
  game_version: string;
  screen: string;
  device: string;
  has_screenshot: boolean;
  has_picture: boolean;
  emailed_at: Date | string | null;
  status: string;
  status_changed_at: Date | string | null;
  has_notes: boolean;
  mail_thread_id: number | null;
  unread_replies: number | string;
}

const SUMMARY_COLUMNS = `id, created_at, userid, username, message, game_version, screen, device,
  screenshot IS NOT NULL AS has_screenshot, picture IS NOT NULL AS has_picture, emailed_at,
  status, status_changed_at, owner_notes <> '' AS has_notes, mail_thread_id,
  ${UNREAD_REPLIES} AS unread_replies`;

const summaryOf = (row: SummaryRow): BugReportSummary => ({
  id: Number(row.id),
  createdAt: iso(row.created_at)!,
  userid: row.userid === null ? null : Number(row.userid),
  username: row.username,
  preview: preview(row.message),
  gameVersion: row.game_version,
  screen: row.screen,
  device: row.device,
  hasScreenshot: Boolean(row.has_screenshot),
  hasPicture: Boolean(row.has_picture),
  emailed: row.emailed_at !== null,
  status: isTicketStatus(row.status) ? row.status : "new",
  statusChangedAt: iso(row.status_changed_at),
  hasNotes: Boolean(row.has_notes),
  unreadReplies: Number(row.unread_replies) || 0,
});

/** Reports newest first, a page at a time (at most 100), without their pictures. */
export const listBugReports = async (
  em: EntityManager,
  query: BugReportListQuery = {}
): Promise<{ reports: BugReportSummary[]; nextBefore: number | null }> => {
  const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 50) || 50));
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.before !== undefined && Number.isSafeInteger(query.before)) {
    where.push("id < ?");
    params.push(query.before);
  }
  if (query.filter === "open") where.push(`status IN ('new', 'working')`);
  else if (query.filter === "closed") where.push(`status IN ('fixed', 'wontfix')`);
  else if (isTicketStatus(query.filter)) {
    where.push("status = ?");
    params.push(query.filter);
  }
  const rows = await em.execute<SummaryRow[]>(
    `SELECT ${SUMMARY_COLUMNS} FROM bym.bug_report ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY id DESC LIMIT ${limit + 1}`,
    params
  );
  const reports = rows.slice(0, limit).map(summaryOf);
  return { reports, nextBefore: rows.length > limit ? reports[reports.length - 1]!.id : null };
};

interface DetailRow extends SummaryRow {
  contact_email: string | null;
  user_agent: string;
  screen_size: string;
  errors: unknown;
  screenshot_type: string | null;
  picture_type: string | null;
  owner_notes: string;
  notes_changed_at: Date | string | null;
}

interface ChangeRow {
  changed_at: Date | string;
  changed_by: number | null;
  old_status: string | null;
  new_status: string | null;
  notes: string | null;
}

const changeOf = (row: ChangeRow): TicketChange => ({
  at: iso(row.changed_at)!,
  by: row.changed_by === null ? null : Number(row.changed_by),
  status: isTicketStatus(row.new_status)
    ? { from: isTicketStatus(row.old_status) ? row.old_status : null, to: row.new_status }
    : null,
  notes: row.notes,
});

const errorsOf = (raw: unknown): string[] => {
  const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
  return Array.isArray(list) ? list.filter((line): line is string => typeof line === "string") : [];
};

/** One report with everything but the picture bytes, or null when there is none. */
export const getBugReport = async (em: EntityManager, id: number): Promise<BugReportDetail | null> => {
  const [row] = await em.execute<DetailRow[]>(
    `SELECT ${SUMMARY_COLUMNS}, contact_email, user_agent, screen_size, errors, screenshot_type, picture_type,
            owner_notes, notes_changed_at
       FROM bym.bug_report WHERE id = ?`,
    [id]
  );
  if (!row) return null;
  const changes = await em.execute<ChangeRow[]>(
    `SELECT changed_at, changed_by, old_status, new_status, notes FROM bym.bug_report_change
      WHERE bug_report_id = ? ORDER BY changed_at, id`,
    [id]
  );
  const { preview: _preview, ...summary } = summaryOf(row);
  return {
    ...summary,
    message: row.message,
    contactEmail: row.contact_email,
    userAgent: row.user_agent,
    screenSize: row.screen_size,
    errors: errorsOf(row.errors),
    screenshotType: row.screenshot_type,
    pictureType: row.picture_type,
    emailedAt: iso(row.emailed_at),
    browser: browserSummary(row.user_agent),
    ownerNotes: row.owner_notes,
    notesChangedAt: iso(row.notes_changed_at),
    changes: changes.map(changeOf),
    thread: row.mail_thread_id === null ? [] : await readSupportThread(em, Number(row.mail_thread_id)),
    cannotReply: await noReplyReason(em, summary.userid),
    awards: await awardsForReport(em, id),
  };
};

export type BugReportImageKind = "screenshot" | "picture";

/** A report's screenshot or added picture, or null when it has none. */
export const getBugReportImage = async (
  em: EntityManager,
  id: number,
  kind: BugReportImageKind
): Promise<{ bytes: Buffer; type: string } | null> => {
  const column = kind === "screenshot" ? "screenshot" : "picture";
  const [row] = await em.execute<{ bytes: Buffer | Uint8Array | null; type: string | null }[]>(
    `SELECT ${column} AS bytes, ${column}_type AS type FROM bym.bug_report WHERE id = ?`,
    [id]
  );
  if (!row?.bytes || !row.type) return null;
  return { bytes: Buffer.from(row.bytes), type: row.type };
};

/** "Chrome 130 on Android": the browser and system a user agent names, without the rest of it. */
export const browserSummary = (userAgent: string): string => {
  // Most specific first: Edge, Opera and Samsung also say "Chrome", and Chrome also says "Safari".
  const browsers: [RegExp, string][] = [
    [/\bEdg(?:e|A|iOS)?\/(\d+)/, "Edge"],
    [/\bOPR\/(\d+)/, "Opera"],
    [/\bSamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/\b(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/\b(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
    [/\bVersion\/(\d+).*\bSafari\//, "Safari"],
  ];
  const systems: [RegExp, string][] = [
    [/\bAndroid\b/, "Android"],
    [/\biPhone\b/, "iOS"],
    [/\biPad\b/, "iPadOS"],
    [/\bWindows\b/, "Windows"],
    [/\bCrOS\b/, "ChromeOS"],
    [/\bMac OS X\b/, "macOS"],
    [/\bLinux\b/, "Linux"],
  ];
  let named = "unknown browser";
  for (const [pattern, name] of browsers) {
    const match = pattern.exec(userAgent);
    if (match) {
      named = `${name} ${match[1]}`;
      break;
    }
  }
  const system = systems.find(([pattern]) => pattern.test(userAgent))?.[1];
  return system ? `${named} on ${system}` : named;
};

export interface TicketUpdate {
  readonly status?: TicketStatus;
  /** The whole new notes (not an addition); cut to {@link MAX_OWNER_NOTES}. */
  readonly notes?: string;
}

/**
 * The body of a ticket change, `{ status?, notes? }`: at least one of them, a
 * known status, notes as text. Anything else in the body is ignored.
 */
export const parseTicketUpdate = (
  body: unknown
): { readonly ok: true; readonly value: TicketUpdate } | { readonly ok: false; readonly message: string } => {
  const raw = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const { status, notes } = raw;
  if (status !== undefined && !isTicketStatus(status)) {
    return { ok: false, message: `status must be one of ${TICKET_STATUSES.join(", ")}.` };
  }
  if (notes !== undefined && typeof notes !== "string") return { ok: false, message: "notes must be text." };
  if (status === undefined && notes === undefined) return { ok: false, message: "Send a status, notes, or both." };
  return { ok: true, value: { ...(status !== undefined && { status }), ...(notes !== undefined && { notes }) } };
};

/**
 * Changes report `id`'s ticket:its status, its notes, or both, as owner
 * `by`. Only what really changes is written, and each write is kept in
 * `bym.bug_report_change` with its time. Answers the report as it is
 * afterwards, or null when there is no such report.
 */
export const updateBugReportTicket = async (
  em: EntityManager,
  id: number,
  update: TicketUpdate,
  by: number
): Promise<BugReportDetail | null> => {
  const notes = update.notes === undefined ? undefined : update.notes.slice(0, MAX_OWNER_NOTES);
  const changed = await em.transactional(async (tx) => {
    const [row] = await tx.execute<{ status: string; owner_notes: string }[]>(
      `SELECT status, owner_notes FROM bym.bug_report WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!row) return null;
    const newStatus = update.status !== undefined && update.status !== row.status ? update.status : null;
    const newNotes = notes !== undefined && notes !== row.owner_notes ? notes : null;
    if (newStatus === null && newNotes === null) return false;
    await tx.execute(
      `UPDATE bym.bug_report SET
         status = COALESCE(?, status),
         status_changed_at = CASE WHEN ?::text IS NULL THEN status_changed_at ELSE now() END,
         owner_notes = COALESCE(?, owner_notes),
         notes_changed_at = CASE WHEN ?::text IS NULL THEN notes_changed_at ELSE now() END
       WHERE id = ?`,
      [newStatus, newStatus, newNotes, newNotes, id]
    );
    await tx.execute(
      `INSERT INTO bym.bug_report_change (bug_report_id, changed_by, old_status, new_status, notes) VALUES (?, ?, ?, ?, ?)`,
      [id, by, newStatus === null ? null : row.status, newStatus, newNotes]
    );
    return true;
  });
  if (changed === null) return null;
  if (changed) logger.info(`Dashboard: bug report ${id} ticket changed by ${by}`);
  return getBugReport(em, id);
};
