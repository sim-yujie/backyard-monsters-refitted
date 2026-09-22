import { MapRoomVersion } from "../../../../enums/MapRoom.js";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { postgres } from "../../../../server.js";
import { tribeSaveHandler } from "../../../../services/maproom/tribeSaveHandler.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { MR1_TRIBE_IDS } from "../../../../game-data/tribes/v1/index.js";
import { isWildMonsterExpired } from "../../../../services/maproom/wildMonsterExpiry.js";

/**
 * Handles viewing the base mode for a given base ID.
 * If the save is outdated for a wild monster, it removes the old save and creates a new one.
 *
 * @param {string} baseid - The base identifier for the requested save.
 * @param {MapRoomVersion} mapversion - The version of the map to determine the save handling logic.
 * @param {string} worldid - The world UUID, passed through for MR3 player yard defender lookups.
 * @returns {Promise<Loaded<Save, never>>} The save object or null if no valid save is found.
 */
export const baseModeView = async (baseid: string, mapversion: MapRoomVersion = MapRoomVersion.V2, worldid: string | null | undefined, user: User) => {
  if (mapversion === MapRoomVersion.V1 && MR1_TRIBE_IDS.has(baseid))
    return tribeSaveHandler(baseid, mapversion, worldid, user);

  let save = await postgres.em.findOne(Save, { baseid });

  if (!save) save = await tribeSaveHandler(baseid, mapversion, worldid, user);

  // Opening the yard is the one place allowed to write, so it reclaims the row and
  // regenerates the camp. Read-only paths share the same rule via isWildMonsterExpired
  // but only report the camp as fresh - see wildMonsterCell and worldSnapshot.
  if (mapversion !== MapRoomVersion.V3 && isWildMonsterExpired(save, getCurrentDateTime())) {
    postgres.em.remove(save!);
    await postgres.em.flush();
    save = await tribeSaveHandler(baseid, mapversion, worldid, user);
  }

  return save;
};
