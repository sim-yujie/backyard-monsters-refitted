import { z } from "zod";

import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres, redis } from "../../../server.js";
import { devConfig } from "../../../config/GameConfig.js";
import { Status } from "../../../enums/StatusCodes.js";
import { createCellData } from "../../../services/maproom/v2/createCellData.js";
import { generateNoise, getTerrainHeight } from "../../../services/maproom/v2/generateMap.js";
import { MapRoom2, MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import { onlinePlayers } from "../../../services/user/online.js";
import { getTruces } from "../../../services/maproom/getTruces.js";
import { attackersAmong } from "../../../services/maproom/v2/attackers.js";
import { attackedBetween } from "../../../services/maproom/v2/hostiles.js";
import { friendMarksAmong } from "../../../services/friends/friendFlags.js";
import { outpostWorkerSaves } from "../../../services/maproom/v2/idleWorkers.js";
import { pendingInvitesOn } from "../../../services/mail/inviteRules.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { mapRoomDisabledErr } from "../../../errors/errors.js";
import { getAllianceRoster } from "../../../services/alliance/allianceData.js";
import { visibleCredits } from "../../../services/user/shinyLock.js";
import { emptyAreaResponse, hasWorldPlacement } from "../../../services/maproom/v2/emptyAreaResponse.js";
import { getPlayerSight } from "../../../services/maproom/sight/sightService.js";
import { zoneCellKey, zoneVisibility as visibilityOfZone } from "../../../services/maproom/sight/zoneVisibility.js";
import { mr2HexShape, mr2NeighbourBonusMode } from "../../../config/MapRoom2Config.js";
import { loadAreaNeighbourCounts } from "../../../services/maproom/v2/neighbourDefence.js";
import { visiblePhotos } from "../../../services/profile/visiblePhoto.js";
import { flingerLevelsNow } from "../../../services/yard/flingerLevelsNow.js";
import { loadArmyOwner, monstersForMapMany } from "../../../services/yard/armies.js";
import { readZoneVersion, zoneId } from "../../../services/maproom/live/liveZones.js";

/** `x,y` as a `Map` key for a zone's per-cell visibility lookup. */
const cellKey = zoneCellKey;

/**
 * Schema for validating the request body when getting area data.
 */
const getAreaSchema = z.object({
  x: z.coerce.number().int().min(0).max(MapRoom2.WIDTH - 1),
  y: z.coerce.number().int().min(0).max(MapRoom2.HEIGHT - 1),
  sendresources: z.coerce.number().optional().default(0),
});

/**
 * Fields loaded off the requesting player's own save.
 */
const OWN_SAVE_FIELDS = [
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
const CELL_OWNER_FIELDS = [
  "userid",
  "username",
  "pic_square",
  "save.points",
  "save.basevalue",
  "alliance_id",
] as const;

/**
 * Save fields fetched alongside each WorldMapCell in the DB query.
 * Restricted to only what the cell handlers need.
 */
const CELL_SAVE_FIELDS = [
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
 * Controller for generating cells on the World Map.
 * 
 * Processes chunks of 10 x 10 cells, retrieving persistent cells (e.g., homebases, outposts) 
 * from the database, while all other cells are stored in-memory.
 * 
 * @param {Koa.Context} ctx - The Koa context object
 * @returns {Promise<void>} A promise that resolves when the area data is retrieved and the response is sent.
 * 
 * @throws {Error} Throws an error if there are issues parsing the request body or retrieving data.
 */
/** A served cell the neighbour count reads: players' cells and camps have both. */
interface CountedCell {
  uid?: number;
  b?: number;
  nb?: number;
}

/** Puts `nb` on every served land cell with friendly neighbours, when the switch is on. */
const addNeighbourCounts = async (
  cells: Record<number, Record<number, unknown>>,
  worldid: string,
  heightAt: (x: number, y: number) => number
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

/** Every cell of the zone visible: the fog of war switched off (`devConfig.disableFogOfWar`). */
const allVisible = (x: number, y: number, width: number, height: number): Map<string, boolean> => {
  const visibility = new Map<string, boolean>();
  for (let cellX = x; cellX <= x + width; cellX++) {
    for (let cellY = y; cellY <= y + height; cellY++) visibility.set(cellKey(cellX, cellY), true);
  }
  return visibility;
};

export const getArea: KoaController = async (ctx) => {
  if (!devConfig.maproom) throw mapRoomDisabledErr();
  
  const { x, y, sendresources } = getAreaSchema.parse(ctx.request.body);

  const user: User = ctx.authUser;

  await postgres.em.populate(user, ["save"], { fields: OWN_SAVE_FIELDS });

  const save = user.save;

  // No Save row yet (brand-new account, before its first /base/load), or a
  // Save that has never been placed on a Map Room 2 world (Town Hall 6 gate
  // on /worldmapv2/setmapversion). Neither is an error - see
  // emptyAreaResponse.ts.
  if (!hasWorldPlacement(save)) {
    ctx.status = Status.OK;
    ctx.body = emptyAreaResponse(x, y);
    return;
  }

  // hasWorldPlacement guarantees both `save` and `save.worldid` from here on.
  const placedSave = save!;
  const worldid = placedSave.worldid!;

  const width = 10;
  const height = 10;

  const currentX = x;
  const currentY = y;

  // The fog of war (issue #330, `docs/design/fog-of-war.md` §5.1): what P can
  // see of this zone, before any `world_map_cell` row is touched. `sv` rides
  // on every response below so the client can tell its cached zones apart
  // from a sight that has changed.
  const sight = await getPlayerSight(user);

  // `getarea`'s 11×11 block can run past the world edge (`x+10` etc.),
  // unwrapped; each cell is tested at its wrapped coordinates, so one near
  // the seam compares correctly against `revealed`'s exact coordinates
  // (`fog-of-war.md` §5.1 step 3). Only the circles and cells that can reach
  // this zone are asked (`zoneVisibility.ts`): the same answer, without
  // testing every cell against a big alliance's whole sight.
  const zoneVisibility = devConfig.disableFogOfWar
    ? allVisible(currentX, currentY, width, height)
    : visibilityOfZone(sight, currentX, currentY, width, height, mr2HexShape());

  const credits = visibleCredits(user, placedSave.credits);
  // The live map (beta 9): the zone's version, read before any row is, so a write landing in
  // between makes the map ask once more rather than keep an old answer under a new version.
  const zv = await readZoneVersion(redis, worldid, zoneId(Math.floor(x / 10) * 10, Math.floor(y / 10) * 10));
  const extras = { zv, ...(sendresources === 1 ? { resources: placedSave.resources, credits } : {}) };

  // No sight source or revealed cell touches this zone at all: answer at
  // once with every cell fogged, no `world_map_cell` query, no owner data.
  if (![...zoneVisibility.values()].some(Boolean)) {
    const cells: Record<number, Record<number, unknown>> = {};
    for (let cellX = currentX; cellX <= currentX + width; cellX++) {
      cells[cellX] = {};
      for (let cellY = currentY; cellY <= currentY + height; cellY++) {
        cells[cellX][cellY] = { fog: 1 };
      }
    }

    ctx.status = Status.OK;
    ctx.body = {
      error: 0,
      x: currentX,
      y: currentY,
      data: cells,
      alliancedata: await getAllianceRoster(user.alliance_id ? [user.alliance_id] : []),
      sv: sight.sv,
      myalliance: user.alliance_id ?? null,
      ...extras,
    };
    return;
  }

  // First, get persistant cells which have been stored in the database.
  const dbCells = await postgres.em.find(
    WorldMapCell,
    {
      world: worldid,
      map_version: MapRoomVersion.V2,
      x: {
        $gte: currentX,
        $lte: currentX + width,
      },
      y: {
        $gte: currentY,
        $lte: currentY + height,
      },
    },
    { populate: ["save"], fields: CELL_SAVE_FIELDS }
  );

  // Hidden rows are dropped here, before owners, online status, truces and
  // invites are loaded, so nothing about them reaches the response or the
  // logs (`fog-of-war.md` §5.1 step 4).
  const visibleDbCells = dbCells.filter((cell) => zoneVisibility.get(cellKey(cell.x, cell.y)));

  // Batch load all unique cell owners in a single query
  const ownerIds = [...new Set(visibleDbCells.map(cell => cell.uid).filter(Boolean))] as number[];

  // The player's own outposts here, for their invitations still waiting (`pi`, #205).
  const ownOutposts = visibleDbCells
    .filter((cell) => cell.uid === user.userid && cell.base_type === MapRoomCell.OUTPOST)
    .map((cell) => cell.baseid);

  // Own outposts whose worker is free (#338) or busy, by base-save id.
  const ownOutpostSaveIds = visibleDbCells
    .filter((cell) => cell.uid === user.userid && cell.base_type === MapRoomCell.OUTPOST && cell.save)
    .map((cell) => cell.save!.basesaveid);

  // The player's own yard and outposts here, for their Flinger level as of now (`f`).
  const ownBaseids = visibleDbCells.filter((cell) => cell.uid === user.userid).map((cell) => cell.baseid);

  // ... and for their armies as of now (`m`), all in one query (`monstersForMapMany`).
  const ownSaveIds = visibleDbCells
    .filter((cell) => cell.uid === user.userid && cell.save?.basesaveid)
    .map((cell) => cell.save!.basesaveid);
  const viewerMainId = user.save?.basesaveid;
  const viewerMain = () => (viewerMainId ? loadArmyOwner(viewerMainId) : Promise.resolve(null));

  const [ownersList, online, truces, pendingInvites, workers, attackers, friendMarks, attacked, photos, flingers, ownMonsters] = await Promise.all([
    postgres.em.find(User, { userid: { $in: ownerIds } }, {
      populate: ["save"],
      fields: CELL_OWNER_FIELDS,
    }),
    // The online rule of #271, in the attack load's window: the lock shows
    // only on a player who really cannot be attacked (#275).
    onlinePlayers(ownerIds, getCurrentDateTime()),
    getTruces(user.userid, ownerIds),
    pendingInvitesOn(postgres.em, user.userid, ownOutposts, getCurrentDateTime()),
    outpostWorkerSaves(postgres.em, ownOutpostSaveIds, getCurrentDateTime()),
    // Who has ever attacked the viewer: the red "attacked you" plate (`ak`).
    attackersAmong(postgres.em, user.userid, ownerIds),
    // Friends among them: the `fr` flag (friends WP2, #369), and the pinned ones' `fp` (beta 7).
    friendMarksAmong(postgres.em, user.userid, ownerIds),
    // Anyone with an attack between them and the viewer, either way: the hostile border's `ho`
    // (owner, 8 Nov 2026; `hostiles.ts`), switched off by a running truce in `userCell`.
    attackedBetween(postgres.em, user.userid, ownerIds),
    // Their uploaded photos others may see (owner, 13 Nov 2026), one query for the area: `photo`.
    visiblePhotos(postgres.em, ownerIds),
    // Each own Flinger's level as the range check reads it (`validateRange.ts`):
    // a build or upgrade that ran out since the yard was last written counts now,
    // so the map's range, its Attack button and the server agree.
    flingerLevelsNow(ownBaseids),
    monstersForMapMany(ownSaveIds, viewerMain, getCurrentDateTime()),
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

  const allianceIds = new Set<number>();

  if (user.alliance_id) allianceIds.add(user.alliance_id);

  for (const owner of cellOwners.values()) {
    if (owner.alliance_id) allianceIds.add(owner.alliance_id);
  }

  const alliancedata = await getAllianceRoster([...allianceIds]);

  const cells: Record<number, Record<number, unknown>> = {};
  for (const cell of visibleDbCells) {
    if (!cells[cell.x]) cells[cell.x] = {};

    cells[cell.x][cell.y] = await createCellData(cell, worldid, ctx, cellOwners);
  }

  // Then, fill the remaining cells: fog where hidden, else generated in-memory.
  const noise = generateNoise(worldid);
  for (let cellX = currentX; cellX <= currentX + width; cellX++) {
    // Ensure the cellX object exists in the cells map to append the cellY object to it
    if (!cells[cellX]) cells[cellX] = {};
    for (let cellY = currentY; cellY <= currentY + height; cellY++) {
      // The cell already exists, skip it
      if (cells[cellX][cellY]) continue;

      if (!zoneVisibility.get(cellKey(cellX, cellY))) {
        cells[cellX][cellY] = { fog: 1 };
        continue;
      }

      const terrainHeight = getTerrainHeight(noise, cellX, cellY);
      // Create a cell in-memory, skip the world being defined for memory efficency
      const inMemoryCell = new WorldMapCell(
        undefined,
        cellX,
        cellY,
        terrainHeight
      );
      cells[cellX][cellY] = await createCellData(inMemoryCell, worldid, ctx);
    }
  }

  // Map Room 2's neighbour defence bonus, switched on: each land cell's
  // friendly neighbours as `nb`, counted the way the attack load counts them
  // for the battle (`docs/mr2-neighbours.md`). Switched off, nothing is added.
  await addNeighbourCounts(cells, worldid, (cx, cy) => getTerrainHeight(noise, cx, cy));

  ctx.status = Status.OK;
  ctx.body = {
    error: 0,
    x: currentX,
    y: currentY,
    data: cells,
    alliancedata,
    sv: sight.sv,
    // The viewer's own alliance id (issue #334: plates read gold for "you",
    // green for "your alliance"); cheap, since `user` is already loaded for
    // this request and carries it directly, unlike a cell owner's, which is a
    // batched lookup (`CELL_OWNER_FIELDS`).
    myalliance: user.alliance_id ?? null,
    ...extras,
  };
};
