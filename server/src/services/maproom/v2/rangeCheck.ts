import { MapRoom2 } from "../../../enums/MapRoom.js";

/**
 * The Map Room 2 flinger range rule, as a decision (issue #26).
 *
 * This module holds the whole of "can this player reach that cell": the range
 * tables, the toroidal distance, the outpost sweep and the verdict. It is pure
 * — no database, no ORM, no `server.js` — so the rule can be run before the
 * attack is written down, and tested without a request.
 *
 * Why it had to move: the check used to run at the very end of
 * `baseModeAttack`, after the defender's `attackid`, the appended attack
 * record, the attack log and the map cell had already been flushed. A refusal
 * therefore left the defender flagged as under attack for the full seven
 * minutes of `isAttackActive` with nobody actually attacking them. The rule
 * itself is unchanged; only the moment it runs is.
 *
 * `validateRange.ts` is the half that talks to the database and turns a
 * verdict into the error the client already handles.
 */

/** Cells of extra reach the Declare War powerup buys (`POWERUPS.as:341-344`). */
export const DECLARE_WAR_RANGE = 2;

/** The longest reach any outpost flinger can have. */
export const MAX_OUTPOST_RANGE = 4;

/** Half-width of the box swept around the target when looking for outposts. */
export const OUTPOST_SWEEP = MAX_OUTPOST_RANGE + DECLARE_WAR_RANGE;

/** A cell on the Map Room 2 grid. */
export interface CellCoords {
  x: number;
  y: number;
}

/** An owned outpost as the save stores it: `[x, y, baseid]`. */
export type OutpostEntry = [number, number, string];

/** An owned outpost sitting inside the sweep box, with its offset from the target. */
export interface NearbyOutpost {
  baseid: string;
  dx: number;
  dy: number;
}

/** Why an attack was refused on range grounds. */
export type RangeRefusal =
  | "no-homebase"
  | "no-attack-cell"
  | "no-outposts"
  | "no-outposts-near-cell"
  | "out-of-range";

export type RangeVerdict =
  | { ok: true; via: "main" | "outpost" }
  | { ok: false; reason: RangeRefusal };

/**
 * What the rule can settle before anything is read from the database, plus the
 * one case where it cannot: the target is out of the main yard's reach but
 * owned outposts sit near it, and their flinger levels decide the answer.
 */
export type RangePlan =
  | { ok: true; via: "main" }
  | { ok: false; reason: Exclude<RangeRefusal, "out-of-range"> }
  | { pending: NearbyOutpost[] };

/**
 * A base's flinger range, with the Declare War allowance always included.
 *
 * The server adds it unconditionally, whether or not the powerup is running;
 * the client only adds it when the powerup really is active. That asymmetry is
 * long-standing behaviour and is left alone here.
 *
 * @param {number} range - The base's own flinger range.
 * @returns {number} The range to validate against.
 */
export const withDeclareWar = (range: number) => (range > 0 ? range + DECLARE_WAR_RANGE : 0);

/**
 * Reach of a main yard's flinger, by flinger level.
 *
 * @param {number | undefined} flinger - The flinger's level.
 * @returns {number} Reach in cells.
 */
export const getMainYardRange = (flinger: number | undefined) => {
  switch (flinger) {
    case 0:
      return 0;
    case 1:
      return 4;
    case 2:
      return 6;
    case 3:
      return 8;
    case 4:
      return 10;
    default:
      return 10;
  }
};

/**
 * Reach of an outpost's flinger, by flinger level.
 *
 * @param {number | undefined} flinger - The flinger's level.
 * @returns {number} Reach in cells.
 */
export const getOutpostRange = (flinger: number | undefined) => {
  switch (flinger) {
    case 0:
      return 0;
    case 1:
      return 1;
    case 2:
      return 2;
    case 3:
      return 3;
    default:
      return 4;
  }
};

/**
 * Distance from the main yard to the target cell.
 *
 * Square (Chebyshev) distance on a toroidal grid, not a hex distance.
 *
 * @param {number} cellX - Target cell x.
 * @param {number} cellY - Target cell y.
 * @param {number} baseX - Main yard x.
 * @param {number} baseY - Main yard y.
 * @returns {number} Distance in cells.
 */
export const getDistanceFromMain = (
  cellX: number,
  cellY: number,
  baseX: number,
  baseY: number
) => {
  // Calculate the straight-line distances
  const deltaX = Math.abs(baseX - cellX);
  const deltaY = Math.abs(baseY - cellY);

  // Wrap-around distances (for toroidal map)
  const wrappedDeltaX = Math.min(deltaX, MapRoom2.WIDTH - deltaX);
  const wrappedDeltaY = Math.min(deltaY, MapRoom2.HEIGHT - deltaY);

  // Use the maximum wrapped distance to calculate square range distance
  return Math.max(wrappedDeltaX, wrappedDeltaY);
};

/**
 * Cell coordinates carried by a Map Room 2 / 3 base id.
 *
 * The last six digits are the cell: three for x, three for y. This is the same
 * derivation the attack path uses when it has to create the `world_map_cell`
 * row for a wild monster camp that has never been attacked before, which is why
 * the range check can run before that row exists.
 *
 * @param {string} baseid - The target base id.
 * @returns {CellCoords | null} The cell, or null if the id does not carry one.
 */
export const cellCoordsFromBaseId = (baseid: string): CellCoords | null => {
  const x = parseInt(baseid.slice(-6, -3));
  const y = parseInt(baseid.slice(-3));

  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
};

/**
 * Whether a candidate cell carries usable coordinates.
 *
 * @param {object | null | undefined} cell - The cell to test.
 * @returns {boolean} True when both coordinates are real numbers.
 */
export const hasCoords = (
  cell: { x?: number | null; y?: number | null } | null | undefined
): cell is CellCoords => Number.isFinite(cell?.x) && Number.isFinite(cell?.y);

/**
 * The owned outposts inside the sweep box around the target cell.
 *
 * Keys are comma-separated: plain concatenation makes (1, 23) and (12, 3) both
 * "123", which would grant or deny outpost range against the wrong cell.
 *
 * @param {CellCoords} cell - The cell under attack.
 * @param {OutpostEntry[]} outposts - The attacker's owned outposts.
 * @returns {NearbyOutpost[]} Outposts in the box, with their offsets.
 */
export const outpostsNearCell = (
  cell: CellCoords,
  outposts: readonly OutpostEntry[]
): NearbyOutpost[] => {
  const userOutposts = new Map(outposts.map(([x, y, id]) => [`${x},${y}`, id]));
  const nearby: NearbyOutpost[] = [];

  for (let dx = -OUTPOST_SWEEP; dx <= OUTPOST_SWEEP; dx++) {
    for (let dy = -OUTPOST_SWEEP; dy <= OUTPOST_SWEEP; dy++) {
      const neighborX = (cell.x + dx + MapRoom2.WIDTH) % MapRoom2.WIDTH;
      const neighborY = (cell.y + dy + MapRoom2.HEIGHT) % MapRoom2.HEIGHT;

      const outpostId = userOutposts.get(`${neighborX},${neighborY}`);
      if (outpostId) nearby.push({ baseid: outpostId, dx, dy });
    }
  }

  return nearby;
};

/** What the rule needs before any outpost flinger levels are known. */
export interface RangePlanInput {
  /** The attacker's `homebase`, as the save stores it: `["x", "y"]`. */
  homebase: readonly (string | number)[] | null | undefined;
  /** The attacker's main yard flinger level. */
  flinger: number | undefined;
  /** The cell under attack. */
  cell: { x?: number | null; y?: number | null } | null | undefined;
  /** The attacker's owned outposts. */
  outposts: readonly OutpostEntry[] | undefined;
}

/**
 * Everything the rule can settle without reading an outpost's flinger level.
 *
 * @param {RangePlanInput} input - The attacker's reach and the target cell.
 * @returns {RangePlan} A verdict, or the outposts whose levels decide it.
 */
export const planRangeCheck = ({
  homebase,
  flinger,
  cell,
  outposts = [],
}: RangePlanInput): RangePlan => {
  if (!homebase) return { ok: false, reason: "no-homebase" };

  if (!hasCoords(cell)) return { ok: false, reason: "no-attack-cell" };

  const [homeX, homeY] = homebase.map(Number);

  // An empty `homebase` array leaves these NaN, and the comparison below is
  // then false, which sends the check to the outposts. That is what the rule
  // has always done, so it is left as it is.
  const totalRange = withDeclareWar(getMainYardRange(flinger));
  const distanceFromMain = getDistanceFromMain(cell.x, cell.y, homeX!, homeY!);

  if (distanceFromMain <= totalRange) return { ok: true, via: "main" };

  if (outposts.length === 0) return { ok: false, reason: "no-outposts" };

  const nearby = outpostsNearCell(cell, outposts);

  if (nearby.length === 0) return { ok: false, reason: "no-outposts-near-cell" };

  return { pending: nearby };
};

/**
 * The second half of the rule: do any of the nearby outposts actually reach?
 *
 * The flinger level of one nearby outpost is tested against the offsets of
 * every other, so the strongest flinger in the box effectively decides for all
 * of them. That is how the rule has always run, and issue #26 is about when the
 * check happens, not what it decides, so it is preserved exactly.
 *
 * @param {NearbyOutpost[]} nearby - Outposts inside the sweep box.
 * @param {ReadonlyMap<string, number>} flingers - Flinger level per outpost baseid.
 * @returns {RangeVerdict} Whether the target is reachable from an outpost.
 */
export const checkOutpostRange = (
  nearby: readonly NearbyOutpost[],
  flingers: ReadonlyMap<string, number | undefined>
): RangeVerdict => {
  for (const { baseid } of nearby) {
    if (!flingers.has(baseid)) continue;

    const totalRange = withDeclareWar(getOutpostRange(flingers.get(baseid)));

    for (const { dx, dy } of nearby) {
      if (Math.abs(dx) <= totalRange && Math.abs(dy) <= totalRange)
        return { ok: true, via: "outpost" };
    }
  }

  return { ok: false, reason: "out-of-range" };
};

/** The whole rule in one call, for callers that already hold every input. */
export interface RangeCheckInput extends RangePlanInput {
  /** Flinger level per outpost baseid. */
  outpostFlingers: ReadonlyMap<string, number | undefined>;
}

/**
 * The complete decision, for tests and for any caller with all the data.
 *
 * @param {RangeCheckInput} input - The attacker's reach, the target and the outpost levels.
 * @returns {RangeVerdict} Whether the attack is in range.
 */
export const checkRange = ({ outpostFlingers, ...plan }: RangeCheckInput): RangeVerdict => {
  const planned = planRangeCheck(plan);

  if ("pending" in planned) return checkOutpostRange(planned.pending, outpostFlingers);

  return planned;
};
