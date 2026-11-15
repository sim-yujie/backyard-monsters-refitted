import { guideRunning } from "@/game/announcements/announcementQueue";
import { eventsFeed, eventsFeedClock } from "@/game/events/eventsFeed";
import { resetRows } from "@/game/resetClock";
import { currentWeekend } from "@/game/weekend";
import { ResetClock } from "@/ui/yard/ResetClock";
import { YARD_PLUGINS, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the reset clock (`ui/yard/ResetClock.ts`): the pill
 * beside Bob's floating "?", on every own yard (main, outpost, Inferno).
 *
 * - **Clock.** The events list's server clock (`serverClock`) once the Events
 *   button has read it, else the yard store's, which the server's
 *   `currenttime` corrects too: never the device's alone.
 * - **Rows.** The weekend event as the server last sent it, and the Krallen
 *   Hunt from the events list (read on the main yard only; an outpost opened
 *   first has no Krallen row until the main yard has been seen).
 * - **Hidden** while Bob's guided start runs, like the "?" itself.
 */
export const resetClockPlugin: YardPlugin = ({ store, overlay }) => {
  const clock = new ResetClock({
    now: () => eventsFeedClock()?.now() ?? store.now(),
    rows: (now) => resetRows(now, { weekend: currentWeekend(), events: eventsFeed() }),
  });
  const sync = (): void => clock.setHidden(guideRunning(store.save.onboarding?.guide.state));
  sync();
  const unsubscribe = store.subscribe(sync);
  overlay.content.append(clock.element);
  return () => {
    unsubscribe();
    clock.destroy();
  };
};

YARD_PLUGINS.push(resetClockPlugin);
