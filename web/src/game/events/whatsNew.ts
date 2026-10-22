import { markWhatsNewSeen } from "@/api/events";
import type { GuideState } from "@/api/types";
import { LATEST_RELEASE, type ChangelogRelease } from "@/data/changelog";

/**
 * When the "What's new" cards pop up by themselves: once, on the first visit
 * to the own yard after an update. The release a player has seen is kept on
 * the server (`GET /bm/events` `whatsNewSeen`, `POST /bm/whatsnew/seen`), so
 * it pops up once per player rather than once per device; this device's copy
 * only stands in when the server's cannot be read.
 *
 * A brand-new player still in Bob's guided start gets no pop-up: the update
 * news means nothing to them, and the guide must not be covered. Their copy
 * is marked seen quietly instead.
 */

const STORAGE_KEY = "bymr.whatsNewSeen";

/** This device's last seen release, or null. */
export const localSeen = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const rememberLocally = (version: string): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // Private windows and blocked storage: the server's record is the real one.
  }
};

export type WhatsNewDecision = "show" | "markSeen" | "none";

/**
 * What to do on a yard visit: `serverSeen` is the server's record (null when
 * it has none or could not be read), `deviceSeen` this device's.
 */
export const whatsNewDecision = (
  latest: Pick<ChangelogRelease, "version"> | undefined,
  serverSeen: string | null,
  deviceSeen: string | null,
  guide: GuideState | undefined,
): WhatsNewDecision => {
  if (!latest) return "none";
  const seen = serverSeen ?? deviceSeen;
  if (seen === latest.version) return "none";
  return guide === "pending" || guide === "active" ? "markSeen" : "show";
};

/** Records that the player has seen `version`, on the server and on this device. */
export const markSeen = async (
  version: string,
  send: (version: string) => Promise<unknown> = markWhatsNewSeen,
): Promise<void> => {
  rememberLocally(version);
  try {
    await send(version);
  } catch {
    // Not recorded on the server: this device's copy keeps it from popping again here.
  }
};

/** The release that pops up. */
export const latestRelease = (): ChangelogRelease | undefined => LATEST_RELEASE;
