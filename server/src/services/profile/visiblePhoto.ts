import type { EntityManager } from "@mikro-orm/postgresql";

/**
 * Whose uploaded photo other players may see (beta 7 fix, owner 13 Nov 2026:
 * "Other players should be able to see the profile picture i set!").
 *
 * The one rule, used by the Profile window, the photo's own address and every
 * list that shows a player's picture (map, leaderboard, friends, alliance,
 * Map Room 1, Inferno): a photo shows when there is one, it is not hidden by
 * reports or waiting for the owner's review, and the player is not banned.
 * A photo the owner removed or blocked is gone (`photo` is NULL), so it fails
 * the first test. Anything else shows the player's critter (`pic_square`).
 *
 * Lists send the visible photo's upload number (`photo`) beside `pic_square`;
 * the client builds the address from it (`/profile/photos/:userid?v=N`), so a
 * new photo is a new address. Null means "show the critter".
 */

/** What the rule needs from a `bym.player_profile` row (and its player). */
export interface PhotoFacts {
  readonly has_photo: boolean | null;
  readonly photo_hidden: boolean | null;
  readonly photo_version: number | string | null;
  readonly banned?: boolean | null;
}

/** The photo's upload number when others may see it, else null. */
export const visiblePhotoVersion = (facts: PhotoFacts | null | undefined): number | null => {
  if (!facts || facts.has_photo !== true || facts.photo_hidden === true || facts.banned === true) return null;
  const version = Number(facts.photo_version ?? 0);
  return Number.isFinite(version) ? version : null;
};

/**
 * The same rule in SQL, for `bym.player_profile` aliased `profile` joined to
 * `bym."user"` aliased `user`.
 */
export const visiblePhotoWhere = (profile = "p", user = "u"): string =>
  `${profile}.photo IS NOT NULL AND ${profile}.photo_hidden = false AND ${user}.banned = false`;

/**
 * For a query that already reads `bym."user"` as `user`: the join that brings
 * in its profile row as `profile`, and the column that reads the visible
 * photo's upload number as `photo` (NULL for the critter). One join per
 * query, never one lookup per player.
 */
export const photoJoin = (profile = "p", user = "u"): string =>
  `LEFT JOIN bym.player_profile ${profile} ON ${profile}.userid = ${user}.userid`;
export const photoColumn = (profile = "p", user = "u"): string =>
  `CASE WHEN ${visiblePhotoWhere(profile, user)} THEN ${profile}.photo_version END AS photo`;

/** A `photo` column as the driver gives it, as the number the client wants. */
export const photoOf = (value: number | string | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const version = Number(value);
  return Number.isFinite(version) ? version : null;
};

/** A list's player ids, as a Postgres int array. */
const intArray = (ids: Iterable<number>): string => {
  const unique = new Set<number>();
  for (const id of ids) if (Number.isSafeInteger(id) && id > 0) unique.add(id);
  return `{${[...unique].join(",")}}`;
};

/**
 * The visible photo of each of `userids` that has one: one query for the
 * whole list, never one per player. Players with no visible photo are left
 * out of the map.
 */
export const visiblePhotos = async (em: EntityManager, userids: Iterable<number>): Promise<Map<number, number>> => {
  const list = intArray(userids);
  if (list === "{}") return new Map();
  const rows = await em.execute<{ userid: number | string; photo_version: number | string }[]>(
    `SELECT p.userid, p.photo_version
       FROM bym.player_profile p
       JOIN bym."user" u ON u.userid = p.userid
      WHERE p.userid = ANY(?::int[]) AND ${visiblePhotoWhere("p", "u")}`,
    [list],
  );
  return new Map(rows.map((row) => [Number(row.userid), Number(row.photo_version)]));
};

/**
 * For a list whose rows keep a player's id long after it was written (the
 * Defences screen's attackers): each of `userids` whose account still exists,
 * with their visible photo's upload number or null for the critter. A player
 * who deleted their account is left out of the map, so their id is not sent.
 * One query for the whole list.
 */
export const playersAndPhotos = async (em: EntityManager, userids: Iterable<number>): Promise<Map<number, number | null>> => {
  const list = intArray(userids);
  if (list === "{}") return new Map();
  const rows = await em.execute<{ userid: number | string; photo: number | string | null }[]>(
    `SELECT u.userid, ${photoColumn("p", "u")}
       FROM bym."user" u
       ${photoJoin("p", "u")}
      WHERE u.userid = ANY(?::int[])`,
    [list],
  );
  return new Map(rows.map((row) => [Number(row.userid), photoOf(row.photo)]));
};

/**
 * Sets `photo` on each row from {@link visiblePhotos} (null for the critter),
 * in place, and returns the rows. `idOf` gives a row's player id (0 or less
 * for a row with no player, such as a tribe).
 */
export const addPhotos = async <T extends { photo?: number | null }>(
  em: EntityManager,
  rows: T[],
  idOf: (row: T) => number,
): Promise<T[]> => {
  if (rows.length === 0) return rows;
  const photos = await visiblePhotos(em, rows.map(idOf));
  for (const row of rows) row.photo = photos.get(idOf(row)) ?? null;
  return rows;
};
