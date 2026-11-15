/**
 * Cases that fail on revamp today and wait for a fix branch, so CI stays green
 * until the fix merges. Key: "<profile id>/<window id>", or "<profile id>/*"
 * for every window on that screen, or "* /<window id>" (no space) for one
 * window on every screen. Value: why, naming the fix branch. A listed case is
 * marked `test.fixme` (reported, not run); delete the line when the fix merges
 * and the case passes.
 *
 * Empty on purpose: the helper that wrote this check could not run a browser
 * (owner rule), so nothing has been seen failing yet. Fill it from the first
 * run, e.g.
 *   "ipad-side-short/build": "list collapses under the tabs; fix/ipad-panels",
 */
export const KNOWN_FAILURES: Readonly<Record<string, string>> = {};

export const knownFailure = (profileId: string, windowId: string): string | undefined =>
  KNOWN_FAILURES[`${profileId}/${windowId}`] ??
  KNOWN_FAILURES[`${profileId}/*`] ??
  KNOWN_FAILURES[`*/${windowId}`];
