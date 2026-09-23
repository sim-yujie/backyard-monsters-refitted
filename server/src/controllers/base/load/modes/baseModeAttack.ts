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
import { getGeneratedCells, cellKey } from "../../../../services/maproom/v3/generateCells.js";
import { createAttackLog } from "../../../../services/base/createAttackLog.js";
import { updateResources, Operation } from "../../../../services/base/updateResources.js";
import { isAttackActive } from "../../../../services/base/isAttackActive.js";
import { baseUnderAttackErr, baseProtectedErr, userOnlineErr, truceActiveErr, shinyLockedErr } from "../../../../errors/errors.js";
import { redis } from "../../../../server.js";
import { isTruceActive } from "../../../../services/mail/isTruceActive.js";
import { MR1_TRIBE_IDS } from "../../../../game-data/tribes/v1/index.js";
import { registerAttacker } from "../../../../services/maproom/v1/registerAttacker.js";
import { isShinyLocked } from "../../../../services/user/shinyLock.js";
import { newAttackSession } from "../../../../services/base/attackSession.js";
import { startAttackSession } from "../../../../services/base/attackSessionStore.js";
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
}

/**
 * Processes an attack from a user against a specific base.
 *
 * Every refusal — protection, an attack already running, the defender being
 * online, a truce, and now range — is decided before anything is written, so a
 * refused attack leaves the defender exactly as it found them.
 *
 * @param {BaseModeAttack} options - Attack options
 * @returns {Promise<Save>} The base being attacked
 */
export const baseModeAttack = async ({ user, baseid, mapversion, attackCost }: BaseModeAttack) => {
  const userSave = user.save!;
  let save: Save | null = null;

  if (mapversion === MapRoomVersion.V1 && MR1_TRIBE_IDS.has(baseid)) {
    save = await tribeSaveHandler(baseid, mapversion, null, user);
  } else {
    save = await postgres.em.findOne(Save, { baseid });
    if (!save) save = await tribeSaveHandler(baseid, mapversion, userSave.worldid, user);
  }

  if (!save) throw new Error(`Save not found for baseid: ${baseid}`);

  if (save.type !== BaseType.TRIBE) {
    if (save.protected > getCurrentDateTime()) throw baseProtectedErr();

    if (isAttackActive(save)) throw baseUnderAttackErr();

    if (save.type === BaseType.MAIN) {
      const lastSeen = await redis.get(`last-seen:${BaseType.MAIN}:${save.userid}`);
      if (lastSeen && parseInt(lastSeen) >= getCurrentDateTime() - 60) throw userOnlineErr();
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

  await validateRange(user, save, mapversion, { baseid, cell: cellCoords });

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
  // gives a freshly created wild-monster row its `basesaveid`; a Map Room 1
  // tribe never gets one, and its save never reaches the attack branch either.
  if (save.basesaveid)
    await startAttackSession(save.basesaveid, newAttackSession(user.userid, save.attackid));

  // Create an attack log and update neighbour attack counters
  if (save.type !== BaseType.TRIBE) {
    const defender = await postgres.em.findOne(User, {
      userid: save.saveuserid,
    });

    if (!defender) throw new Error("Defender user not found.");

    if (mapversion === MapRoomVersion.V1) await registerAttacker(user, defender);
    await createAttackLog(user, defender, save)
  }

  return save;
};
