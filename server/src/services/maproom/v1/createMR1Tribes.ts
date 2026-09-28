import { TribeScale } from "../../../enums/Tribes.js";
import { Maproom } from "../../../database/models/maproom.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { extractTownHall } from "../../../utils/extractTownHall.js";
import { currentMR1Tribes, mr1TribeRespawned, respawnMR1Tribe } from "./mr1TribeRules.js";

export interface MR1TribeScaleConfig {
  [TribeScale.NEW]: { maxLevel: number };     // Town Hall 1–2
  [TribeScale.TH3]: { maxLevel: number };     // Town Hall 3
  [TribeScale.TH4]: { maxLevel: number };     // Town Hall 4
  [TribeScale.TH5]: { maxLevel: number };     // Town Hall 5
  [TribeScale.HIGH]: { maxLevel: number };    // Town Hall 6 >
}

/**
 * Returns an array of scaled MR1 tribes based on the player's Town Hall level.
 *
 * Each scale maps to a different baseid per tribe type so the client loads
 * the appropriate difficulty variant. The wmstatus level is set dynamically
 * relative to the player's level so tribes always pass the client's
 * _baseLevel - 10 display filter.
 *
 * Destroyed tribes respawn after 10 minutes. There is no tutorial camp any
 * more: every account faces its Town Hall's tier (`currentMR1Tribes`).
 *
 * @param {Save} save - The player's main save
 * @param {MR1TribeScaleConfig} tribes - Town Hall level thresholds per scale (max TH level is 10)
 * @returns {Promise<number[][]>} wmstatus array of [baseid, level, destroyed] tuples
 */
export const createMR1Tribes = async (save: Save, tribes: MR1TribeScaleConfig) => {
  const { userid, wmstatus, level } = save;
  const playerLevel = Math.max(1, level);
  const levelPattern = [-1, 0, 1, 2];

  const townHall = extractTownHall(save.buildingdata ?? {});
  const thLevel = townHall?.l ?? 1;

  const currentTime = getCurrentDateTime();

  let persist = false;

  const scaledTribes = currentMR1Tribes(thLevel, tribes).map((slot) => slot.template);
  const scaledBaseIds = new Set(scaledTribes.map((tribe) => Number(tribe.baseid)));

  let maproom = await postgres.em.findOne(Maproom, { userid });

  if (!maproom) {
    const user = await postgres.em.findOne(User, { userid });

    if (!user) throw new Error(`User not found for userid: ${userid}`);

    maproom = await Maproom.setupMapRoomData(postgres.em, user);
  }

  // Only store tribedata within the user's current level range
  const currentTribes = maproom.tribedata.filter((tribe) =>
    scaledBaseIds.has(Number(tribe.baseid))
  );

  // Respawn tribes destroyed at least 10 minutes ago
  for (const tribe of maproom.tribedata) {
    if (mr1TribeRespawned(tribe, currentTime)) {
      const status = wmstatus?.findIndex((status) => status[0] === Number(tribe.baseid));

      if (status !== undefined && status !== -1) wmstatus![status][2] = 0;

      respawnMR1Tribe(tribe);
      persist = true;
    }
  }

  if (currentTribes.length !== maproom.tribedata.length) persist = true;

  maproom.tribedata = currentTribes;

  if (persist) {
    postgres.em.persist(maproom);
    await postgres.em.flush();
  }

  return scaledTribes.map((tribe, i) => {
    const tribeLevel = Math.max(1, playerLevel + levelPattern[i]);
    const tribeStatus = wmstatus?.find((s) => s[0] === Number(tribe.baseid));
    const isDestroyed = tribeStatus ? tribeStatus[2] || 0 : 0;
    return [Number(tribe.baseid), tribeLevel, isDestroyed];
  });
};
