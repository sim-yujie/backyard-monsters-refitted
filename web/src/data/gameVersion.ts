/**
 * The full version this build goes live as, patch number included: what Map
 * Room 2's open timings report (`app/mr2TimingReport.ts`). The changelog's
 * `LATEST_RELEASE.version` names only the release whose "What's new" cards
 * pop up ("2.0.0-beta.6"), so every timing from a patch said the same.
 *
 * Raise it with each release or patch, to the name of its notes file in
 * docs/releases (v2.0.0-beta.6.8.md is "2.0.0-beta.6.8"). The game page is
 * built on Vercel from web/ alone, so it cannot read docs/ or the git tag at
 * build time; `gameVersion.test.ts` fails when docs/releases has a newer
 * version than this.
 */
export const GAME_VERSION = "2.0.0-beta.6.11";
