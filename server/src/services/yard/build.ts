import {
  costOf,
  hallTypeOf,
  OUTPOST_COSTS,
  OUTPOST_TRAITS,
  type CostRequirement,
  type CostStep,
  type YardKind,
} from "../../game-data/buildingCosts.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  cancelRefund,
  stepAmounts,
  type StorageCapSave,
} from "../base/economy/resourceBudget.js";
import { requirementDetail } from "../base/economy/transitions.js";
import {
  countOfType,
  hallName,
  isShort,
  pointsForBuild,
  shortfall,
  townHallLevel,
  yardKindOf,
  type ResourceAmounts,
} from "../yardplanner/costs.js";
import {
  currentExpansion,
  mushroomRects,
  overlaps,
  rectOf,
  withinBounds,
} from "../yardplanner/layoutGeometry.js";
import { busyWorkers, sharperToolsMultiplier, workerCount } from "../yardplanner/workers.js";
import { buildingOrThrow, finishBuildingJob } from "./buildingJobs.js";
import { fitCredit } from "./credit.js";
import { instantBuildPrice } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * The build menu's three routes (`docs/design/yard-buildings.md` §5.3,
 * decisions D13 and D19): `POST /bm/yard/build`, `/build/cancel` and
 * `/build/instant`.
 *
 * All three are pure: they read the caught-up save the yard action wrapper
 * hands them and return what should change, or throw the refusal. The wrapper
 * (`controllers/yard/yardAction.ts`) charges, credits through the storage cap,
 * awards the points and writes.
 *
 * ## What may be built
 *
 * {@link BUILDABLE_TYPES}: every main-yard type the original build menu listed
 * (`group` 1 to 3 without `block`, `client/scripts/BUILDINGSPOPUP.as:124`),
 * less what this project leaves out: the Radio (D15, §5.7), every Inferno type
 * (D19: the Quake and Magma Towers, the Siege Factory and Works, the Spurtz
 * Cannons) and the Map Room 3 structures (Stronghold, Resource Outpost,
 * Outpost Defender). The Town Hall and the legacy Stone Block are `block`ed in
 * the props table itself (`client/scripts/YARD_PROPS.as:1310`, `:1842`).
 * Decorations come from the shop and the inventory (Phase 6, §8.3), not from
 * here. The web's build menu lists the same types
 * (`web/src/ui/yard/BuildMenu.ts`).
 *
 * An outpost builds {@link OUTPOST_BUILDABLE_TYPES} from the outpost table
 * (`client/scripts/OUTPOST_YARD_PROPS.as`, swapped in wholesale,
 * `client/scripts/GLOBAL.as:716-723`): its limits are `quantity[1]`, since its
 * hall is the core (112), always level 1, and its prerequisites are the
 * table's own (the Juicer, Hatchery and Bunker need a Housing, the HCC two
 * Hatcheries). It has one worker (`workers.ts`). Every rule below reads the
 * kind off the save (`yardKindOf`).
 *
 * ## The gates, in order
 *
 * `BASE.CanBuild` (`client/scripts/BASE.as:3640-3800`) first, then where the
 * building goes, then who builds it:
 *
 * 1. `400 notBuildable`: a type not in {@link BUILDABLE_TYPES}.
 * 2. `409 townHall {have, need}`: the Town Hall allows none of this type yet
 *    (`quantity[hall]` is 0; `need` is the first hall that allows one).
 * 3. `409 limit {have, allowed, next}`: the yard already holds as many as its
 *    hall allows (`BASE.as:3740-3752`). `next` is the hall that allows more,
 *    or null when none does. Buildings still under construction count.
 * 4. `409 townHall` / `409 requirements`: the build step's `re` list
 *    (`BASE.as:3757-3788`), a half-built prerequisite counting as level 0.
 * 5. `409 shortfall {r1..r4}`: the yard cannot pay `costs[0]`.
 * 6. `409 placement {placement, with?}`: the footprint leaves the plot
 *    (`outOfBounds`), or lands on a building (`overlap`, `with` its id) or a
 *    mushroom (`mushroom`): the rules Apply measures a layout by
 *    (`controllers/yardplanner/applyLayout.ts`, `services/yardplanner/layoutGeometry.ts`).
 *    A 409 rather than Apply's 400 because the client cannot always see it
 *    coming: a mushroom can spring up under the spot between two requests.
 * 7. `409 workers {total, busy}`: every worker is on a job. Walls and traps
 *    need none (D13).
 *
 * The instant build skips 5 and 7: it charges Shiny instead of resources and
 * holds no worker, as `upgrade/instant` does.
 *
 * ## What is written
 *
 * A new id, one above every id the save knows (the Flash client's
 * `_buildingCount + 1`, `client/scripts/BASE.as:5067`). An ordinary building
 * gets `cB = floor(time × bst)` and the same figure as its length `cL` (#136);
 * the catch-up finishes it at level 1 and awards `pointsForBuild`
 * (`catchUpBuildings.ts`). A wall or trap is written finished, level 1, with
 * its points now (D13, as the planner's batch routes write their steps).
 *
 * The new building carries no `l`. The original wrote `l: 0` while building
 * (`client/scripts/BFOUNDATION.as:2975-2977`) and `Constructed()` set 1; the
 * server's completion only deletes `cB` (`advanceBuildingTimers.ts`), and the
 * web reads a stored `l: 0` as level 0, so a missing `l` — level 1 once `cB`
 * is gone, level 0 while it runs, on both sides — is the one spelling that
 * cannot finish as a level 0 building.
 */

/** Types the build menu offers (see the file comment). */
export const BUILDABLE_TYPES: ReadonlySet<number> = new Set([
  // Resources.
  1, 2, 3, 4, 6,
  // Buildings.
  5, 10, 11, 12, 19, 51,
  // Monster buildings.
  8, 9, 13, 15, 16, 26, 114, 116, 119,
  // Defences.
  17, 20, 21, 22, 23, 24, 25, 115, 117, 118,
]);

/**
 * Types an outpost's build menu offers: the main menu's, less what the outpost
 * table blocks or allows none of (`quantity[1]` 0). Twenty types, the list the
 * web's outpost catalogue shows (`web/src/game/yard/buildCatalogue.ts`).
 */
export const OUTPOST_BUILDABLE_TYPES: ReadonlySet<number> = new Set(
  [...BUILDABLE_TYPES].filter((type) => {
    const row = OUTPOST_COSTS[type];
    return (
      row !== undefined &&
      row.costs.length > 0 &&
      OUTPOST_TRAITS[type]?.blocked !== true &&
      (row.quantity[1] ?? 0) > 0
    );
  })
);

/** The build menu of a yard of `kind`. */
export const buildableTypesOf = (kind: YardKind): ReadonlySet<number> =>
  kind === "outpost" ? OUTPOST_BUILDABLE_TYPES : BUILDABLE_TYPES;

/** Walls and traps finish the moment they are placed and hold no worker (D13). */
const AT_ONCE_KINDS: ReadonlySet<string> = new Set(["wall", "trap"]);

/** The parts of a `Save` the build routes read. */
export interface BuildSave extends StorageCapSave {
  /** `BaseType`: an outpost builds from the outpost table. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
  mushrooms?: JsonObject | null;
}

/** Where the new building goes: its type and footprint origin in yard units. */
export interface BuildRequest {
  type: number;
  x: number;
  y: number;
}

/** `report` of `POST /bm/yard/build`. */
export interface BuildReport {
  /** The new building's id. */
  id: number;
  t: number;
  x: number;
  y: number;
  /** The countdown written, after Sharper Tools; 0 for a wall or trap. */
  seconds: number;
  /** Whether it was written finished (a wall or trap, D13). */
  finished: boolean;
  /** What it cost: `costs[0]`. */
  cost: ResourceAmounts;
  /** Empire points awarded now: a finished wall or trap's; 0 while building. */
  points: number;
}

/** `report` of `POST /bm/yard/build/instant`. */
export interface InstantBuildReport {
  id: number;
  t: number;
  x: number;
  y: number;
  /** Shiny charged. */
  credits: number;
  /** Empire points the finished build awarded. */
  points: number;
}

/** `report` of `POST /bm/yard/build/cancel`. */
export interface CancelBuildReport {
  id: number;
  t: number;
  /** What came back: `costs[0]`, less whatever the storage cap turned away. */
  refund: ResourceAmounts;
}

/** `quantity[hall]`, the last entry standing in for any hall past the end (`BASE.as:3717`). */
const allowedAt = (quantity: readonly number[], hall: number): number => {
  if (quantity.length === 0) return 0;
  return quantity[Math.min(Math.max(hall, 0), quantity.length - 1)] ?? 0;
};

/** The first hall level above `hall` that allows more than `allowed`, or null. */
const nextHallAllowing = (quantity: readonly number[], hall: number, allowed: number): number | null => {
  for (let level = hall + 1; level < quantity.length; level++) {
    if ((quantity[level] ?? 0) > allowed) return level;
  }
  return null;
};

/** One above every id the save uses, in `buildingdata` or in `buildinghealthdata`. */
export const nextBuildingId = (save: BuildSave): number => {
  let top = 0;
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    top = Math.max(top, Number(building?.id ?? key) || 0, Number(key) || 0);
  }
  // A health entry left behind by a building that is gone must not become the
  // new one's damage.
  for (const key of Object.keys(save.buildinghealthdata ?? {})) top = Math.max(top, Number(key) || 0);
  return top + 1;
};

/**
 * The gates `build` and `build/instant` share: 1 to 4 and 6 of the file
 * comment. Returns the build step.
 */
const buildGates = (save: BuildSave, request: BuildRequest): CostStep => {
  const { type } = request;
  const kind = yardKindOf(save);
  const row = costOf(type, kind);
  const step = row?.costs[0];
  if (!row || !step || !buildableTypesOf(kind).has(type)) {
    throw yardBadRequestErr("That cannot be built here.", { type }, "notBuildable");
  }

  const buildings = save.buildingdata ?? {};
  const hall = townHallLevel(buildings, kind);
  const hallLabel = hallName(kind);
  const allowed = allowedAt(row.quantity, hall);
  if (allowed <= 0) {
    const need = nextHallAllowing(row.quantity, Math.max(hall, 0), 0) ?? 1;
    throw yardRefusedErr(
      "townHall",
      hall <= 0
        ? `You need a ${hallLabel} before you can build anything.`
        : `That needs a level ${need} ${hallLabel}.`,
      { townHall: { have: hall, need: hall <= 0 ? 1 : need } }
    );
  }

  const have = countOfType(buildings, type);
  if (have >= allowed) {
    // The core never leaves level 1, so an outpost has no bigger hall to wait for.
    const next = kind === "outpost" ? null : nextHallAllowing(row.quantity, hall, allowed);
    throw yardRefusedErr(
      "limit",
      next === null
        ? `You already have ${have}, the most a yard can hold.`
        : `You already have ${have}. Upgrade your ${hallLabel} to level ${next} to build more.`,
      { limit: { have, allowed, next } }
    );
  }

  const unmet = requirementDetail(step[5], buildings, hall, hallTypeOf(kind));
  if (unmet) {
    const gate = unmet.townHall as { have: number; need: number } | undefined;
    if (gate) {
      throw yardRefusedErr("townHall", `That needs a level ${gate.need} ${hallLabel}.`, {
        townHall: gate,
      });
    }
    throw yardRefusedErr("requirements", "That needs other buildings first.", {
      requirements: unmet.requirements as CostRequirement[],
    });
  }

  return step;
};

/** Why a footprint cannot go where it was asked: gate 6's `placement` detail. */
export type PlacementProblem =
  | { placement: "outOfBounds" }
  | { placement: "overlap"; with: number }
  | { placement: "mushroom" };

/**
 * Gate 6's rule, without the refusal: inside the plot, clear of every building
 * and mushroom. Null when the spot is free. The Map Room migration checks the
 * spot it picks with it too (`mapRoom.ts`).
 */
export const placementProblem = (save: BuildSave, request: BuildRequest): PlacementProblem | null => {
  const { type, x, y } = request;
  const rect = rectOf(type, x, y);

  if (!withinBounds(rect, type, currentExpansion(save.storedata))) return { placement: "outOfBounds" };

  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    const other = rectOf(Number(building.t), Number(building.X), Number(building.Y));
    if (overlaps(rect, other)) return { placement: "overlap", with: Number(building.id ?? key) };
  }

  if (mushroomRects(save.mushrooms).some((mushroom) => overlaps(rect, mushroom))) {
    return { placement: "mushroom" };
  }
  return null;
};

const PLACEMENT_MESSAGES: Readonly<Record<PlacementProblem["placement"], string>> = {
  outOfBounds: "That spot is outside your yard.",
  overlap: "Something is already built there.",
  mushroom: "A mushroom is in the way. Pick it or build somewhere else.",
};

/** Gate 6: inside the plot, clear of every building and mushroom. */
const placementGate = (save: BuildSave, request: BuildRequest): void => {
  const problem = placementProblem(save, request);
  if (problem) throw yardRefusedErr("placement", PLACEMENT_MESSAGES[problem.placement], problem);
};

/** The new building, still to be built: `cB` and `cL` set, no `l` (see the file comment). */
const newBuilding = (id: number, request: BuildRequest, seconds: number): BuildingData =>
  ({ id, t: request.type, X: request.x, Y: request.y, cB: seconds, cL: seconds }) as unknown as BuildingData;

/** The new building, finished at level 1. */
const finishedBuilding = (id: number, request: BuildRequest): BuildingData =>
  ({ id, t: request.type, X: request.x, Y: request.y }) as unknown as BuildingData;

/**
 * Places a new building: a countdown and a worker, or for a wall or trap a
 * finished building (D13). Refuses with the gates of the file comment, in
 * order.
 *
 * @param save - The caught-up main yard.
 * @param request - The type and the footprint origin.
 * @param now - Unix seconds, for the Sharper Tools window.
 * @returns The new `buildingdata`, the debit, the points and the report.
 */
export const planBuild = (save: BuildSave, request: BuildRequest, now: number) => {
  const kind = yardKindOf(save);
  const step = buildGates(save, request);
  const cost = stepAmounts(step);

  const missing = shortfall(save.resources, cost);
  if (isShort(missing)) {
    throw yardRefusedErr("shortfall", "You do not have enough resources for that.", {
      shortfall: missing,
    });
  }

  placementGate(save, request);

  const id = nextBuildingId(save);
  const atOnce = AT_ONCE_KINDS.has(costOf(request.type, kind)?.kind ?? "");

  if (atOnce) {
    const points = pointsForBuild(step);
    const report: BuildReport = {
      id,
      t: request.type,
      x: request.x,
      y: request.y,
      seconds: 0,
      finished: true,
      cost,
      points,
    };
    return {
      report,
      slices: { buildingdata: { ...save.buildingdata, [String(id)]: finishedBuilding(id, request) } },
      debit: cost,
      points,
    };
  }

  const buildings = save.buildingdata ?? {};
  const total = workerCount(save.storedata, kind);
  const busy = busyWorkers(buildings);
  if (busy >= total) {
    throw yardRefusedErr("workers", "All your workers are busy.", { workers: { total, busy } });
  }

  const seconds = Math.floor(step[4] * sharperToolsMultiplier(save.storedata, now));
  const report: BuildReport = {
    id,
    t: request.type,
    x: request.x,
    y: request.y,
    seconds,
    finished: false,
    cost,
    points: 0,
  };
  return {
    report,
    slices: { buildingdata: { ...buildings, [String(id)]: newBuilding(id, request, seconds) } },
    debit: cost,
  };
};

/**
 * Places a new building finished, for Shiny: no resources charged, no worker
 * held, the build's points awarded now (`BFOUNDATION.InstantBuildCost`,
 * `client/scripts/BFOUNDATION.as:2085-2098`). The building is finished the
 * way the catch-up finishes one, through `finishBuildingJob`, so the level,
 * points and the job record are the ones a countdown running out would give.
 *
 * Price: `instantBuildPrice(type)` (`services/yard/shiny.ts`). The Shiny lock
 * and the balance are the wrapper's.
 */
export const planInstantBuild = (save: BuildSave, request: BuildRequest, now: number) => {
  const kind = yardKindOf(save);
  buildGates(save, request);
  placementGate(save, request);

  const id = nextBuildingId(save);
  const shiny = instantBuildPrice(request.type, kind);
  const { building, job } = finishBuildingJob(newBuilding(id, request, 1), "cB", now, kind);
  const points = job.detail.points;

  const report: InstantBuildReport = {
    id,
    t: request.type,
    x: request.x,
    y: request.y,
    credits: shiny,
    points,
  };
  return {
    report,
    slices: { buildingdata: { ...save.buildingdata, [String(id)]: building } },
    shiny,
    points,
  };
};

/**
 * Cancels a building still under construction: it goes, and its full build
 * price comes back, clamped to the storage cap by the wrapper (BB §5 "Cancel
 * and refund"). Shiny spent speeding it up is not refunded.
 *
 * Refuses `400 badRequest` for no such building, `409 notBuilding` when no
 * `cB` is running on it.
 */
export const planCancelBuild = (save: BuildSave, id: number) => {
  const building = buildingOrThrow(save.buildingdata, id);
  if (!(Number(building.cB) > 0)) {
    throw yardRefusedErr("notBuilding", "That building is not under construction.");
  }

  const type = Number(building.t);
  const refund = cancelRefund(type, 0, yardKindOf(save));
  const { [String(id)]: _gone, ...buildingdata } = save.buildingdata ?? {};

  const slices: { buildingdata: BuildingDataMap; buildinghealthdata?: BuildingHealthData } = {
    buildingdata,
  };
  if (save.buildinghealthdata && String(id) in save.buildinghealthdata) {
    const { [String(id)]: _health, ...health } = save.buildinghealthdata;
    slices.buildinghealthdata = health;
  }

  // What the wrapper's clamp will let through (`credit.ts`, T3), measured
  // against the yard as it stands once the building is gone.
  const report: CancelBuildReport = {
    id,
    t: type,
    refund: fitCredit({ ...save, buildingdata }, refund).credited,
  };
  return { report, slices, credit: refund };
};
