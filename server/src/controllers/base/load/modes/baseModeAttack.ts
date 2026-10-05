import { BaseMode, BaseType } from "../../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../../enums/MapRoom.js";
import { World } from "../../../../database/models/world.model.js";
import { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../../server.js";
import { damageProtection } from "../../../../services/maproom/v2/damageProtection.js";
import { Save } from "../../../../database/models/save.model.js";
import { User } from "../../../../database/models/user.model.js";
import { tribeSaveHandler } from "../../../../services/maproom/tribeSaveHandler.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { validateRange } from "../../../../services/maproom/v2/validateRange.js";
import { cellCoordsFromBaseId } from "../../../../services/maproom/v2/rangeCheck.js";
import { generateBaseId } from "../../../../utils/generateBaseId.js";
import { getGeneratedCells, cellKey } from "../../../../services/maproom/v3/generateCells.js";
import { createAttackLog } from "../../../../services/base/createAttackLog.js";
import { updateResources, Operation } from "../../../../services/base/updateResources.js";
import { isAttackActive } from "../../../../services/base/isAttackActive.js";
import { raidFighting } from "../../../../services/raids/raidLock.js";
import { baseNotFoundErr, baseUnderAttackErr, baseProtectedErr, userOnlineErr, truceActiveErr, shinyLockedErr } from "../../../../errors/errors.js";
import { ATTACK_ONLINE_SECONDS, isPlayerOnline } from "../../../../services/user/online.js";
import { isTruceActive } from "../../../../services/mail/isTruceActive.js";
import { MR1_TRIBE_IDS } from "../../../../game-data/tribes/v1/index.js";
import { registerAttacker } from "../../../../services/maproom/v1/registerAttacker.js";
import { requireAttackableMR1Tribe } from "../../../../services/maproom/v1/mr1TribeAttack.js";
import { startMR1TribeSession } from "../../../../services/maproom/v1/mr1TribeSession.js";
import { servedDefenderForces } from "../../../../services/base/combat/defenderForces.js";
import { isShinyLocked } from "../../../../services/user/shinyLock.js";
import { brainsOf, newAttackSession } from "../../../../services/base/attackSession.js";
import { startAttackSession } from "../../../../services/base/attackSessionStore.js";
import { catchUpArmiesForAttack } from "../../../../services/yard/armies.js";
import { getOutpostOwnerSave } from "../../../../services/base/getOutpostOwnerSave.js";
import { poolAmounts } from "../../../../services/base/combat/attackLoot.js";
import { autobankOwner } from "../../../../services/maproom/v2/autobank.js";
import {
  generateNoise,
  getTerrainHeight,
} from "../../../../services/maproom/v2/generateMap.js";

export interface AttackDetails {
  fbid?: string;
  name: string;
  pic_square?: string;
  friend: number;
  count: number;
  starttime: number;
  seen: boolean;
}

interface BaseModeAttack {
  user: User;
  baseid: string;
  mapversion?: MapRoomVersion;
  attackCost?: { resources?: number[]; shiny?: number };
  /**
   * The attacker's player level (`playerLevelOf`), which the load also serves
   * as `attackerlevel`; kept in the attack session for the loot replay.
   */
  attackerLevel?: number;
}

/**
 * Processes an attack from a user against a specific base.
 *
 * Every refusal — protection, an attack already running, the defender being
 * online, a truce, and now range — is decided before anything is written, so a
 * refused attack leaves the defender exactly as it found them.
 *
 * @param {BaseModeAttack} options - Attack options
 * @returns The base being attacked, the defence it fights with (issue #195),
 *   and the attacker's champions' brains the battle is frozen with (issue #219)
 */
export const baseModeAttack = async ({ user, baseid, mapversion, attackCost, attackerLevel }: BaseModeAttack) => {
  const userSave = user.save!;
  let save: Save | null = null;

  // `mapversion` is the attacker's own Map Room (`playerMapVersion`), and the
  // target has to belong to it (issue #165).
  if (mapversion === MapRoomVersion.V1) {
    if (MR1_TRIBE_IDS.has(baseid)) {
      await requireAttackableMR1Tribe(user, baseid, getCurrentDateTime());
      save = await tribeSaveHandler(baseid, mapversion, null, user);
    } else {
      // Map Room 1 has its own players' main yards and its own tribes, nothing
      // else (its neighbours are Map Room 1 main yards, `findOverworldNeighbours`):
      // an outpost, a camp or a yard on another Map Room is not a Map Room 1
      // target, and so no way round that Map Room's range.
      save = await postgres.em.findOne(Save, { baseid });
      if (save?.type !== BaseType.MAIN || save.mapversion !== MapRoomVersion.V1) throw baseNotFoundErr();
    }
  } else {
    save = await postgres.em.findOne(Save, { baseid });
    // A base on another world is out of everyone's reach here.
    if (save && save.worldid !== userSave.worldid) throw baseNotFoundErr();
  }

  if (save && save.type !== BaseType.TRIBE) {
    if (save.protected > getCurrentDateTime()) throw baseProtectedErr();

    if (isAttackActive(save)) throw baseUnderAttackErr();
    // A wild monster raid being fought locks the yard as an attack does (#226, `raidLock.ts`).
    if (raidFighting(save, getCurrentDateTime())) throw baseUnderAttackErr();

    // Online means a game open (a presence mark from the last minute) AND
    // real play in the last ten minutes: a ping alone protects nobody (#271).
    if (save.type === BaseType.MAIN && (await isPlayerOnline(save.userid, getCurrentDateTime(), ATTACK_ONLINE_SECONDS))) {
      throw userOnlineErr();
    }

    const activeTruce = await isTruceActive(user.userid, save.saveuserid);
    
    if (activeTruce) throw truceActiveErr();
  }

  // Range is decided here, before a single field is touched (issue #26). It used
  // to run as the last statement of this function, long after the `attackid`,
  // the appended attack record, the map cell, the attack log and the Map Room 3
  // attack cost had been flushed — so an attack the server then refused still
  // left the defender flagged as under attack for the full 7-minute window of
  // `isAttackActive`, with nobody attacking them and nothing to clear it.
  //
  // The cell row is read now rather than in the block below: a wild monster camp
  // attacked for the first time has no `world_map_cell` row yet, and the old
  // order was what made one exist in time for the check. Its coordinates come
  // from the base id instead, which is the same derivation that block uses, so
  // the check sees exactly the cell it saw before.
  const cell =
    mapversion === MapRoomVersion.V1
      ? null
      : await postgres.em.findOne(WorldMapCell, { baseid });

  const cellCoords = cell ? { x: cell.x, y: cell.y } : cellCoordsFromBaseId(baseid);

  // A Map Room 2 camp with no row yet is known only by its base id, which has
  // to be this world's id for that cell (`generateBaseId`, as `getarea` hands
  // it out), or the range below would be measured to a cell of another world.
  if (!save && mapversion === MapRoomVersion.V2) {
    const ownId = cellCoords && userSave.worldid && generateBaseId(userSave.worldid, cellCoords.x, cellCoords.y);
    if (baseid !== ownId) throw baseNotFoundErr();
  }

  await validateRange(user, mapversion, { baseid, cell: cellCoords });

  // Only an attack in range gives a camp attacked for the first time its save
  // row (issue #165): `em.create` hands the row to the next flush, and the
  // range refusal's report entry used to be that flush.
  if (!save) save = await tribeSaveHandler(baseid, mapversion, userSave.worldid, user);

  if (!save) throw baseNotFoundErr();

  // The defender's pool takes in its outposts' income before the attack
  // snapshots it for the loot (issue #179, outposts WP4): an outpost's owner
  // is paid here; a main yard is paid inside the locked catch-up below.
  if (save.type === BaseType.OUTPOST) await autobankOwner(postgres.em, save.saveuserid);

  // Both armies as they are now, before anything below changes either row
  // (docs/design/yard-buildings.md §4.6): the defender's yard and the
  // attacker's own yards are caught up and written, and what each of the
  // attacker's yards houses is kept in the attack session, which caps what
  // the attack save can take from it. A main yard's catch-up autobanks it.
  const armies = await catchUpArmiesForAttack({ user, defender: save, cell: cellCoords, mapversion });
  save = armies.defender;

  // Past this point the attack is committed: everything below writes.
  if (save.attacks.length > 3) save.attacks = save.attacks.slice(-2);

  // Track the details of the attack
  const attackDetails: AttackDetails = {
    fbid: "",
    name: user.username,
    pic_square: user.pic_square ?? undefined,
    friend: 0,
    count: 1,
    starttime: getCurrentDateTime(),
    seen: false,
  };

  if (save.type != BaseType.TRIBE) save.attacks.push(attackDetails);

  if (save.type !== BaseType.TRIBE || mapversion !== MapRoomVersion.V1) {
    await damageProtection(userSave, BaseMode.ATTACK);
  }

  save.attackid = Math.floor(Math.random() * 99999) + 1;

  if (mapversion !== MapRoomVersion.V1) {
    let attackCell: WorldMapCell | null = cell;

    if (!attackCell) {
      const { x: cellX, y: cellY } = cellCoords ?? {
        x: parseInt(baseid.slice(-6, -3)),
        y: parseInt(baseid.slice(-3)),
      };

      const world = await postgres.em.findOne(World, { uuid: userSave.worldid });

      if (!world) throw new Error("No world found.");

      if (mapversion === MapRoomVersion.V3) {
        const genCell = getGeneratedCells().get(cellKey(cellX, cellY));

        attackCell = new WorldMapCell(world, cellX, cellY, genCell?.altitude ?? 0);
        attackCell.uid = save.saveuserid;
        attackCell.base_type = genCell?.type ?? save.wmid;
        attackCell.map_version = MapRoomVersion.V3;
        attackCell.baseid = baseid;
      } else {
        const noise = generateNoise(world.uuid);
        const terrainHeight = getTerrainHeight(noise, cellX, cellY);

        attackCell = new WorldMapCell(world, cellX, cellY, terrainHeight);
        attackCell.uid = save.saveuserid;
        attackCell.base_type = MapRoomCell.WM;
        attackCell.map_version = MapRoomVersion.V2;
        attackCell.baseid = baseid;
      }
    }

    save.cell = attackCell;
    postgres.em.persist(attackCell);
  }

  // Handle attack cost for MR3 attack range
  if (mapversion === MapRoomVersion.V3 && attackCost) {
    if (attackCost.resources) {
      const [r1, r2, r3] = attackCost.resources;
      updateResources({ r1, r2, r3 }, userSave.resources!, Operation.SUBTRACT);
    } else if (attackCost.shiny) {
      const shinyLocked = isShinyLocked(user);

      if (shinyLocked) throw shinyLockedErr();
      
      userSave.credits = Math.max(0, userSave.credits - attackCost.shiny);
    }
  }

  const isMR1Tribe = mapversion === MapRoomVersion.V1 && save.type === BaseType.TRIBE;

  if (!isMR1Tribe) postgres.em.persist(save);

  postgres.em.persist(userSave);
  await postgres.em.flush();

  // Bind this attack to the player who started it (issue #25). Only the account
  // recorded here may post the result to `/base/save`, and only for as long as
  // `isAttackActive` would still call the attack live. The flush above is what
  // gives a freshly created wild-monster row its `basesaveid`. A Map Room 1
  // tribe never gets one: its session is keyed by the attacker and the tribe
  // base instead, and its save is bound to that (issue #161).
  // The defence the battle is fought against, served to the client and kept
  // in the session for the server's replay (issue #195).
  const defenderForces = await servedDefenderForces(save);
  // The attacker's champions' brains as they stand now, after the load has
  // landed any attack they left (issue #219): frozen into the session, served
  // to the client, and the only brains this battle is ever fought with.
  const championBrains = brainsOf(userSave.champion);

  if (isMR1Tribe) {
    await startMR1TribeSession(
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
        championBrains
      )
    );
  } else if (save.basesaveid) {
    // The pool the load serves (`mapSaveData`): an outpost's is its owner's,
    // which is not frozen by the attack, so the loot replay keeps this copy
    // (issue #163, `services/base/combat/attackLoot.ts`).
    const served = (await getOutpostOwnerSave(save, user)) ?? save;
    await startAttackSession(
      save.basesaveid,
      newAttackSession(
        user.userid,
        save.attackid,
        armies.entryHoused,
        poolAmounts(served.resources),
        attackerLevel,
        // The attacker's own pool, which its bombs are priced against (#23, C3).
        poolAmounts(userSave.resources),
        defenderForces,
        championBrains
      )
    );
  }

  // Create an attack log and update neighbour attack counters
  if (save.type !== BaseType.TRIBE) {
    const defender = await postgres.em.findOne(User, {
      userid: save.saveuserid,
    });

    if (!defender) throw new Error("Defender user not found.");

    if (mapversion === MapRoomVersion.V1) await registerAttacker(user, defender);
    await createAttackLog(user, defender, save)
  }

  return { save, defenderForces, championBrains };
};
