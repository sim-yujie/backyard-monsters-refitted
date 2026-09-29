import { BaseType } from "../../../enums/Base.js";
import { Save } from "../../../database/models/save.model.js";
import { defenderForcesOf, type DefenderForces } from "../../../game-rules/combat/index.js";
import { postgres } from "../../../server.js";

/**
 * The defence an attack load serves (issue #195): the target row's bunker
 * garrisons and caged champion, at the academy levels of the player who owns
 * it, which for an outpost are its owner's main yard's (Q14). The load keeps it
 * in the attack session and hands the same to the client, so both fight one
 * defence.
 *
 * @param save - The row being attacked.
 */
export const servedDefenderForces = async (save: Save): Promise<DefenderForces> =>
  defenderForcesOf({
    buildingdata: save.buildingdata,
    academy: await defendingAcademy(save),
    champion: save.champion,
  });

/** The academy the row's monsters fight at: its own, or its owner's main yard's for an outpost. */
const defendingAcademy = async (save: Save): Promise<Save["academy"]> => {
  if (save.type !== BaseType.OUTPOST) return save.academy;
  const owner = await postgres.em.findOne(
    Save,
    { saveuserid: save.saveuserid, type: BaseType.MAIN },
    { fields: ["academy"] }
  );
  return owner?.academy ?? null;
};
