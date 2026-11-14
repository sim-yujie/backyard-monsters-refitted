/**
 * The signed-in player's own profile photo, for the account badge in the top
 * right (beta 7 fix, 13 Nov 2026: an uploaded photo never reached the badge,
 * which kept showing the critter).
 *
 * The photo is fetched once per page and kept here, so a HUD made again on
 * each screen does not ask again. The Profile window records every own
 * profile it shows (load, upload, remove), and each watcher hears the new
 * address at once.
 */

import { fetchProfile, photoUrl, type Profile } from "./profile";

type Listener = (url: string | null) => void;

let known: { readonly userid: number; readonly url: string | null } | null = null;
let loading: number | null = null;
const listeners = new Set<Listener>();

/** The photo's address on `profile`, or null when there is none to show. */
export const photoOf = (profile: Profile): string | null =>
  profile.photoVersion === null ? null : photoUrl(profile.userid, profile.photoVersion);

/** Records the player's own profile and tells every watcher. */
export const recordOwnProfile = (profile: Profile): void => {
  known = { userid: profile.userid, url: photoOf(profile) };
  for (const listener of listeners) listener(known.url);
};

/**
 * Calls `listener` with `userid`'s photo address (null for none) now if it is
 * known, else once it is fetched, and again whenever it changes. Returns the
 * way to stop.
 */
export const watchOwnPhoto = (userid: number, listener: Listener): (() => void) => {
  listeners.add(listener);
  if (known?.userid === userid) listener(known.url);
  else if (loading !== userid) {
    loading = userid;
    void fetchProfile(userid)
      .then((profile) => {
        if (profile.own) recordOwnProfile(profile);
      })
      .catch(() => undefined)
      .finally(() => {
        if (loading === userid) loading = null;
      });
  }
  return () => listeners.delete(listener);
};

/** Forgets the photo, for a test. */
export const resetOwnPhoto = (): void => {
  known = null;
  loading = null;
  listeners.clear();
};
