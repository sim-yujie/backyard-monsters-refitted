import type { NotificationKind } from "../../database/models/notification.model.js";

/**
 * The bell's notification categories (owner, 11 Nov 2026, beta 7: "the
 * ability to configure what gets sent to a player's notifications. Maybe
 * categorise them and put in settings").
 *
 * Every entry the bell's list can show belongs to one category, read from the
 * row's kind and, for `jobs` and `away` rows, from each entry's own `kind`.
 * A player can turn a category off in Settings (`user.notifications_off`,
 * `/player/settings`); {@link GAME_NOTICES} cannot be turned off.
 *
 * To add a category (alliance events, say): add it to
 * {@link NOTIFICATION_CATEGORIES} with the row kind or job kinds it covers,
 * and give it a label and an icon in the web client
 * (`web/src/game/notifications/notificationCategories.ts`). Everything else
 * (the setting's schema, the list's filter, the prune) reads this list.
 */

/** A category the player can turn off. */
export const NOTIFICATION_CATEGORIES = [
  /** Someone attacked the yard, the Inferno yard or an outpost, or took an outpost. Also kept in the mailbox. */
  { id: "attacks", rowKinds: [], jobKinds: ["yardAttacked", "infernoAttacked", "outpostAttacked", "outpostTaken"] },
  /** A build, upgrade, fortification or repair finished. */
  { id: "buildings", rowKinds: [], jobKinds: ["build", "upgrade", "fortify", "repair"] },
  /** Monsters unlocked, trained, researched, hatched or culled; Chaos weapons; the champion hatching or starving. */
  {
    id: "monsters",
    rowKinds: [],
    jobKinds: ["unlock", "train", "research", "hatch", "cull", "queueRefund", "siege", "championHatch", "starve"],
  },
  /** A shop boost (Protection, an overdrive, Sharper Tools…) ran out. */
  { id: "boosts", rowKinds: [], jobKinds: ["storeItem"] },
  /** A friend request, a new friend, a gift, a friend's speed-up or repair help. */
  { id: "friends", rowKinds: ["friend"], jobKinds: [] },
  /** An achievement earned. */
  { id: "achievements", rowKinds: ["achievement"], jobKinds: [] },
] as const satisfies readonly {
  id: string;
  rowKinds: readonly NotificationKind[];
  jobKinds: readonly string[];
}[];

export type MutableCategory = (typeof NOTIFICATION_CATEGORIES)[number]["id"];

/**
 * What the game itself did to the yard and must say why: the Radio Tower
 * taken down and refunded, a Map Room added, the starter yard placed, and any
 * kind of entry this list does not know yet (so a new kind is never hidden by
 * accident). Always shown.
 */
export const GAME_NOTICES = "game";

export type NotificationCategory = MutableCategory | typeof GAME_NOTICES;

/** Every category a player can turn off, in the order Settings lists them. */
export const MUTABLE_CATEGORIES: readonly MutableCategory[] = NOTIFICATION_CATEGORIES.map((category) => category.id);

const byRowKind = new Map<string, MutableCategory>(
  NOTIFICATION_CATEGORIES.flatMap((category) => category.rowKinds.map((kind) => [kind, category.id] as const)),
);

const byJobKind = new Map<string, MutableCategory>(
  NOTIFICATION_CATEGORIES.flatMap((category) => category.jobKinds.map((kind) => [kind, category.id] as const)),
);

/** The category of one entry in a row of kind `rowKind`. */
export const categoryOf = (rowKind: string, entry: unknown): NotificationCategory => {
  const whole = byRowKind.get(rowKind);
  if (whole) return whole;
  const kind = (entry as { kind?: unknown } | null)?.kind;
  return (typeof kind === "string" && byJobKind.get(kind)) || GAME_NOTICES;
};

/** Whether `id` names a category the player can turn off. */
export const isMutableCategory = (id: unknown): id is MutableCategory =>
  typeof id === "string" && (MUTABLE_CATEGORIES as readonly string[]).includes(id);

/** The stored list (`user.notifications_off`) as a set of known categories; anything else is ignored. */
export const mutedSetOf = (stored: unknown): ReadonlySet<MutableCategory> =>
  new Set(Array.isArray(stored) ? stored.filter(isMutableCategory) : []);

/**
 * The entries of a row the player still wants: all of them while nothing is
 * muted, otherwise those whose category is on.
 */
export const visibleEntries = (
  rowKind: string,
  entries: readonly unknown[],
  muted: ReadonlySet<string>,
): unknown[] => (muted.size === 0 ? [...entries] : entries.filter((entry) => !muted.has(categoryOf(rowKind, entry))));

/**
 * The muted list after a change from Settings: `change` switches categories
 * on (true) or off (false); the rest stay as stored. In the order Settings
 * lists them.
 */
export const mutedAfter = (stored: unknown, change: Partial<Record<string, boolean>>): MutableCategory[] => {
  const muted = new Set<string>(mutedSetOf(stored));
  for (const [id, on] of Object.entries(change)) {
    if (on === true) muted.delete(id);
    else if (on === false) muted.add(id);
  }
  return MUTABLE_CATEGORIES.filter((id) => muted.has(id));
};
