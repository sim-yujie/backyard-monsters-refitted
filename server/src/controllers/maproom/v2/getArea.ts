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

/** The most zones one `/worldmapv2/getareas` asks for (live map, beta 9). */
export const MAX_BATCH_ZONES = 10;

/**
 * `/worldmapv2/getareas`'s body: zone origins as `"x,y;x,y"` (a flat string, as
 * every JSON body is flattened to, `jsonBodyCompat`), at most {@link MAX_BATCH_ZONES}.
 */
const getAreasSchema = z.object({
  zones: z
    .string()
    .max(MAX_BATCH_ZONES * 8 + 16)
    .transform((text, check) => {
      const zones = text
        .split(";")
        .filter(Boolean)
        .map((pair) => pair.split(",").map(Number));
      const valid = zones.every(
        ([zx, zy]) =>
          Number.isInteger(zx) && Number.isInteger(zy) && zx! >= 0 && zy! >= 0 && zx! < MapRoom2.WIDTH && zy! < MapRoom2.HEIGHT,
      );
      if (!valid || zones.length === 0 || zones.length > MAX_BATCH_ZONES) {
        check.addIssue({ code: "custom", message: "zones" });
        return z.NEVER;
      }
      return zones.map(([zx, zy]) => ({ x: zx!, y: zy! }));
    }),
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

/** One zone a request asks for: its origin as sent. */
export interface AreaRequest {
  x: number;
  y: number;
}

const ZONE_SPAN = 10;
const cellsKey = (x: number, y: number): string => `${x},${y}`;

/**
 * The `getarea` answers for one or more zones (live map, beta 9: the map
 * re-asks the zones that changed in one call, `/worldmapv2/getareas`). Every
 * lookup that does not depend on the zone runs once for the whole call — the
 * viewer's save and sight, the cell rows (one query over every zone), their
 * owners and the viewer's relations to them, the alliance roster and the
 * neighbour counts — so asking for several zones together costs about what
 * one zone did. One zone gives exactly the answer `getarea` always gave.
 */
export const buildAreas = async (
  ctx: Parameters<KoaController>[0],
  zones: readonly AreaRequest[],
  sendresources: number,
): Promise<Record<string, unknown>[]> => {
  const user: User = ctx.authUser;

  await postgres.em.populate(user, ["save"], { fields: OWN_SAVE_FIELDS });

  const save = user.save;

  // No Save row yet (brand-new account, before its first /base/load), or a
  // Save that has never been placed on a Map Room 2 world (Town Hall 6 gate
  // on /worldmapv2/setmapversion). Neither is an error - see
  // emptyAreaResponse.ts.
  if (!hasWorldPlacement(save)) return zones.map((zone) => emptyAreaResponse(zone.x, zone.y));

  // hasWorldPlacement guarantees both `save` and `save.worldid` from here on.
  const placedSave = save!;
  const worldid = placedSave.worldid!;

  const width = ZONE_SPAN;
  const height = ZONE_SPAN;

  // The fog of war (issue #330, `docs/design/fog-of-war.md` §5.1): what P can
  // see of each zone, before any `world_map_cell` row is touched. `sv` rides
  // on every response below so the client can tell its cached zones apart
  // from a sight that has changed.
  const sight = await getPlayerSight(user);

  // `getarea`'s 11×11 block can run past the world edge (`x+10` etc.),
  // unwrapped; each cell is tested at its wrapped coordinates, so one near
  // the seam compares correctly against `revealed`'s exact coordinates
  // (`fog-of-war.md` §5.1 step 3). Only the circles and cells that can reach
  // this zone are asked (`zoneVisibility.ts`): the same answer, without
  // testing every cell against a big alliance's whole sight.
  const visibilities = zones.map((zone) =>
    devConfig.disableFogOfWar
      ? allVisible(zone.x, zone.y, width, height)
      : visibilityOfZone(sight, zone.x, zone.y, width, height, mr2HexShape()),
  );
  const fogged = visibilities.map((visibility) => ![...visibility.values()].some(Boolean));

  const credits = visibleCredits(user, placedSave.credits);
  const extras = sendresources === 1 ? { resources: placedSave.resources, credits } : {};
  // The live map (beta 9): each zone's version, read before any row is, so a write landing in
  // between makes the map ask once more rather than keep an old answer under a new version. A zone
  // the viewer cannot see at all gets none: its version would say when something there changed.
  const versions = await Promise.all(
    zones.map((zone, index) =>
      fogged[index] ? Promise.resolve(undefined) : readZoneVersion(redis, worldid, zoneId(Math.floor(zone.x / 10) * 10, Math.floor(zone.y / 10) * 10)),
    ),
  );

  // No sight source or revealed cell touches a zone at all: every cell fogged,
  // no `world_map_cell` query, no owner data.
  const foggedAnswer = async (zone: AreaRequest): Promise<Record<string, unknown>> => {
    const cells: Record<number, Record<number, unknown>> = {};
    for (let cellX = zone.x; cellX <= zone.x + width; cellX++) {
      cells[cellX] = {};
      for (let cellY = zone.y; cellY <= zone.y + height; cellY++) cells[cellX][cellY] = { fog: 1 };
    }
    return {
      error: 0,
      x: zone.x,
      y: zone.y,
      data: cells,
      alliancedata: await getAllianceRoster(user.alliance_id ? [user.alliance_id] : []),
      sv: sight.sv,
      myalliance: user.alliance_id ?? null,
      ...extras,
    };
  };

  const open = zones.filter((_, index) => !fogged[index]);
  if (open.length === 0) return Promise.all(zones.map(foggedAnswer));

  const rect = (zone: AreaRequest) => ({
    x: { $gte: zone.x, $lte: zone.x + width },
    y: { $gte: zone.y, $lte: zone.y + height },
  });

  // First, get persistant cells which have been stored in the database: one query for every zone.
  const dbCells = await postgres.em.find(
    WorldMapCell,
    {
      world: worldid,
      map_version: MapRoomVersion.V2,
      ...(open.length === 1 ? rect(open[0]!) : { $or: open.map(rect) }),
    },
    { populate: ["save"], fields: CELL_SAVE_FIELDS }
  );

  // Hidden rows are dropped here, before owners, online status, truces and
  // invites are loaded, so nothing about them reaches the response or the
  // logs (`fog-of-war.md` §5.1 step 4). A row visible from any asked zone counts.
  const inZone = (cell: { x: number; y: number }, zone: AreaRequest) =>
    cell.x >= zone.x && cell.x <= zone.x + width && cell.y >= zone.y && cell.y <= zone.y + height;
  const visibleFrom = (cell: { x: number; y: number }, index: number) =>
    !fogged[index] && inZone(cell, zones[index]!) && !!visibilities[index]!.get(cellKey(cell.x, cell.y));
  const visibleDbCells = dbCells.filter((cell) => zones.some((_, index) => visibleFrom(cell, index)));

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

  // Each cell's payload, built once however many zones show it (zones share an edge).
  const payloads = new Map<string, unknown>();
  for (const cell of visibleDbCells) {
    payloads.set(cellsKey(cell.x, cell.y), await createCellData(cell, worldid, ctx, cellOwners));
  }

  // Every cell of every zone, so the neighbour counts below run once.
  const everyCell: Record<number, Record<number, unknown>> = {};
  const noise = generateNoise(worldid);
  const answers: Record<string, unknown>[] = [];
  for (const [index, zone] of zones.entries()) {
    if (fogged[index]) {
      answers.push(await foggedAnswer(zone));
      continue;
    }
    const visibility = visibilities[index]!;
    const cells: Record<number, Record<number, unknown>> = {};
    for (let cellX = zone.x; cellX <= zone.x + width; cellX++) {
      cells[cellX] = {};
      everyCell[cellX] ??= {};
      for (let cellY = zone.y; cellY <= zone.y + height; cellY++) {
        if (!visibility.get(cellKey(cellX, cellY))) {
          cells[cellX][cellY] = { fog: 1 };
          continue;
        }
        const key = cellsKey(cellX, cellY);
        let payload = payloads.get(key);
        if (payload === undefined && !visibleDbCells.some((cell) => cell.x === cellX && cell.y === cellY)) {
          // A cell with no row: generated in memory, skipping the world for memory efficiency.
          const terrainHeight = getTerrainHeight(noise, cellX, cellY);
          const inMemoryCell = new WorldMapCell(undefined, cellX, cellY, terrainHeight);
          payload = await createCellData(inMemoryCell, worldid, ctx);
          payloads.set(key, payload);
        }
        cells[cellX][cellY] = payload;
        if (payload) everyCell[cellX][cellY] = payload;
      }
    }
    answers.push({
      error: 0,
      x: zone.x,
      y: zone.y,
      data: cells,
      alliancedata,
      sv: sight.sv,
      // The viewer's own alliance id (issue #334: plates read gold for "you",
      // green for "your alliance"); cheap, since `user` is already loaded for
      // this request and carries it directly, unlike a cell owner's, which is a
      // batched lookup (`CELL_OWNER_FIELDS`).
      myalliance: user.alliance_id ?? null,
      zv: versions[index] ?? 0,
      ...extras,
    });
  }

  // Map Room 2's neighbour defence bonus, switched on: each land cell's
  // friendly neighbours as `nb`, counted the way the attack load counts them
  // for the battle (`docs/mr2-neighbours.md`). Switched off, nothing is added.
  // The payloads are shared with the answers, so one count serves every zone.
  await addNeighbourCounts(everyCell, worldid, (cx, cy) => getTerrainHeight(noise, cx, cy));

  return answers;
};

/**
 * Controller for generating cells on the World Map.
 *
 * Processes chunks of 10 x 10 cells (11 x 11 with the shared edge), retrieving
 * persistent cells (homebases, outposts) from the database, while all other
 * cells are generated in memory (`buildAreas`).
 */
export const getArea: KoaController = async (ctx) => {
  if (!devConfig.maproom) throw mapRoomDisabledErr();

  const { x, y, sendresources } = getAreaSchema.parse(ctx.request.body);
  const [answer] = await buildAreas(ctx, [{ x, y }], sendresources);

  ctx.status = Status.OK;
  ctx.body = answer;
};

/**
 * `POST /worldmapv2/getareas` (live map, beta 9): several zones' `getarea`
 * answers in one call, `{ error: 0, areas: [...] }` in the order asked. The map
 * gathers the zones a live push says changed and asks for them together.
 */
export const getAreas: KoaController = async (ctx) => {
  if (!devConfig.maproom) throw mapRoomDisabledErr();

  const { zones, sendresources } = getAreasSchema.parse(ctx.request.body);
  const areas = await buildAreas(ctx, zones, sendresources);

  ctx.status = Status.OK;
  ctx.body = { error: 0, areas };
};
