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
 * - The game's own graphics log lines that beta 8.1's client sends and later
 *   clients no longer do (patch 8.2, 22 Nov 2026; `web/src/game/graphicsLog.ts`):
 *   a picture over the texture limit that was cut through a canvas (handled,
 *   most of the flood), a WebGL context restored, and a WebGL context lost
 *   that the client sent at once, before knowing whether it came back (on the
 *   live game it nearly always did within 2 s). A loss still kept is one a
 *   later client sends after waiting ("..., not restored in 10 s, ...") and a
 *   WebGPU device lost, which never comes back. "could not be cut" and "did
 *   not load" are kept.
 *
 * Graphics (WebGL) or sound (Web Audio) switched off in the player's browser
 * ("... is disabled due to your security policy") is NOT noise and is kept
 * (owner, 7 Nov 2026): it shows how many players see the game's
 * "graphics are off" message.
 */
export const BROWSER_NOISE: readonly RegExp[] = [
  /iabjs:\/\//i,
  /window\.ethereum/i,
  /Graphics: picture over the texture limit, cut through a canvas/i,
  /Graphics: WebGL context restored/i,
  // Up to the entry's first " | ", where its device details begin.
  /Graphics: WebGL context lost(?![^|\n]*(?:not restored in|WebGPU device lost))/i,
];

/** Whether a browser error is one of {@link BROWSER_NOISE}. */
export const isBrowserNoise = (message: string, place = "", stack = ""): boolean => {
  const text = `${message}\n${place}\n${stack}`;
  return BROWSER_NOISE.some((pattern) => pattern.test(text));
};

/** One stored kind of noise: matched by `like`, unless its message matches one of `unless`. */
interface StoredNoise {
  readonly like: string;
  readonly unless?: readonly string[];
}

/**
 * SQL `LIKE` forms of the same noise, plus the server's old "client closed the
 * connection mid-request" entries ("Parse Error: Invalid EOF state"), which
 * `middleware/appErrors.ts` no longer records. Used to clear kinds already
 * stored before this filter existed.
 */
const STORED_NOISE_LIKE: readonly StoredNoise[] = [
  { like: "%iabjs://%" },
  { like: "%window.ethereum%" },
  { like: "%Parse Error: Invalid EOF state%" },
  { like: "%Graphics: picture over the texture limit, cut through a canvas%" },
  { like: "%Graphics: WebGL context restored%" },
  { like: "%Graphics: WebGL context lost%", unless: ["%not restored in%", "%WebGPU device lost%"] },
];

/**
 * Deletes stored error kinds that are noise (their reporters go with them by
 * the foreign key). Run by the daily clean-up (`services/privacy/retention.ts`).
 * Returns how many kinds were deleted.
 */
export const deleteNoiseErrors = async (em: EntityManager): Promise<number> => {
  const where = STORED_NOISE_LIKE.map(
    ({ unless = [] }) =>
      `((message ILIKE ? OR place ILIKE ? OR coalesce(stack, '') ILIKE ?)${unless.map(() => " AND message NOT ILIKE ?").join("")})`
  ).join(" OR ");
  const params = STORED_NOISE_LIKE.flatMap(({ like, unless = [] }) => [like, like, like, ...unless]);
  const rows: { id: string }[] = await em
    .getConnection()
    .execute(`DELETE FROM bym.app_error WHERE ${where} RETURNING id`, params);
  return rows.length;
};
