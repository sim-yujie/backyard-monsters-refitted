/**
 * The player avatars a player can pick from (issue #175): twelve backyard
 * critters, drawn once and shipped with the web client under
 * `web/public/avatars/`.
 *
 * The choice is stored in `user.pic_square` as the picture's path on the web
 * client, so every place that already hands `pic_square` on (chat, the
 * leaderboards, attack logs, Map Room cells and neighbours) carries it without
 * change. This list is the allow-list: `POST /player/avatar` takes one of these
 * paths and nothing else, so the column never holds a caller's own URL.
 *
 * The web client keeps the same twelve ids in `web/src/game/avatars.ts`; a web
 * test reads this file to hold the two lists together.
 */
export const AVATAR_IDS = [
  "hedgehog",
  "frog",
  "raccoon",
  "mole",
  "snail",
  "ladybug",
  "bee",
  "squirrel",
  "rabbit",
  "owl",
  "worm",
  "tortoise",
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

/**
 * The picture a new account starts with, before its player picks a critter
 * (`controllers/auth/register.ts`); also the fallback when there is no Discord
 * picture.
 */
export const PLACEHOLDER_PIC_SQUARE = "https://cdn.bymrefitted.com/assets/bym-refitted-assets/placeholder.jpg";

/** "/avatars/hedgehog.webp": the value stored for a chosen avatar. */
export const avatarPath = (id: AvatarId): string => `/avatars/${id}.webp`;

const AVATAR_PATHS: ReadonlySet<string> = new Set(AVATAR_IDS.map(avatarPath));

/** True when a `pic_square` value is one of the critters rather than a URL. */
export const isAvatarPath = (value: unknown): value is string =>
  typeof value === "string" && AVATAR_PATHS.has(value);

/**
 * What `pic_square` becomes when the login's Discord refresh finds a new
 * Discord picture: the Discord one, unless the player has picked a critter,
 * which a refresh must not undo.
 */
export const picSquareAfterDiscordRefresh = (
  current: string | null | undefined,
  fromDiscord: string
): string => (isAvatarPath(current) ? current : fromDiscord);
