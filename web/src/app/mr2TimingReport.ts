import { getAuthToken, postJson } from "@/api/http";
import type { ApiEnvelope } from "@/api/types";
import { GAME_VERSION } from "@/data/gameVersion";
import { setOpenTimingSender } from "@/game/maproom/openMarks";
import type { CompactRecord } from "@/game/maproom/openTimingSummary";

/**
 * Sends how long Map Room 2 took to open to the server (owner, 7 Nov 2026:
 * yes to logging real players' MR2 open timings). The server writes each one
 * as a log line, nothing else (`server/src/controllers/maproom/clientTiming.ts`).
 *
 * `openMarks.ts` hands over at most one record for the first open and one for
 * a later open per page load. Sending is fire-and-forget: it never waits,
 * never throws and never shows the player anything; a failed send is dropped.
 */
const TIMING_PATH = "/api/:apiVersion/clienttiming";

export type TimingPost = (path: string, body: Record<string, unknown>) => Promise<unknown>;

const defaultPost: TimingPost = (path, body) => postJson<ApiEnvelope>(path, body);

/** Posts one record when signed in; never throws. */
export const sendMr2Timing = (record: CompactRecord, post: TimingPost = defaultPost): void => {
  try {
    if (!getAuthToken()) return;
    void post(TIMING_PATH, { record, gameVersion: GAME_VERSION }).catch(() => {});
  } catch {
    // Timing must never break the map.
  }
};

/** Connects the sender; called each time Map Room 2 opens, before its first mark. */
export const connectMr2TimingReport = (post: TimingPost = defaultPost): void => {
  setOpenTimingSender((record) => sendMr2Timing(record, post));
};
