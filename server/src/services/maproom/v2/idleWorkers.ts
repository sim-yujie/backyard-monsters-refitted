import type { EntityManager } from "@mikro-orm/postgresql";
import { Save } from "../../../database/models/save.model.js";
import { busyWorkers } from "../../yardplanner/workers.js";

/**
 * Which of the viewer's own outposts have their one worker free (issue
 * #337; Flash's `mcWorker`, shown on `_base == 3 && _mine` while no job runs)
 * and which have it busy building, upgrading or fortifying (Modern's
 * construction badge, owner 29 Oct 2026).
 *
 * The cells query leaves `buildingdata` out (it is a large blob), so this
 * reads it for the viewer's own outposts only, as base-save ids. An id whose
 * save is not found is in neither set.
 */
export const outpostWorkerSaves = async (
  em: EntityManager,
  saveIds: number[],
): Promise<{ idle: Set<number>; busy: Set<number> }> => {
  const idle = new Set<number>();
  const busy = new Set<number>();
  if (saveIds.length === 0) return { idle, busy };
  const saves = await em.find(Save, { basesaveid: { $in: saveIds } }, { fields: ["basesaveid", "buildingdata"] });
  for (const save of saves) (busyWorkers(save.buildingdata) === 0 ? idle : busy).add(save.basesaveid);
  return { idle, busy };
};
