import type { EntityManager } from "@mikro-orm/postgresql";
import { GIFT_RESOURCES, type GiftResource } from "./giftRules.js";

/**
 * Gift wishes (issue #391, owner 6 Nov 2026): each player marks up to 3 of
 * the four gift resources they would like. A friend sending a gift sees the
 * wished ones first, with the wish marker; any gift can still be sent, and a
 * wished one earns nothing extra. Stored as a comma list on
 * `user.gift_wishes` (`r4,r1`), null for none.
 *
 * Ranked (owner, 7 Nov: "Some player just prefer twigs only, or goo only"):
 * the list's order is the order wanted, best first, and one wish alone means
 * "that one only". Wishes saved before this were kept in resource order and
 * read as that rank, so nothing needed moving.
 */

/** At most this many wishes. */
export const MAX_GIFT_WISHES = 3;

/**
 * The wishes in a stored value, best first: known resources only, each once,
 * in the order kept, at most {@link MAX_GIFT_WISHES}. Anything else reads as none.
 */
export const readWishes = (stored: string | null | undefined): GiftResource[] => {
  if (typeof stored !== "string" || stored === "") return [];
  const wishes: GiftResource[] = [];
  for (const part of stored.split(",")) {
    const key = part.trim() as GiftResource;
    if (GIFT_RESOURCES.includes(key) && !wishes.includes(key)) wishes.push(key);
    if (wishes.length >= MAX_GIFT_WISHES) break;
  }
  return wishes;
};

/** The value to store for `wishes` (already checked), keeping their order: null for none. */
export const storedWishes = (wishes: readonly GiftResource[]): string | null =>
  wishes.length > 0 ? [...new Set(wishes)].slice(0, MAX_GIFT_WISHES).join(",") : null;

/** The player's own wishes. */
export const wishesOf = async (em: EntityManager, userid: number): Promise<GiftResource[]> => {
  const [row] = await em.execute<{ gift_wishes: string | null }[]>(
    `SELECT gift_wishes FROM bym."user" WHERE userid = ?`,
    [userid]
  );
  return readWishes(row?.gift_wishes);
};

/** Stores the player's wishes and answers them as stored. */
export const setWishes = async (
  em: EntityManager,
  userid: number,
  wishes: readonly GiftResource[]
): Promise<GiftResource[]> => {
  const stored = storedWishes(wishes);
  await em.execute(`UPDATE bym."user" SET gift_wishes = ? WHERE userid = ?`, [stored, userid]);
  return readWishes(stored);
};
