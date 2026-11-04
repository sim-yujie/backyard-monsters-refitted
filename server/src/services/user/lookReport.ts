import type { EntityManager } from "@mikro-orm/postgresql";
import z from "zod";

import { User } from "../../database/models/user.model.js";

/**
 * Which look each player uses (owner, 4 Nov 2026: "can we log down which
 * players are using modern vs classic for beta6? would be nice to know").
 *
 * The web client keeps its Account settings ▸ Look and sound choices in the
 * browser only; it sends them here once per load and on every change
 * (`POST /player/look`). They go on the player's row (`user.look_*`) for the
 * owner's dashboard. The game never reads them back.
 */

export const LOOK_STYLES = ["modern", "classic"] as const;
export const LOOK_MUSIC = ["style", "new", "flash"] as const;
export const LOOK_QUALITIES = ["high", "medium", "low"] as const;
export const LOOK_FONTS = ["game", "clear", "readable"] as const;

export type LookStyle = (typeof LOOK_STYLES)[number];

/** The choices as the client sends them. Strict: an unknown key or value is refused. */
export const LookReportSchema = z
  .object({
    style: z.enum(LOOK_STYLES),
    music: z.enum(LOOK_MUSIC).optional(),
    quality: z.enum(LOOK_QUALITIES).optional(),
    font: z.enum(LOOK_FONTS).optional(),
  })
  .strict();

export type LookReport = z.infer<typeof LookReportSchema>;

/** An unchanged look is written again at most this often (so `look_seen_at` stays roughly current). */
export const LOOK_SEEN_INTERVAL_MS = 60 * 60 * 1000;

/** The row's columns for a report; a choice left out keeps what the row has. */
const columnsOf = (user: User, report: LookReport) => ({
  look_style: report.style,
  look_music: report.music ?? user.look_music ?? null,
  look_quality: report.quality ?? user.look_quality ?? null,
  look_font: report.font ?? user.look_font ?? null,
});

/**
 * Whether a report needs a write: a choice changed, or the last one is an
 * hour old (or there was none).
 */
export const lookNeedsWrite = (user: User, report: LookReport, now: Date): boolean => {
  const columns = columnsOf(user, report);
  const changed =
    columns.look_style !== (user.look_style ?? null) ||
    columns.look_music !== (user.look_music ?? null) ||
    columns.look_quality !== (user.look_quality ?? null) ||
    columns.look_font !== (user.look_font ?? null);
  const stale = !user.look_seen_at || now.getTime() - user.look_seen_at.getTime() >= LOOK_SEEN_INTERVAL_MS;
  return changed || stale;
};

/**
 * Stores a report on the player's row. A direct update, like
 * `services/user/lastSeen.ts`, so nothing else on the loaded entity is
 * flushed with it. Returns whether a row was written.
 */
export const recordLook = async (
  em: EntityManager,
  user: User,
  report: LookReport,
  now: Date = new Date(),
): Promise<boolean> => {
  if (!lookNeedsWrite(user, report, now)) return false;
  const columns = { ...columnsOf(user, report), look_seen_at: now };
  const written = await em.nativeUpdate(User, { userid: user.userid }, columns);
  // Keep the request's entity in step, so a later read in the same request agrees.
  Object.assign(user, columns);
  return written > 0;
};
