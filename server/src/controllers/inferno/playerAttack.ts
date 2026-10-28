import { LockMode, type EntityManager } from "@mikro-orm/core";

import { InfernoMaproom } from "../../database/models/infernomaproom.model.js";
import { Save } from "../../database/models/save.model.js";
import { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { AttackPermission } from "../../enums/MapRoom.js";
import { infernoAttackRefusedErr, noInfernoYardErr } from "../../errors/errors.js";
import type { DefenderForces } from "../../game-rules/combat/index.js";
import { isDeclareWarRunning, runningPowerups } from "../../services/alliance/powerups.js";
import { newAttackSession } from "../../services/base/attackSession.js";
import { playerLevelOf } from "../../services/base/calculateBaseLevel.js";
import { academyLevels } from "../../services/base/combat/abandonedAttack.js";
import { servedDefenderForces } from "../../services/base/combat/defenderForces.js";
import { mapSaveData } from "../../services/base/mapSaveData.js";
import { isBot } from "../../services/bots/isBot.js";
import { purseAmounts } from "../../services/inferno/descent.js";
import { attackedAt } from "../../services/inferno/infernoNeighbours.js";
import { closeExpiredInfernoPlayerAttackOn } from "../../services/inferno/infernoPlayerFinalise.js";
import { endInfernoPlayerSession, startInfernoPlayerSession } from "../../services/inferno/infernoPlayerSession.js";
import { infernoAttackPermission, permitsAttack, vengeanceLeft } from "../../services/inferno/infernoPvp.js";
import { infernoTribeFlingCapacity, infernoYardLevel } from "../../services/inferno/infernoTribes.js";
import { ATTACK_ONLINE_SECONDS, isPlayerOnline } from "../../services/user/online.js";
import { countsOf, type Counts } from "../../services/yard/attackRoster.js";
import { catchUpYard } from "../../services/yard/catchUp.js";
import type { AttackDetails } from "../base/load/modes/baseModeAttack.js";
import { caughtUpInfernoYard } from "./tribeAttack.js";

/**
 * `POST /bm/inferno/attack/start` with kind `"player"` (`docs/design/inferno.md`
 * §2.7, §3.2, WP 3.2): starts an attack on another player's Inferno yard and
 * mints its session.
 *
 * Refused (`infernoAttackRefusedErr`, 409) before anything is written for a
 * base that is not another real player's live Inferno yard
 * (`notInfernoPlayer`: none, the player's own, one its owner no longer plays,
 * or a bot's, R10); a yard under damage protection (`protected`, with
 * `protectedUntil`), being attacked (`targetUnderAttack`, with `attacker`),
 * out of range with no revenge left (`outOfRange`, `PlayerHandler.as:98-121`
 * codes 5, 7 and 3); an owner playing now (`ownerOnline`: the main yard's
 * rule, #271, where Flash looked only at the Inferno yard's last 62 seconds,
 * `PlayerHandler.as:217`; owner to confirm); or no monsters in the Housing
 * Bunkers (`noMonsters`). `409 noInfernoYard` without an Inferno yard of
 * one's own, `409 underAttack` while it is attacked. One attack per yard,
 * failing closed: `targetUnderAttack` too while the yard's last attack is
 * still open, or past its window but could not be closed, and the session is
 * minted under the yard's lock, never over another's (SET NX).
 *
 * The attack is fought as a tribe attack is (`tribeAttack.ts`): the Inferno
 * yard's Housing Bunker army only, at its Infernal Academy's levels, a
 * Housing Bunker's load per fling (R11), no champion, catapult or siege. The
 * defender's yard is the real row: caught up under its lock, then marked as
 * attacked (`attacks`, `attackid`) as a surface attack marks it
 * (`baseModeAttack.ts`). Its housed monsters defend from its Housing Bunkers
 * at its own academy's levels. The loot comes from the defender's Inferno
 * purse (their main save's `iresources`), frozen in the session. Attacking
 * ends the attacker's own Inferno protection (`map_msg_protection`).
 */

/** What the start answers for a player: the yard and everything the client fights it with. */
export interface InfernoPlayerAttackStart {
  kind: "player";
  yardkind: "inferno";
  attackid: number;
  /** The defender's Inferno yard level. */
  level: number;
  /** The defender's name. */
  ownername: string;
  base: Partial<Save>;
  defenderforces: DefenderForces;
  /** The Inferno yard's base id: the army's yard, for the save's `monsterupdate`. */
  armybaseid: string;
  army: Counts;
  attackeracademy: Record<string, number>;
  attackerlevel: number;
  attpowerups: unknown[];
  flingercapacity: number;
}

/**
 * The yard `baseid` names when it is another real player's live Inferno
 * yard, read without a lock; else `notInfernoPlayer`.
 */
export const targetYard = async (em: EntityManager, user: User, baseid: string): Promise<{ yard: Save; main: Save }> => {
  const yard = /^\d+$/.test(baseid) ? await em.findOne(Save, { baseid }) : null;
  if (!yard || yard.type !== BaseType.INFERNO || yard.userid === user.userid) {
    throw infernoAttackRefusedErr("notInfernoPlayer");
  }
  const main = await em.findOne(Save, { userid: yard.userid, type: BaseType.MAIN });
  if (!main || String(main.baseid_inferno) !== yard.baseid || (await isBot(yard.userid, em as never))) {
    throw infernoAttackRefusedErr("notInfernoPlayer");
  }
  return { yard, main };
};

/** Refuses an attack the permission does not allow, with Flash's reason. */
const requirePermitted = (permission: AttackPermission, yard: Pick<Save, "protected" | "attacks">): void => {
  if (permitsAttack(permission)) return;
  if (permission === AttackPermission.DAMAGE_PROTECTION) {
    throw infernoAttackRefusedErr("protected", { protectedUntil: Number(yard.protected) });
  }
  if (permission === AttackPermission.UNDER_ATTACK) {
    throw infernoAttackRefusedErr("targetUnderAttack", { attacker: yard.attacks.at(-1)?.name ?? "" });
  }
  throw infernoAttackRefusedErr("outOfRange");
};

/**
 * Starts an attack on the Inferno yard `baseid` for `user` (the rules above).
 *
 * @param now - Unix seconds.
 */
export const startInfernoPlayerAttack = async (
  em: EntityManager,
  user: User,
  baseid: string,
  now: number
): Promise<InfernoPlayerAttackStart> => {
  await em.populate(user, ["save"]);
  const main = user.save!;
  if (!(Number(main.baseid_inferno) > 0)) throw noInfernoYardErr();

  const target = await targetYard(em, user, baseid);
  // The yard's last attack, if its window closed without a save, lands first.
  // One still open, or that could not be closed, keeps the yard attacked:
  // never two attacks on one yard at once (fail closed).
  const closed = await closeExpiredInfernoPlayerAttackOn(target.yard.basesaveid, "superseded");
  if (closed !== "none" && closed !== "landed" && closed !== "released" && closed !== "stale") {
    throw infernoAttackRefusedErr("targetUnderAttack", { attacker: target.yard.attacks?.at(-1)?.name ?? "" });
  }
  const maproom = await em.findOne(InfernoMaproom, { userid: user.userid });
  const vengeance = vengeanceLeft(maproom?.neighbors?.find((entry) => entry.userid === target.yard.userid));

  const permissionOf = (yard: Save, mine: number) =>
    infernoAttackPermission({
      mine,
      theirs: infernoYardLevel(yard),
      vengeance,
      protectedUntil: Number(yard.protected),
      underAttack: attackedAt(yard, now),
      now,
    });

  // Refused before the attacker's yard is touched, on the unlocked rows; the
  // defender's row is checked again under its lock below.
  requirePermitted(permissionOf(target.yard, infernoYardLevel(await ownYardUnlocked(em, main))), target.yard);
  if (await isPlayerOnline(target.yard.userid, now, ATTACK_ONLINE_SECONDS)) throw infernoAttackRefusedErr("ownerOnline");

  const inferno = await caughtUpInfernoYard(em, user, main, now);
  const mine = infernoYardLevel(inferno);

  const army: Counts = {};
  for (const [id, count] of Object.entries(countsOf(inferno.monsters?.housed))) {
    if (count > 0) army[id] = count;
  }
  const declareWar = await isDeclareWarRunning(user.alliance_id);
  const flingerCapacity = infernoTribeFlingCapacity(inferno.buildingdata, declareWar);
  if (Object.keys(army).length === 0 || flingerCapacity <= 0) throw infernoAttackRefusedErr("noMonsters");

  const attackerAcademy = academyLevels(inferno.academy);
  const attackerLevel = playerLevelOf(main);
  const purse = purseAmounts(target.main.iresources);

  // The session is minted under the yard's lock, never over another attack's
  // (SET NX): of two starts at once, only one gets the yard. Should the mark
  // then fail to commit, the session goes with it.
  let minted: number | null = null;
  const marked = em.transactional(async (tx) => {
    const locked = await tx.findOne(
      Save,
      { basesaveid: target.yard.basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );
    if (!locked || locked.type !== BaseType.INFERNO || locked.userid !== target.yard.userid) {
      throw infernoAttackRefusedErr("notInfernoPlayer");
    }
    requirePermitted(permissionOf(locked, mine), locked);

    // The defender's yard as it is now, then marked as attacked.
    catchUpYard(locked, now);
    if (locked.attacks.length > 3) locked.attacks = locked.attacks.slice(-2);
    const lastAttacker = locked.attacks.at(-1)?.name ?? "";
    const attack: AttackDetails = {
      fbid: "",
      name: user.username,
      pic_square: user.pic_square ?? undefined,
      friend: 0,
      count: 1,
      starttime: now,
      seen: false,
    };
    locked.attacks = [...locked.attacks, attack];
    locked.attackid = Math.floor(Math.random() * 99999) + 1;

    const defenderForces = await servedDefenderForces(locked, main, now);
    const started = await startInfernoPlayerSession(locked.basesaveid, {
      baseid: locked.baseid,
      flingerCapacity,
      session: newAttackSession(
        user.userid,
        locked.attackid,
        { [inferno.baseid]: army },
        purse,
        attackerLevel,
        undefined,
        defenderForces,
        undefined,
        attackerAcademy,
        declareWar
      ),
    });
    if (!started) throw infernoAttackRefusedErr("targetUnderAttack", { attacker: lastAttacker });
    minted = locked.attackid;

    await tx.flush();
    return { yard: locked, defenderForces };
  });
  const { yard, defenderForces } = await marked.catch(async (err) => {
    if (minted !== null) await endInfernoPlayerSession(target.yard.basesaveid, minted);
    throw err;
  });

  // Attacking anyone ends one's own Inferno protection (`map_msg_protection`).
  if (Number(inferno.protected) > 0) {
    await em.nativeUpdate(Save, { basesaveid: inferno.basesaveid }, { protected: 0 });
  }

  const owner = await em.findOne(User, { userid: yard.userid }, { fields: ["username"] });
  const base = await mapSaveData(yard, user, { attack: true });
  // The loot is the defender's Inferno purse, as the session froze it.
  base.resources = { ...purse } as Save["resources"];

  return {
    kind: "player",
    yardkind: "inferno",
    attackid: yard.attackid,
    level: infernoYardLevel(yard),
    ownername: owner?.username ?? "",
    base,
    defenderforces: defenderForces,
    armybaseid: inferno.baseid,
    army,
    attackeracademy: attackerAcademy,
    attackerlevel: attackerLevel,
    attpowerups: await runningPowerups(user.alliance_id),
    flingercapacity: flingerCapacity,
  };
};

/** The caller's own Inferno yard, read without a lock, for the first range check. */
const ownYardUnlocked = async (em: EntityManager, main: Save): Promise<Save> => {
  const yard = await em.findOne(Save, { baseid: String(main.baseid_inferno) });
  if (!yard || yard.type !== BaseType.INFERNO || yard.userid !== main.userid) throw noInfernoYardErr();
  return yard;
};
