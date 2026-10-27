import { LockMode, type EntityManager } from "@mikro-orm/core";

import { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { infernoAttackRefusedErr, noInfernoYardErr } from "../../errors/errors.js";
import type { DefenderForces } from "../../game-rules/combat/index.js";
import { isDeclareWarRunning, runningPowerups } from "../../services/alliance/powerups.js";
import { newAttackSession } from "../../services/base/attackSession.js";
import { playerLevelOf } from "../../services/base/calculateBaseLevel.js";
import { academyLevels } from "../../services/base/combat/abandonedAttack.js";
import { servedDefenderForces } from "../../services/base/combat/defenderForces.js";
import { mapSaveData } from "../../services/base/mapSaveData.js";
import { syncInfernoCap } from "../../services/inferno/infernoLoad.js";
import { infernoTribeOf, loadInfernoTribes } from "../../services/inferno/infernoTribeMap.js";
import {
  infernoTribeFlingCapacity,
  infernoTribeRespawnAt,
  infernoTribeYardOf,
  infernoYardLevel,
  isInfernoTribeBaseid,
} from "../../services/inferno/infernoTribes.js";
import { startInfernoTribeSession } from "../../services/inferno/infernoTribeSession.js";
import { countsOf, type Counts } from "../../services/yard/attackRoster.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import { lockInfernoRow } from "../yard/yardAction.js";

/**
 * `POST /bm/inferno/attack/start` with kind `"tribe"` (`docs/design/inferno.md`
 * §2.7, §3.2, WP 2.8): starts an attack on one of the player's seven Moloch
 * tribes and mints its session.
 *
 * Refused (`infernoAttackRefusedErr`, 409) for a base that is not a tribe
 * (`notInfernoTribe`), a tribe of another tier than the Inferno yard's level
 * faces (`notYourTribe`), one still wrecked (`tribeDestroyed`, with
 * `respawnAt`), or an Inferno yard housing no monsters (`noMonsters`,
 * `maproom_inferno/PlayerHandler.as:300-310`); `409 noInfernoYard` without an
 * Inferno yard, `409 underAttack` while it is attacked.
 *
 * The attack is fought from the Inferno yard only: its Housing Bunkers' monsters
 * are the army (`entryHoused`, keyed by its base id), at its Infernal
 * Academy's levels, with no champion, catapult or siege (`UI_TOP.as:289`,
 * `:296`). The yard is caught up under its lock first, as a load would, so
 * what has hatched by now can go. One fling carries what a Housing Bunker of
 * the yard's best level holds (`infernoTribeFlingCapacity`, R11).
 *
 * The tribe is fought as an Inferno yard (kind `"inferno"`): the Inferno
 * building table, its housed monsters defending from its Housing Bunkers,
 * and the health it kept from the player's earlier attacks this tribe life.
 */

/** What the start answers for a tribe: the yard and everything the client fights it with. */
export interface InfernoTribeAttackStart {
  kind: "tribe";
  yardkind: "inferno";
  attackid: number;
  /** The tribe's map level. */
  level: number;
  base: Partial<Save>;
  defenderforces: DefenderForces;
  /** The Inferno yard's base id: the army's yard, for the save's `monsterupdate`. */
  armybaseid: string;
  /** What the Inferno yard's Housing Bunkers hold: everything the attack can fling. */
  army: Counts;
  attackeracademy: Record<string, number>;
  /** The player's level, for the low-level loot bonus (`ATTACK.Loot`). */
  attackerlevel: number;
  attpowerups: unknown[];
  /** What one fling may carry. */
  flingercapacity: number;
}

/** The caller's Inferno yard, caught up to `now` and written under its lock, with the main yard's caps synced. */
export const caughtUpInfernoYard = async (em: EntityManager, user: User, main: Save, now: number): Promise<Save> =>
  em.transactional(async (tx) => {
    const lockedMain =
      (await tx.findOne(Save, { basesaveid: main.basesaveid }, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true })) ??
      main;
    if (!(Number(lockedMain.baseid_inferno) > 0)) throw noInfernoYardErr();
    const inferno = await lockInfernoRow(tx, user, String(lockedMain.baseid_inferno));
    catchUpYard(inferno, now);
    syncInfernoCap(lockedMain, inferno);
    await tx.flush();
    return inferno;
  });

/**
 * Starts an attack on tribe `baseid` for `user` (the rules above).
 *
 * @param now - Unix seconds.
 */
export const startInfernoTribeAttack = async (
  em: EntityManager,
  user: User,
  baseid: string,
  now: number
): Promise<InfernoTribeAttackStart> => {
  if (!isInfernoTribeBaseid(baseid)) throw infernoAttackRefusedErr("notInfernoTribe");
  await em.populate(user, ["save"]);
  const main = user.save!;
  if (!(Number(main.baseid_inferno) > 0)) throw noInfernoYardErr();

  const inferno = await caughtUpInfernoYard(em, user, main, now);

  const tribes = await loadInfernoTribes(em, user.userid, infernoYardLevel(inferno), now);
  if (tribes.changed) await em.flush();
  const slot = tribes.slots.find((one) => one.baseid === baseid);
  if (!slot) throw infernoAttackRefusedErr("notYourTribe");
  const kept = infernoTribeOf(tribes.row, baseid);
  if (kept?.destroyed) throw infernoAttackRefusedErr("tribeDestroyed", { respawnAt: infernoTribeRespawnAt(kept) });

  const army: Counts = {};
  for (const [id, count] of Object.entries(countsOf(inferno.monsters?.housed))) {
    if (count > 0) army[id] = count;
  }
  const declareWar = await isDeclareWarRunning(user.alliance_id);
  const flingerCapacity = infernoTribeFlingCapacity(inferno.buildingdata, declareWar);
  if (Object.keys(army).length === 0 || flingerCapacity <= 0) throw infernoAttackRefusedErr("noMonsters");

  const yard = Object.assign(new Save(), {
    ...structuredClone(infernoTribeYardOf(baseid)!),
    baseid,
    buildinghealthdata: { ...(kept?.tribeHealthData ?? {}) },
    attackid: Math.floor(Math.random() * 99999) + 1,
  });

  const defenderForces = await servedDefenderForces(yard, main, now);
  const attackerAcademy = academyLevels(inferno.academy);
  const attackerLevel = playerLevelOf(main);

  await startInfernoTribeSession(user.userid, {
    baseid,
    flingerCapacity,
    session: newAttackSession(
      user.userid,
      yard.attackid,
      { [inferno.baseid]: army },
      undefined,
      attackerLevel,
      undefined,
      defenderForces,
      undefined,
      attackerAcademy,
      declareWar
    ),
  });

  return {
    kind: "tribe",
    yardkind: "inferno",
    attackid: yard.attackid,
    level: slot.level,
    base: await mapSaveData(yard, user, { attack: true }),
    defenderforces: defenderForces,
    armybaseid: inferno.baseid,
    army,
    attackeracademy: attackerAcademy,
    attackerlevel: attackerLevel,
    attpowerups: await runningPowerups(user.alliance_id),
    flingercapacity: flingerCapacity,
  };
};
