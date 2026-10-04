import { BaseType } from "../../enums/Base.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { TOWN_HALL_TYPE, type ResourceAmounts } from "../yardplanner/costs.js";
import { nextBuildingId, placementProblem } from "./build.js";
import { creditResources } from "./credit.js";
import { freeSpotFor, type MigrationSave } from "./mapRoom.js";

/**
 * The starter base (issue #154, owner decision 2026-09-28): the set the
 * original game put in a main yard that had no buildings at all.
 *
 * When a main yard loaded empty, the Flash client placed a level 1 Town Hall,
 * a Twig Snapper holding 200 twigs, a Pebble Shiner and a General Store around
 * the middle of the plot and set the pool to 1,600 twigs and 1,600 pebbles,
 * with no points (`client/scripts/BASE.as:1661-1702`). The Town Hall was never
 * on the build menu, so a yard without one could build nothing.
 *
 * The server writes the same set in two places:
 *
 * - A new main save starts with it (`game-data/getDefaultBaseData.ts`,
 *   {@link starterBuildingData}); an account that ticked the dev-only test
 *   yard box at sign-up gets the sandbox yard instead while `DEV_SANDBOX` is on
 *   (issue #217).
 * - The catch-up gives it once to an existing main yard with no buildings
 *   ({@link addStarterBase}, run first by `catchUpYard`), and reports it as a
 *   `starterBase` job so the next load says "Your yard is ready". Outposts,
 *   Inferno yards and wild camps never get it: the catch-up only runs on main
 *   yards, and this checks `type` as well. Once placed the yard is no longer
 *   empty, so a second catch-up adds nothing.
 *
 * Each building goes on the original's spot when that spot is free (in the
 * plot, clear of every building, `placementProblem`), else on the nearest
 * free spot (`freeSpotFor`). A mushroom on the original's spot does not
 * count: the same catch-up moves it to free ground (`catchUpMushrooms.ts`,
 * #263). A yard with no room for the Town Hall
 * gets nothing and is tried again on the next catch-up.
 */

/** One building of the starter set: the original's spot and fields. */
interface StarterBuilding {
  t: number;
  /** Footprint origin, yard units (`BASE.as:1661-1692`). */
  X: number;
  Y: number;
  /** What the harvester holds: the Twig Snapper's 200 twigs (`BASE.as:1678`). */
  st?: number;
}

/** The set, Town Hall first (`client/scripts/BASE.as:1661-1692`). All level 1. */
export const STARTER_BUILDINGS: readonly StarterBuilding[] = [
  { t: TOWN_HALL_TYPE, X: -70, Y: 0 },
  // Twig Snapper.
  { t: 1, X: 60, Y: 0, st: 200 },
  // Pebble Shiner.
  { t: 2, X: 60, Y: 70 },
  // General Store.
  { t: 12, X: 60, Y: -70 },
];

/** The pool the set comes with: 1,600 twigs and 1,600 pebbles (`BASE.as:1693-1700`). */
export const STARTER_RESOURCES: ResourceAmounts = { r1: 1600, r2: 1600, r3: 0, r4: 0 };

/** The level every starter building stands at. */
const STARTER_LEVEL = 1;

/** One placed building as the job reports it. */
export interface StarterBaseBuilding {
  id: number;
  t: number;
  /** Its footprint origin, yard units. */
  x: number;
  y: number;
  level: number;
}

/** The starter set the catch-up put in an empty main yard. */
export interface StarterBaseJob {
  kind: "starterBase";
  /** The Town Hall's id. */
  id: number;
  t: typeof TOWN_HALL_TYPE;
  /** The catch-up's `now`: when it was placed. */
  at: number;
  detail: {
    /** Every building placed, Town Hall first. */
    buildings: StarterBaseBuilding[];
    /** What landed in the pool: 1,600 twigs and pebbles, less whatever the storage cap turned away. */
    resources: ResourceAmounts;
  };
}

/** The slice of a save the starter base reads and writes. */
export interface StarterBaseSave extends MigrationSave {
  /** `BaseType`; only a main yard gets the set. */
  type?: string;
}

/** A starter building as `buildingdata` holds it. */
const buildingOf = (id: number, starter: StarterBuilding, x: number, y: number): BuildingData =>
  ({
    id,
    t: starter.t,
    X: x,
    Y: y,
    l: STARTER_LEVEL,
    ...(starter.st !== undefined && { st: starter.st }),
  }) as unknown as BuildingData;

/**
 * The set on the original's spots with ids 1 to 4, for a new save's
 * `buildingdata` (the plot is empty, so every spot is free).
 */
export const starterBuildingData = (): BuildingDataMap =>
  Object.fromEntries(
    STARTER_BUILDINGS.map((starter, index) => {
      const id = index + 1;
      return [String(id), buildingOf(id, starter, starter.X, starter.Y)];
    })
  );

/** The original's spot when it is free, else the nearest free one, else null. */
const spotFor = (save: MigrationSave, starter: StarterBuilding): { x: number; y: number } | null =>
  placementProblem(save, { type: starter.t, x: starter.X, y: starter.Y }) === null
    ? { x: starter.X, y: starter.Y }
    : freeSpotFor(save, starter.t);

/**
 * Gives an empty main yard the starter set and its 1,600 twigs and pebbles
 * (the file comment). Pure apart from mutating the save.
 *
 * @param save - Mutated when the set is placed: `buildingdata`, `resources`.
 * @param now - The catch-up's `now`, stamped on the job.
 * @returns The one `starterBase` job, or nothing when the yard is not an empty
 *   main yard (or has no room for the Town Hall).
 */
export const addStarterBase = (save: StarterBaseSave, now: number): StarterBaseJob[] => {
  if (save.type !== BaseType.MAIN) return [];
  if (Object.keys(save.buildingdata ?? {}).length > 0) return [];

  const working: MigrationSave = { ...save, buildingdata: {} };
  const placed: StarterBaseBuilding[] = [];
  for (const starter of STARTER_BUILDINGS) {
    const spot = spotFor(working, starter);
    if (!spot) {
      // No Town Hall, no starter base: leave the yard as it was.
      if (starter.t === TOWN_HALL_TYPE) return [];
      continue;
    }
    const id = nextBuildingId(working);
    working.buildingdata = { ...working.buildingdata, [String(id)]: buildingOf(id, starter, spot.x, spot.y) };
    placed.push({ id, t: starter.t, x: spot.x, y: spot.y, level: STARTER_LEVEL });
  }

  save.buildingdata = working.buildingdata;
  const { credited } = creditResources(save, STARTER_RESOURCES);
  const hall = placed[0]!;

  return [
    {
      kind: "starterBase",
      id: hall.id,
      t: TOWN_HALL_TYPE,
      at: now,
      detail: { buildings: placed, resources: credited },
    },
  ];
};
