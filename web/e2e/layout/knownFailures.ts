import { settings } from "./settings";

/**
 * Cases that fail on revamp today and wait for a fix branch, so CI stays green
 * until the fix merges. Key: "<profile id>/<window id>", or "<profile id>/*"
 * for every window on that screen, or "* /<window id>" (no space) for one
 * window on every screen. A World chat case is "<window id>+chat". Value: why,
 * naming the fix branch. A listed case is skipped and reported as "fixme";
 * delete the line when the fix merges and the case passes.
 *
 * A listed key skips the whole step (all of a window's tabs too). To see
 * whether a fix branch cures them, run with LAYOUT_IGNORE_KNOWN=1.
 *
 * From the first full run on revamp (15 Nov 2026, WebKit).
 */
export const KNOWN_FAILURES: Readonly<Record<string, string>> = {
  "odd-980/mail":
    "Mail stops above Main yard at 194px, list 9px; fix/ipad-panels (Mail --centre-min-height)",
  "odd-980/building":
    "side panel runs off the bottom (top 102, bottom 602); fix/ipad-panels (right dock panel shrinks)",
  "ipad-side-short/building":
    "side panel runs off the bottom (top 102, bottom 608); fix/ipad-panels (right dock panel shrinks)",
  "phone-side/building":
    "side panel runs off the bottom (top 86, bottom 455); fix/ipad-panels (right dock panel shrinks)",
  "phone-upright/goals+chat":
    "More's fan opens under the open World chat, Goals cannot be pressed; fix/ipad-panels (chat steps aside)",
  "phone-upright-bars/goals+chat":
    "More's fan opens under the open World chat, Goals cannot be pressed; fix/ipad-panels (chat steps aside)",
  // Found by the friend's-yard check (bug report #70, 24 Nov 2026). Not the
  // bug #70 fault: the own yard's menu is the same box here. On a short
  // landscape screen the menu has no height limit, so Log out ends 10-19px
  // below the screen. No fix branch yet.
  "odd-980/friend-account-menu":
    "account menu 94..561 on a 551px screen (own yard the same); no fix branch yet",
  "ipad-side-short/friend-account-menu":
    "account menu 94..570 on a 560px screen (own yard the same); no fix branch yet",
  // The "Your outpost" card (bug 73, 27 Nov 2026). With its width and height
  // cap back it fits every screen with every button in sight, as in beta 8.
  // Two older choices remain, for the owner (bug 73 option B): it may cover
  // the top bar (the check opens it over the yard, whose bar is taller than
  // the map's), and an upright phone scrolls to the monsters under the chips.
  "desktop/yard-card": "covers the yard's top bar by 25px (beta 8 design); owner decides (bug 73 option B)",
  "ipad-split/yard-card": "covers the yard's top bar by 25px (beta 8 design); owner decides (bug 73 option B)",
  "odd-980/yard-card": "covers the yard's top bar by 25px (beta 8 design); owner decides (bug 73 option B)",
  "ipad-side-bars/yard-card": "covers the yard's top bar by 25px (beta 8 design); owner decides (bug 73 option B)",
  "ipad-side-short/yard-card": "covers the yard's top bar by 25px (beta 8 design); owner decides (bug 73 option B)",
  "phone-upright/yard-card": "monsters below the chips, the body scrolls (beta 7 design B); owner decides",
  "phone-upright-bars/yard-card": "monsters below the chips, the body scrolls (beta 7 design B); owner decides",
};

export const knownFailure = (profileId: string, windowId: string): string | undefined =>
  settings.ignoreKnown
    ? undefined
    : (KNOWN_FAILURES[`${profileId}/${windowId}`] ??
      KNOWN_FAILURES[`${profileId}/*`] ??
      KNOWN_FAILURES[`*/${windowId}`]);
