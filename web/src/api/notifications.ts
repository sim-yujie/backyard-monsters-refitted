import { get, post } from "./http";
import type { ApiEnvelope, CompletedJob } from "./types";

/**
 * The notification list's routes (#257, `server/src/controllers/notifications/notifications.ts`):
 * what the yard's catch-up finished, kept on the server for the bell.
 *
 * - `GET  /api/:apiVersion/bm/notifications`: the list, newest first (at
 *   most 20, none older than 7 days), and its unread count.
 * - `GET  /api/:apiVersion/bm/notifications/unread`: the unread count.
 * - `POST /api/:apiVersion/bm/notifications/read { id }`: marks one read.
 * - `POST /api/:apiVersion/bm/notifications/readall`: marks all read.
 *
 * The count also rides every yard answer and the own yard's load
 * (`notifications`), which is where the bell reads it between opens.
 */

const LIST_PATH = "/api/:apiVersion/bm/notifications";
const UNREAD_PATH = "/api/:apiVersion/bm/notifications/unread";
const READ_PATH = "/api/:apiVersion/bm/notifications/read";
const READ_ALL_PATH = "/api/:apiVersion/bm/notifications/readall";

/**
 * One notification: one kind of job a yard answer finished (`jobs`),
 * everything a yard load finished while the player was away (`away`), or an
 * achievement earned (`achievement`, #204: one unlock, or the backfill's
 * together, each entry `{ kind: "achievement", id, detail: { name, shiny,
 * backfill? } }`).
 */
export interface GameNotification {
  readonly id: number;
  readonly kind: "jobs" | "away" | "achievement";
  /** The outpost it is about; null for the main yard. */
  readonly baseid: string | null;
  /** Unix seconds it was written. */
  readonly at: number;
  readonly read: boolean;
  /** The catch-up's `completed` entries, as the yard answer carried them; an achievement's unlocks. */
  readonly jobs: readonly CompletedJob[];
}

interface ListResponse extends ApiEnvelope {
  notifications?: GameNotification[];
  unread?: number;
}

interface UnreadResponse extends ApiEnvelope {
  unread?: number;
}

/** Everything the bell asks the server, as one object a test can replace. */
export interface NotificationsApi {
  list(): Promise<{ notifications: GameNotification[]; unread: number }>;
  unread(): Promise<number>;
  /** Marks one read; the unread count after. */
  read(id: number): Promise<number>;
  /** Marks all read; the unread count after. */
  readAll(): Promise<number>;
}

const countOf = (response: UnreadResponse): number => Math.max(0, Math.floor(Number(response.unread) || 0));

export const notificationsApi: NotificationsApi = {
  async list() {
    const response = await get<ListResponse>(LIST_PATH);
    return { notifications: response.notifications ?? [], unread: countOf(response) };
  },
  async unread() {
    return countOf(await get<UnreadResponse>(UNREAD_PATH));
  },
  async read(id) {
    return countOf(await post<UnreadResponse>(READ_PATH, { id }));
  },
  async readAll() {
    return countOf(await post<UnreadResponse>(READ_ALL_PATH));
  },
};
