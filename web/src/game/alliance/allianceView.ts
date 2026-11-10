/**
 * The way into the alliance window from anywhere (the More menu's Alliance
 * button, the Observatory's panel, an accepted invite in the mail): the scene
 * that owns the window sets the opener while it is on screen, as the Friends
 * window's (`game/friends/friendsView.ts`).
 */

/** The window's pages (design v5 §7b); Trade comes with phase 3. */
export type AllianceTab = "overview" | "constellation" | "members" | "territory";

export type AllianceOpener = (tab?: AllianceTab) => void;

let opener: AllianceOpener | null = null;

/** Sets the opener; the function it gives back clears it again, if it is still this one. */
export const setAllianceOpener = (open: AllianceOpener | null): (() => void) => {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
};

/** The opener, or null where no scene has put one. */
export const allianceOpener = (): AllianceOpener | null => opener;
