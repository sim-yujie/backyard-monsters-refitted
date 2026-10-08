import type { EntityManager } from "@mikro-orm/postgresql";
import { Save } from "../../../database/models/save.model.js";
import { busyWorkers } from "../../yardplanner/workers.js";

/**
 * Which of the viewer's own outposts have their one worker free (issue
 * #337; Flash's `mcWorker`, shown on `_base == 3 && _mine` while no job runs).
 *
 * The cells query leaves `buildingdata` out (it is a large blob), so this
 * reads it for the viewer's own outposts only, as base-save ids, and returns
 * the ids whose build, upgrade and fortify countdowns are all done.
 */
export const idleWorkerSaves = async (em: EntityManager, saveIds: number[]): Promise<Set<number>> => {
  if (saveIds.length === 0) return new Set();
  const saves = await em.find(Save, { basesaveid: { $in: saveIds } }, { fields: ["basesaveid", "buildingdata"] });
  return new Set(saves.filter((save) => busyWorkers(save.buildingdata) === 0).map((save) => save.basesaveid));
};
