import type { Context } from "koa";
import type { Loaded } from "@mikro-orm/core";
import type { User } from "../../../../database/models/user.model.js";
import type { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { calculateBaseLevel } from "../../../../services/base/calculateBaseLevel.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { MapRoomCell } from "../../../../enums/MapRoom.js";
import { isAttackActive } from "../../../../services/base/isAttackActive.js";

export type UserCellFields =
  | "*"
  | "save.locked"
  | "save.protected"
  | "save.damage"
  | "save.empirevalue"
  | "save.flinger"
  | "save.catapult"
  | "save.resources"
  | "save.monsters"
  | "save.attackid"
  | "save.attacks";

export type UserCellOwner = Loaded<User, "save", "userid" | "username" | "pic_square" | "alliance_id" | "save.points" | "save.basevalue">;

type Cell = Loaded<WorldMapCell, "save", UserCellFields>;

/**
 * Handles the user's homecell & outpost data on the world map.
 *
 * Retrives the current user's homecell details if the cell belongs to them.
 * Otherwise, retrieves the homecell details of all other users on the world map.
 * Data for a homeCell comes from both the world map cell and the user's save data.
 *
 * @param {Context} ctx - The Koa context object.
 * @param {Cell} cell - The world map cell, with the save fields this handler reads.
 * @param {Map<number, UserCellOwner>} cellOwners - Pre-loaded map of user IDs to cell owners.
 */
export const userCell = async (ctx: Context, cell: Cell, cellOwners: Map<number, UserCellOwner>) => {
  const currentUser: User = ctx.authUser;
  const { lastSeen, truces } = ctx.state;

  const mine = currentUser.userid === cell.uid;
  const cellOwner = mine ? currentUser : cellOwners.get(cell.uid);

  const cellSave = cell.save;
  if (!cellSave || !cellOwner?.save) return;

  const currentTime = getCurrentDateTime();

  const homeCell = cell.base_type === MapRoomCell.HOMECELL;
    
  const online = homeCell && (lastSeen.get(cell.uid) ?? 0) >= currentTime - 60;
  const isUnderAttack = homeCell && isAttackActive(cellSave);

  let locked = cellSave.locked;
  if (online || isUnderAttack) locked = 1;
  if (mine) locked = 0;

  const points = cellOwner.save.points;
  const basevalue = cellOwner.save.basevalue;
  const baseLevel = calculateBaseLevel(points, basevalue);

  const isProtected = cellSave.protected > 0 && cellSave.protected > currentTime;
  const protectionExpired = cellSave.protected > 0 && cellSave.protected <= currentTime;

  const damage = protectionExpired ? 0 : cellSave.damage;

  const truceExpiry = mine ? undefined : truces.get(cellOwner.userid)?.expires_at;

  return {
    uid: cellOwner.userid,
    b: cell.base_type,
    pi: 0,
    bid: cell.baseid,
    aid: cellOwner.alliance_id,
    i: cell.terrainHeight,
    v: cellSave.empirevalue,
    mine: mine ? 1 : 0,
    f: cellSave.flinger,
    c: cellSave.catapult,
    t: truceExpiry,
    n: cellOwner.username,
    fr: 0,
    p: isProtected ? 1 : 0,
    // Only the owner's own cells carry live resources and monsters. Every client read of
    // `r`/`m` is gated on the cell being the viewer's own - the 1 Hz production sim bails
    // at `if (!this._mine) return true` (MapRoomCell.as:706), the attack monster roll-up
    // checks `mapRoomCell._mine` (PopupAttackA.as:218), the spend path checks
    // `attackerCell.mine` (BASE.as:2989), and the garrison popups are own-yard only
    // (PopupInfoMine.as:361, PopupMonstersA.as:72). Omitting them makes MapRoomCell.Setup
    // fall back to its zeroed defaults (MapRoomCell.as:375-395, :410-420).
    ...(mine && { r: cellSave.resources, m: cellSave.monsters || {} }),
    l: baseLevel,
    d: damage >= 90 ? 1 : 0,
    lo: locked,
    dm: damage,
    pic_square: cellOwner.pic_square,
  };
};
