import { mainYardRange, outpostRange, withDeclareWar } from "../../../game-rules/maproom/range.js";
import type { RevealedCell, SightSource } from "../../../game-rules/maproom/sight.js";

/**
 * Turns a player's or an alliance member's save into sight circles and
 * always-visible cells, the half of the Map Room 2 fog of war rule
 * (`game-rules/maproom/sight.ts`, issue #329) that has nothing to do with the
 * database: given the save fields and each owned outpost's own flinger
 * level, what does this base let its owner (and, unioned in, their alliance)
 * see.
 *
 * `sightService.ts` is the other half: it loads these fields from Postgres,
 * reads who has ever attacked the player, and caches the result in Redis.
 */

/** The slice of a save {@link ownSight} needs: a main yard's. */
export interface OwnBaseSave {
  /** `save.homebase`, as the save stores it: `["x", "y"]`. */
  homebase: readonly (string | number)[] | null | undefined;
  /** The main yard's flinger level. */
  flinger: number | undefined;
  /** `save.outposts`, as the save stores it: `[x, y, baseid][]`. */
  outposts: readonly [number, number, string][] | undefined;
}

/** A cell with no coordinates on it yet (an empty `homebase`) parses to `NaN`; never a sight circle. */
const isReal = (n: number): boolean => Number.isFinite(n);

/**
 * The main yard's own sight circle, or nothing when it has no cell yet (a
 * fresh account, or a save never placed on a Map Room 2 world).
 *
 * Reach 0 (no flinger, or a destroyed one) still returns a circle; it simply
 * reaches no cells (`isVisible`'s `inReach`). The main yard's own cell stays
 * visible regardless, through {@link ownRevealedCells}, not this circle.
 *
 * @param save - The main yard's own fields.
 * @param declareWar - Whether the owner's alliance has Declare War running.
 */
export const mainYardSource = (save: OwnBaseSave, declareWar: boolean): SightSource | null => {
  const [x, y] = (save.homebase ?? []).map(Number);
  if (!isReal(x!) || !isReal(y!)) return null;

  return { x: x!, y: y!, reach: withDeclareWar(mainYardRange(save.flinger), declareWar) };
};

/**
 * Every owned outpost's own sight circle, each measured from its own cell
 * with its own flinger level, as the attack range rule already does
 * (`rangeCheck.ts`'s `checkOutpostRange`).
 *
 * @param save - The owner's outposts.
 * @param flingerLevels - Flinger level per outpost `baseid`, from
 *   {@link sightService.ts}'s query. An outpost whose level is not in the
 *   map (its save row is gone) is skipped.
 * @param declareWar - Whether the owner's alliance has Declare War running.
 */
export const outpostSources = (
  save: Pick<OwnBaseSave, "outposts">,
  flingerLevels: ReadonlyMap<string, number | undefined>,
  declareWar: boolean,
): SightSource[] =>
  (save.outposts ?? [])
    .filter(([, , baseid]) => flingerLevels.has(baseid))
    .map(([x, y, baseid]) => ({
      x,
      y,
      reach: withDeclareWar(outpostRange(flingerLevels.get(baseid)), declareWar),
    }));

/**
 * Every sight circle a base (main yard plus outposts) contributes.
 *
 * @param save - The base's own fields.
 * @param flingerLevels - Flinger level per outpost `baseid`.
 * @param declareWar - Whether the owner's alliance has Declare War running.
 */
export const ownSources = (
  save: OwnBaseSave,
  flingerLevels: ReadonlyMap<string, number | undefined>,
  declareWar: boolean,
): SightSource[] => {
  const main = mainYardSource(save, declareWar);
  const outposts = outpostSources(save, flingerLevels, declareWar);

  return main ? [main, ...outposts] : outposts;
};

/**
 * The base's own cells (main yard and every outpost), always visible to its
 * owner however short their flingers' reach (`fog-of-war.md` §3 rule 2), and
 * to the owner's alliance under the same union (rule 3).
 *
 * @param save - The base's own fields.
 */
export const ownRevealedCells = (save: Pick<OwnBaseSave, "homebase" | "outposts">): RevealedCell[] => {
  const [x, y] = (save.homebase ?? []).map(Number);
  const home: RevealedCell[] = isReal(x!) && isReal(y!) ? [{ x: x!, y: y! }] : [];

  return [...home, ...(save.outposts ?? []).map(([ox, oy]) => ({ x: ox, y: oy }))];
};

/**
 * The bases of players who have ever attacked the viewer, each a single
 * revealed cell, forever (`fog-of-war.md` §3 rule 4). Callers resolve which
 * cells those attackers currently hold on the viewer's world; this just
 * drops everything but the coordinates the sight rule needs.
 *
 * @param attackerBases - Every base, on the viewer's world, owned by someone
 *   who has ever attacked them.
 */
export const attackerRevealedCells = (
  attackerBases: readonly { x: number; y: number }[],
): RevealedCell[] => attackerBases.map(({ x, y }) => ({ x, y }));

/**
 * A short, stable fingerprint of a sight: the client's `sv`
 * (`fog-of-war.md` §5.1, §6), so it can tell its cached zones apart from a
 * sight that has changed without comparing the full source and revealed
 * lists itself. Sorted first, so the same sight hashes the same regardless
 * of which order its sources (own sight, alliance union) were assembled in.
 *
 * @param sources - Every sight circle in the combined sight.
 * @param revealed - Every always-visible cell in the combined sight.
 */
export const sightVersionOf = (
  sources: readonly SightSource[],
  revealed: readonly RevealedCell[],
): string => {
  const key = (c: { x: number; y: number }) => c.x * 800 + c.y;
  const sortedSources = [...sources].sort((a, b) => key(a) - key(b) || a.reach - b.reach);
  const sortedRevealed = [...revealed].sort((a, b) => key(a) - key(b));

  // djb2: fast, deterministic, collision-resistant enough for a cache-busting
  // fingerprint that is never used for security.
  let hash = 5381;
  const feed = (text: string) => {
    for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  };
  for (const s of sortedSources) feed(`${s.x},${s.y},${s.reach};`);
  feed("|");
  for (const r of sortedRevealed) feed(`${r.x},${r.y};`);

  return hash.toString(16).padStart(8, "0");
};
