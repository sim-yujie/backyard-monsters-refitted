import type { EntityManager } from "@mikro-orm/postgresql";

/**
 * Browser errors that are not the game's (owner, 6 Nov 2026: "can we remove
 * them as well as not log those"). Each pattern is matched against the
 * message, the place and the stack together, case-insensitively.
 *
 * - `iabjs://`: scripts Facebook's in-app browser adds to every page
 *   ("browser_declutter"); its own syntax errors land in our handler.
 * - `window.ethereum`: crypto-wallet browser add-ons poking the page.
 *
 * Graphics (WebGL) or sound (Web Audio) switched off in the player's browser
 * ("... is disabled due to your security policy") is NOT noise and is kept
 * (owner, 7 Nov 2026): it shows how many players see the game's
 * "graphics are off" message.
 */
export const BROWSER_NOISE: readonly RegExp[] = [
  /iabjs:\/\//i,
  /window\.ethereum/i,
];

/** Whether a browser error is one of {@link BROWSER_NOISE}. */
export const isBrowserNoise = (message: string, place = "", stack = ""): boolean => {
  const text = `${message}\n${place}\n${stack}`;
  return BROWSER_NOISE.some((pattern) => pattern.test(text));
};

/**
 * SQL `LIKE` forms of the same noise, plus the server's old "client closed the
 * connection mid-request" entries ("Parse Error: Invalid EOF state"), which
 * `middleware/appErrors.ts` no longer records. Used to clear kinds already
 * stored before this filter existed.
 */
const STORED_NOISE_LIKE: readonly string[] = [
  "%iabjs://%",
  "%window.ethereum%",
  "%Parse Error: Invalid EOF state%",
];

/**
 * Deletes stored error kinds that are noise (their reporters go with them by
 * the foreign key). Run by the daily clean-up (`services/privacy/retention.ts`).
 * Returns how many kinds were deleted.
 */
export const deleteNoiseErrors = async (em: EntityManager): Promise<number> => {
  const where = STORED_NOISE_LIKE.map(
    () => `(message ILIKE ? OR place ILIKE ? OR coalesce(stack, '') ILIKE ?)`
  ).join(" OR ");
  const params = STORED_NOISE_LIKE.flatMap((like) => [like, like, like]);
  const rows: { id: string }[] = await em
    .getConnection()
    .execute(`DELETE FROM bym.app_error WHERE ${where} RETURNING id`, params);
  return rows.length;
};
