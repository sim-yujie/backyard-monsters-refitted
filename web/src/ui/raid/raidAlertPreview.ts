import { RaidAlert, type RaidAlertRaid } from "./RaidScreens";

/**
 * The layout check's way to the WILD MONSTER ALERT (web/e2e/layout) at its
 * busiest, and the pictures' way to every champion at every level: the real
 * alert with a fixed beta 10 raid (Threat 14, 4 sides, a champion, three
 * monster cards and "+N more"), with no server and nothing run. Installed as
 * `window.__raidAlert(champion, level)` in a dev build or one built with
 * VITE_LAYOUT_CHECK=1, never in a release build. Returns its close.
 */

/** Abunakki at threat 14 with Vorgs and Zafreetis: more types than the three cards. */
const BUSY_RAID: Omit<RaidAlertRaid, "champion"> = {
  id: "preview-raid",
  tribe: "Abunakki",
  monsters: { C6: 160, C9: 45, C15: 6, C16: 14, C12: 22, C2: 9 },
  threat: 14,
  sides: 4,
};

/** Seconds left on the alert's clock: a 4:25 that does not tick. */
const SECONDS_LEFT = 265;

export const previewRaidAlert = (modal: HTMLElement, champion = 3, level = 3): (() => void) => {
  const alert = new RaidAlert(
    { ...BUSY_RAID, champion: { t: champion, l: level } },
    { onEngage: () => undefined, onPrepare: () => undefined },
  ).mount(modal);
  alert.update(SECONDS_LEFT, null);
  return () => alert.close();
};
