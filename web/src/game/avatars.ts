/**
 * Player avatars (issue #175): twelve backyard critters a player picks one of
 * in the Account menu.
 *
 * The server keeps the choice in `pic_square` as the picture's path
 * ("/avatars/owl.webp") and accepts only these twelve
 * (`server/src/game-data/avatars.ts`, the allow-list; a test here holds the
 * two lists together). Anything else in `pic_square`, the old placeholder or a
 * Discord picture, means the player has not picked one, and they are shown a
 * default critter chosen by user id, so a player looks the same everywhere and
 * a map full of new players is not twelve hundred hedgehogs.
 *
 * The art sits in `web/public/avatars/`: `<id>.webp` at 256 square for the
 * picker, `<id>-64.webp` for the small places (the HUD, a map card). They sit
 * outside `/assets` because the dev server proxies that prefix to the game
 * server (see `game/maproom/tribeAvatars.ts`).
 */

export const AVATARS = [
  { id: "hedgehog", name: "Hedgehog" },
  { id: "frog", name: "Frog" },
  { id: "raccoon", name: "Raccoon" },
  { id: "mole", name: "Mole" },
  { id: "snail", name: "Snail" },
  { id: "ladybug", name: "Ladybug" },
  { id: "bee", name: "Bee" },
  { id: "squirrel", name: "Squirrel" },
  { id: "rabbit", name: "Rabbit" },
  { id: "owl", name: "Owl" },
  { id: "worm", name: "Worm" },
  { id: "tortoise", name: "Tortoise" },
] as const;

export type AvatarId = (typeof AVATARS)[number]["id"];

/** "/avatars/owl.webp": what the server stores for a picked avatar. */
export const avatarPath = (id: AvatarId): string => `/avatars/${id}.webp`;

const BY_PATH: ReadonlyMap<string, AvatarId> = new Map(AVATARS.map(({ id }) => [avatarPath(id), id]));
const NAMES: ReadonlyMap<AvatarId, string> = new Map(AVATARS.map(({ id, name }) => [id, name]));

/** The critter a `pic_square` names, or null when it names none of them. */
export const pickedAvatar = (picSquare: string | null | undefined): AvatarId | null =>
  (picSquare && BY_PATH.get(picSquare)) || null;

/** The critter a player who has not picked one is shown: the same one for the same player. */
export const defaultAvatar = (userId: number): AvatarId => {
  const index = Number.isFinite(userId) ? Math.abs(Math.trunc(userId)) % AVATARS.length : 0;
  return AVATARS[index]!.id;
};

/** The critter to show for a player: theirs, or their default. */
export const avatarOf = (picSquare: string | null | undefined, userId: number): AvatarId =>
  pickedAvatar(picSquare) ?? defaultAvatar(userId);

export const avatarName = (id: AvatarId): string => NAMES.get(id) ?? id;

/**
 * The picture's URL. `small` is the 64 px copy, for anything drawn at 48 px or
 * less; the full one is 256 px.
 */
export const avatarUrl = (id: AvatarId, size: "full" | "small" = "full"): string =>
  `${import.meta.env.BASE_URL}avatars/${id}${size === "small" ? "-64" : ""}.webp`;
