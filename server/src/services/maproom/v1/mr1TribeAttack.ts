import { Maproom } from "../../../database/models/maproom.model.js";
import type { User } from "../../../database/models/user.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { MR1_TRIBES } from "../../../enums/Tribes.js";
import { mr1TribeRefusedErr } from "../../../errors/errors.js";
import { postgres } from "../../../server.js";
import { extractTownHall } from "../../../utils/extractTownHall.js";
import { currentMR1Tribes, mr1TribeRespawnAt, mr1TribeRespawned, respawnMR1Tribe } from "./mr1TribeRules.js";

/**
 * Refuses a Map Room 1 tribe attack the player could not have started from
 * their map (issue #161), before anything is written: a player no longer on
 * Map Room 1, a tribe base that is not one of the four they face now (another
 * tier's, or the tutorial camp's), or a tribe still wrecked. A wrecked tribe
 * whose time is up is stood back up here, as the map would on its next read.
 *
 * @param {User} user - The attacker, with `save` populated.
 * @param {string} baseid - The tribe base.
 * @param {number} now - Server seconds.
 */
export const requireAttackableMR1Tribe = async (user: User, baseid: string, now: number): Promise<void> => {
  const userSave = user.save!;

  if (userSave.mapversion !== MapRoomVersion.V1) throw mr1TribeRefusedErr("notMapRoom1");

  const townHall = extractTownHall(userSave.buildingdata ?? {});
  const tribes = currentMR1Tribes(townHall?.l ?? 1, MR1_TRIBES);

  if (!tribes.some((tribe) => tribe.template.baseid === baseid)) throw mr1TribeRefusedErr("notYourTribe");

  const maproom = await postgres.em.findOne(Maproom, { userid: user.userid });
  const tribe = maproom?.tribedata.find((entry) => entry.baseid === baseid);

  if (!maproom || !tribe?.destroyed) return;

  if (!mr1TribeRespawned(tribe, now)) {
    throw mr1TribeRefusedErr("tribeDestroyed", { respawnAt: mr1TribeRespawnAt(tribe) });
  }

  respawnMR1Tribe(tribe);
  userSave.wmstatus?.forEach((status) => {
    if (status[0] === Number(baseid)) status[2] = 0;
  });

  postgres.em.persist(maproom);
  postgres.em.persist(userSave);
  await postgres.em.flush();
};
