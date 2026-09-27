import type { BuildingDataMap } from "../../types/BuildingData.js";
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
