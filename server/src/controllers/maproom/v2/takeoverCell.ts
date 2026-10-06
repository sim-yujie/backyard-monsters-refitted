import { LockMode, type EntityManager } from "@mikro-orm/core";
import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { Save } from "../../../database/models/save.model.js";
import { postgres } from "../../../server.js";
import { invalidateWorldsCache } from "../../../services/maproom/knownWorlds.js";
import { invalidatePlayerSight } from "../../../services/maproom/sight/sightService.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import {
  Operation,
  RESOURCE_KEYS,
  updateResources,
} from "../../../services/base/updateResources.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { validateRange } from "../../../services/maproom/v2/validateRange.js";
import {
  OUTPOST_TAKEN,
  takenNoticeText,
  writeOutpostNotice,
} from "../../../services/maproom/v2/outpostNotices.js";
import { TakeoverCellSchema } from "../../../schemas/TakeoverCellSchema.js";
import { shinyLockedErr, takeoverRefusedErr } from "../../../errors/errors.js";
import { isShinyLocked } from "../../../services/user/shinyLock.js";
import { voidOutpostInvites } from "../../../services/mail/inviteRules.js";
import { quoteTakeover } from "../../../services/maproom/v2/takeoverCost.js";
import { takeoverRefusal } from "../../../services/maproom/v2/takeoverRules.js";
import { holdsTakeoverGrant } from "../../../services/maproom/v2/takeoverGrant.js";
import { endTakeoverGrant, readTakeoverGrant } from "../../../services/maproom/v2/takeoverGrantStore.js";
import { runningPowerups } from "../../../services/alliance/powerups.js";
import { AlliancePowerupType } from "../../../enums/Alliance.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";
import { readAttackSession } from "../../../services/base/attackSessionStore.js";
import { recordAchievements, unseenAchievements } from "../../../services/achievements/record.js";
import type { AchievementEvents } from "../../../services/achievements/evaluate.js";

/** `SELECT … FOR UPDATE` on one save row, refreshed into the identity map. */
const lockSave = (em: EntityManager, where: { basesaveid: number } | { userid: number; type: string }) =>
  em.findOne(Save, where, { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true });

/**
 * Controller to handle the takeover of a cell on the world map via shiny or resources.
 *
 * Retrieve the cell that is being taken over, by querying it with the baseid from the client.
 * To transfer ownership, update properties on the user, user's save, the cell and the associated cell save.
 * The previous owner's outposts are updated to reflect the takeover.
 *
 * Who may take what over is Flash's test, which the server used to leave to the
 * client (issue #182): `takeoverRules.ts` refuses a main yard, the taker's own
 * yard, a yard that is not destroyed (a wild camp past its 12-hour regeneration
 * counts as rebuilt), one under damage protection, locked or under attack, and
 * a taker at the outpost cap. A player outpost is taken only by the attacker
 * holding its one-time grant (`takeoverGrant.ts`, the owner's rule), which the
 * takeover consumes. The checks and every write run in one transaction
 * with the taker's main yard, the target and the previous owner's main yard
 * locked, so two takers cannot both pay for the same cell.
 *
 * The takeover counts towards the taker's achievements in the same
 * transaction, and the answer carries `achievements`, the paid unlocks not
 * yet shown (issue #204).
 *
 * @param {Context} ctx - The Koa context object.
 * @throws Will throw an error if the base or base type is invalid.
 */
export const takeoverCell: KoaController = async (ctx) => {
  // `resources` is still accepted by the schema for wire compatibility, but the client's
  // figure is no longer trusted - the cost is recomputed below.
  const { baseid, shiny } = TakeoverCellSchema.parse(ctx.request.body);

  const currentUser: User = ctx.authUser;

  // The posted `shiny` only says which of PopupTakeover's two buttons was pressed.
  const useShiny = (shiny ?? 0) > 0;

  if (useShiny && isShinyLocked(currentUser)) throw shinyLockedErr();

  await postgres.em.populate(currentUser, ["save"]);

  const userSave = currentUser.save!;

  const cell = await postgres.em.findOne(
    WorldMapCell,
    { baseid, world: userSave.worldid, map_version: MapRoomVersion.V2 },
    { populate: ["save", "world"] }
  );

  if (!cell || !cell.save) throw takeoverRefusedErr("notFound");

  await validateRange(currentUser, MapRoomVersion.V2, { attackCell: cell });

  const powerups = await runningPowerups(currentUser.alliance_id);

  const conquestActive = powerups.some(({ id }) => id === AlliancePowerupType.CONQUEST);

  const result = await postgres.em.transactional(async (em) => {
    const taker = await lockSave(em, { basesaveid: userSave.basesaveid });
    const cellSave = await lockSave(em, { basesaveid: cell.save!.basesaveid });

    if (!taker || !cellSave) throw takeoverRefusedErr("notFound");

    const now = getCurrentDateTime();

    const underAttack =
      isAttackActive(cellSave) || (await readAttackSession(cellSave.basesaveid)) !== null;

    const grant = await readTakeoverGrant(cellSave.basesaveid);

    const refusal = takeoverRefusal({
      takerId: currentUser.userid,
      outpostCount: taker.outposts.length,
      now,
      cell,
      save: cellSave,
      underAttack,
      holdsGrant: holdsTakeoverGrant(grant, currentUser.userid, now),
    });

    if (refusal) throw takeoverRefusedErr(refusal);

    // The price used to be whatever the client posted in `resources` / `shiny`, which
    // made every takeover free for anyone willing to edit the request. Recompute the
    // client's own formula here (see takeoverCost.ts for the citations) and charge that
    // instead. Neither client path can produce a zero price - both floor above a
    // million - so a request that omits both fields is charged the resource cost rather
    // than taking the cell for nothing.
    // The client branches on the cell payload's `b` field, which is base_type, so match it.
    const { resources: cost, shiny: shinyCost } = quoteTakeover({
      cell,
      isWildMonster: cell.base_type === MapRoomCell.WM,
      empireValue: cellSave.empirevalue,
      takerHomebase: taker.homebase,
      conquestActive,
    });

    if (useShiny) {
      if (taker.credits < shinyCost) throw takeoverRefusedErr("notEnoughShiny");

      taker.credits = taker.credits - shinyCost;
    } else {
      const ownedResources = taker.resources ?? {};

      if (RESOURCE_KEYS.some((key) => Number(ownedResources[key] ?? 0) < cost))
        throw takeoverRefusedErr("notEnoughResources");

      taker.resources = updateResources(
        { r1: cost, r2: cost, r3: cost, r4: cost },
        ownedResources,
        Operation.SUBTRACT
      );
    }

    // Clean up previous owner's save if the cell was player-owned
    const previousOwner = cellSave.userid
      ? await lockSave(em, { userid: cellSave.userid, type: BaseType.MAIN })
      : null;

    // Achievements (issue #204, `docs/design/achievements.md` §7.2): a wild
    // camp counts towards "Camp Crusher", a player's outpost "Empire Builder".
    const events: AchievementEvents =
      cellSave.type === BaseType.TRIBE ? { wmoutpost: 1 } : previousOwner ? { playeroutpost: 1 } : {};

    if (previousOwner) {
      previousOwner.outposts = previousOwner.outposts.filter(
        ([x, y, id]) => !(x === cell.x && y === cell.y && String(id) === String(baseid))
      );

      if (previousOwner.buildingresources)
        delete previousOwner.buildingresources[`b${baseid}`];

      // Its previous owner's invitation to move onto it (#205) is void.
      await voidOutpostInvites(em, baseid);

      em.persist(previousOwner);

      // The previous owner is told who took it (outposts WP8, #187), in the
      // same transaction as the takeover.
      await writeOutpostNotice(em, {
        ownerId: previousOwner.userid,
        byUserId: currentUser.userid,
        type: OUTPOST_TAKEN,
        text: takenNoticeText(currentUser.username, cell),
        cell,
        baseid,
        now,
      });
    }

    const twelveHours = 12 * 60 * 60;

    // Transfer ownership of the save
    cellSave.saveuserid = currentUser.userid;
    cellSave.userid = taker.userid;
    cellSave.homebaseid = taker.homebaseid;
    cellSave.mapversion = MapRoomVersion.V2;
    cellSave.name = taker.name;
    cellSave.worldid = taker.worldid;
    cellSave.createtime = now;
    cellSave.protected = now + twelveHours;
    cellSave.attacks = [];
    cellSave.resources = {};
    cellSave.tutorialstage = 205;
    cellSave.monsters = {};

    cellSave.takeoverDate = new Date();

    if (cellSave.type === BaseType.TRIBE) {
      cellSave.type = BaseType.OUTPOST;
      cellSave.buildingdata = {};
      cellSave.wmid = 0;
    }

    // Update cell
    cell.uid = currentUser.userid;
    cell.base_type = MapRoomCell.OUTPOST;

    // Evaluated on the taker's locked main row before the outpost joins their
    // list, so a first-ever evaluation's backfill (§8) does not take this
    // takeover for an outpost they already had: it is a live unlock.
    await recordAchievements(em, taker, now, events);

    // Update user
    taker.outposts.push([cell.x, cell.y, baseid]);

    const originCell = cell.x === 0 && cell.y === 0;
    if (originCell) cell.world.name = `${currentUser.username} Server`;

    em.persist([cellSave, cell, taker]);
    await em.flush();

    // Spent: the chance was one takeover.
    if (grant) await endTakeoverGrant(cellSave.basesaveid);

    return { originCell, achievements: unseenAchievements(taker), previousOwnerId: previousOwner?.userid };
  });

  const { originCell: isOriginCell, achievements, previousOwnerId } = result;

  if (isOriginCell) await invalidateWorldsCache();

  // The taker's own sight just grew a base, and the previous owner (a wild
  // monster camp has none) lost one, both outside a flinger's reach rule
  // (issue #329, `docs/design/fog-of-war.md` §9).
  await Promise.all(
    [currentUser.userid, previousOwnerId]
      .filter((userid): userid is number => userid !== undefined)
      .map(invalidatePlayerSight),
  );

  ctx.status = Status.OK;
  // The paid unlocks not yet shown, as yard answers carry them (§9.3).
  ctx.body = { error: 0, ...(achievements.length > 0 && { achievements }) };
};
