import type { EntityManager } from "@mikro-orm/postgresql";

import { AUTO_HIDE_REPORTS } from "../profile/profileRules.js";

/**
 * Reported profile photos on the owner's dashboard, beside the chat cases
 * (beta 7, grill Q28): every player whose photo has open reports is one
 * case, with the photo, who reported it and when, and whether it is hidden.
 * The owner keeps it (reports closed; this upload is not hidden by reports
 * again), removes it, or removes it and blocks the player from uploading.
 * A block can be lifted again. Tables: `20261112_CreatePlayerProfile.ts`.
 */

export type PhotoAction = "keep" | "remove" | "block" | "unblock";
export type PhotoOutcome = "kept" | "removed" | "blocked" | "replaced";

export interface PhotoReporter {
  userid: number;
  username: string | null;
  at: string;
  /** Which upload they reported: older than the photo shown means it was replaced since. */
  version: number;
}

export interface PhotoCase {
  userid: number;
  username: string | null;
  banned: boolean;
  /** The photo now, as a data URL, hidden or not; null when there is none. */
  photo: string | null;
  photoVersion: number;
  hidden: boolean;
  blocked: boolean;
  /** The owner kept this upload before. */
  kept: boolean;
  reporters: PhotoReporter[];
  /** Null when there are no reports (a block from a case already closed). */
  firstReportAt: string | null;
  lastReportAt: string | null;
  /** For a closed case: how and when it was closed. */
  closed: { outcome: PhotoOutcome; at: string; by: number | null; byName: string | null } | null;
}

export interface PhotoCaseList {
  cases: PhotoCase[];
  /** Players with open reports, in all. */
  open: number;
  nextOffset: number | null;
  /** Reports from this many players hide a photo. */
  hideAt: number;
}

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 30;

const iso = (value: Date | string): string => new Date(value).toISOString();

interface ProfileRow {
  userid: number | string;
  username: string | null;
  banned: boolean | null;
  photo: Buffer | Uint8Array | null;
  photo_version: number | null;
  photo_hidden: boolean | null;
  photo_kept_version: number | null;
  upload_blocked: boolean | null;
}

const profilesOf = async (em: EntityManager, ids: readonly number[]): Promise<Map<number, ProfileRow>> => {
  if (ids.length === 0) return new Map();
  const rows = await em.execute<ProfileRow[]>(
    `SELECT u.userid, u.username, u.banned, p.photo, p.photo_version, p.photo_hidden, p.photo_kept_version, p.upload_blocked
       FROM bym."user" u LEFT JOIN bym.player_profile p ON p.userid = u.userid
      WHERE u.userid IN (${ids.map(() => "?").join(", ")})`,
    [...ids],
  );
  return new Map(rows.map((row) => [Number(row.userid), row]));
};

interface ReportRow {
  reported_id: number | string;
  reporter_id: number | string;
  reporter_name: string | null;
  photo_version: number;
  created_at: Date | string;
  resolved_at: Date | string | null;
  outcome: PhotoOutcome | null;
  resolved_by: number | null;
  resolver_name: string | null;
}

const caseOf = (userid: number, profile: ProfileRow | undefined, reports: ReportRow[], closed: boolean): PhotoCase => {
  const version = Number(profile?.photo_version ?? 0);
  const first = reports[0];
  const last = reports[reports.length - 1];
  return {
    userid,
    username: profile?.username ?? null,
    banned: profile?.banned === true,
    photo: profile?.photo ? `data:image/jpeg;base64,${Buffer.from(profile.photo).toString("base64")}` : null,
    photoVersion: version,
    hidden: profile?.photo_hidden === true && profile.photo !== null,
    blocked: profile?.upload_blocked === true,
    kept: profile?.photo_kept_version !== null && profile?.photo_kept_version !== undefined && Number(profile.photo_kept_version) === version,
    reporters: reports.map((report) => ({
      userid: Number(report.reporter_id),
      username: report.reporter_name,
      at: iso(report.created_at),
      version: Number(report.photo_version),
    })),
    firstReportAt: first ? iso(first.created_at) : null,
    lastReportAt: last ? iso(last.created_at) : null,
    closed:
      closed && last?.resolved_at && last.outcome
        ? { outcome: last.outcome, at: iso(last.resolved_at), by: last.resolved_by, byName: last.resolver_name }
        : null,
  };
};

const REPORT_COLUMNS = `r.reported_id, r.reporter_id, ru.username AS reporter_name, r.photo_version, r.created_at,
       r.resolved_at, r.outcome, r.resolved_by, au.username AS resolver_name`;
const REPORT_JOINS = `LEFT JOIN bym."user" ru ON ru.userid = r.reporter_id LEFT JOIN bym."user" au ON au.userid = r.resolved_by`;

/**
 * The open cases (hidden photos first, then the latest report first), or the
 * closed ones (latest closed first), a page at a time.
 */
export const listPhotoCases = async (
  em: EntityManager,
  options: { status: "open" | "closed"; offset?: number | undefined; limit?: number | undefined },
): Promise<PhotoCaseList> => {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);
  const [{ n: open } = { n: 0 }] = await em.execute<{ n: number | string }[]>(
    `SELECT count(DISTINCT reported_id) AS n FROM bym.photo_report WHERE resolved_at IS NULL`,
  );

  // One case per player (open) or per player and closing (closed).
  const keys =
    options.status === "open"
      ? await em.execute<{ reported_id: number | string; resolved_at: null }[]>(
          `SELECT r.reported_id, NULL AS resolved_at
             FROM bym.photo_report r LEFT JOIN bym.player_profile p ON p.userid = r.reported_id
            WHERE r.resolved_at IS NULL
            GROUP BY r.reported_id, p.photo_hidden
            ORDER BY coalesce(p.photo_hidden, false) DESC, max(r.created_at) DESC, r.reported_id
            LIMIT ? OFFSET ?`,
          [limit + 1, offset],
        )
      : await em.execute<{ reported_id: number | string; resolved_at: Date | string }[]>(
          `SELECT r.reported_id, r.resolved_at
             FROM bym.photo_report r
            WHERE r.resolved_at IS NOT NULL
            GROUP BY r.reported_id, r.resolved_at
            ORDER BY r.resolved_at DESC, r.reported_id
            LIMIT ? OFFSET ?`,
          [limit + 1, offset],
        );
  const page = keys.slice(0, limit);
  const ids = [...new Set(page.map((key) => Number(key.reported_id)))];
  const profiles = await profilesOf(em, ids);

  const cases: PhotoCase[] = [];
  for (const key of page) {
    const userid = Number(key.reported_id);
    const reports =
      key.resolved_at === null
        ? await em.execute<ReportRow[]>(
            `SELECT ${REPORT_COLUMNS} FROM bym.photo_report r ${REPORT_JOINS}
              WHERE r.reported_id = ? AND r.resolved_at IS NULL ORDER BY r.created_at, r.id`,
            [userid],
          )
        : await em.execute<ReportRow[]>(
            `SELECT ${REPORT_COLUMNS} FROM bym.photo_report r ${REPORT_JOINS}
              WHERE r.reported_id = ? AND r.resolved_at = ? ORDER BY r.created_at, r.id`,
            [userid, key.resolved_at],
          );
    if (reports.length === 0) continue;
    const profile = profiles.get(userid);
    // A closed case shows the photo only while it is still the one reported and up.
    const shown =
      key.resolved_at !== null && profile && Number(profile.photo_version) !== Number(reports[reports.length - 1]!.photo_version)
        ? { ...profile, photo: null }
        : profile;
    cases.push(caseOf(userid, shown, reports, key.resolved_at !== null));
  }
  return {
    cases,
    open: Number(open),
    nextOffset: keys.length > limit ? offset + limit : null,
    hideAt: AUTO_HIDE_REPORTS,
  };
};

/** One player's open case; with no open reports, the case with none (after a step closed them). */
const openCaseOf = async (em: EntityManager, userid: number): Promise<PhotoCase | null> => {
  const profile = (await profilesOf(em, [userid])).get(userid);
  if (!profile) return null;
  const reports = await em.execute<ReportRow[]>(
    `SELECT ${REPORT_COLUMNS} FROM bym.photo_report r ${REPORT_JOINS}
      WHERE r.reported_id = ? AND r.resolved_at IS NULL ORDER BY r.created_at, r.id`,
    [userid],
  );
  return caseOf(userid, profile, reports, false);
};

export const parsePhotoAction = (body: unknown): { ok: true; value: PhotoAction } | { ok: false; message: string } => {
  const action = (body as { action?: unknown } | undefined)?.action;
  return action === "keep" || action === "remove" || action === "block" || action === "unblock"
    ? { ok: true, value: action }
    : { ok: false, message: "Say keep, remove, block or unblock." };
};

/**
 * The owner's step on one player's photo. `keep`: shown again, the open
 * reports closed, and this upload no longer hidden by reports. `remove`: the
 * photo deleted (their critter shows), reports closed. `block`: removed, and
 * no more uploads. `unblock`: uploads allowed again.
 */
export const actOnPhoto = async (
  em: EntityManager,
  userid: number,
  action: PhotoAction,
  admin: number,
  now: Date = new Date(),
): Promise<{ outcome: "done"; case: PhotoCase } | { outcome: "notFound" }> => {
  const [player] = await em.execute<{ userid: number }[]>(`SELECT userid FROM bym."user" WHERE userid = ?`, [userid]);
  if (!player) return { outcome: "notFound" };

  await em.transactional(async (tx) => {
    // Every step works on the profile row, which a block may need to make.
    await tx.execute(
      `INSERT INTO bym.player_profile (userid, bio, photo_version, photo_hidden, upload_blocked, updated_at)
       VALUES (?, '', 0, false, false, now()) ON CONFLICT (userid) DO NOTHING`,
      [userid],
    );
    let outcome: PhotoOutcome | null = null;
    if (action === "keep") {
      await tx.execute(
        `UPDATE bym.player_profile SET photo_hidden = false, photo_kept_version = photo_version, updated_at = now() WHERE userid = ?`,
        [userid],
      );
      outcome = "kept";
    } else if (action === "remove" || action === "block") {
      await tx.execute(
        `UPDATE bym.player_profile SET photo = NULL, photo_hidden = false, upload_blocked = (upload_blocked OR ?), updated_at = now()
          WHERE userid = ?`,
        [action === "block", userid],
      );
      outcome = action === "block" ? "blocked" : "removed";
    } else {
      await tx.execute(`UPDATE bym.player_profile SET upload_blocked = false, updated_at = now() WHERE userid = ?`, [userid]);
    }
    if (outcome) {
      await tx.execute(
        `UPDATE bym.photo_report SET resolved_at = ?, outcome = ?, resolved_by = ? WHERE reported_id = ? AND resolved_at IS NULL`,
        [now, outcome, admin, userid],
      );
    }
  });

  const view = await openCaseOf(em, userid);
  return view ? { outcome: "done", case: view } : { outcome: "notFound" };
};
