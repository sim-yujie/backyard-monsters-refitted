import { BETA_4 } from "./beta4";
import { BETA_5 } from "./beta5";
import type { ChangelogRelease } from "./types";

export type { ChangelogCard, ChangelogRelease } from "./types";

/**
 * Every release's "What's new" cards, NEWEST FIRST. To add a release: make a
 * file beside this one (copy `beta4.ts`), put its pictures in
 * web/public/whats-new/, and add it at the top of this list. The first entry
 * is the one that pops up once for every player after the update.
 */
export const CHANGELOG: readonly ChangelogRelease[] = [BETA_5, BETA_4];

/** The newest release, the one that pops up. */
export const LATEST_RELEASE: ChangelogRelease | undefined = CHANGELOG[0];
