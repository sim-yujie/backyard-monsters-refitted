import { MapRoom2 } from "../../../enums/MapRoom.js";
import {
  DECLARE_WAR_RANGE,
  MAX_OUTPOST_RANGE,
  hexDistance,
  mainYardRange,
  outpostRange,
  withDeclareWar,
} from "../../../game-rules/maproom/range.js";

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
 * minutes of `isAttackActive` with nobody actually attacking them. That move
 * changed only the moment the rule runs; issue #190 later changed what it
 * measures (below).
 *
 * `validateRange.ts` is the half that talks to the database and turns a
 * verdict into the error the client already handles.
 *
 * The measuring itself — the flinger ladders, Declare War, and the hex-ring
 * distance on the wrapping world — is `game-rules/maproom/range.ts`, a
 * byte-for-byte copy of the file the web client's range overlay and Attack
 * button use (issue #190), so the three can never disagree.
 */

/**
 * The longest reach any outpost flinger can have, Declare War included: the
 * half-width of the box swept around the target when looking for outposts.
 * The box is only a first cut; the hex rule decides.
 */
export const OUTPOST_SWEEP = MAX_OUTPOST_RANGE + DECLARE_WAR_RANGE;

/** A cell on the Map Room 2 grid. */
export interface CellCoords {
  x: number;
  y: number;
}

/** An owned outpost as the save stores it: `[x, y, baseid]`. */
export type OutpostEntry = [number, number, string];

/** An owned outpost sitting inside the sweep box: where it is, and its offset from the target. */
export interface NearbyOutpost {
  baseid: string;
  x: number;
  y: number;
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

export { DECLARE_WAR_RANGE, MAX_OUTPOST_RANGE, withDeclareWar };

/** Reach of a main yard's flinger, by flinger level (`range.ts`). */
export const getMainYardRange = mainYardRange;

/** Reach of an outpost's flinger, by flinger level (`range.ts`). */
export const getOutpostRange = outpostRange;

/**
 * Hex steps from the main yard to the target cell, on the wrapping world
 * (`range.ts`; was the larger of the column and row differences before #190).
 *
 * @param {number} cellX - Target cell x.
 * @param {number} cellY - Target cell y.
 * @param {number} baseX - Main yard x.
 * @param {number} baseY - Main yard y.
 * @returns {number} Distance in cells.
 */
export const getDistanceFromMain = (cellX: number, cellY: number, baseX: number, baseY: number) =>
  hexDistance({ x: baseX, y: baseY }, { x: cellX, y: cellY });

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
      if (outpostId) nearby.push({ baseid: outpostId, x: neighborX, y: neighborY, dx, dy });
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
  /**
   * Whether the attacker's alliance has Declare War running: its two extra
   * cells count only then, as in Flash (`POWERUPS.as:140-160`, `:341-344`).
   */
  declareWar: boolean;
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
  declareWar,
}: RangePlanInput): RangePlan => {
  if (!homebase) return { ok: false, reason: "no-homebase" };

  if (!hasCoords(cell)) return { ok: false, reason: "no-attack-cell" };

  const [homeX, homeY] = homebase.map(Number);

  // An empty `homebase` array leaves these NaN, and the comparison below is
  // then false, which sends the check to the outposts. That is what the rule
  // has always done, so it is left as it is.
  const totalRange = withDeclareWar(mainYardRange(flinger), declareWar);
  const distanceFromMain = getDistanceFromMain(cell.x, cell.y, homeX!, homeY!);

  if (totalRange > 0 && distanceFromMain <= totalRange) return { ok: true, via: "main" };

  if (outposts.length === 0) return { ok: false, reason: "no-outposts" };

  const nearby = outpostsNearCell(cell, outposts);

  if (nearby.length === 0) return { ok: false, reason: "no-outposts-near-cell" };

  return { pending: nearby };
};

/**
 * The second half of the rule: does any nearby outpost actually reach?
 *
 * Each outpost is measured from its own cell with its own flinger (issue
 * #190; the check used to test one outpost's reach against the offsets of
 * every other, in a square).
 *
 * @param {NearbyOutpost[]} nearby - Outposts inside the sweep box.
 * @param {ReadonlyMap<string, number>} flingers - Flinger level per outpost baseid.
 * @param {boolean} declareWar - Whether Declare War is running.
 * @returns {RangeVerdict} Whether the target is reachable from an outpost.
 */
export const checkOutpostRange = (
  nearby: readonly NearbyOutpost[],
  flingers: ReadonlyMap<string, number | undefined>,
  declareWar: boolean
): RangeVerdict => {
  for (const { baseid, x, y, dx, dy } of nearby) {
    if (!flingers.has(baseid)) continue;

    const totalRange = withDeclareWar(outpostRange(flingers.get(baseid)), declareWar);
    const target = { x: x - dx, y: y - dy };

    if (totalRange > 0 && hexDistance({ x, y }, target) <= totalRange)
      return { ok: true, via: "outpost" };
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

  if ("pending" in planned)
    return checkOutpostRange(planned.pending, outpostFlingers, plan.declareWar);

  return planned;
};
