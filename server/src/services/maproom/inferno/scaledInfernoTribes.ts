import type { TypeOf } from "zod";
import { resourcesHandler } from "../../../controllers/base/save/handlers/resourceHandler.js";
import { SaveKeys } from "../../../enums/SaveKeys.js";
import { saveFailureErr } from "../../../errors/errors.js";
import { InfernoMaproom } from "../../../database/models/infernomaproom.model.js";
import { Save } from "../../../database/models/save.model.js";
import { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { BaseSaveSchema } from "../../../schemas/BaseSaveSchema.js";
import { molochTribes } from "../../../game-data/tribes/inferno/molochTribes.js";
import { championsAfterAttack } from "../../base/combat/attackerRow.js";

type BaseSaveData = TypeOf<typeof BaseSaveSchema>;

/**
 * Persists Inferno tribe attack state (building health, monsters, destroyed) to
 * the player's InfernoMaproom.tribedata record
 *
 * @param {User} user - The attacking user
 * @param {BaseSaveData} saveData - Parsed save payload from the client
 * @returns {Promise<Save>} Synthetic Save reflecting updated tribe state
 */
export const scaledInfernoTribes = async (user: User, saveData: BaseSaveData) => {
  const userSave = user.save!;
  const userInfernoSave = user.infernosave;
  const currentSave = userInfernoSave || userSave!;

  const maproomInferno = await postgres.em.findOne(InfernoMaproom, {
    userid: user.userid,
  });

  if (!maproomInferno) throw new Error(`Inferno MapRoom not found for userid: ${user.username}`);

  let existingTribe = maproomInferno.tribedata.find(
    (tribe) => tribe.baseid === saveData.baseid
  );

  if (!existingTribe) throw saveFailureErr();

  existingTribe.tribeHealthData = saveData.buildinghealthdata;
  existingTribe.monsters = saveData.monsters;
  existingTribe.destroyed = saveData.destroyed;
  existingTribe.destroyedAt = saveData.destroyed && getCurrentDateTime();

  // Update the wild monster status on the user save
  currentSave.wmstatus.forEach((tribe) => {
    if (tribe[0] === Number(saveData.baseid)) tribe[2] = saveData.destroyed ?? 0;
  });

  const tribeData = molochTribes.find(
    (tribe) => tribe.baseid === saveData.baseid
  );

  const tribeSave = Object.assign(new Save(), {
    ...tribeData,
    baseid: saveData.baseid,
    buildinghealthdata: existingTribe?.tribeHealthData || {},
    monsters: existingTribe.monsters ?? tribeData?.monsters,
  });

  postgres.em.persist(maproomInferno);

  for (const key of Object.keys(saveData) as (keyof typeof saveData)[]) {
    const value = saveData[key];

    switch (key) {
      case SaveKeys.ATTACKCREATURES:
        currentSave.monsters = value;
        break;

      case SaveKeys.ATTACKERCHAMPION:
        // Only health, only downwards, for a champion the log flung, as a
        // Map Room 1 or 2 attack takes it (#23, C1): the client's list once
        // replaced the main yard's, so it could add a Krallen or raise any
        // champion's level.
        if (saveData.attackerchampion) {
          userSave.champion = championsAfterAttack(userSave.champion, saveData.attackerchampion, saveData.flinglog);
        }
        break;

      case SaveKeys.ATTACKLOOT:
        if (userInfernoSave)
          resourcesHandler(userSave, value, { key: SaveKeys.IRESOURCES });
        break;
    }
  }
  postgres.em.persist(userSave);
  await postgres.em.flush();
  return tribeSave;
};
