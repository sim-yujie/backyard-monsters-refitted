import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { postgres } from "../../../server.js";
import { invalidateWorldsCache } from "../../../services/maproom/knownWorlds.js";
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
import { TakeoverCellSchema } from "../../../schemas/TakeoverCellSchema.js";
import {
  takeoverCellErr,
  shinyLockedErr,
  notEnoughShinyErr,
  notEnoughResourcesErr,
} from "../../../errors/errors.js";
import { isShinyLocked } from "../../../services/user/shinyLock.js";
import {
  isAdjacentToMainYard,
  takeoverResourceCost,
  takeoverShinyCost,
} from "../../../services/maproom/v2/takeoverCost.js";
import { calculateTribeLevel } from "../../../services/maproom/v2/calculateTribeLevel.js";
import { Tribes } from "../../../enums/Tribes.js";
import { runningPowerups } from "../../../services/alliance/powerups.js";
import { AlliancePowerupType } from "../../../enums/Alliance.js";

/**
 * Controller to handle the takeover of a cell on the world map via shiny or resources.
 *
 * Retrieve the cell that is being taken over, by querying it with the baseid from the client.
 * To transfer ownership, update properties on the user, user's save, the cell and the associated cell save.
 * The previous owner's outposts are updated to reflect the takeover.
 *
 * @param {Context} ctx - The Koa context object.
 * @throws Will throw an error if the base or base type is invalid.
 */
export const takeoverCell: KoaController = async (ctx) => {
  // `resources` is still accepted by the schema for wire compatibility, but the client's
  // figure is no longer trusted - the cost is recomputed below.
  const { baseid, shiny } = TakeoverCellSchema.parse(ctx.request.body);

  const currentUser: User = ctx.authUser;
  const shinyLocked = isShinyLocked(currentUser);

  if (shiny && shinyLocked) throw shinyLockedErr();

  await postgres.em.populate(currentUser, ["save"]);

  const userSave = currentUser.save!;

  const cell = await postgres.em.findOne(
    WorldMapCell,
    { baseid, world: userSave.worldid },
    { populate: ["save", "world"] }
  );

  if (!cell || !cell.save || cell.save.type === BaseType.MAIN) {
    throw new Error(`Invalid base or base type. Base ID: ${baseid}`);
  }

  const cellSave = cell.save;

  if (cellSave.damage < 90) throw takeoverCellErr();

  const mapversion: MapRoomVersion = cell.map_version;

  await validateRange(currentUser, userSave, mapversion, { attackCell: cell });

  // The price used to be whatever the client posted in `resources` / `shiny`, which
  // made every takeover free for anyone willing to edit the request. Recompute the
  // client's own formula here (see takeoverCost.ts for the citations) and charge that
  // instead. Neither client path can produce a zero price - both floor above a
  // million - so a request that omits both fields is charged the resource cost rather
  // than taking the cell for nothing.
  // The client branches on the cell payload's `b` field, which is base_type, so match it.
  const isWildMonster = cell.base_type === MapRoomCell.WM;

  const [homeX, homeY] = (userSave.homebase ?? []).map(Number);

  const tribe = Tribes[(cell.x + cell.y) % Tribes.length];

  const powerups = await runningPowerups(currentUser.alliance_id);

  const cost = takeoverResourceCost({
    isWildMonster,
    level: calculateTribeLevel(cell.x, cell.y, tribe),
    empireValue: cellSave.empirevalue,
    adjacentToMainYard:
      Number.isFinite(homeX) &&
      Number.isFinite(homeY) &&
      isAdjacentToMainYard(homeX, homeY, cell.x, cell.y),
    conquestActive: powerups.some(({ id }) => id === AlliancePowerupType.CONQUEST),
  });

  if (shiny) {
    const shinyCost = takeoverShinyCost(cost);

    if (userSave.credits < shinyCost) throw notEnoughShinyErr();

    userSave.credits = userSave.credits - shinyCost;
  } else {
    const ownedResources = userSave.resources ?? {};

    if (RESOURCE_KEYS.some((key) => Number(ownedResources[key] ?? 0) < cost))
      throw notEnoughResourcesErr();

    userSave.resources = updateResources(
      { r1: cost, r2: cost, r3: cost, r4: cost },
      ownedResources,
      Operation.SUBTRACT
    );
  }

  // Clean up previous owner's save if the cell was player-owned
  const previousOwner = await postgres.em.findOne(
    User,
    { userid: cellSave.userid },
    { populate: ["save"] }
  );

  if (previousOwner?.save) {
    const { outposts } = previousOwner.save;

    previousOwner.save.outposts = outposts.filter(
      ([x, y, id]) => !(x === cell.x && y === cell.y && id === baseid)
    );

    if (previousOwner.save.buildingresources)
      delete previousOwner.save.buildingresources[`b${baseid}`];

    postgres.em.persist(previousOwner);
  }

  // Update save
  const currentTime = getCurrentDateTime();
  const twelveHours = 12 * 60 * 60;

  // Transfer ownership of the save
  cellSave.saveuserid = currentUser.userid;
  cellSave.userid = userSave.userid;
  cellSave.homebaseid = userSave.homebaseid;
  cellSave.mapversion = mapversion;
  cellSave.name = userSave.name;
  cellSave.worldid = userSave.worldid;
  cellSave.createtime = currentTime;
  cellSave.protected = currentTime + twelveHours;
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

  // Update user
  userSave.outposts.push([cell.x, cell.y, baseid]);

  const isOriginCell = cell.x === 0 && cell.y === 0;
  if (isOriginCell) cell.world.name = `${currentUser.username} Server`;

  postgres.em.persist([cellSave, currentUser]);
  await postgres.em.flush();

  if (isOriginCell) await invalidateWorldsCache();

  ctx.status = Status.OK;
  ctx.body = { error: 0 };
};
