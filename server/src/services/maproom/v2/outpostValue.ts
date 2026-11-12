import { costOf, OUTPOST_CORE_TYPE } from "../../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../../types/BuildingData.js";

/**
 * A player outpost's value, the figure Map Room 2 prices its takeover from.
 *
 * Flash works it out in the client, `BASE.CalcBaseValue`
 * (`client/scripts/BASE.as:4830-4862`), and posts it as `empirevalue` on every
 * save (`:3208`); the map cell carries it back as `v` and `PopupTakeover`
 * prices the takeover from it (`PopupTakeover.as:50-57`, `takeoverCost.ts`).
 * This project's web client never sent it, so every player outpost read as 0
 * and cost the 1,000,000 floor whatever stood on it. The server now works it
 * out from the outpost's stored buildings, never from a number a client sent,
 * so an outpost already on the map is priced right with no migration.
 *
 * The rules, as `CalcBaseValue` runs them on an outpost:
 * - every building counts but those whose props `type` is `decoration`,
 *   `enemy`, `immovable` or `trap`;
 * - on an outpost a building still counting its build down counts too (on a
 *   main yard it would not, `_countdownBuild <= 0`; main yards are never
 *   taken over, so only the outpost rule is here);
 * - each adds the cost step that reached its level, `costs[level - 1]`, as
 *   `time + r1 + r2 + r3 + r4` (seconds and resources added together, as Flash
 *   does), from the outpost's own props table, which replaces the main one on
 *   an outpost (`GLOBAL.as:716-723`); a level of 0 or less counts as 1, and a
 *   type or level the table has no step for adds nothing;
 * - the total is `ceil(sum * 0.1)`.
 *
 * A building's level is the one `BFOUNDATION.Setup` gives it on load
 * (`client/scripts/BFOUNDATION.as:3041-3056`): the outpost core is always 1, a
 * missing or zero `l` is 1, and a Starter Kit prefab is its `prefab` level even
 * while its countdown runs. The load also skips types 53 and 54 and turns a
 * legacy Stone Block (18) into a level 2 Block (`BASE.as:1536-1541`).
 */

/** Props `type` strings `CalcBaseValue` leaves out (`BASE.as:4842`). */
const NOT_COUNTED: ReadonlySet<string> = new Set(["decoration", "enemy", "immovable", "trap"]);

/** Types the yard load never builds (`BASE.as:1536`). */
const NEVER_LOADED: ReadonlySet<number> = new Set([53, 54]);

const LEGACY_STONE_BLOCK = 18;

const BLOCK = 17;

/** The level `BFOUNDATION.Setup` gives a stored building (`BFOUNDATION.as:3041-3056`). */
const loadedLevel = (type: number, building: BuildingData): number => {
  const stored = type === OUTPOST_CORE_TYPE ? 1 : Math.trunc(Number(building.l));
  let level = Number.isFinite(stored) && stored !== 0 ? stored : 1;
  const prefab = Math.trunc(Number(building.prefab));
  if (Number.isFinite(prefab) && prefab !== 0) level = prefab;
  return level <= 0 ? 1 : level;
};

/** What one stored building adds to the sum before the tenth, 0 when it does not count. */
export const buildingValue = (building: BuildingData | null | undefined): number => {
  if (!building || typeof building !== "object") return 0;

  let type = Math.trunc(Number(building.t));
  if (!type || NEVER_LOADED.has(type)) return 0;

  let level: number;
  if (type === LEGACY_STONE_BLOCK) {
    type = BLOCK;
    level = 2;
  } else {
    level = loadedLevel(type, building);
  }

  const props = costOf(type, "outpost");
  if (!props || NOT_COUNTED.has(props.kind)) return 0;

  const step = props.costs[level - 1];
  if (!step) return 0;

  const [r1, r2, r3, r4, time] = step;
  return time + r1 + r2 + r3 + r4;
};

/**
 * The value of a player outpost from its stored `buildingdata`, as Flash's
 * `CalcBaseValue` works it out on an outpost.
 *
 * @param {BuildingDataMap | null | undefined} buildingdata - The outpost's stored buildings.
 * @returns {number} The outpost's value, 0 for an empty one.
 */
export const outpostValue = (buildingdata: BuildingDataMap | null | undefined): number => {
  let sum = 0;
  for (const building of Object.values(buildingdata ?? {})) sum += buildingValue(building);
  return Math.ceil(sum * 0.1);
};
