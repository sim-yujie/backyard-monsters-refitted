import type { EntityManager } from "@mikro-orm/core";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { Status } from "../../enums/StatusCodes.js";
import { infernoAttackRefusedErr } from "../../errors/errors.js";
import { academyRanks, type DefenderForces } from "../../game-rules/combat/index.js";
import { postgres } from "../../server.js";
import { isDeclareWarRunning, runningPowerups } from "../../services/alliance/powerups.js";
import { brainsOf, newAttackSession } from "../../services/base/attackSession.js";
import { academyLevels } from "../../services/base/combat/abandonedAttack.js";
import { poolAmounts } from "../../services/base/combat/attackLoot.js";
import { servedDefenderForces } from "../../services/base/combat/defenderForces.js";
import { mapSaveData } from "../../services/base/mapSaveData.js";
import {
  descentBaseidOf,
  descentFlingerCapacity,
  descentIndexOf,
  descentLevelOf,
  descentRefusal,
  descentYardOf,
  flingerLevelOf,
  nextDescentIndex,
  purseAmounts,
} from "../../services/inferno/descent.js";
import { startDescentSession } from "../../services/inferno/descentSession.js";
import { requireInfernoEnabled } from "../../services/inferno/infernoGate.js";
import { readInfernoProgress } from "../../services/inferno/infernoProgress.js";
import { catchUpArmiesForAttack } from "../../services/yard/armies.js";
import { getCurrentDateTime } from "../../utils/getCurrentDateTime.js";
import type { KoaController } from "../../utils/KoaController.js";

/**
 * `POST /bm/inferno/attack/start` (`docs/design/inferno.md` §3.2, WP 1.11):
 * starts an Inferno attack and mints its attack session. Only the kind
 * `"descent"` is built so far: the next of the 13 Descent yards.
 *
 * Every refusal comes before anything is written (`infernoAttackRefusedErr`,
 * 409): the cave not up all five levels, the Descent passed, a base that is
 * not a Descent yard or not the next one. Then the attacker's main yard is
 * caught up and what it houses is kept in the session, as for a Map Room 1
 * attack: the Descent is fought with the main army only, never an outpost's
 * (`ATTACK.as:589-591`). The Flinger payload is the main table's at the
 * attacker's own Flinger level (`descentFlingerCapacity`), kept with the
 * session. No catapult and no siege (`UI_TOP.as:289`, `:296`).
 *
 * The yard is fought as an Inferno yard (§2.4 "Yard kind"): kind `"inferno"`,
 * so the Inferno building table (`INFERNOYARDPROPS`), with its housed
 * monsters defending from its Housing Bunkers (`defenderforces`). It is the
 * data file's yard with the health it kept from the player's earlier attacks
 * on it (`inferno_progress.descent_yards`).
 */

/** What the start answers: the yard and everything the client fights it with. */
export interface DescentAttackStart {
  kind: "descent";
  /** The engine's yard kind the battle is fought as. */
  yardkind: "inferno";
  attackid: number;
  /** Flash's Descent counter before this attack, 1-13. */
  level: number;
  /** The yard, as an attack load serves one. */
  base: Partial<Save>;
  defenderforces: DefenderForces;
  attackerbrains: ReturnType<typeof brainsOf>;
  attackeracademy: Record<string, number>;
  attackerranks?: ReturnType<typeof academyRanks>;
  /** The alliance powers running for the attacker (Declare War's countdown). */
  attpowerups: unknown[];
  /** What one fling may carry. */
  flingercapacity: number;
  /** The Inferno purse now: the Descent's running loot total. */
  descentloot: ReturnType<typeof purseAmounts>;
}

/**
 * Starts a Descent attack on `baseid` for `user` (the rules above).
 *
 * @param now - Unix seconds.
 * @throws {ClientSafeError} `infernoAttackRefusedErr` when it may not start.
 */
export const startDescentAttack = async (
  em: EntityManager,
  user: User,
  baseid: string,
  now: number
): Promise<DescentAttackStart> => {
  await em.populate(user, ["save"]);
  const progress = await readInfernoProgress(em, user.userid);
  const refusal = descentRefusal(progress, baseid);
  if (refusal) {
    const next = nextDescentIndex(progress);
    throw infernoAttackRefusedErr(refusal, next === null ? {} : { next: descentBaseidOf(next) });
  }

  const index = descentIndexOf(baseid)!;
  const template = descentYardOf(index);
  const kept = progress.descentYards[descentBaseidOf(index)];
  const yard = Object.assign(new Save(), {
    ...structuredClone(template),
    baseid: descentBaseidOf(index),
    buildinghealthdata: { ...(kept?.health ?? {}) },
    attackid: Math.floor(Math.random() * 99999) + 1,
  });

  // The main yard caught up, and what it houses kept: the Descent is fought
  // from the main yard only, as a Map Room 1 attack is.
  const armies = await catchUpArmiesForAttack({ user, defender: yard, cell: null, mapversion: MapRoomVersion.V1 });
  const userSave = user.save!;

  const defenderForces = await servedDefenderForces(yard, userSave, now);
  const championBrains = brainsOf(userSave.champion);
  const attackerAcademy = academyLevels(userSave.academy);
  const attackerRanks = academyRanks(userSave.academy);
  const declareWar = await isDeclareWarRunning(user.alliance_id);
  const flingerCapacity = descentFlingerCapacity(flingerLevelOf(userSave.buildingdata), declareWar);

  await startDescentSession(user.userid, {
    baseid: yard.baseid,
    flingerCapacity,
    session: newAttackSession(
      user.userid,
      yard.attackid,
      armies.entryHoused,
      undefined,
      undefined,
      poolAmounts(userSave.resources),
      defenderForces,
      championBrains,
      attackerAcademy,
      declareWar,
      attackerRanks
    ),
  });

  return {
    kind: "descent",
    yardkind: "inferno",
    attackid: yard.attackid,
    level: descentLevelOf(progress),
    base: await mapSaveData(yard, user, { attack: true }),
    defenderforces: defenderForces,
    attackerbrains: championBrains,
    attackeracademy: attackerAcademy,
    ...(Object.keys(attackerRanks).length > 0 && { attackerranks: attackerRanks }),
    attpowerups: await runningPowerups(user.alliance_id),
    flingercapacity: flingerCapacity,
    descentloot: purseAmounts(userSave.iresources),
  };
};

export const infernoAttackStart: KoaController = async (ctx) => {
  requireInfernoEnabled();
  const body = (ctx.request.body ?? {}) as { kind?: unknown; baseid?: unknown };
  if (body.kind !== "descent") throw infernoAttackRefusedErr("kindNotReady");

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    ...(await startDescentAttack(postgres.em, ctx.authUser, String(body.baseid ?? ""), getCurrentDateTime())),
  };
};
