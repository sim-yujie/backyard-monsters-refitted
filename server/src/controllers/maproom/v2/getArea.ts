import { z } from "zod";

import type { KoaController } from "../../../utils/KoaController.js";
import { User } from "../../../database/models/user.model.js";
import { WorldMapCell } from "../../../database/models/worldmapcell.model.js";
import { postgres } from "../../../server.js";
import { devConfig } from "../../../config/GameConfig.js";
import { Status } from "../../../enums/StatusCodes.js";
import { createCellData } from "../../../services/maproom/v2/createCellData.js";
import { generateNoise, getTerrainHeight } from "../../../services/maproom/v2/generateMap.js";
import { MapRoom2, MapRoomCell, MapRoomVersion } from "../../../enums/MapRoom.js";
import { onlinePlayers } from "../../../services/user/online.js";
import { getTruces } from "../../../services/maproom/getTruces.js";
import { idleWorkerSaves } from "../../../services/maproom/v2/idleWorkers.js";
import { pendingInvitesOn } from "../../../services/mail/inviteRules.js";
import { getCurrentDateTime } from "../../../utils/getCurrentDateTime.js";
import { mapRoomDisabledErr } from "../../../errors/errors.js";
import { getAllianceRoster } from "../../../services/alliance/allianceData.js";
import { visibleCredits } from "../../../services/user/shinyLock.js";
import { emptyAreaResponse, hasWorldPlacement } from "../../../services/maproom/v2/emptyAreaResponse.js";
import { getPlayerSight } from "../../../services/maproom/sight/sightService.js";
import { isVisible } from "../../../game-rules/maproom/sight.js";

/**
 * Wraps a zone coordinate to the world's `0..size-1`: `getarea`'s 11×11 block
 * can run past the world edge (`x+10` etc.), unwrapped, same as today. Only
 * the fog of war's visibility test needs the wrapped form, so a cell near
 * the seam compares correctly against `revealed`'s exact coordinates
 * (`fog-of-war.md` §5.1 step 3); the hex-ring sight circles already wrap on
 * their own (`game-rules/maproom/range.ts`'s `hexDistance`).
 */
const wrap = (n: number, size: number): number => ((n % size) + size) % size;

/** `x,y` as a `Map` key for a zone's per-cell visibility lookup. */
const cellKey = (x: number, y: number): string => `${x},${y}`;

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

  const zoneVisibility = new Map<string, boolean>();
  for (let cellX = currentX; cellX <= currentX + width; cellX++) {
    for (let cellY = currentY; cellY <= currentY + height; cellY++) {
      const wrapped = { x: wrap(cellX, MapRoom2.WIDTH), y: wrap(cellY, MapRoom2.HEIGHT) };
      const visible = devConfig.disableFogOfWar || isVisible(wrapped, sight.sources, sight.revealed);
      zoneVisibility.set(cellKey(cellX, cellY), visible);
    }
  }

  const credits = visibleCredits(user, placedSave.credits);
  const extras = sendresources === 1 ? { resources: placedSave.resources, credits } : {};

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

  // Own outposts whose worker is free (#338), by base-save id.
  const ownOutpostSaveIds = visibleDbCells
    .filter((cell) => cell.uid === user.userid && cell.base_type === MapRoomCell.OUTPOST && cell.save)
    .map((cell) => cell.save!.basesaveid);

  const [ownersList, online, truces, pendingInvites, idleWorkers] = await Promise.all([
    postgres.em.find(User, { userid: { $in: ownerIds } }, {
      populate: ["save"],
      fields: CELL_OWNER_FIELDS,
    }),
    // The online rule of #271, in the attack load's window: the lock shows
    // only on a player who really cannot be attacked (#275).
    onlinePlayers(ownerIds, getCurrentDateTime()),
    getTruces(user.userid, ownerIds),
    pendingInvitesOn(postgres.em, user.userid, ownOutposts, getCurrentDateTime()),
    idleWorkerSaves(postgres.em, ownOutpostSaveIds),
  ]);

  const cellOwners = new Map(ownersList.map((u) => [u.userid, u]));

  ctx.state.online = online;
  ctx.state.truces = truces;
  ctx.state.pendingInvites = pendingInvites;
  ctx.state.idleWorkers = idleWorkers;

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
