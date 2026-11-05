import { apiUrl, get, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The owner's in-game announcements (server `controllers/announcements/routes.ts`):
 *
 *   GET  /api/:apiVersion/bm/announcements              the current ones, newest first
 *   POST /api/:apiVersion/bm/announcements/:id/dismiss  "Got it", kept per account
 *   POST /api/:apiVersion/bm/announcements/:id/claim    the gift's Shiny, once per account
 *   GET  /api/:apiVersion/announcements/images/:id      a picture, for an `<img src>`
 */

/** One current announcement as the game gets it. */
export interface Announcement {
  readonly id: number;
  readonly title: string;
  /** Plain text with line breaks; `http(s)://` addresses become links. */
  readonly body: string;
  readonly imageIds: readonly number[];
  /** When it became current, ISO. */
  readonly shownFrom: string;
  readonly endsAt: string | null;
  /** Whether it is done with for this player: "Got it" pressed, and any gift claimed. */
  readonly dismissed: boolean;
  /** The gift this player may claim; absent or 0 is none. */
  readonly shiny?: number;
  /** Whether this player claimed the gift. */
  readonly claimed?: boolean;
}

export interface AnnouncementList extends ApiEnvelope {
  readonly announcements: Announcement[];
}

export const fetchAnnouncements = (): Promise<AnnouncementList> =>
  get<AnnouncementList>("/api/:apiVersion/bm/announcements");

export const dismissAnnouncement = (id: number): Promise<ApiEnvelope> =>
  post(`/api/:apiVersion/bm/announcements/${id}/dismiss`);

export interface GiftClaim extends ApiEnvelope {
  readonly shiny: number;
  /** True when an earlier press gave it. */
  readonly already: boolean;
}

export const claimAnnouncementGift = (id: number): Promise<GiftClaim> =>
  post<GiftClaim>(`/api/:apiVersion/bm/announcements/${id}/claim`);

/** A published announcement's picture. */
export const announcementImageUrl = (id: number): string =>
  apiUrl(`/api/:apiVersion/announcements/images/${id}`);
