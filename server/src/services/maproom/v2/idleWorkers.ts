import type { EntityManager } from "@mikro-orm/postgresql";
import { Save } from "../../../database/models/save.model.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../../types/BuildingData.js";
import { advanceBuildingTimers, isCountdownPaused } from "../../base/advanceBuildingTimers.js";
import { holdsWorker } from "../../yardplanner/workers.js";

/** The save columns the worker state is read from. */
export interface WorkerClockSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  savetime?: number | null;
}

/**
 * An outpost's one worker at `now`: free, or busy until `finishAt` (Unix
 * seconds; null when the job is paused on a damaged building and has no end).
 *
 * The stored countdowns are the time left as of the save's `savetime`, and an
 * outpost nobody has opened since is never saved again, so they are brought
 * forward to `now` first. Counting the stored ones as they were kept the map's
 * construction badge up after the job had finished, until the player opened
 * that yard (owner, 12 Nov 2026).
 */
export const outpostWorkerAt = (
  save: WorkerClockSave,
  now: number,
): { busy: false } | { busy: true; finishAt: number | null } => {
  const savedAt = Number(save.savetime);
  const elapsed = Number.isFinite(savedAt) && savedAt > 0 ? now - savedAt : 0;
  const health = save.buildinghealthdata;
  const buildings = advanceBuildingTimers(save.buildingdata ?? {}, health, elapsed);

  let left = 0;
  let busy = false;
  let paused = false;
  for (const raw of Object.values(buildings)) {
    const building = raw as BuildingData;
    if (!holdsWorker(building)) continue;
    busy = true;
    if (isCountdownPaused(building, health)) {
      paused = true;
      continue;
    }
    // The countdown `advanceBuildingTimers` runs: upgrade, else build, else fortify.
    const countdown = Number(building.cU || building.cB || building.cF) || 0;
    left = Math.max(left, countdown);
  }
  if (!busy) return { busy: false };
  return { busy: true, finishAt: paused ? null : now + left };
};

/**
 * Which of the viewer's own outposts have their one worker free (issue
 * #337; Flash's `mcWorker`, shown on `_base == 3 && _mine` while no job runs)
 * and which have it busy building, upgrading or fortifying (Modern's
 * construction badge, owner 29 Oct 2026), with when that job ends so the map
 * can take the badge down at that moment.
 *
 * The cells query leaves `buildingdata` out (it is a large blob), so this
 * reads it for the viewer's own outposts only, as base-save ids. An id whose
 * save is not found is in neither.
 */
export const outpostWorkerSaves = async (
  em: EntityManager,
  saveIds: number[],
  now: number,
): Promise<{ idle: Set<number>; busy: Map<number, number | null> }> => {
  const idle = new Set<number>();
  const busy = new Map<number, number | null>();
  if (saveIds.length === 0) return { idle, busy };
  const saves = await em.find(
    Save,
    { basesaveid: { $in: saveIds } },
    { fields: ["basesaveid", "buildingdata", "buildinghealthdata", "savetime"] },
  );
  for (const save of saves) {
    const worker = outpostWorkerAt(save, now);
    if (worker.busy) busy.set(save.basesaveid, worker.finishAt);
    else idle.add(save.basesaveid);
  }
  return { idle, busy };
};
