import { Save } from "../../../database/models/save.model.js";
import type { User } from "../../../database/models/user.model.js";
import { MapRoomVersion } from "../../../enums/MapRoom.js";
import { lastAttackLandingErr } from "../../../errors/errors.js";
import { academyRanks } from "../../../game-rules/combat/index.js";
import { postgres } from "../../../server.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { brainsOf, healthOf, newAttackSession } from "../../base/attackSession.js";
import { mintAttackId } from "../../base/claimAttack.js";
import { academyLevels } from "../../base/combat/abandonedAttack.js";
import { poolAmounts } from "../../base/combat/attackLoot.js";
import { servedDefenderForces } from "../../base/combat/defenderForces.js";
import { readRowlessCheckpoint } from "../../base/rowlessCheckpoint.js";
import { recordQuestEvents } from "../../quests/record.js";
import { catchUpArmiesForAttack } from "../../yard/armies.js";
import { startEventYardSession } from "./eventYardSession.js";
import { requireAttackableEventYard } from "./yardEventGate.js";

/**
 * Starts an attack on a Brukkarg event yard (beta 10, bruk-port): the attack
 * load's (`/base/load`, `wmattack`) branch for an event yard id, from
 * `baseModeAttack`, for a player on any Map Room.
 *
 * Fought as a Map Room 1 tribe is (`mr1TribeSession.ts`, issue #161): the
 * yard has no row (each player fights their own copy, its damage in
 * `bym.event_yard`), the army is the main yard's housing alone (Flash flung
 * event attacks from home), and the session is keyed by the attacker and the
 * yard. Unlike a Map Room 2 camp it takes no range, cell, damage protection
 * or Discord age check: it is not on any map and no other player is touched.
 *
 * Refused before anything is written: by the event's rules
 * (`requireAttackableEventYard`), or while the player's last attack on this
 * yard is still landing.
 */
export const startEventYardAttack = async ({
  user,
  baseid,
  attackerLevel,
}: {
  user: User;
  baseid: string;
  attackerLevel?: number;
}) => {
  const userSave = user.save!;
  const now = getCurrentDateTime();

  // The last attack on this yard still holds its checkpoint: a new one would
  // replace it and lose that attack (as `baseModeAttack` waits for an MR1 tribe).
  if (await readRowlessCheckpoint({ kind: "event", userid: user.userid, baseid })) throw lastAttackLandingErr();

  const target = await requireAttackableEventYard(postgres.em, user.userid, userSave, baseid, now);

  // The main yard caught up and written, and what its housing holds kept in the
  // session (`entryHoused`), as a Map Room 1 attack does (no cell: main yard only).
  const armies = await catchUpArmiesForAttack({
    user,
    defender: Object.assign(new Save(), target.yard),
    cell: null,
    mapversion: MapRoomVersion.V1,
  });
  const save = armies.defender;
  save.attackid = mintAttackId(0);

  postgres.em.persist(userSave);
  await postgres.em.flush();
  await recordQuestEvents(postgres.em, userSave.basesaveid, armies.attackerHatched);

  const defenderForces = await servedDefenderForces(save, userSave);
  const championBrains = brainsOf(userSave.champion);
  const championHealth = healthOf(userSave.champion);
  const attackerAcademy = academyLevels(userSave.academy);
  const attackerRanks = academyRanks(userSave.academy);

  await startEventYardSession(
    user.userid,
    baseid,
    newAttackSession(
      user.userid,
      save.attackid,
      armies.entryHoused,
      undefined,
      attackerLevel,
      poolAmounts(userSave.resources),
      defenderForces,
      championBrains,
      attackerAcademy,
      attackerRanks,
      championHealth
    )
  );

  return { save, defenderForces, championBrains, championHealth, attackerAcademy, attackerRanks };
};
