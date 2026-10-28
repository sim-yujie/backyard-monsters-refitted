import { apiUrl, get, post } from "./http";
import type { ApiEnvelope } from "./types";

/**
 * The owner's in-game announcements (server `controllers/announcements/routes.ts`):
 *
 *   GET  /api/:apiVersion/bm/announcements              the current ones, newest first
 *   POST /api/:apiVersion/bm/announcements/:id/dismiss  "Got it", kept per account
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
  /** Whether this player pressed "Got it" on it already. */
  readonly dismissed: boolean;
}

export interface AnnouncementList extends ApiEnvelope {
  readonly announcements: Announcement[];
}

export const fetchAnnouncements = (): Promise<AnnouncementList> =>
  get<AnnouncementList>("/api/:apiVersion/bm/announcements");

export const dismissAnnouncement = (id: number): Promise<ApiEnvelope> =>
  post(`/api/:apiVersion/bm/announcements/${id}/dismiss`);

/** A published announcement's picture. */
export const announcementImageUrl = (id: number): string =>
  apiUrl(`/api/:apiVersion/announcements/images/${id}`);
