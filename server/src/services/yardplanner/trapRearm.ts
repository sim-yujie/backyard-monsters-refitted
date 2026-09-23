import { batchBlockedErr, layoutInvalidErr } from "../../errors/errors.js";
import { costOf, TRAP_TYPES } from "../../game-data/buildingCosts.js";
import {
  BATCH_TRAP_MAX,
  TrapPlacementListSchema,
  type TrapPlacement,
} from "../../schemas/YardPlannerSchemas.js";
import type { BuildingData, BuildingDataMap, FiredTrap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  FREE_FINISH_SECONDS,
  countOfType,
  isShort,
  pointsForBuild,
  shortfall,
  sumCosts,
  townHallLevel,
  type ResourceAmounts,
} from "./costs.js";
import {
  currentExpansion,
  mushroomRects,
  rectOf,
  sweepOverlaps,
  withinBounds,
  type PlacedRect,
} from "./layoutGeometry.js";
import { checkRequirements } from "./wallUpgrade.js";
import { listIds, MAX_LISTED } from "./validateLayout.js";

/**
 * Trap re-arm: build a Booby Trap (24) or Heavy Trap (117) at each position the
 * client asks for, in one charge
 * (`docs/design/yard-planner-phase1-remainder.md` §2.5).
 *
 * A trap that fires is gone. `BTRAP.Explode` sets its health to zero
 * (`client/scripts/BTRAP.as:88-151`), the next save leaves it out of
 * `buildingdata` altogether, and the attack save drops it here
 * (`controllers/base/save/handlers/buildingDataHandler.ts`). Only the id
 * survives, never the position — which is why that handler now records
 * `{ t, X, Y, at }` on `save.firedtraps` and why this route re-*builds* rather
 * than un-deleting. New traps take fresh ids continuing from the highest the
 * yard holds, exactly as `_buildingCount` does in the Flash client
 * (`client/scripts/BFOUNDATION.as:1668-1669`).
 *
 * Both trap builds are 5 seconds, inside the free-finish window, so a trap is
 * written finished with no `cB` — decision Q1.
 *
 * Nothing here touches the database.
 */

/** The parts of a `Save` this route reads. */
export interface TrapRearmSave {
  buildingdata?: BuildingDataMap | null;
  resources?: JsonObject | null;
  storedata?: JsonObject | null;
  mushrooms?: JsonObject | null;
  firedtraps?: FiredTrap[] | null;
}

/** What the controller writes back when the batch is allowed. */
export interface TrapRearmPlan {
  /** A new `buildingdata` with the new traps added. */
  buildingdata: BuildingDataMap;
  /** Total charge for every trap. */
  cost: ResourceAmounts;
  /** Empire points earned, summed over the same builds. */
  points: number;
  /** The ids handed to the new traps, in request order. */
  ids: number[];
  /** `save.firedtraps` with the entries these traps answer removed. */
  firedtraps: FiredTrap[];
  /** How many traps were built. */
  placed: number;
}

/**
 * Positions are on a 5-unit grid (spec `docs/specs/base-building.md` §2, "The
 * occupancy grid"), so anything off it is a client that has lost the grid
 * rather than a placement worth arguing about.
 */
const GRID = 5;

/** The key the overlap sweep gives an existing building or a mushroom. */
const EXISTING = -1;

/**
 * Parses the `traps` form field: a JSON string holding `{ t, x, y }` entries.
 *
 * Mirrors `parsePayload` (`validateLayout.ts`) down to echoing the first few
 * schema issues.
 */
export const parseTrapPlacements = (raw: unknown): TrapPlacement[] => {
  if (typeof raw !== "string" || raw.length === 0) {
    throw layoutInvalidErr("Tell the server which traps to put back.");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw layoutInvalidErr("That list of traps could not be read.");
  }

  if (Array.isArray(decoded) && decoded.length > BATCH_TRAP_MAX) {
    throw layoutInvalidErr(`That is more traps than one re-arm can take. The limit is ${BATCH_TRAP_MAX}.`, {
      traps: decoded.length,
    });
  }

  const parsed = TrapPlacementListSchema.safeParse(decoded);
  if (!parsed.success) {
    throw layoutInvalidErr("That list of traps is not in a format this server understands.", {
      issues: parsed.error.issues.slice(0, MAX_LISTED).map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  if (parsed.data.length === 0) {
    throw layoutInvalidErr("Pick at least one trap to put back.");
  }

  const offGrid = parsed.data
    .map((trap, index) => ({ trap, index }))
    .filter(({ trap }) => trap.x % GRID !== 0 || trap.y % GRID !== 0)
    .map(({ index }) => index);

  if (offGrid.length > 0) {
    throw layoutInvalidErr(
      `${offGrid.length} of those positions ${
        offGrid.length === 1 ? "is" : "are"
      } not on the yard grid.`,
      { offGrid: offGrid.slice(0, MAX_LISTED) }
    );
  }

  return parsed.data;
};

/** The highest building id the yard holds, or 0 for an empty yard. */
const highestId = (buildings: BuildingDataMap): number => {
  let highest = 0;
  for (const [key, building] of Object.entries(buildings)) {
    const id = Number(building.id ?? key);
    if (Number.isFinite(id)) highest = Math.max(highest, id);
  }
  return highest;
};

/**
 * Checks a trap re-arm against the caller's yard and works out what it costs.
 * Throws a `ClientSafeError` on the first rule the batch breaks; like the wall
 * route it is all or nothing.
 */
export const planTrapRearm = (save: TrapRearmSave, traps: readonly TrapPlacement[]): TrapRearmPlan => {
  const buildings = save.buildingdata ?? {};

  // 1. Type.
  const notTraps = traps
    .map((trap, index) => ({ trap, index }))
    .filter(({ trap }) => !TRAP_TYPES.includes(trap.t))
    .map(({ index }) => index);

  if (notTraps.length > 0) {
    throw layoutInvalidErr(
      `${listIds(notTraps)} ${notTraps.length === 1 ? "is not a trap" : "are not traps"}.`,
      { notTraps: notTraps.slice(0, MAX_LISTED) }
    );
  }

  // 2. Prerequisites.
  const hall = townHallLevel(buildings);
  if (hall === 0) {
    throw batchBlockedErr("You need a Town Hall before you can build anything.", {
      townHall: { have: 0, need: 1 },
    });
  }

  const wanted = new Map<number, number>();
  for (const trap of traps) wanted.set(trap.t, (wanted.get(trap.t) ?? 0) + 1);

  for (const type of wanted.keys()) {
    const build = costOf(type)?.costs[0];
    if (!build) {
      throw layoutInvalidErr(`This server has no price for building type ${type}.`, {
        notTraps: [traps.findIndex((trap) => trap.t === type)],
      });
    }
    checkRequirements(build[5], buildings, hall);
  }

  // 3. Cap. `quantity[hall]` is how many of a type a yard may hold at that Town
  //    Hall level (`client/scripts/YARD_PROPS.as:2723`, `:6307`).
  for (const [type, count] of wanted) {
    const max = costOf(type)?.quantity[hall] ?? 0;
    const have = countOfType(buildings, type);
    if (have + count > max) {
      throw batchBlockedErr(
        `You can only have ${max} of those at Town Hall ${hall}, and you already have ${have}.`,
        { capReached: { type, have, max } }
      );
    }
  }

  // 4. Placement, against the plot the player actually owns.
  const expansion = currentExpansion(save.storedata);
  const outOfBounds: number[] = [];
  const placing: PlacedRect<number>[] = [];

  traps.forEach((trap, index) => {
    const rect = rectOf(trap.t, trap.x, trap.y);
    if (!withinBounds(rect, trap.t, expansion)) outOfBounds.push(index);
    placing.push({ key: index, rect });
  });

  if (outOfBounds.length > 0) {
    throw layoutInvalidErr(
      `${outOfBounds.length} of those traps ${
        outOfBounds.length === 1 ? "does" : "do"
      } not fit inside your yard.`,
      { outOfBounds: outOfBounds.slice(0, MAX_LISTED), expansion }
    );
  }

  const obstacles: PlacedRect<number>[] = [];
  for (const building of Object.values(buildings)) {
    const rect = rectOfBuilding(building);
    if (rect) obstacles.push({ key: EXISTING, rect });
  }
  for (const rect of mushroomRects(save.mushrooms)) obstacles.push({ key: EXISTING, rect });

  // Pairs of two *existing* buildings are ignored: a yard can genuinely hold
  // overlapping decorations, and that is not this route's argument to have.
  const collision = sweepOverlaps<number>(
    [...obstacles, ...placing],
    (a, b) => a !== EXISTING || b !== EXISTING
  );
  if (collision) {
    const blocked = collision.filter((key) => key !== EXISTING);
    throw layoutInvalidErr(
      blocked.length === 1
        ? "Something is already standing where that trap goes. Clear the spot and try again."
        : "Two of those traps are on top of each other.",
      { overlapping: blocked }
    );
  }

  // 5. Free-finish guard, then 6. cost.
  const steps = traps.map((trap) => costOf(trap.t)!.costs[0]!);
  for (const step of steps) {
    if (step[4] > FREE_FINISH_SECONDS) {
      throw batchBlockedErr("That trap takes too long to build for free.", {
        slowStep: { time: step[4], limit: FREE_FINISH_SECONDS },
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
    throw batchBlockedErr("You do not have enough resources to put those traps back.", {
      shortfall: missing,
    });
  }

  // The plan. Ids continue from the highest the yard holds, and a finished
  // trap carries no `l` (absent means level 1) and no `cB`.
  const buildingdata: BuildingDataMap = { ...buildings };
  const firedtraps = [...(save.firedtraps ?? [])];
  const ids: number[] = [];
  let nextId = highestId(buildings);

  for (const trap of traps) {
    const id = ++nextId;
    ids.push(id);
    buildingdata[String(id)] = { id, t: trap.t, X: trap.x, Y: trap.y } as unknown as BuildingData;

    const at = firedtraps.findIndex(
      (entry) => entry.t === trap.t && entry.X === trap.x && entry.Y === trap.y
    );
    if (at >= 0) firedtraps.splice(at, 1);
  }

  return {
    buildingdata,
    cost,
    points: steps.reduce((total, step) => total + pointsForBuild(step), 0),
    ids,
    firedtraps,
    placed: traps.length,
  };
};

/**
 * A stored building's footprint, or `null` when its position is unusable.
 *
 * `buildingdata` spells the origin `X`/`Y` (`applyLayout.ts:74-76`), where the
 * `BuildingData` type still declares the lower-case pair the Flash source used.
 */
const rectOfBuilding = (building: BuildingData) => {
  const x = Number(building.X);
  const y = Number(building.Y);
  const type = Number(building.t);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(type)) return null;
  return rectOf(type, x, y);
};
