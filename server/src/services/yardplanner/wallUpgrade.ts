import { batchBlockedErr, layoutInvalidErr } from "../../errors/errors.js";
import { maxLevel, type CostRequirement, type CostStep } from "../../game-data/buildingCosts.js";
import {
  LAYOUT_NODE_MAX,
  WallIdListSchema,
} from "../../schemas/YardPlannerSchemas.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  FREE_FINISH_SECONDS,
  TOWN_HALL_TYPE,
  isShort,
  levelOf,
  pointsForUpgrade,
  requirementsMet,
  shortfall,
  sumCosts,
  townHallLevel,
  upgradeSteps,
  type ResourceAmounts,
} from "./costs.js";
import { listIds, MAX_LISTED } from "./validateLayout.js";

/**
 * Batch wall upgrade: take every listed wall to one target level in a single
 * charge (`docs/design/yard-planner-phase1-remainder.md` §2.4).
 *
 * This is the first place the server charges a player for anything. The Flash
 * client charged itself and shipped a resource delta; here the client sends ids
 * and a level, and this file works out what that costs from the generated table
 * and refuses the whole batch if the yard cannot pay for or unlock all of it.
 *
 * Every wall step is 5 seconds, which is inside the free-finish window
 * (`client/scripts/BFOUNDATION.as:2063-2083`), so the upgrade is written as a
 * finished building rather than as a countdown — decision Q1. {@link FREE_FINISH_SECONDS}
 * is still checked per step so that widening this route to a slow building
 * later cannot quietly hand it away for nothing.
 *
 * Nothing here touches the database. The caller hands in the slice of the save
 * it reads and applies the returned plan itself, which is the same bargain
 * `validateLayout.ts` makes.
 */

/** The parts of a `Save` this route reads. */
export interface WallUpgradeSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
}

/** What the controller writes back when the batch is allowed. */
export interface WallUpgradePlan {
  /** A new `buildingdata` with every listed wall at `level`. */
  buildingdata: BuildingDataMap;
  /** Total charge for every step of every wall. */
  cost: ResourceAmounts;
  /** Empire points earned, summed over the same steps. */
  points: number;
  /** How many walls moved. */
  upgraded: number;
  /** The level they all ended up at, echoed for the response. */
  level: number;
}

/**
 * The Wooden Block. Type 18 (Stone Block) is a legacy row with no ladder of its
 * own: the Flash client rewrites `t: 18` to `t: 17, l: 2` on load
 * (`client/scripts/BASE.as:1523-1526`), so it is priced and written as a type 17.
 */
const WALL_TYPE = 17;
const LEGACY_WALL_TYPE = 18;

/** The lowest level this route will take a wall to: a build is not an upgrade. */
const MIN_TARGET_LEVEL = 2;

/**
 * A wall's current level.
 *
 * A legacy type 18 row counts as at least level 2, which is what the Flash
 * conversion makes it, so upgrading one to level 3 is charged for one step and
 * not for two.
 */
const wallLevel = (building: BuildingData): number => {
  const level = levelOf(building);
  return Number(building.t) === LEGACY_WALL_TYPE ? Math.max(level, MIN_TARGET_LEVEL) : level;
};

/** Whether a countdown of any kind is running on this building. */
const isBusy = (building: BuildingData): boolean =>
  Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF);

/**
 * Whether the building is damaged, and so has to be repaired before it can be
 * upgraded (spec `docs/specs/base-building.md:917-919`). Damage lives in
 * `buildinghealthdata` on Map Room 3 and additionally as `hp` elsewhere.
 */
const isDamaged = (building: BuildingData, health: BuildingHealthData | null | undefined): boolean =>
  building.hp != null || (health != null && String(building.id) in health);

/**
 * Parses the `ids` form field: a JSON string holding a list of building ids.
 *
 * Mirrors `parsePayload` (`validateLayout.ts`), including echoing the first few
 * schema issues, so a client that sends the wrong shape gets the same help it
 * gets from the layout routes.
 */
export const parseWallIds = (raw: unknown): number[] => {
  if (typeof raw !== "string" || raw.length === 0) {
    throw layoutInvalidErr("Tell the server which walls to upgrade.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw layoutInvalidErr("That list of walls could not be read.");
  }

  if (Array.isArray(decoded) && decoded.length > LAYOUT_NODE_MAX) {
    throw layoutInvalidErr(`That is more walls than one upgrade can take. The limit is ${LAYOUT_NODE_MAX}.`, {
      ids: decoded.length,
    });
  }

  const parsed = WallIdListSchema.safeParse(decoded);
  if (!parsed.success) {
    throw layoutInvalidErr("That list of walls is not in a format this server understands.", {
      issues: parsed.error.issues.slice(0, MAX_LISTED).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (parsed.data.length === 0) {
    throw layoutInvalidErr("Pick at least one wall to upgrade.");
  }

  const seen = new Set<number>();
  const duplicated: number[] = [];
  for (const id of parsed.data) {
    if (seen.has(id) && !duplicated.includes(id)) duplicated.push(id);
    seen.add(id);
  }
  if (duplicated.length > 0) {
    throw layoutInvalidErr(`That list names ${listIds(duplicated)} more than once.`, {
      duplicated: duplicated.slice(0, MAX_LISTED),
    });
  }

  return parsed.data;
};

/**
 * Checks a batch wall upgrade against the caller's yard and works out what it
 * costs. Throws a `ClientSafeError` on the first rule the batch breaks; the
 * batch is all or nothing, so there is no partial plan to return.
 */
export const planWallUpgrade = (
  save: WallUpgradeSave,
  ids: readonly number[],
  level: number
): WallUpgradePlan => {
  const buildings = save.buildingdata ?? {};
  const health = save.buildinghealthdata;

  // 1. Ownership and type.
  const unknown: number[] = [];
  const notWalls: number[] = [];
  const walls: { id: number; building: BuildingData; level: number }[] = [];

  for (const id of ids) {
    const building = buildings[String(id)];
    if (!building) {
      unknown.push(id);
      continue;
    }
    const type = Number(building.t);
    if (type !== WALL_TYPE && type !== LEGACY_WALL_TYPE) {
      notWalls.push(id);
      continue;
    }
    walls.push({ id, building, level: wallLevel(building) });
  }

  if (unknown.length > 0) {
    throw layoutInvalidErr(
      `${unknown.length} of those walls ${
        unknown.length === 1 ? "is" : "are"
      } no longer in your yard (${listIds(unknown)}).`,
      { unknown: unknown.slice(0, MAX_LISTED) }
    );
  }
  if (notWalls.length > 0) {
    throw layoutInvalidErr(
      `${listIds(notWalls)} ${notWalls.length === 1 ? "is not a wall" : "are not walls"}.`,
      { notWalls: notWalls.slice(0, MAX_LISTED) }
    );
  }

  // 2. Target level.
  const top = maxLevel(WALL_TYPE);
  if (!Number.isInteger(level) || level < MIN_TARGET_LEVEL || level > top) {
    throw layoutInvalidErr(`Walls go up to level ${top}. Pick a level from ${MIN_TARGET_LEVEL} to ${top}.`, {
      level,
    });
  }

  // 3. Per-wall state.
  const alreadyAtLevel: number[] = [];
  const busy: number[] = [];
  const damaged: number[] = [];

  for (const wall of walls) {
    if (wall.level >= level) alreadyAtLevel.push(wall.id);
    if (isBusy(wall.building)) busy.push(wall.id);
    if (isDamaged(wall.building, health)) damaged.push(wall.id);
  }

  if (alreadyAtLevel.length > 0) {
    throw layoutInvalidErr(
      `${alreadyAtLevel.length} of those walls ${
        alreadyAtLevel.length === 1 ? "is" : "are"
      } already at level ${level} or higher (${listIds(alreadyAtLevel)}).`,
      { alreadyAtLevel: alreadyAtLevel.slice(0, MAX_LISTED) }
    );
  }
  if (busy.length > 0) {
    throw layoutInvalidErr(
      `${listIds(busy)} ${busy.length === 1 ? "is" : "are"} still busy. Wait for the countdown to finish.`,
      { busy: busy.slice(0, MAX_LISTED) }
    );
  }
  if (damaged.length > 0) {
    throw layoutInvalidErr(
      `${listIds(damaged)} ${
        damaged.length === 1 ? "is damaged and has" : "are damaged and have"
      } to be repaired first.`,
      { damaged: damaged.slice(0, MAX_LISTED) }
    );
  }

  // 4. Prerequisites. Every wall walks the same ladder, so each step index only
  //    needs checking once however many walls pass through it.
  const hall = townHallLevel(buildings);
  if (hall === 0) {
    throw batchBlockedErr("You need a Town Hall before you can upgrade anything.", {
      townHall: { have: 0, need: 1 },
    });
  }

  const lowest = Math.min(...walls.map((wall) => wall.level));
  for (let step = lowest; step < level; step++) {
    const [requirement] = upgradeSteps(WALL_TYPE, step, step + 1);
    if (!requirement) continue;
    checkRequirements(requirement[5], buildings, hall);
  }

  // 5. Free-finish guard, then 6. cost.
  const steps: CostStep[] = [];
  for (const wall of walls) steps.push(...upgradeSteps(WALL_TYPE, wall.level, level));

  for (const step of steps) {
    if (step[4] > FREE_FINISH_SECONDS) {
      throw batchBlockedErr("That upgrade takes too long to finish for free.", {
        slowStep: { type: WALL_TYPE, time: step[4], limit: FREE_FINISH_SECONDS },
      });
    }
  }

  const totals = sumCosts(steps);
  const cost: ResourceAmounts = {
    r1: totals.r1,
    r2: totals.r2,
    r3: totals.r3,
    r4: totals.r4,
  };

  const missing = shortfall(save.resources, cost);
  if (isShort(missing)) {
    throw batchBlockedErr("You do not have enough resources to upgrade those walls.", {
      shortfall: missing,
    });
  }

  const buildingdata: BuildingDataMap = { ...buildings };
  for (const wall of walls) {
    buildingdata[String(wall.id)] = { ...wall.building, t: WALL_TYPE, l: level };
  }

  return {
    buildingdata,
    cost,
    points: steps.reduce((total, step) => total + pointsForUpgrade(step), 0),
    upgraded: walls.length,
    level,
  };
};

/**
 * Throws when a step's `re` list is not satisfied, naming the Town Hall gate
 * separately because it is the one the player can read off their own yard.
 *
 * The *failing* entry decides which error comes back, not merely the presence
 * of a Town Hall entry: a step gated on both a Town Hall the yard has and a
 * building it does not would otherwise blame the hall.
 */
export const checkRequirements = (
  re: readonly CostRequirement[],
  buildings: BuildingDataMap,
  hall: number
): void => {
  if (requirementsMet(re, buildings)) return;

  const unmet = re.filter((entry) => !requirementsMet([entry], buildings));
  const townHall = unmet.find(([type]) => type === TOWN_HALL_TYPE);
  if (townHall) {
    throw batchBlockedErr(`That needs a level ${townHall[2]} Town Hall. Yours is level ${hall}.`, {
      townHall: { have: hall, need: townHall[2] },
    });
  }

  throw batchBlockedErr("Your yard does not have what that upgrade needs yet.", {
    requirements: unmet.map((entry) => [...entry]),
  });
};
