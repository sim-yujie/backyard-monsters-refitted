import { Tribes } from "../../../enums/Tribes.js";
import { calculateTribeLevel } from "./calculateTribeLevel.js";

/**
 * Server-side reconstruction of the Map Room 2 takeover price.
 *
 * The original game computes this entirely in the Flash client and posts the answer
 * back, so the server had no figure of its own to charge. The formulas below are the
 * ones the client actually runs, in
 * `client/scripts/com/monsters/maproom_advanced/PopupTakeover.as:50-80`:
 *
 *   wild monster camp - max(round((level * 562500 - 14750000) / 250000) * 250000, 1000000)
 *   player outpost    - min(max(round((ln(empireValue) * 15820570.7 - 227080916.9)
 *                                     / 250000) * 250000, 1000000), 65000000)
 *
 * then halved when the cell is adjacent to the taker's main yard
 * (`PopupTakeover.as:62-75`), then reduced 25% by the Alliance Conquest power-up
 * (`PopupTakeover.as:77-79`, `POWERUPS.as:337-339`). The same amount is charged for
 * each of r1..r4, and the Shiny alternative is
 * `ceil(sqrt(cost / 2) ^ 0.75 * 4)` (`PopupTakeover.as:80`).
 *
 * The outpost-count tier table in `PopupInfoEnemy.as:498-513` is NOT this price: it
 * only decides whether `PopupInfoEnemy.TakeOverConfirm` runs instead of opening
 * PopupTakeover, and it is gated on the tier cost being exactly 0
 * (`PopupInfoEnemy.as:514-521`). Its floor is `_minTakeoverCost` = 2,000,000
 * (`PopupInfoEnemy.as:113`), so it never reaches 0 and that branch is dead. There is
 * therefore no free takeover in the client: both paths floor above a million.
 */

const ROUND_TO = 250000;

const RESOURCE_FLOOR = 1000000;

const RESOURCE_CAP = 65000000;

const WILD_MONSTER_SLOPE = 562500;

const WILD_MONSTER_INTERCEPT = -14750000;

const OUTPOST_SLOPE = 15820570.7;

const OUTPOST_INTERCEPT = -227080916.9;

/** Alliance Conquest takes 25% off the price (POWERUPS.as:337-339). */
const CONQUEST_MULTIPLIER = 0.75;

export interface TakeoverCostInput {
  /** True for a wild monster camp, false for a player-owned outpost. */
  isWildMonster: boolean;
  /** The camp's coordinate-derived tribe level. Wild monster camps only. */
  level: number;
  /** The target save's empirevalue. Player outposts only. */
  empireValue: number;
  /** Whether the target neighbours the taker's main yard. */
  adjacentToMainYard: boolean;
  /** Whether the taker's alliance has Conquest running. */
  conquestActive: boolean;
}

/**
 * Whether a cell is one of the six hexagonal neighbours of a main yard.
 *
 * Mirrors the odd-q offset adjacency test in `PopupTakeover.as:62-75`.
 *
 * @param {number} homeX - The main yard's X coordinate.
 * @param {number} homeY - The main yard's Y coordinate.
 * @param {number} cellX - The target cell's X coordinate.
 * @param {number} cellY - The target cell's Y coordinate.
 * @returns {boolean} True when the target is adjacent to the main yard.
 */
export const isAdjacentToMainYard = (
  homeX: number,
  homeY: number,
  cellX: number,
  cellY: number
) => {
  if (Math.abs(homeX - cellX) === 1)
    return homeY + 1 - ((homeX + 1) % 2) * 2 === cellY || homeY === cellY;

  if (homeX === cellX) return homeY + 1 === cellY || homeY - 1 === cellY;

  return false;
};

/**
 * The per-resource cost of taking a cell over. The same figure is charged for r1..r4.
 *
 * @param {TakeoverCostInput} input - The target and the taker's modifiers.
 * @returns {number} The amount of each resource the takeover costs.
 */
export const takeoverResourceCost = ({
  isWildMonster,
  level,
  empireValue,
  adjacentToMainYard,
  conquestActive,
}: TakeoverCostInput) => {
  let cost: number;

  if (isWildMonster) {
    const raw = level * WILD_MONSTER_SLOPE + WILD_MONSTER_INTERCEPT;
    cost = Math.max(Math.round(raw / ROUND_TO) * ROUND_TO, RESOURCE_FLOOR);
  } else {
    // Math.log(0) is -Infinity and Math.log of a negative is NaN, either of which
    // would poison the clamp, so an empty or missing empire falls back to 1.
    const raw = Math.log(Math.max(empireValue, 1)) * OUTPOST_SLOPE + OUTPOST_INTERCEPT;
    const rounded = Math.max(Math.round(raw / ROUND_TO) * ROUND_TO, RESOURCE_FLOOR);
    cost = Math.min(rounded, RESOURCE_CAP);
  }

  if (adjacentToMainYard) cost *= 0.5;

  if (conquestActive) cost = Math.ceil(cost * CONQUEST_MULTIPLIER);

  return cost;
};

/**
 * The Shiny price for a takeover, derived from its resource price.
 *
 * @param {number} resourceCost - The per-resource cost from takeoverResourceCost.
 * @returns {number} The Shiny the takeover costs instead.
 */
export const takeoverShinyCost = (resourceCost: number) =>
  Math.ceil(Math.pow(Math.sqrt(resourceCost / 2), 0.75) * 4);

/** What a takeover would cost this taker. */
export interface TakeoverQuote {
  /** Of each of r1..r4. */
  resources: number;
  /** The Shiny alternative. */
  shiny: number;
  /** Whether the cell neighbours the taker's main yard, which halves the price. */
  adjacent: boolean;
}

/**
 * The takeover price for one taker and one cell, the way `PopupTakeover.as`
 * works it out: the camp's coordinate-derived level or the outpost's empire
 * value, the taker's main yard for the adjacency half, and Conquest.
 *
 * @param {object} input - The cell, what it is, and the taker's side.
 * @returns {TakeoverQuote} The price.
 */
export const quoteTakeover = ({
  cell,
  isWildMonster,
  empireValue,
  takerHomebase,
  conquestActive,
}: {
  cell: { x: number; y: number };
  isWildMonster: boolean;
  empireValue: number;
  /** The taker's `Save.homebase`, `[x, y]` as strings. */
  takerHomebase: readonly (string | number)[] | null | undefined;
  conquestActive: boolean;
}): TakeoverQuote => {
  const [homeX, homeY] = (takerHomebase ?? []).map(Number);
  const tribe = Tribes[(cell.x + cell.y) % Tribes.length]!;

  const adjacent =
    Number.isFinite(homeX) &&
    Number.isFinite(homeY) &&
    isAdjacentToMainYard(homeX!, homeY!, cell.x, cell.y);

  const resources = takeoverResourceCost({
    isWildMonster,
    level: calculateTribeLevel(cell.x, cell.y, tribe),
    empireValue,
    adjacentToMainYard: adjacent,
    conquestActive,
  });

  return { resources, shiny: takeoverShinyCost(resources), adjacent };
};
