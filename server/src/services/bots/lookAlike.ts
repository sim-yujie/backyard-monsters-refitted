import type { Save } from "../../database/models/save.model.js";
import { MR1_TRIBES } from "../../enums/Tribes.js";
import { extractTownHall } from "../../utils/extractTownHall.js";
import { mr1TribeStatuses } from "../maproom/v1/mr1TribeRules.js";

/**
 * What a player's own visits leave in their save that a bot, which never
 * opens a screen, would otherwise lack (issue #245, decision 3 of
 * `docs/design/bot-neighbours.md`). An attacker's view and attack loads send
 * the whole save, so a field only real players fill is a tell.
 *
 * - **Map Room 1's tribes** ({@link visitMapRoom1}): opening Map Room 1
 *   (`getMapRoom1`) writes the four current tribes into `wmstatus`. Every Map
 *   Room 1 player who has looked for someone to attack has them; a bot gets
 *   them when it is made and on each grow, as a player opening the map now
 *   and then would.
 *
 * Pure; the factory and the sweep call it on the save they are writing.
 */

/**
 * `wmstatus` as opening Map Room 1 leaves it (`getMapRoom1`): the four
 * current tribes' entries written over any earlier ones, the rest kept.
 * Reads `level`, which the caller has set.
 */
export const visitMapRoom1 = (save: Pick<Save, "buildingdata" | "wmstatus" | "level">): void => {
  const townHall = extractTownHall(save.buildingdata ?? {});
  const statuses = mr1TribeStatuses(townHall?.l ?? 1, MR1_TRIBES, save.level, save.wmstatus);
  const wmstatus = new Map((save.wmstatus ?? []).map((status) => [status[0], status]));
  statuses.forEach((status) => wmstatus.set(status[0], status));
  save.wmstatus = [...wmstatus.values()];
};
