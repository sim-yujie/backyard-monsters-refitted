import { ApiError, get, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * A word from the game team (server `services/admin/moderation.ts`): a
 * warning or a chat pause shows as a pop-up in the yard until the player
 * closes it, and a ban is told at sign-in, in the player's own time.
 *
 * - `GET  /api/:apiVersion/bm/moderation/notice`: the oldest one not closed.
 * - `POST /api/:apiVersion/bm/moderation/notice/:id/seen`: closed.
 */

export interface ModerationNotice {
  readonly id: number;
  /** `warn`: a warning; `mute`: chat is paused until `until`. */
  readonly kind: "warn" | "mute";
  /** The game team's words. */
  readonly text: string;
  readonly until: string | null;
  readonly at: string;
}

interface NoticeResponse extends ApiEnvelope {
  notice?: ModerationNotice | null;
}

export const fetchModerationNotice = async (): Promise<ModerationNotice | null> =>
  (await get<NoticeResponse>("/api/:apiVersion/bm/moderation/notice")).notice ?? null;

export const seeModerationNotice = (id: number): Promise<ApiEnvelope> =>
  post(`/api/:apiVersion/bm/moderation/notice/${id}/seen`);

/** A time in the player's own clock: "Tue 10 Nov, 14:05". */
export const localWhen = (at: number | string): string =>
  new Date(at).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

/** What a banned player is told: until when (or for good) and why. */
export const banWords = (until: number | string | null, reason: string | null | undefined): string => {
  const when = until === null ? "for good" : `until ${localWhen(until)}`;
  const why = reason?.trim();
  return `Your account is banned ${when}.${why ? ` Reason: ${why}` : ""}`;
};

/**
 * The sign-in refusal for a ban from the game team, worded in the player's
 * own time; null for any other failure.
 */
export const banRefusal = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const data = caught.details?.data as { reason?: unknown; until?: unknown; banReason?: unknown } | undefined;
  if (data?.reason !== "banned") return null;
  const until = typeof data.until === "string" ? data.until : null;
  return banWords(until, typeof data.banReason === "string" ? data.banReason : null);
};
