import { dismissAnnouncement, fetchAnnouncements } from "@/api/announcements";
import { AnnouncementQueue, guideRunning } from "@/game/announcements/announcementQueue";
import { openAnnouncement } from "@/ui/announcements/AnnouncementDialog";
import { isPopupOver } from "@/ui/Popup";
import { YARD_PLUGINS, type YardMounts, type YardPlugin } from "../yardPlugins";

/**
 * Own-yard plugin for the owner's announcements
 * (`game/announcements/announcementQueue.ts`): after the yard loads, each
 * current one the player has not pressed "Got it" on pops up, one at a time,
 * once nothing else has the screen.
 */

/** Whether Bob is talking: the guided start, Help's tour of it, or a tip. */
const bobTalking = (): boolean =>
  [...document.querySelectorAll<HTMLElement>(".guide-bob")].some(
    (bubble) => !bubble.hidden && bubble.isConnected,
  );

/** Whether something else has the screen: the guided start, a popup, Bob, the planner. */
export const screenBusy = (mounts: Pick<YardMounts, "store" | "scene">): boolean =>
  guideRunning(mounts.store.save.onboarding?.guide.state) ||
  isPopupOver(document.body) ||
  bobTalking() ||
  mounts.scene.plannerOpen();

export const announcementsPlugin: YardPlugin = (mounts) => {
  const queue = new AnnouncementQueue({
    load: async () => (await fetchAnnouncements()).announcements,
    dismiss: dismissAnnouncement,
    show: (item, step, closed) =>
      openAnnouncement({
        container: mounts.overlay.modal,
        announcement: item,
        step,
        onClose: closed,
      }),
    blocked: () => screenBusy(mounts),
    setTimer: (run, ms) => window.setTimeout(run, ms),
    clearTimer: (handle) => window.clearTimeout(handle as number),
  });
  void queue.start();
  return () => queue.stop();
};

YARD_PLUGINS.push(announcementsPlugin);
