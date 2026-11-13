import { quietLogin } from "@/game/quietLogin";
import { checkInWeekendMessage, refreshWeekend } from "@/api/weekend";
import {
  announcedWeekend,
  currentWeekend,
  onWeekendChange,
  runningWeekend,
  weekendCheckin,
  weekendNow,
  type WeekendRun,
  type WeekendState,
} from "@/game/weekend";
import { openWeekendPopup } from "@/ui/events/weekendUi";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";
import { screenBusy } from "./announcements";

/**
 * Own-yard plugin for the weekend event (`game/weekend.ts`):
 *
 * - no banner on the yard (owner, 13 Nov 2026: "Put under events rather than
 *   obstructing the screen"): the running event is a card on the Events page
 *   (`game/yard/plugins/events.ts`), the next one under its Coming up;
 * - the pop-up once per run on this device: on Friday when it is announced,
 *   or when the player first comes in while it runs (ASSUMED: one pop-up per
 *   weekend is enough; the Events card says the rest), once nothing else has
 *   the screen;
 * - a fresh `GET /bm/weekend` every 10 minutes and just after each
 *   boundary (announce, start, end), so a dashboard swap reaches open yards.
 */

const REFRESH_MS = 10 * 60_000;
const WAIT_MS = 2_000;
/** Where the last run's pop-up shown on this device is remembered. */
export const WEEKEND_SEEN_KEY = "bymr.weekend.seen";

const seenKey = (): string | null => {
  try {
    return localStorage.getItem(WEEKEND_SEEN_KEY);
  } catch {
    return null;
  }
};

const markSeen = (key: string): void => {
  try {
    localStorage.setItem(WEEKEND_SEEN_KEY, key);
  } catch {
    // Private mode: the pop-up may come back next visit, which is harmless.
  }
};

/** The run the pop-up should show at `now`, or null: announced or running, and not seen here. */
export const popupRun = (now: number, state: WeekendState, seen: string | null): WeekendRun | null => {
  const run = runningWeekend(now, state) ?? announcedWeekend(now, state);
  return run && run.key !== seen ? run : null;
};

export const weekendPlugin: YardPlugin = (mounts) => {
  const { overlay, store } = mounts;
  // On every own yard: the Inferno has upgrades and tribes too.
  let stopped = false;
  let popupOpen = false;
  let waitTimer: number | undefined;
  let edgeTimer: number | undefined;

  const openPopup = (run: WeekendRun): void => {
    if (popupOpen) return;
    popupOpen = true;
    markSeen(run.key);
    openWeekendPopup({
      container: overlay.modal,
      run,
      now: weekendNow(),
      // The check-in is a main-yard action; elsewhere the pop-up says so.
      ...(store.kind === "main" && { onCheckIn: () => checkInWeekendMessage(store) }),
      onClose: () => {
        popupOpen = false;
      },
    });
  };

  const maybePopup = (): void => {
    window.clearTimeout(waitTimer);
    // A test server's quiet login: no pop-up by itself; the Events card still opens it.
    if (stopped || popupOpen || quietLogin()) return;
    const run = popupRun(weekendNow(), currentWeekend(), seenKey());
    if (!run) return;
    if (screenBusy(mounts)) {
      waitTimer = window.setTimeout(maybePopup, WAIT_MS);
      return;
    }
    openPopup(run);
  };

  /** Re-asks the server just after the next start, end or announcement. */
  const scheduleEdge = (): void => {
    window.clearTimeout(edgeTimer);
    const now = weekendNow();
    const { active, next } = currentWeekend();
    // The next check-in day too, so the Events badge and card hear it from the server.
    const nextDay = weekendCheckin(active, now)?.nextAt;
    const edges = [active?.endsAt, next?.announceAt, next?.startsAt, next?.endsAt, nextDay].filter(
      (t): t is number => typeof t === "number" && t > now,
    );
    if (edges.length === 0) return;
    const ms = Math.min((Math.min(...edges) - now) * 1000 + 2_000, REFRESH_MS);
    edgeTimer = window.setTimeout(() => void refresh(), ms);
  };

  const refresh = async (): Promise<void> => {
    try {
      await refreshWeekend();
    } catch {
      // Offline or refused: keep what the yard load said.
    }
    if (stopped) return;
    scheduleEdge();
    maybePopup();
  };

  const stopChange = onWeekendChange(() => {
    scheduleEdge();
    maybePopup();
  });
  const poll = window.setInterval(() => void refresh(), REFRESH_MS);

  scheduleEdge();
  maybePopup();

  return () => {
    stopped = true;
    window.clearTimeout(waitTimer);
    window.clearTimeout(edgeTimer);
    window.clearInterval(poll);
    stopChange();
  };
};

YARD_PLUGINS.push(weekendPlugin);
