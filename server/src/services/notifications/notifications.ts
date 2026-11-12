import type { EntityManager } from "@mikro-orm/core";
import { Notification, type NotificationKind } from "../../database/models/notification.model.js";
import { logger } from "../../utils/logger.js";
import { mutedSetOf, visibleEntries, type MutableCategory } from "./notificationCategories.js";

/**
 * The yard's notification list behind the bell (issue #257; owner decisions
 * 2026-10-04 on the issue).
 *
 * The yard used to announce what the catch-up finished with toasts: one per
 * kind of job in each yard answer, and one "While you were away" toast for
 * everything the owner's yard load finished (`web/src/ui/yard/JobNotices.ts`).
 * The same events are now written here instead, by the server, the moment the
 * catch-up finishes them, so they wait for the player on any device:
 *
 * - a yard answer (`yardRoute`) writes one `jobs` row per kind of job its
 *   catch-up finished, in the order each kind first finished, hatches left out
 *   (a busy yard hatches every few seconds; the toasts left them out too);
 * - the owner's build-mode `/base/load` writes one `away` row with everything
 *   its catch-up finished, hatches and the outpost and yard-attack notices
 *   included (`baseLoad.ts`).
 *
 * Each row keeps the catch-up's `completed` entries as they were, and the
 * client words them as the toasts did. `baseid` is the outpost they finished
 * on, null for the main yard, so a click selects a building only in its own
 * yard.
 *
 * The list keeps the newest {@link NOTIFICATION_LIMIT} per player and nothing
 * older than {@link NOTIFICATION_MAX_AGE_MS}: every write prunes, and every
 * read leaves out what is too old. Every query names the player, so no one
 * reads or marks another player's rows.
 *
 * **Categories turned off** (owner 11 Nov 2026, `notificationCategories.ts`,
 * `user.notifications_off`): a muted entry is still written but never shown.
 * The list and the bell's count leave out the muted entries of each row, and
 * a row with nothing left; a row written with nothing the player wants is
 * written already read, so it never lights the bell. Turning a category back
 * on brings its last week back into the list, quietly. The prune keeps the
 * newest 20 rows the player can see and, apart, the newest 20 they cannot,
 * so a noisy muted category never pushes the rows they want out of the list.
 * A player with nothing muted (the default) takes the plain queries below.
 */

/** The most rows a player keeps. */
export const NOTIFICATION_LIMIT = 20;

/** The oldest a row may be: 7 days. */
export const NOTIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The kind of a hatch entry (`catchUpMonsters.ts`), which a yard answer's toasts never showed. */
const HATCH = "hatch";

/** A `completed` entry, as far as the list reads one. */
export interface JobLike {
  kind: string;
}

/** One notification as the client gets it. */
export interface NotificationView {
  id: number;
  kind: NotificationKind;
  /** The outpost it is about; null for the main yard. */
  baseid: string | null;
  /** Unix seconds it was written. */
  at: number;
  read: boolean;
  jobs: unknown[];
}

/**
 * A yard answer's `completed` as rows: one list per kind, in the order each
 * kind first appears, hatches left out. Empty when nothing is left.
 */
export const liveBatches = (completed: readonly JobLike[]): JobLike[][] => {
  const byKind = new Map<string, JobLike[]>();
  for (const job of completed) {
    if (job.kind === HATCH) continue;
    const list = byKind.get(job.kind) ?? [];
    list.push(job);
    byKind.set(job.kind, list);
  }
  return [...byKind.values()];
};

/** A load's `completed` as rows: all of it in one, or none when it is empty. */
export const awayBatches = (completed: readonly JobLike[]): JobLike[][] =>
  completed.length === 0 ? [] : [[...completed]];

const cutoffOf = (now: Date): Date => new Date(now.getTime() - NOTIFICATION_MAX_AGE_MS);

/**
 * The categories the player turned off (`user.notifications_off`): none for
 * a player who never changed it, or a row that is not there.
 */
export const mutedCategories = async (em: EntityManager, userid: number): Promise<ReadonlySet<MutableCategory>> => {
  const rows: unknown = await em
    .getConnection()
    .execute(`SELECT "notifications_off" FROM "bym"."user" WHERE "userid" = ?`, [userid]);
  const first = Array.isArray(rows) ? (rows[0] as { notifications_off?: unknown } | undefined) : undefined;
  return mutedSetOf(first?.notifications_off);
};

/** Whether a row shows anything once the muted entries are left out; a row with no entries always shows. */
const showsAnything = (kind: string, jobs: unknown, muted: ReadonlySet<string>): boolean => {
  const entries = Array.isArray(jobs) ? jobs : [];
  return entries.length === 0 || visibleEntries(kind, entries, muted).length > 0;
};

/**
 * Drops the player's rows older than 7 days and all but their newest 20; with
 * categories turned off, all but the newest 20 they can see and the newest 20
 * they cannot.
 *
 * @param em - Any entity manager; the deletes run as they are called.
 * @param muted - The player's muted categories, when the caller has read them.
 */
export const pruneNotifications = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
  muted?: ReadonlySet<string>,
): Promise<void> => {
  await em.nativeDelete(Notification, { userid, created_at: { $lt: cutoffOf(now) } });
  const off = muted ?? (await mutedCategories(em, userid));
  if (off.size > 0) {
    const found: unknown = await em.getConnection().execute(
      `SELECT "id", "kind", "jobs" FROM "bym"."notification" WHERE "userid" = ? ORDER BY "created_at" DESC, "id" DESC`,
      [userid],
    );
    const rows = (Array.isArray(found) ? found : []) as { id: number | string; kind: string; jobs: unknown }[];
    let shown = 0;
    let hidden = 0;
    const drop: number[] = [];
    for (const row of rows) {
      const kept = showsAnything(row.kind, row.jobs, off) ? ++shown : ++hidden;
      if (kept > NOTIFICATION_LIMIT) drop.push(Number(row.id));
    }
    if (drop.length > 0) await em.nativeDelete(Notification, { userid, id: { $in: drop } });
    return;
  }
  await em.getConnection().execute(
    `DELETE FROM "bym"."notification"
      WHERE "userid" = ?
        AND "id" NOT IN (
          SELECT "id" FROM "bym"."notification"
           WHERE "userid" = ?
           ORDER BY "created_at" DESC, "id" DESC
           LIMIT ?
        )`,
    [userid, userid, NOTIFICATION_LIMIT],
  );
};

/**
 * Writes one row per batch, then prunes. Nothing for no batches. A batch with
 * nothing the player wants (every entry in a category they turned off) is
 * written already read, so it never lights the bell.
 *
 * @param baseid - The outpost the jobs finished on; null for the main yard.
 * @param muted - The player's muted categories, when the caller has read them.
 */
export const recordNotifications = async (
  em: EntityManager,
  userid: number,
  baseid: string | null,
  kind: NotificationKind,
  batches: readonly (readonly unknown[])[],
  now: Date = new Date(),
  muted?: ReadonlySet<string>,
): Promise<void> => {
  if (batches.length === 0) return;
  const off = muted ?? (await mutedCategories(em, userid));
  await em.insertMany(
    Notification,
    batches.map((jobs) => ({
      userid,
      baseid,
      kind,
      jobs: [...jobs],
      read_at: showsAnything(kind, jobs, off) ? null : now,
      created_at: now,
    })),
  );
  await pruneNotifications(em, userid, now, off);
};

/** A row as the player sees it: the muted entries left out, or null when nothing is left. */
export const shownView = (view: NotificationView, muted: ReadonlySet<string>): NotificationView | null => {
  if (muted.size === 0 || view.jobs.length === 0) return view;
  const jobs = visibleEntries(view.kind, view.jobs, muted);
  return jobs.length === 0 ? null : { ...view, jobs };
};

/**
 * The player's notifications, newest first: at most 20, none older than 7
 * days, the categories they turned off left out.
 *
 * @param muted - The player's muted categories, when the caller has read them.
 */
export const listNotifications = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
  muted?: ReadonlySet<string>,
): Promise<NotificationView[]> => {
  const off = muted ?? (await mutedCategories(em, userid));
  const rows = await em.find(
    Notification,
    { userid, created_at: { $gte: cutoffOf(now) } },
    // With nothing muted the newest 20 are the list; otherwise every row is
    // read (the prune keeps at most 40) and the shown 20 picked from them.
    { orderBy: { created_at: "DESC", id: "DESC" }, ...(off.size === 0 && { limit: NOTIFICATION_LIMIT }) },
  );
  const views = rows.map(notificationView);
  if (off.size === 0) return views;
  return views
    .map((view) => shownView(view, off))
    .filter((view): view is NotificationView => view !== null)
    .slice(0, NOTIFICATION_LIMIT);
};

/** How many of the player's listed notifications are unread. */
export const unreadNotificationCount = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
  muted?: ReadonlySet<string>,
): Promise<number> => {
  const off = muted ?? (await mutedCategories(em, userid));
  if (off.size > 0) return (await listNotifications(em, userid, now, off)).filter((view) => !view.read).length;
  const unread = await em.count(Notification, { userid, read_at: null, created_at: { $gte: cutoffOf(now) } });
  return Math.min(unread, NOTIFICATION_LIMIT);
};

/**
 * Marks one of the player's notifications read; another player's id, or one
 * already read, changes nothing.
 */
export const markNotificationRead = async (
  em: EntityManager,
  userid: number,
  id: number,
  now: Date = new Date(),
): Promise<void> => {
  await em.nativeUpdate(Notification, { id, userid, read_at: null }, { read_at: now });
};

/** Marks every one of the player's notifications read. */
export const markAllNotificationsRead = async (
  em: EntityManager,
  userid: number,
  now: Date = new Date(),
): Promise<void> => {
  await em.nativeUpdate(Notification, { userid, read_at: null }, { read_at: now });
};

/** A row as the client gets it. */
export const notificationView = (row: Notification): NotificationView => ({
  id: Number(row.id),
  kind: row.kind,
  baseid: row.baseid ?? null,
  at: Math.floor(new Date(row.created_at).getTime() / 1000),
  read: row.read_at != null,
  jobs: Array.isArray(row.jobs) ? row.jobs : [],
});

/**
 * Writes what a catch-up finished and returns the player's unread count, for
 * the answer to carry to the bell. Never throws: the yard's answer matters
 * more than its notifications, so a failure is logged and the count left out.
 * Run it after the yard's transaction has committed, never inside it (a failed
 * statement would abort the yard's transaction with it).
 *
 * @returns The unread count, or undefined when the list could not be read.
 */
export const notifyAndCount = async (
  em: EntityManager,
  userid: number,
  baseid: string | null,
  kind: NotificationKind,
  completed: readonly JobLike[],
): Promise<number | undefined> => {
  try {
    const now = new Date();
    const batches = kind === "away" ? awayBatches(completed) : liveBatches(completed);
    const muted = await mutedCategories(em, userid);
    await recordNotifications(em, userid, baseid, kind, batches, now, muted);
    return await unreadNotificationCount(em, userid, now, muted);
  } catch (err) {
    logger.warn("Notifications for user {userid} failed: {error}", {
      userid,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
};
