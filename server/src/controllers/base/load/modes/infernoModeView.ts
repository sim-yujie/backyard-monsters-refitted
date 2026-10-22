import { molochTribes } from "../../../../game-data/tribes/inferno/molochTribes.js";
import { InfernoMaproom, type TribeData } from "../../../../database/models/infernomaproom.model.js";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { postgres } from "../../../../server.js";
import { BaseType } from "../../../../enums/Base.js";

export const infernoModeView = async (user: User, baseid: string) => {
  // An Inferno view opens Inferno yards only: any base id used to load here,
  // a Map Room 2 yard outside the player's sight among them.
  const save = await postgres.em.findOne(Save, { baseid, type: { $in: [BaseType.INFERNO, BaseType.INFERNO_TRIBE] } });

  if (save) return save;

  const maproomInferno = await postgres.em.findOne(InfernoMaproom, {
    userid: user.userid,
  });

  if (!maproomInferno) throw new Error(`Inferno maproom not found for user: ${user.username}`);

  let existingTribe = maproomInferno.tribedata.find(
    (tribe) => tribe.baseid === baseid
  );

  if (!existingTribe) {
    const newTribe: TribeData = { baseid, tribeHealthData: {} };

    maproomInferno.tribedata.push(newTribe);
    postgres.em.persist(maproomInferno);
    await postgres.em.flush();
  }

  const tribeData = molochTribes.find((tribe) => tribe.baseid === baseid)!;

  return Object.assign(new Save(), {
    ...tribeData,
    baseid,
    buildinghealthdata: existingTribe?.tribeHealthData || {},
    monsters: existingTribe?.monsters ?? tribeData.monsters,
  });
};
