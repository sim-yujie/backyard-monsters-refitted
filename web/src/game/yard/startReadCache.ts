import { getAuthToken } from "@/api/http";

/**
 * What the yard's start-up reads last brought (beta 9, speed-ups item 6):
 * per yard kind and part (`main:goals`, `main:quests`, `inferno:goals`), the
 * view and the server's stamp of it. The next time the yard opens, the
 * stamp rides the first `state` call (`have`), and an unchanged view comes
 * back as `{ same: true }` instead of being sent again (`startReadOr`).
 *
 * In memory only, for one sign-in: a new session token empties it, so one
 * player never sees another's view, and a reload starts afresh.
 */

export interface CachedPart {
  readonly stamp: string;
  readonly report: unknown;
}

const entries = new Map<string, CachedPart>();
let owner: string | null = null;

/** Empties the cache when the session changed since it was filled. */
const own = (): void => {
  const token = getAuthToken();
  if (token === owner) return;
  entries.clear();
  owner = token;
};

export const cachedPart = (key: string): CachedPart | undefined => {
  own();
  return entries.get(key);
};

export const cachePart = (key: string, stamp: string, report: unknown): void => {
  own();
  if (owner === null) return;
  entries.set(key, { stamp, report });
};

/** For the tests. */
export const clearPartCache = (): void => {
  entries.clear();
  owner = null;
};
