import { LockMode } from "@mikro-orm/core";
import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { Save } from "../../../database/models/save.model.js";
import { postgres } from "../../../server.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { Status } from "../../../enums/StatusCodes.js";
import { BaseType } from "../../../enums/Base.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { joinOrCreateWorld } from "../../../services/maproom/v2/joinOrCreateWorld.js";
import { leaveWorld } from "../../../services/maproom/v2/leaveWorld.js";
import { MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import { relocateRefusedErr, shinyLockedErr } from "../../../errors/errors.js";
import { MigrateBaseSchema } from "../../../schemas/MigrateBaseSchema.js";
import { isShinyLocked } from "../../../services/user/shinyLock.js";
import { isAttackActive } from "../../../services/base/isAttackActive.js";
import { readAttackSession } from "../../../services/base/attackSessionStore.js";
import {
  RELOCATE_COOLDOWN,
  chargeRelocation,
  mainYardHealth,
  randomRelocateRefusal,
  relocateTargetRefusal,
  type RelocatePayment,
} from "../../../services/maproom/v2/relocateRules.js";
import { catchUpLockedYard } from "../../yard/yardAction.js";

/**
 * Handles user base migration.
 *
 * `type=random` is the Flash "your empire was overrun" move (`PopupLostMainBase.as`):
 * the player leaves their world and is placed in a new one, free of charge. It
 * follows Flash's gate for that popup (`randomRelocateRefusal`, the owner's
 * answer D): no alliance, no outposts, and the main yard, caught up to now as
 * a load would, below 10% of its health.
 *
 * `type=outpost` moves the main yard onto one of the player's own Map Room 2
 * outposts (`PopupRelocateMe.as`), destroying the outpost. Everything the
 * client posts past the target `baseid` and which button was pressed is
 * ignored (issue #181): the server checks the outpost is the caller's, in the
 * caller's world, and not under attack, then charges its own price
 * (`relocateRules.ts`). Every write lands in one transaction, under a lock on
 * the main yard row, so a second copy of the request waits and then meets the
 * cooldown the first one set.
 *
 * Flash's `RelocateSuccess` drops `GLOBAL._mapOutpost[0]` from its own list
 * whichever outpost was used (`PopupRelocateMe.as:134`). That is the client's
 * bookkeeping and is not copied: the server removes exactly the outpost named
 * by `baseid` from `Save.outposts`, and the client's list is rebuilt from the
 * server on the next load.
 *
 * @param {Object} ctx - The Koa context object
 * @returns {Promise<void>} A promise that resolves once the base migration is complete.
 */
export const migrateBase: KoaController = async (ctx) => {
  const { baseid, shiny, type } = MigrateBaseSchema.parse(ctx.request.body);

  const currentUser: User = ctx.authUser;

  await postgres.em.populate(currentUser, ["save"]);

  const userSave = currentUser.save!;
  const currentTime = getCurrentDateTime();

  // Check if the user is within the cooldown period.
  if (userSave.cantmovetill && userSave.cantmovetill > currentTime) {
    ctx.status = Status.OK;
    ctx.body = {
      error: 0,
      cantMoveTill: userSave.cantmovetill,
      currenttime: currentTime,
    };
    return;
  }

  // User is relocating due to their empire being overrun.
  if (type === BaseType.RANDOM) {
    // Repairs that finished while the player was away count, as on their load.
    const { save: mainYard } = await catchUpLockedYard(postgres.em, userSave);

    const refusal = randomRelocateRefusal({
      allianceId: currentUser.alliance_id,
      outpostCount: mainYard.outposts.length,
      health: mainYardHealth(mainYard),
      underAttack:
        isAttackActive(mainYard) || (await readAttackSession(mainYard.basesaveid)) !== null,
    });

    if (refusal) throw relocateRefusedErr(refusal);

    await leaveWorld(currentUser, userSave);
    await joinOrCreateWorld(currentUser, userSave, postgres.em, true);

    ctx.status = Status.OK;
    ctx.body = { error: 0 };
    return;
  }

  // The posted `shiny`/`resources` only say which of the popup's two buttons was
  // pressed (`PopupRelocateMe.as:176-197`); the amounts are the server's.
  const payment: RelocatePayment = (shiny ?? 0) > 0 ? "shiny" : "resources";

  if (payment === "shiny" && isShinyLocked(currentUser)) throw shinyLockedErr();

  const outcome = await postgres.em.transactional(async (em) => {
    const save = await em.findOne(
      Save,
      { basesaveid: userSave.basesaveid },
      { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    );

    if (!save || save.type !== BaseType.MAIN || save.userid !== currentUser.userid || !save.worldid)
      throw relocateRefusedErr("noHomeCell");

    const now = getCurrentDateTime();

    if (save.cantmovetill && save.cantmovetill > now)
      return { cantMoveTill: save.cantmovetill, currenttime: now };

    const homeCell = await em.findOne(WorldMapCell, {
      baseid: save.baseid,
      uid: currentUser.userid,
      world: save.worldid,
      map_version: MapRoomVersion.V2,
      base_type: MapRoomCell.HOMECELL,
    });

    if (!homeCell) throw relocateRefusedErr("noHomeCell");

    // Every cell with this base id, preferring the caller's world, so a base id
    // from another world is refused as such rather than as missing.
    const candidates = await em.find(WorldMapCell, { baseid }, { populate: ["save"] });
    const outpostCell =
      candidates.find((cell) => cell.world.uuid === save.worldid) ?? candidates[0] ?? null;
    const outpostSave = outpostCell?.save ?? null;

    const underAttack =
      outpostSave !== null &&
      (isAttackActive(outpostSave) || (await readAttackSession(outpostSave.basesaveid)) !== null);

    const refusal = relocateTargetRefusal({
      userid: currentUser.userid,
      worldid: save.worldid,
      outposts: save.outposts,
      cell: outpostCell && {
        uid: outpostCell.uid,
        base_type: outpostCell.base_type,
        map_version: outpostCell.map_version,
        worldid: outpostCell.world.uuid,
      },
      save: outpostSave,
      underAttack,
    });

    if (refusal || !outpostCell || !outpostSave) throw relocateRefusedErr(refusal ?? "notFound");

    const charge = chargeRelocation({ credits: save.credits, resources: save.resources }, payment);

    if (!charge.ok) throw relocateRefusedErr(charge.reason);

    save.credits = charge.credits;
    save.resources = charge.resources;

    const [outpostX, outpostY] = [outpostCell.x, outpostCell.y];

    // The home cell takes the outpost's place; its old spot is left to the wild monsters.
    homeCell.x = outpostX;
    homeCell.y = outpostY;
    homeCell.terrainHeight = outpostCell.terrainHeight;

    save.homebase = [outpostX.toString(), outpostY.toString()];
    save.cantmovetill = now + RELOCATE_COOLDOWN;

    // Exactly the outpost used, whatever Flash drops from its own list (see above).
    save.outposts = save.outposts.filter(([, , id]) => String(id) !== String(outpostSave.baseid));

    if (save.buildingresources) delete save.buildingresources[`b${outpostSave.baseid}`];

    em.persist([homeCell, save]);
    em.remove([outpostSave, outpostCell]);
    await em.flush();

    return { coords: [outpostX, outpostY] };
  });

  ctx.status = Status.OK;
  ctx.body = { error: 0, ...outcome };
};
