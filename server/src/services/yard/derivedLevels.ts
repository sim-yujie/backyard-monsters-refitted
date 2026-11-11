import { BaseType } from "../../enums/Base.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { baseValueOf } from "../base/economy/resourceBudget.js";
import { levelOf } from "../yardplanner/costs.js";

/**
 * `save.flinger` and `save.catapult`: two numbers the save caches from its own
 * buildings.
 *
 * Only the Flash client ever wrote them, on every base save, as the level of
 * the yard's Flinger and Catapult (`client/scripts/BASE.as:3179-3180`). Other
 * code still reads the cache rather than the buildings: the attack range check
 * takes `save.flinger` (`services/maproom/v2/validateRange.ts:94`) and every
 * map cell publishes both (`controllers/maproom/v2/cells/userCell.ts:79-80`).
 * Now that the server finishes upgrades itself, nothing refreshed them, so a
 * Flinger upgraded from the web never extended the player's range
 * (`docs/design/yard-buildings.md` §3.3, issue #94).
 *
 * The fix is to derive both from `buildingdata` wherever the server writes a
 * yard, rather than to trust whatever the column last held.
 */

/** Flinger type id (`client/scripts/YARD_PROPS.as:610`). */
export const FLINGER_TYPE = 5;

/** Catapult type id (`client/scripts/YARD_PROPS.as:3862`). */
export const CATAPULT_TYPE = 51;

/** The two cached levels. */
export interface DerivedLevels {
  flinger: number;
  catapult: number;
}

/** The slice of a save {@link syncDerivedLevels} reads and writes. */
export interface DerivedLevelsSave {
  buildingdata?: BuildingDataMap | null;
  flinger?: number;
  catapult?: number;
}

/**
 * The highest finished level among the buildings of `type`, 0 when there is
 * none.
 *
 * "Finished" is what {@link levelOf} already means: a building still counting
 * its initial build down is level 0, exactly as the Flash `_lvl` read until
 * `Constructed()` set it to 1 (`client/scripts/BFOUNDATION.as:2892-2901`). One
 * mid-upgrade still counts at the level it has, not the one it is going to.
 */
const highestLevel = (buildingdata: BuildingDataMap | null | undefined, type: number): number => {
  let best = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    if (Number(building.t) !== type) continue;
    best = Math.max(best, levelOf(building));
  }
  return best;
};

/** Both levels, derived from `buildingdata`. */
export const derivedLevels = (buildingdata: BuildingDataMap | null | undefined): DerivedLevels => ({
  flinger: highestLevel(buildingdata, FLINGER_TYPE),
  catapult: highestLevel(buildingdata, CATAPULT_TYPE),
});

/**
 * {@link syncDerivedLevels} for a yard an attack has just caught up
 * (`advanceBuildingTimers` in an attack's landing): a countdown that ran out
 * while the owner was away is finished there, so a Flinger upgrade done by
 * then has to count for the cached level too, or the owner's range and fog of
 * war stay short until they next open the yard. Player yards only: a wild
 * camp's or a bot tribe's column is left as its data has it.
 *
 * @returns Whether either level changed.
 */
export const syncAttackedYardLevels = (save: DerivedLevelsSave & { type?: string }): boolean =>
  save.type === BaseType.MAIN || save.type === BaseType.OUTPOST ? syncDerivedLevels(save) : false;

/** The slice of a save {@link flingerLevelAt} reads. */
export interface FlingerClockSave {
  flinger?: number;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  savetime?: number | null;
}

/**
 * The yard's Flinger level as of `now`, rather than as of its last write.
 *
 * `save.flinger` only moves when the server writes the yard (a load, a yard
 * action), so a Flinger whose upgrade countdown ran out since then still
 * reads at its old level there until the owner next opens that yard, which
 * for an outpost can be days. This plays the Flinger's own countdown forward
 * to `now` the way the catch-up would (`advanceBuildingTimers`: paused while
 * damaged, a prefab finishing at its kit level) and reads the level off that,
 * so the fog of war's sight and the attack range grow the moment the upgrade
 * is done, never before it.
 *
 * A row loaded without its `buildingdata`, or with no Flinger in it, falls
 * back to the stored column.
 *
 * @param save - The yard's Flinger, health and clock.
 * @param now - Unix seconds.
 */
export const flingerLevelAt = (save: FlingerClockSave, now: number): number | undefined => {
  const buildingdata = save.buildingdata;
  if (!buildingdata || typeof buildingdata !== "object") return save.flinger;

  const flingers: BuildingDataMap = {};
  for (const [key, building] of Object.entries(buildingdata)) {
    if (building && Number(building.t) === FLINGER_TYPE) flingers[key] = building;
  }
  // No Flinger on record (a row written without its buildings): keep the stored level.
  if (!Object.keys(flingers).length) return save.flinger;

  const savedAt = Number(save.savetime);
  const elapsed = Number.isFinite(savedAt) && savedAt > 0 ? now - savedAt : 0;
  return highestLevel(advanceBuildingTimers(flingers, save.buildinghealthdata, elapsed), FLINGER_TYPE);
};

/**
 * Writes `flinger` and `catapult` onto the save from its buildings.
 *
 * Call it after `buildingdata` is final and before the flush. Assigning only
 * when a value actually differs keeps an unchanged save out of MikroORM's
 * change set.
 *
 * @returns Whether either field changed, so a caller with nothing else to
 * write can skip its flush.
 */
export const syncDerivedLevels = (save: DerivedLevelsSave): boolean => {
  const { flinger, catapult } = derivedLevels(save.buildingdata);
  let changed = false;

  if (save.flinger !== flinger) {
    save.flinger = flinger;
    changed = true;
  }

  if (save.catapult !== catapult) {
    save.catapult = catapult;
    changed = true;
  }

  return changed;
};

/** The slice of a save {@link syncBaseValue} reads and writes. */
export interface BaseValueSave {
  type?: string;
  buildingdata?: BuildingDataMap | null;
  basevalue?: string;
}

/**
 * Raises `save.basevalue` to the value of the yard's buildings, never lowering
 * it (issue #209).
 *
 * `basevalue` is the other half of the player level, beside `points`
 * (`services/base/calculateBaseLevel.ts`). Only the Flash client ever wrote it:
 * `BASE.CalcBaseValue` ran on every level check, and on the main yard kept the
 * larger of what it had and what the buildings were worth
 * (`client/scripts/BASE.as:4830-4861`), so a recycled or destroyed building
 * never took a level away. Now that the server builds and upgrades, nothing
 * refreshed it, and the level rose only with job points.
 *
 * The value is {@link baseValueOf}, the rule the economy audit already derives
 * the same high-water mark with (`auditEconomySave.ts`, §2.9). Main yards only,
 * as in Flash: an outpost's value never reached the level, and an outpost seen
 * through its main yard (`poolView.ts`) keeps its own `type`, so it is skipped
 * here and `basevalue` stays on neither row.
 *
 * Call it after `buildingdata` is final and before the flush, wherever the
 * server changes a main yard's buildings.
 *
 * @returns Whether `basevalue` changed.
 */
export const syncBaseValue = (save: BaseValueSave): boolean => {
  if (save.type !== BaseType.MAIN) return false;

  const computed = baseValueOf(save.buildingdata);
  const stored = Number(save.basevalue);
  if (Number.isFinite(stored) && stored >= computed) return false;

  save.basevalue = String(computed);
  return true;
};
