import type { BuildingDataMap, BuildingHealthData } from "../../../types/BuildingData.js";
import { advanceBuildingTimers } from "../advanceBuildingTimers.js";

/**
 * The reference yard: the stored save brought forward to now.
 *
 * Every economy rule compares the submitted save against this, not against the
 * stored row, so a countdown that merely ticked between two saves is never a
 * violation and a level that rose because a countdown ran out is already
 * accounted for (`docs/design/economy-save-validation.md` §2).
 *
 * The clamp and the {@link advanceBuildingTimers} call are the same pair the
 * attack path and both Yard Planner batch controllers already make
 * (`controllers/base/save/baseSave.ts:213-215`,
 * `controllers/yardplanner/upgradeWalls.ts:46-52`); they live here so the
 * attack audit (issue #23) can share them rather than write a third copy.
 *
 * Nothing here touches the database.
 */

/**
 * The client caps its load replay at 30 days, so a save never credits more
 * than that (`services/base/advanceBuildingTimers.ts:32`).
 */
export const MAX_ELAPSED_SECONDS = 60 * 60 * 24 * 30;

/** The parts of a `Save` the reference yard is built from. */
export interface ReferenceYardSave {
  savetime?: number | null;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** The stored yard as it should look now with no player action. */
export interface ReferenceYard {
  /** `buildingdata` with every countdown advanced by {@link ReferenceYard.elapsed}. */
  buildingdata: BuildingDataMap;
  /** Seconds since the stored save, floored and clamped to [0, 30 days]. */
  elapsed: number;
}

/**
 * Seconds between a stored `savetime` and now, floored and clamped.
 *
 * A save from the future (clock skew, or the sandbox row's `savetime: 0` after
 * a clock change) reads as 0 rather than as a negative allowance.
 */
export const elapsedSince = (savetime: number | null | undefined, now: number): number => {
  const stored = Number(savetime);
  const start = Number.isFinite(stored) ? stored : 0;
  const gap = Math.floor(now - start);
  if (!Number.isFinite(gap)) return 0;
  return Math.min(Math.max(gap, 0), MAX_ELAPSED_SECONDS);
};

/**
 * Advances a stored save's countdowns to `now`.
 *
 * Returns a fresh `buildingdata` — {@link advanceBuildingTimers} copies every
 * building — so callers may read it freely without disturbing the entity.
 */
export const referenceYard = (save: ReferenceYardSave, now: number): ReferenceYard => {
  const elapsed = elapsedSince(save.savetime, now);
  const buildingdata = save.buildingdata ?? {};

  return {
    buildingdata: advanceBuildingTimers(buildingdata, save.buildinghealthdata, elapsed),
    elapsed,
  };
};
