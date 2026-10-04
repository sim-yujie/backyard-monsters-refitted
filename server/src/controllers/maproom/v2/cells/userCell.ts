import type { Context } from "koa";
import type { Loaded } from "@mikro-orm/core";
import type { User } from "../../../../database/models/user.model.js";
import type { WorldMapCell } from "../../../../database/models/worldmapcell.model.js";
import { calculateBaseLevel } from "../../../../services/base/calculateBaseLevel.js";
import { getCurrentDateTime } from "../../../../utils/getCurrentDateTime.js";
import { MapRoomCell } from "../../../../enums/MapRoom.js";
import { isAttackActive } from "../../../../services/base/isAttackActive.js";
import { TAKEOVER_DAMAGE } from "../../../../services/maproom/v2/takeoverRules.js";
import { loadArmyOwner, monstersForMap, type ArmyOwner } from "../../../../services/yard/armies.js";

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
  | "save.basesaveid"
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
  const { online: onlineNow, truces, pendingInvites } = ctx.state;

  const mine = currentUser.userid === cell.uid;
  const cellOwner = mine ? currentUser : cellOwners.get(cell.uid);

  const cellSave = cell.save;
  if (!cellSave || !cellOwner?.save) return;

  const currentTime = getCurrentDateTime();

  const homeCell = cell.base_type === MapRoomCell.HOMECELL;
    
  // The online rule of #271, read for every owner by `getArea` (#275).
  const online = homeCell && onlineNow.has(cell.uid);
  const isUnderAttack = homeCell && isAttackActive(cellSave);

  let locked = cellSave.locked;
  if (online || isUnderAttack) locked = 1;
  if (mine) locked = 0;

  const points = cellOwner.save.points;
  const basevalue = cellOwner.save.basevalue;
  const baseLevel = calculateBaseLevel(points, basevalue);

  const isProtected = cellSave.protected > 0 && cellSave.protected > currentTime;

  // The real damage until the owner repairs (`catchUpDamage.ts`), not 0 once
  // damage protection ends: the owner's rule (issue #182 B). The takeover rules
  // read the same stored figure.
  const damage = cellSave.damage;

  const truceExpiry = mine ? undefined : truces.get(cellOwner.userid)?.expires_at;

  // The army as it is now (docs/design/yard-buildings.md §2.3): the stored
  // blob caught up in memory, so the roster the map offers for an attack
  // equals what the next write stores. The owner's academy and buffs are read
  // once per request.
  const monsters = mine ? await ownMonsters(ctx, cellSave, currentUser, currentTime) : undefined;

  return {
    uid: cellOwner.userid,
    b: cell.base_type,
    // The thread of an invitation to move still waiting on this, one of the
    // viewer's own outposts (#205; Flash's `_invitePendingID`), else 0.
    pi: (mine && !homeCell && (pendingInvites as Map<string, number> | undefined)?.get(cell.baseid)) || 0,
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
    // When damage protection ends, unix seconds (#187): Flash sent only `p`,
    // and the map could only say "protected" with no end. Sent while it runs.
    ...(isProtected && { pe: cellSave.protected }),
    // Only the owner's own cells carry live resources and monsters. Every client read of
    // `r`/`m` is gated on the cell being the viewer's own - the 1 Hz production sim bails
    // at `if (!this._mine) return true` (MapRoomCell.as:706), the attack monster roll-up
    // checks `mapRoomCell._mine` (PopupAttackA.as:218), the spend path checks
    // `attackerCell.mine` (BASE.as:2989), and the garrison popups are own-yard only
    // (PopupInfoMine.as:361, PopupMonstersA.as:72). Omitting them makes MapRoomCell.Setup
    // fall back to its zeroed defaults (MapRoomCell.as:375-395, :410-420).
    ...(mine && { r: cellSave.resources, m: monsters || {} }),
    l: baseLevel,
    d: damage >= TAKEOVER_DAMAGE ? 1 : 0,
    lo: locked,
    dm: damage,
    pic_square: cellOwner.pic_square,
  };
};

/** `m` for one of the viewer's own cells, caught up; the stored blob if the row cannot be read. */
const ownMonsters = async (
  ctx: Context,
  cellSave: NonNullable<Cell["save"]>,
  currentUser: User,
  now: number
) => {
  const basesaveid = cellSave.basesaveid;
  const mainId = currentUser.save?.basesaveid;
  if (!basesaveid) return cellSave.monsters;

  const owner = (): Promise<ArmyOwner> => {
    ctx.state.armyOwner ??= mainId ? loadArmyOwner(mainId) : Promise.resolve(null);
    return ctx.state.armyOwner as Promise<ArmyOwner>;
  };

  return (await monstersForMap(basesaveid, owner, now)) ?? cellSave.monsters;
};
