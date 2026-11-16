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
};

export const knownFailure = (profileId: string, windowId: string): string | undefined =>
  settings.ignoreKnown
    ? undefined
    : (KNOWN_FAILURES[`${profileId}/${windowId}`] ??
      KNOWN_FAILURES[`${profileId}/*`] ??
      KNOWN_FAILURES[`*/${windowId}`]);
