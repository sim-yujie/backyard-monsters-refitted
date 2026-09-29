import { costOf, OUTPOST_CORE_TYPE } from "../../game-data/buildingCosts.js";
import { STARTER_KITS, type KitBuilding, type StarterKit } from "../../game-data/starterKits.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { queuedProduction } from "../monsters/transferRules.js";
import { yardKindOf } from "../yardplanner/costs.js";
import { readBunker } from "./bunker.js";
import { academyLevels } from "./hatchery.js";
import { housingCapacity, housingUsedBy } from "./housing.js";
import { readHoused } from "./production.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * Outpost Starter Kits: `POST /bm/yard/starterkit` (outposts WP9, issue #188).
 *
 * A kit replaces an outpost's buildings with one of three ready-made layouts
 * (`game-data/starterKits.ts`, copied verbatim from `GetBuildings`,
 * `client/scripts/popup_prefab.as:278-311`). What it does is `BuildKit`
 * (`:227-276`):
 *
 * - every building but the core goes; the core moves to the kit's spot and is
 *   healed (`GLOBAL.townHall.Setup` and `setHealth`, `:251-257`);
 * - each kit building goes in at its `prefab` level (1 when the kit gives
 *   none, `:259-261`), with the kit's fortification;
 * - paid with Shiny they are finished at once (`l = prefab`, `:262-265`);
 *   paid with resources they are prefabs: a build countdown the length of
 *   every step up to that level (`BFOUNDATION.Setup`,
 *   `client/scripts/BFOUNDATION.as:3054-3066`) that runs **without the
 *   outpost's worker** (`:3155-3159`, `_hasWorker` set with no `QUEUE.Add`).
 *   The catch-up finishes it at the `prefab` level (`advanceBuildingTimers`),
 *   and `busyWorkers` does not count it (`services/yardplanner/workers.ts`);
 * - harvesters start empty (`:267-269`). An outpost's harvesters hold nothing
 *   anyway: they autobank (`services/maproom/v2/autobank.ts`).
 *
 * ## Paying
 *
 * With Shiny, the kit's own price (`BuyOutright`, `:114-131`). With resources,
 * twigs, pebbles and putty from the main pool (goo is never charged). A short
 * pool can make up the rest in Shiny (`Select` and `PayForKit`, `:147-226`):
 * `ceil(sqrt(short / 2) ^ 0.75)`, where `short` is the missing twigs, pebbles
 * and putty added together; the pool then pays what it has. The client says
 * which top-up it agreed to (`topUp`), as Flash's `PayForKit` rechecked the
 * figure it was shown (`:216`); a pool that is short with no matching top-up
 * is refused `409 shortfall { shortfall, topUp }`.
 *
 * ## Monsters
 *
 * `BuildKit` clears the monsters on screen (`CREATURES.Clear()`, `:235`), not
 * the saved ones, and replaces the Housing, Hatcheries and Bunkers they live
 * in. Nothing here moves or refunds a monster, so the kit is refused
 * (`409 monsters`) while the outpost holds any the new yard cannot keep:
 * housed monsters taking more room than the kit's Housing gives at once (none
 * while a resource-paid Housing is still building, which counts nothing until
 * it stands), monsters in a Bunker, or monsters in a hatchery or the HCC.
 *
 * ## Refusals, in order
 *
 * `400 badRequest` for an unknown kit; `409 notOutpost` on a main yard;
 * `409 monsters`; then the payment: `409 shortfall { shortfall, topUp }`, and
 * the wrapper's own `shinyLocked` and `credits`.
 */

/** How a kit is paid for. */
export type KitPayment = "resources" | "shiny";

export interface StarterKitRequest {
  kit: number;
  pay: KitPayment;
  /** The Shiny top-up the player agreed to for a short pool; see the file comment. */
  topUp?: number | undefined;
}

/** The slice of a save a kit reads. */
export interface StarterKitSave {
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  monsters?: JsonObject | null;
  resources?: JsonObject | null;
  academy?: JsonObject | null;
}

/** `report` of `starterkit`. */
export interface StarterKitReport {
  kit: number;
  pay: KitPayment;
  /** Buildings the kit placed, the core not counted. */
  placed: number;
  /** Buildings it took away, the core not counted. */
  removed: number;
  /** Resources charged. */
  cost: { r1: number; r2: number; r3: number; r4: number };
  /** Shiny charged: the kit's price, or the top-up. */
  shiny: number;
  /** Unix seconds when the last prefab is done; `now` when paid with Shiny. */
  doneBy: number;
}

const KEYS = ["r1", "r2", "r3"] as const;

/** A kit by `GetBuildings`' id, 1 to 3. */
export const starterKit = (id: number): StarterKit | null => STARTER_KITS.find((kit) => kit.id === id) ?? null;

/**
 * Shiny that makes up a short pool (`popup_prefab.as:174`, `:216`):
 * `ceil(sqrt(short / 2) ^ 0.75)`; 0 when nothing is short.
 *
 * @param short - Missing twigs, pebbles and putty, added together.
 */
export const kitTopUpShiny = (short: number): number =>
  short > 0 ? Math.ceil(Math.pow(Math.sqrt(short / 2), 0.75)) : 0;

/** What the pool is missing of each of a kit's three prices. */
export const kitShortfall = (
  resources: JsonObject | null | undefined,
  kit: StarterKit
): { r1: number; r2: number; r3: number } => {
  const missing = { r1: 0, r2: 0, r3: 0 };
  for (const key of KEYS) {
    const have = Math.max(0, Math.floor(Number(resources?.[key] ?? 0)) || 0);
    missing[key] = Math.max(0, kit.resources[key] - have);
  }
  return missing;
};

/**
 * Seconds a prefab takes to reach `level`: every step from the build up,
 * from the outpost table (`BFOUNDATION.as:3057-3063`).
 */
export const prefabSeconds = (type: number, level: number): number => {
  const costs = costOf(type, "outpost")?.costs ?? [];
  let seconds = 0;
  for (let step = 0; step < level; step++) seconds += costs[step]?.[4] ?? 0;
  return seconds;
};

/** One kit building as the save holds it, under a new id. */
const kitBuilding = (row: KitBuilding, id: number, pay: KitPayment): BuildingData => {
  const level = row.prefab ?? 1;
  const building = {
    id,
    t: row.t,
    X: row.X,
    Y: row.Y,
    l: level,
    ...(row.fort ? { fort: row.fort } : {}),
  } as unknown as BuildingData;
  if (pay === "shiny") return building;
  const seconds = prefabSeconds(row.t, level);
  return seconds > 0 ? { ...building, prefab: level, cB: seconds, cL: seconds } : building;
};

/** The core the outpost has, or null. */
const coreOf = (buildings: BuildingDataMap): BuildingData | null =>
  Object.values(buildings).find((building) => Number(building?.t) === OUTPOST_CORE_TYPE) ?? null;

/**
 * The outpost's buildings after a kit: the core, moved and healed, and every
 * kit building under a fresh id after the core's.
 *
 * @returns The new `buildingdata` and when its last prefab finishes, in
 *   seconds from now (0 when paid with Shiny).
 */
export const kitBuildings = (
  kit: StarterKit,
  pay: KitPayment,
  buildings: BuildingDataMap
): { buildingdata: BuildingDataMap; seconds: number } => {
  const layoutCore = kit.buildings.find((row) => row.t === OUTPOST_CORE_TYPE);
  const old = coreOf(buildings);
  const coreId = Math.max(1, Math.floor(Number(old?.id)) || 1);
  // `Setup` puts the core at the kit's spot at level 1 (`BFOUNDATION.as:3043-3045`),
  // healed; a fortification it already paid for is kept when the kit gives less.
  const fort = Math.max(Number(old?.fort ?? 0) || 0, layoutCore?.fort ?? 0);
  const core = {
    id: coreId,
    t: OUTPOST_CORE_TYPE,
    X: layoutCore?.X ?? 0,
    Y: layoutCore?.Y ?? -50,
    l: 1,
    ...(fort > 0 ? { fort } : {}),
  } as unknown as BuildingData;

  const buildingdata: BuildingDataMap = { [String(coreId)]: core };
  let next = coreId + 1;
  let seconds = 0;
  for (const row of kit.buildings) {
    if (row.t === OUTPOST_CORE_TYPE) continue;
    const building = kitBuilding(row, next, pay);
    buildingdata[String(next)] = building;
    seconds = Math.max(seconds, Number(building.cB ?? 0));
    next++;
  }
  return { buildingdata, seconds };
};

/** Whole positive counts in a record, added up. */
const total = (counts: Readonly<Record<string, number>>): number =>
  Object.values(counts).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * `409 monsters` when the outpost holds monsters the new yard cannot keep (the
 * file comment); null when it may go ahead.
 */
export const kitMonsterRefusal = (
  save: StarterKitSave,
  after: BuildingDataMap
): Error | null => {
  const inBunkers = Object.values(save.buildingdata ?? {}).reduce(
    (sum, building) => sum + total(readBunker(building)),
    0
  );
  const inProduction = total(queuedProduction(save.monsters));
  const levels = academyLevels(save.academy);
  const used = housingUsedBy(readHoused(save.monsters), levels);
  const capacity = housingCapacity({ buildingdata: after, buildinghealthdata: {} }, false);

  if (inBunkers === 0 && inProduction === 0 && used <= capacity) return null;
  return yardRefusedErr(
    "monsters",
    "Move the monsters out of this outpost first: a Starter Kit replaces its Housing, Hatcheries and Bunkers.",
    { monsters: { housing: used, capacity, inBunkers, inProduction } }
  );
};

/** The production fields of `monsters` a kit empties with the hatcheries it removes. */
const withoutProduction = (monsters: JsonObject | null | undefined): JsonObject => ({
  ...(monsters ?? {}),
  h: [],
  hid: [],
  hstage: [],
  hcount: 0,
  hcc: [],
});

/**
 * Plans a Starter Kit on an outpost (the file comment).
 *
 * @param save - The caught-up outpost, seen through the main yard (`poolView`).
 * @param request - The kit, how it is paid for, and any agreed top-up.
 * @param now - Unix seconds.
 * @returns The new buildings, health and monsters, the charge and the report.
 */
export const planStarterKit = (save: StarterKitSave, request: StarterKitRequest, now: number) => {
  const kit = starterKit(request.kit);
  if (!kit) throw yardBadRequestErr("There is no such Starter Kit.", { kit: request.kit });
  if (yardKindOf(save) !== "outpost") {
    throw yardRefusedErr("notOutpost", "Starter Kits are for outposts.");
  }

  const before = save.buildingdata ?? {};
  const { buildingdata, seconds } = kitBuildings(kit, request.pay, before);

  const monsters = kitMonsterRefusal(save, buildingdata);
  if (monsters) throw monsters;

  let debit = { r1: 0, r2: 0, r3: 0, r4: 0 };
  let shiny: number;
  if (request.pay === "shiny") {
    shiny = kit.shiny;
  } else {
    const missing = kitShortfall(save.resources, kit);
    const short = missing.r1 + missing.r2 + missing.r3;
    shiny = kitTopUpShiny(short);
    if (short > 0 && request.topUp !== shiny) {
      throw yardRefusedErr(
        "shortfall",
        "You don't have enough resources to afford this Starter Kit.",
        { shortfall: { ...missing, r4: 0 }, topUp: shiny }
      );
    }
    debit = {
      r1: kit.resources.r1 - missing.r1,
      r2: kit.resources.r2 - missing.r2,
      r3: kit.resources.r3 - missing.r3,
      r4: 0,
    };
  }

  const removed = Object.values(before).filter(
    (building) => Number(building?.t) !== OUTPOST_CORE_TYPE
  ).length;
  const report: StarterKitReport = {
    kit: kit.id,
    pay: request.pay,
    placed: Object.keys(buildingdata).length - 1,
    removed,
    cost: debit,
    shiny,
    doneBy: now + seconds,
  };

  return {
    report,
    slices: {
      buildingdata,
      buildinghealthdata: {},
      monsters: withoutProduction(save.monsters),
    },
    debit,
    ...(shiny > 0 ? { shiny } : {}),
  };
};
