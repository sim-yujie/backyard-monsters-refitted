import type { Context } from "koa";

import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { MapRoomCell } from "../../../enums/MapRoom.js";
import { onlinePlayers } from "../../user/online.js";
import { getTruces } from "../getTruces.js";
import { attackersAmong } from "./attackers.js";
import { attackedBetween } from "./hostiles.js";
import { friendMarksAmong } from "../../friends/friendFlags.js";
import { outpostWorkerSaves } from "./idleWorkers.js";
import { pendingInvitesOn } from "../../mail/inviteRules.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { visiblePhotos } from "../../profile/visiblePhoto.js";
import { flingerLevelsNow } from "../../yard/flingerLevelsNow.js";
import { loadArmyOwner, monstersForMapMany } from "../../yard/armies.js";
import { mr2NeighbourBonusMode } from "../../../config/MapRoom2Config.js";
import { loadAreaNeighbourCounts } from "./neighbourDefence.js";
import { createCellData, type MapCell } from "./createCellData.js";
import { getTerrainHeight, type generateNoise } from "./generateMap.js";

/**
 * How a Map Room 2 cell's payload is built, shared by `getarea`/`getareas`
 * (`controllers/maproom/v2/getArea.ts`) and the live map's pushes (beta 9,
 * stage 2, `live/liveCells.ts`), so a pushed cell is exactly what the zone
 * answer gives for it.
 *
 * A payload is built for a viewer. A signed-in player gets everything
 * `getarea` always gave them. The live push is built once for every watcher,
 * for the {@link STRANGER}: a viewer with no cells, no alliance and no
 * relations, so it carries only what anyone who can see the cell may see.
 * What is the viewer's own (`mine`, the owner's fields) or about the viewer
 * and the owner together (`t`, `ak`, `fr`, `fp`, `ho`) never rides a push;
 * the map keeps those from its own answers ({@link RELATION_FIELDS}).
 */

/** Fields loaded off the requesting player's own save. */
export const OWN_SAVE_FIELDS = [
  "save.basesaveid",
  "save.worldid",
  "save.credits",
  "save.resources",
  "save.points",
  "save.basevalue",
] as const;

/**
 * User fields fetched alongside each WorldMapCell in the DB query for cell owners.
 * Restricted to only what the cell handlers need.
 */
export const CELL_OWNER_FIELDS = ["userid", "username", "pic_square", "save.points", "save.basevalue", "alliance_id"] as const;

/**
 * Save fields fetched alongside each WorldMapCell in the DB query.
 * Restricted to only what the cell handlers need.
 */
export const CELL_SAVE_FIELDS = [
  "*",
  "save.basesaveid",
  "save.locked",
  "save.empirevalue",
  "save.flinger",
  "save.catapult",
  "save.protected",
  "save.resources",
  "save.monsters",
  "save.damage",
  "save.destroyed",
  // Needed by the wild monster expiry rule - a camp regenerates 12 hours after its last save.
  "save.savetime",
  "save.wmid",
  "save.points",
  "save.basevalue",
  "save.attackid",
  "save.attacks",
  // Which Starter Kit an outpost wears (issue #334): `userCell` sends it as
  // `kit`, visible on every outpost, not only the owner's.
  "save.starterkit",
  // The main yard's Town Hall level, sent as `th` on home cells (Map Room 2 draws that hall).
  "save.thlevel",
] as const;

/**
 * The fields of a player cell that depend on who looks at it, besides the
 * owner's own (`mine` and what only `mine` carries): a running truce `t`,
 * "attacked you" `ak`, friend `fr`, pinned friend `fp`, hostile `ho`. A push
 * never carries them; the map keeps them from its own answer for that owner.
 */
export const RELATION_FIELDS = ["t", "ak", "fr", "fp", "ho"] as const;

/**
 * The viewer a live push is built for: nobody. Owns no cell (no real cell's
 * `uid` is -1), in no alliance, related to nobody.
 */
export const STRANGER = Object.freeze({ userid: -1, alliance_id: null, save: undefined }) as unknown as User;

/** The context `userCell` reads (`ctx.authUser`, `ctx.state`), for a build outside a request. */
export interface CellContext {
  authUser: User;
  state: Record<string, unknown>;
}

/** A context for building payloads as `viewer` sees them, outside a request. */
export const cellContext = (viewer: User): CellContext => ({ authUser: viewer, state: {} });

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/**
 * Every row's payload as the context's viewer sees it, keyed `x,y` (a row
 * whose payload came out empty, its owner gone, is left out: the caller
 * draws generated ground there, as `getarea` always did). Loads, in one go
 * for all the rows, what the cell handlers read off `ctx.state`: who is
 * online and whose photo shows, and for a real viewer their truces,
 * invitations, workers, attackers, friends, hostiles, Flingers and armies.
 * Returns the alliances owning the rows too, for the roster.
 */
export const rowPayloads = async (
  ctx: CellContext,
  worldid: string,
  rows: readonly MapCell[],
  { ownOnly = false }: { ownOnly?: boolean } = {},
): Promise<{ payloads: Map<string, unknown>; alliances: Set<number> }> => {
  const user = ctx.authUser;
  const stranger = user.userid === STRANGER.userid;
  // Only the viewer's own rows (the live map's own channel): what is about another owner (who is
  // online, truces, attackers, friends, hostiles, the owners themselves) changes nothing on them
  // (`userCell` reads the viewer for `mine`, and every relation is off on it), so it is not read.
  const others = !ownOnly;
  if (ownOnly && rows.some((cell) => cell.uid !== user.userid)) throw new Error("ownOnly: a row is not the viewer's");
  const now = getCurrentDateTime();

  // Batch load all unique cell owners in a single query
  const ownerIds = [...new Set(rows.map((cell) => cell.uid).filter(Boolean))] as number[];

  const own = stranger ? [] : rows.filter((cell) => cell.uid === user.userid);
  // The player's own outposts here, for their invitations still waiting (`pi`, #205).
  const ownOutposts = own.filter((cell) => cell.base_type === MapRoomCell.OUTPOST).map((cell) => cell.baseid);
  // Own outposts whose worker is free (#338) or busy, by base-save id.
  const ownOutpostSaveIds = own
    .filter((cell) => cell.base_type === MapRoomCell.OUTPOST && cell.save)
    .map((cell) => cell.save!.basesaveid);
  // The player's own yard and outposts here, for their Flinger level as of now (`f`).
  const ownBaseids = own.map((cell) => cell.baseid);
  // ... and for their armies as of now (`m`), all in one query (`monstersForMapMany`).
  const ownSaveIds = own.filter((cell) => cell.save?.basesaveid).map((cell) => cell.save!.basesaveid);
  const viewerMainId = user.save?.basesaveid;
  const viewerMain = () => (viewerMainId ? loadArmyOwner(viewerMainId) : Promise.resolve(null));

  const none = <T>(value: T): Promise<T> => Promise.resolve(value);

  const [ownersList, online, truces, pendingInvites, workers, attackers, friendMarks, attacked, photos, flingers, ownMonsters] =
    await Promise.all([
      others && ownerIds.length
        ? postgres.em.find(User, { userid: { $in: ownerIds } }, { populate: ["save"], fields: CELL_OWNER_FIELDS })
        : none([] as User[]),
      // The online rule of #271, in the attack load's window: the lock shows
      // only on a player who really cannot be attacked (#275).
      others ? onlinePlayers(ownerIds, now) : none(new Set<number>()),
      stranger || !others ? none(new Map()) : getTruces(user.userid, ownerIds),
      stranger ? none(new Map()) : pendingInvitesOn(postgres.em, user.userid, ownOutposts, now),
      stranger ? none({ idle: new Set<number>(), busy: new Map<number, number | null>() }) : outpostWorkerSaves(postgres.em, ownOutpostSaveIds, now),
      // Who has ever attacked the viewer: the red "attacked you" plate (`ak`).
      stranger || !others ? none(new Set<number>()) : attackersAmong(postgres.em, user.userid, ownerIds),
      // Friends among them: the `fr` flag (friends WP2, #369), and the pinned ones' `fp` (beta 7).
      stranger || !others
        ? none({ friends: new Set<number>(), pinned: new Set<number>() })
        : friendMarksAmong(postgres.em, user.userid, ownerIds),
      // Anyone with an attack between them and the viewer, either way: the hostile border's `ho`
      // (owner, 8 Nov 2026; `hostiles.ts`), switched off by a running truce in `userCell`.
      stranger || !others ? none(new Set<number>()) : attackedBetween(postgres.em, user.userid, ownerIds),
      // Their uploaded photos others may see (owner, 13 Nov 2026), one query for the area: `photo`.
      visiblePhotos(postgres.em, ownerIds),
      // Each own Flinger's level as the range check reads it (`validateRange.ts`):
      // a build or upgrade that ran out since the yard was last written counts now,
      // so the map's range, its Attack button and the server agree.
      ownBaseids.length ? flingerLevelsNow(ownBaseids) : none(new Map()),
      ownSaveIds.length ? monstersForMapMany(ownSaveIds, viewerMain, now) : none(new Map()),
    ]);

  const cellOwners = new Map(ownersList.map((u) => [u.userid, u]));

  ctx.state.online = online;
  ctx.state.truces = truces;
  ctx.state.pendingInvites = pendingInvites;
  ctx.state.idleWorkers = workers.idle;
  ctx.state.busyWorkers = workers.busy;
  ctx.state.attackers = attackers;
  ctx.state.friends = friendMarks.friends;
  ctx.state.pinnedFriends = friendMarks.pinned;
  ctx.state.attacked = attacked;
  ctx.state.photos = photos;
  ctx.state.flingers = flingers;
  ctx.state.ownMonsters = ownMonsters;

  const alliances = new Set<number>();
  for (const owner of cellOwners.values()) if (owner.alliance_id) alliances.add(owner.alliance_id);

  const payloads = new Map<string, unknown>();
  for (const cell of rows) {
    const payload = await createCellData(cell, worldid, ctx as unknown as Context, cellOwners as never);
    if (payload !== undefined) payloads.set(cellKey(cell.x, cell.y), payload);
  }
  return { payloads, alliances };
};

/** A cell with no row (or a row that gave nothing): generated in memory, as `getarea` always did. */
export const generatedPayload = (
  ctx: CellContext,
  worldid: string,
  noise: ReturnType<typeof generateNoise>,
  x: number,
  y: number,
): ReturnType<typeof createCellData> => {
  const inMemoryCell = new WorldMapCell(undefined, x, y, getTerrainHeight(noise, x, y));
  return createCellData(inMemoryCell as MapCell, worldid, ctx as unknown as Context);
};

/** A served cell the neighbour count reads: players' cells and camps have both. */
interface CountedCell {
  uid?: number;
  b?: number;
  nb?: number;
}

/** Puts `nb` on every served land cell with friendly neighbours, when the switch is on. */
export const addNeighbourCounts = async (
  cells: Record<number, Record<number, unknown>>,
  worldid: string,
  heightAt: (x: number, y: number) => number,
): Promise<void> => {
  const mode = mr2NeighbourBonusMode();
  if (mode === "off") return;
  const targets: Array<{ x: number; y: number; uid: number; base_type: number; cell: CountedCell }> = [];
  for (const [x, column] of Object.entries(cells)) {
    for (const [y, payload] of Object.entries(column)) {
      const cell = payload as CountedCell;
      if (typeof cell.b !== "number" || typeof cell.uid !== "number") continue;
      targets.push({ x: Number(x), y: Number(y), uid: cell.uid, base_type: cell.b, cell });
    }
  }
  const counts = await loadAreaNeighbourCounts(targets, worldid, heightAt, mode === "players");
  for (const target of targets) {
    const count = counts.get(`${target.x},${target.y}`);
    if (count) target.cell.nb = count;
  }
};
