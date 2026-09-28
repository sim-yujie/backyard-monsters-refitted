import type { EntityManager } from "@mikro-orm/core";
import type { Save } from "../../database/models/save.model.js";
import type { User } from "../../database/models/user.model.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import { MUSHROOM_TYPE } from "../../game-data/buildingFootprints.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { levelOf, type ResourceAmounts } from "../yardplanner/costs.js";
import {
  currentExpansion,
  overlaps,
  rectOf,
  yardSize,
  type FootprintRect,
} from "../yardplanner/layoutGeometry.js";
import { nextBuildingId, placementProblem } from "./build.js";
import { MAP_ROOM_TYPE } from "./buildingJobs.js";
import { creditResources, type CreditSave } from "./credit.js";
import { readMushrooms } from "./mushrooms.js";

/**
 * The Map Room and the Radio Tower (`docs/design/yard-buildings.md` §5.7,
 * decisions D15 and D16).
 *
 * **Map Room.** Its level is the map version, capped at 2: the cost table
 * stops there (`web/tools/gen-building-costs.mjs`). Its L1 to L2 upgrade is
 * the move to Map Room 2. The upgrade route lets it start only at Town Hall 6
 * (its step requires `[14, 1, 6]`, refused `409 townHall`); once the level
 * reaches 2 the server does what `POST /worldmapv2/setmapversion` does for
 * version 2 (`controllers/maproom/setMapVersion.ts:74-93`): join or create a
 * world, set `mr2upgraded` and `mapversion = 2`, drop the Map Room 1 row. The
 * Flash client did the same from the building's own tick
 * (`client/scripts/BUILDING11.as:41-42`, `:51-63`).
 *
 * That join needs the database, and the catch-up is pure, so it is keyed on
 * the yard's state rather than on the finishing event: {@link needsMapRoom2Join}
 * is true for any main yard with a level 2 Map Room that is not on Map Room 2
 * yet, however it got there (the catch-up, or a Yard Planner route that
 * advances timers on its own), and {@link joinMapRoom2} runs after every
 * locked catch-up (`controllers/yard/yardAction.ts`).
 *
 * **Migration** ({@link migrateYard}, run by the catch-up before step 1, §2.5).
 * Idempotent, so it simply runs every time and finds nothing to do after the
 * first:
 *
 * - A Map Room above level 2 is written back to 2, nothing refunded (level 3
 *   was free); a running upgrade past level 2 is dropped (its step cost
 *   nothing either).
 * - A save with `mr2upgraded` gets a level 2 Map Room, so a player already on
 *   Map Room 2 sees no change. A Map Room still counting its first build down
 *   is left until it stands.
 * - A save on Map Room 2 (`mr2upgraded`, or `mapversion` 2) with no Map Room
 *   at all is given one, level 2 and finished, on a free spot the server picks
 *   ({@link freeSpotFor}), with the next building id, and reported as a
 *   `mapRoomAdded` job so the next load says so once (owner decision
 *   2026-09-28: every yard has a Map Room). A save not on Map Room 2 is given
 *   none; it builds one from the Build menu. When the plot has no room left
 *   nothing is added, and the next catch-up tries again.
 * - Every Radio Tower (113) is removed and its build cost refunded, clamped to
 *   the storage cap (T3, `services/yard/credit.ts`), and reported as a `radioRemoved` job so the next
 *   load says so once.
 */

/** The highest Map Room level, the map version this project offers (D16). */
export const MAP_ROOM_MAX_LEVEL = 2;

/** The Radio Tower (`client/scripts/YARD_PROPS.as:5962`). */
export const RADIO_TOWER_TYPE = 113;

/**
 * The Radio Tower's build cost, `costs[0]` at `client/scripts/YARD_PROPS.as:5963-5968`.
 * Carried here because the cost table no longer has the row (D15).
 */
export const RADIO_BUILD_COST: ResourceAmounts = { r1: 2000, r2: 2000, r3: 2000, r4: 0 };

/** A Radio Tower the migration took down. */
export interface RadioRemovedJob {
  kind: "radioRemoved";
  /** The building id it had. */
  id: number;
  t: typeof RADIO_TOWER_TYPE;
  /** The catch-up's `now`: when it went. */
  at: number;
  detail: {
    /** What came back: the build cost less whatever the storage cap turned away. */
    refund: ResourceAmounts;
  };
}

/** A Map Room the migration put in a Map Room 2 yard that had none. */
export interface MapRoomAddedJob {
  kind: "mapRoomAdded";
  /** The new building's id. */
  id: number;
  t: typeof MAP_ROOM_TYPE;
  /** The catch-up's `now`: when it was added. */
  at: number;
  detail: {
    level: number;
    /** Its footprint origin, yard units. */
    x: number;
    y: number;
  };
}

/** The slice of a save the migration reads and writes. */
export interface MigrationSave extends CreditSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  mushrooms?: JsonObject | null;
  mr2upgraded?: boolean;
  mapversion?: number;
}

/** The step between the spots {@link freeSpotFor} tries: twice the build grid's 5 units. */
const SPOT_STEP = 10;

/** Every building's footprint and every mushroom's: what a new building must not touch. */
const obstaclesOf = (save: MigrationSave): FootprintRect[] => {
  const rects: FootprintRect[] = [];
  for (const building of Object.values(save.buildingdata ?? {})) {
    const x = Number(building?.X);
    const y = Number(building?.Y);
    const t = Number(building?.t);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(t)) rects.push(rectOf(t, x, y));
  }
  for (const [, x, y] of readMushrooms(save.mushrooms).l) rects.push(rectOf(MUSHROOM_TYPE, x, y));
  return rects;
};

/**
 * The free spot for a new building of `type` nearest the middle of the plot:
 * inside the plot for the yard's expansion, clear of every building and
 * mushroom, by the build route's own placement rule (`placementProblem`,
 * `build.ts`). Spots are tried on a 10-unit grid, nearest first, ties broken
 * top to bottom then left to right, so the same yard always gets the same
 * spot. Null when the plot has no room.
 */
export const freeSpotFor = (save: MigrationSave, type: number): { x: number; y: number } | null => {
  const [width, height] = yardSize(currentExpansion(save.storedata));
  const { w, h } = rectOf(type, 0, 0);
  const obstacles = obstaclesOf(save);

  const spots: { x: number; y: number; distance: number }[] = [];
  const left = Math.ceil(-width / 2 / SPOT_STEP) * SPOT_STEP;
  const top = Math.ceil(-height / 2 / SPOT_STEP) * SPOT_STEP;
  for (let y = top; y + h <= height / 2; y += SPOT_STEP) {
    for (let x = left; x + w <= width / 2; x += SPOT_STEP) {
      spots.push({ x, y, distance: (x + w / 2) ** 2 + (y + h / 2) ** 2 });
    }
  }
  spots.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);

  for (const { x, y } of spots) {
    const rect = rectOf(type, x, y);
    if (obstacles.some((other) => overlaps(rect, other))) continue;
    if (placementProblem(save, { type, x, y }) === null) return { x, y };
  }
  return null;
};

/** Whether the yard is on Map Room 2, and so should have a Map Room. */
const onMapRoom2 = (save: MigrationSave): boolean =>
  Boolean(save.mr2upgraded) || Number(save.mapversion) === MapRoomVersion.V2;

/**
 * Adds a finished level 2 Map Room to a Map Room 2 yard that has none (the
 * file comment). Mutates `save.buildingdata`.
 */
const addMissingMapRoom = (save: MigrationSave, now: number): MapRoomAddedJob[] => {
  if (!onMapRoom2(save)) return [];
  const buildings = save.buildingdata ?? {};
  if (Object.values(buildings).some((building) => Number(building?.t) === MAP_ROOM_TYPE)) return [];

  const spot = freeSpotFor(save, MAP_ROOM_TYPE);
  if (!spot) return [];

  const id = nextBuildingId(save);
  const mapRoom = { id, t: MAP_ROOM_TYPE, X: spot.x, Y: spot.y, l: MAP_ROOM_MAX_LEVEL } as unknown as BuildingData;
  save.buildingdata = { ...buildings, [String(id)]: mapRoom };
  return [
    {
      kind: "mapRoomAdded",
      id,
      t: MAP_ROOM_TYPE,
      at: now,
      detail: { level: MAP_ROOM_MAX_LEVEL, x: spot.x, y: spot.y },
    },
  ];
};

/** The Map Room as the cap and `mr2upgraded` want it, or null when it is already right. */
const migratedMapRoom = (building: BuildingData, mr2upgraded: boolean): BuildingData | null => {
  // Still being built: the first build is not a map version yet.
  if (Number(building.cB) > 0) return null;

  const level = levelOf(building);
  const upgrading = Number(building.cU) > 0;
  const target = mr2upgraded ? MAP_ROOM_MAX_LEVEL : Math.min(level, MAP_ROOM_MAX_LEVEL);
  if (target === level && !(upgrading && level >= MAP_ROOM_MAX_LEVEL)) return null;

  const { cU: _upgrade, cL: _length, ...rest } = building;
  return { ...rest, l: target } as BuildingData;
};

/**
 * Brings an old save up to this project's Map Room and Radio rules (the file
 * comment). Pure apart from mutating the save.
 *
 * @param save - The main yard, mutated in place: `buildingdata`,
 *   `buildinghealthdata` and `resources` may change.
 * @param now - The catch-up's `now`, stamped on each job.
 * @returns One job per Radio Tower removed, then one for a Map Room added.
 */
export const migrateYard = (
  save: MigrationSave,
  now: number
): (RadioRemovedJob | MapRoomAddedJob)[] => [
  ...migrateBuildings(save, now),
  ...addMissingMapRoom(save, now),
];

/** The Map Room cap and `mr2upgraded` level, and the Radio removal. */
const migrateBuildings = (save: MigrationSave, now: number): RadioRemovedJob[] => {
  const buildings = save.buildingdata;
  if (!buildings) return [];

  const next: BuildingDataMap = { ...buildings };
  const radios: string[] = [];
  let changed = false;

  for (const [key, building] of Object.entries(buildings)) {
    const type = Number(building?.t);
    if (type === RADIO_TOWER_TYPE) {
      radios.push(key);
      delete next[key];
      changed = true;
    } else if (type === MAP_ROOM_TYPE) {
      const migrated = migratedMapRoom(building, Boolean(save.mr2upgraded));
      if (migrated) {
        next[key] = migrated;
        changed = true;
      }
    }
  }

  if (!changed) return [];
  save.buildingdata = next;

  if (radios.length > 0 && save.buildinghealthdata) {
    const health = { ...save.buildinghealthdata };
    for (const key of radios) delete health[key];
    save.buildinghealthdata = health;
  }

  // The cap is read after the Radios are gone; a Radio holds none of it.
  return radios.map((key) => ({
    kind: "radioRemoved",
    id: Number(buildings[key]?.id ?? key),
    t: RADIO_TOWER_TYPE,
    at: now,
    detail: { refund: creditResources(save, RADIO_BUILD_COST).credited },
  }));
};

/** The yard's Map Room level: the highest standing Map Room, 0 for none. */
export const mapRoomLevel = (buildingdata: BuildingDataMap | null | undefined): number => {
  let level = 0;
  for (const building of Object.values(buildingdata ?? {})) {
    if (Number(building?.t) === MAP_ROOM_TYPE) level = Math.max(level, levelOf(building));
  }
  return level;
};

/**
 * Whether the yard has a level 2 Map Room and is not on Map Room 2 yet. A save
 * on Map Room 3 is left alone, as `setMapVersion` leaves it for version 2.
 */
export const needsMapRoom2Join = (save: MigrationSave): boolean =>
  !save.mr2upgraded &&
  save.mapversion !== MapRoomVersion.V3 &&
  mapRoomLevel(save.buildingdata) >= MAP_ROOM_MAX_LEVEL;

/** Puts one save's owner in a Map Room 2 world. */
export type WorldJoin = (em: EntityManager, save: Save, user: User | null) => Promise<void>;

/**
 * `setMapVersion`'s version 2 world work (`controllers/maproom/setMapVersion.ts:77-93`):
 * clear pending alliance invites, join or create a world, drop the Map Room 1
 * row. Imported on use: these services reach the server's shared database and
 * cache handles, which the yard wrapper keeps out of its imports so it runs
 * under test without a server.
 *
 * `setMapVersion` refuses a player in an alliance; a finished upgrade cannot
 * be refused, and a player without a world has no alliance to leave.
 */
const joinWorld: WorldJoin = async (em, save, user) => {
  const [{ joinOrCreateWorld }, { clearPendingInvites }, { Maproom }, { User: UserModel }] =
    await Promise.all([
      import("../maproom/v2/joinOrCreateWorld.js"),
      import("../alliance/allianceInvites.js"),
      import("../../database/models/maproom.model.js"),
      import("../../database/models/user.model.js"),
    ]);

  await clearPendingInvites(save.userid);

  const owner = user ?? (await em.findOne(UserModel, { userid: save.userid }));
  if (!owner) throw new Error(`No user ${save.userid} for save ${save.basesaveid}`);
  await joinOrCreateWorld(owner, save, em as Parameters<typeof joinOrCreateWorld>[2]);

  const maproom1 = await em.findOne(Maproom, { userid: save.userid });
  if (maproom1) em.remove(maproom1);
};

/**
 * Moves a yard to Map Room 2 when {@link needsMapRoom2Join} says so. A save
 * that already holds a world id only has its flags set: joining again would
 * give it a second home cell.
 *
 * @param em - The transaction the catch-up runs in.
 * @param save - The caught-up main yard.
 * @param user - Its owner, when the caller has it (it is loaded otherwise).
 * @param join - The world work; a stand-in under test.
 * @returns Whether the yard moved.
 */
export const joinMapRoom2 = async (
  em: EntityManager,
  save: Save,
  user: User | null = null,
  join: WorldJoin = joinWorld
): Promise<boolean> => {
  if (!needsMapRoom2Join(save)) return false;
  if (!save.worldid) await join(em, save, user);
  save.mr2upgraded = true;
  save.mapversion = MapRoomVersion.V2;
  return true;
};
