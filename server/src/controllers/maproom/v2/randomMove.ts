import { LockMode } from "@mikro-orm/core";
import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { Save } from "../../../database/models/save.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { randomMoveRefusedErr } from "../../../errors/errors.js";
import { yardUnderAttack } from "../../../services/base/yardUnderAttack.js";
import { isPlayerAttacking } from "../../../services/base/playerAttacking.js";
import { voidInvitesFrom } from "../../../services/mail/inviteRules.js";
import { findFreeCell } from "../../../services/maproom/v2/findFreeCell.js";
import { invalidateWorldsCache } from "../../../services/maproom/knownWorlds.js";
import { invalidateSight } from "../../../services/maproom/sight/sightService.js";
import {
  randomMoveAvailableAt,
  randomMoveRefusal,
} from "../../../services/maproom/v2/randomMoveRules.js";
import { catchUpLockedYard } from "../../yard/yardAction.js";

/**
 * "Move to a random spot" (`POST /worldmapv2/randommove`, issue #366): the
 * caller's Map Room 2 main yard moves to a random free land cell in the same
 * world, free, once a week (`randomMoveRules.ts`). The owner's decisions of
 * 2026-10-19; Flash had nothing like it.
 *
 * Every outpost the caller holds is lost with the move: its save and its map
 * cell are deleted, as leaving a world deletes them (`leaveWorld.ts`), so the
 * map draws a fresh wild monster camp there again, generated from the world's
 * seed like any untouched land cell, for anyone to attack and take over. Its
 * buildings and the monsters living on it go with it, and invitations to move
 * onto it are void. Before that, the outposts' income is paid up to now by the
 * main yard's catch-up, as a load would pay it.
 *
 * The home cell row keeps its id and moves (`migrateBase.ts` moves it the same
 * way), so the old spot is free land again. The alliance is untouched.
 *
 * Refused while an attack runs on the main yard or an outpost, whose save
 * would land on a yard that moved or no longer exists, and while the caller
 * is in an attack of their own. Every write lands in one transaction under
 * locks on the main yard row and then each outpost's, the order every route
 * that touches two of a player's yards takes, so a second copy of the request
 * waits and then meets the cooldown the first one set.
 *
 * Answers `{ coords, outpostsLost, randommoveat }`.
 */
export const randomMove: KoaController = async (ctx) => {
  const currentUser: User = ctx.authUser;

  await postgres.em.populate(currentUser, ["save"]);

  const userSave = currentUser.save;
  if (!userSave) throw randomMoveRefusedErr("noHomeCell");

  // Builds and repairs that finished while the player was away land, and the
  // outposts' income is paid up to now, while the outposts still stand.
  await catchUpLockedYard(postgres.em, userSave);

  const attacking = await isPlayerAttacking(currentUser.userid);

  const outcome = await postgres.em.transactional(async (em) => {
    const save = await em.findOne(
      Save,
      { basesaveid: userSave.basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );

    if (!save || save.type !== BaseType.MAIN || save.userid !== currentUser.userid)
      throw randomMoveRefusedErr("noHomeCell");

    const now = getCurrentDateTime();

    const homeCell = save.worldid
      ? await em.findOne(
          WorldMapCell,
          {
            baseid: save.baseid,
            uid: currentUser.userid,
            world: save.worldid,
            map_version: MapRoomVersion.V2,
            base_type: MapRoomCell.HOMECELL,
          },
          { populate: ["world"] }
        )
      : null;

    // Locked after the main yard's, in the same order as `migrateBase.ts`.
    const outposts = await em.find(
      Save,
      { userid: currentUser.userid, type: BaseType.OUTPOST },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );

    let outpostUnderAttack = false;
    for (const outpost of outposts) {
      if (await yardUnderAttack(outpost)) {
        outpostUnderAttack = true;
        break;
      }
    }

    const refusal = randomMoveRefusal({
      mapVersion: save.mapversion,
      hasHomeCell: homeCell !== null,
      randomMoveAt: save.randommoveat,
      now,
      underAttack: await yardUnderAttack(save),
      outpostUnderAttack,
      attacking,
    });

    if (refusal === "coolingDown")
      throw randomMoveRefusedErr(refusal, {
        availableAt: randomMoveAvailableAt(save.randommoveat),
        currenttime: now,
      });
    if (refusal || !homeCell) throw randomMoveRefusedErr(refusal ?? "noHomeCell");

    let target: { x: number; y: number; terrainHeight: number };
    try {
      target = await findFreeCell(homeCell.world, em);
    } catch {
      throw randomMoveRefusedErr("noFreeCell");
    }

    // The outposts go back to the wild monsters (see above).
    const outpostCells = await em.find(WorldMapCell, {
      uid: currentUser.userid,
      world: homeCell.world,
      map_version: MapRoomVersion.V2,
      base_type: MapRoomCell.OUTPOST,
    });
    const outpostsLost = new Set([
      ...outposts.map((outpost) => outpost.baseid),
      ...outpostCells.map((cell) => cell.baseid),
    ]).size;

    await voidInvitesFrom(em, currentUser.userid);
    if (outposts.length > 0)
      await em.nativeDelete(Save, { basesaveid: { $in: outposts.map((outpost) => outpost.basesaveid) } });
    if (outpostCells.length > 0)
      await em.nativeDelete(WorldMapCell, { cellid: { $in: outpostCells.map((cell) => cell.cellid) } });

    homeCell.x = target.x;
    homeCell.y = target.y;
    homeCell.terrainHeight = target.terrainHeight;

    save.homebase = [target.x.toString(), target.y.toString()];
    save.outposts = [];
    // Only the autobank's clock is kept: the per-outpost entries go with them.
    if (save.buildingresources) {
      for (const key of Object.keys(save.buildingresources)) {
        if (key.startsWith("b")) delete save.buildingresources[key];
      }
    }
    save.randommoveat = now;

    em.persist([homeCell, save]);
    await em.flush();

    return { coords: [target.x, target.y], outpostsLost, randommoveat: now };
  });

  // A new home cell and no outposts: the caller's sight (and their alliance's
  // union) is built from what is gone, as after `joinOrCreateWorld`.
  await invalidateWorldsCache();
  await invalidateSight(currentUser);

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...outcome };
};
