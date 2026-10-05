/**
 * The way to the achievements screen, for the unlock pop-up's View button
 * (`docs/design/achievements.md` §10.1, §10.2, issue #204).
 *
 * The screen (WP5) registers how to open itself while it can be opened, and
 * clears it when it goes; the pop-up shows View only while one is set. Kept
 * apart so the pop-up (WP6) and the screen build without touching each other.
 */

let opener: (() => void) | null = null;

/** Sets how to open the screen; null when it cannot be opened. Returns an undo for that opener. */
export const setAchievementsOpener = (open: (() => void) | null): (() => void) => {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
};

/** How to open the screen now, or null. */
export const achievementsOpener = (): (() => void) | null => opener;
