import { costOf, type CostStep } from "../../game-data/buildingCosts.js";
import type {
  BuildingData,
  BuildingDataMap,
  BuildingHealthData,
} from "../../types/BuildingData.js";
import { requirementDetail } from "../base/economy/transitions.js";
import { levelOf, townHallLevel } from "../yardplanner/costs.js";
import { UNPLANNABLE_KINDS } from "../yardplanner/validateLayout.js";
import {
  MAP_ROOM_TYPE,
  buildingOrThrow,
  damagedErr,
  finishBuildingJob,
  isDamaged,
  mapRoomErr,
} from "./buildingJobs.js";
import type { BuildingJob } from "./catchUpBuildings.js";
import { instantUpgradePrice } from "./shiny.js";
import { yardBadRequestErr, yardRefusedErr } from "./yardErrors.js";

/**
 * `POST /bm/yard/upgrade/instant`: raise a building one level now for Shiny,
 * with no resources charged and no worker held
 * (`docs/design/yard-buildings.md` §3.2; `docs/specs/base-building.md` §6
 * "Instant upgrade"). `BFOUNDATION.DoInstantUpgrade` checks the balance and
 * calls `Upgraded()` directly (`client/scripts/BFOUNDATION.as:2130-2140`), so
 * the level, full health and the step's points land at once.
 *
 * Price: `instantUpgradePrice(type, level)` (`services/yard/shiny.ts`).
 *
 * Pure: no database, no clock. The wrapper charges the Shiny.
 */

/** The slice of a save the instant upgrade reads. */
export interface InstantUpgradeSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

/** What the route sends back as `report`. */
export interface InstantUpgradeReport {
  id: number;
  from: number;
  to: number;
  /** Shiny charged. */
  credits: number;
  /** Empire points the step awarded. */
  points: number;
}

/** What the instant upgrade decided. */
export interface InstantUpgradePlan {
  buildingdata: BuildingDataMap;
  shiny: number;
  points: number;
  job: BuildingJob;
  report: InstantUpgradeReport;
}

/** Building kinds with their own batch routes (`walls/upgrade`, `traps/rearm`). */
const BATCH_KINDS: ReadonlySet<string> = new Set(["wall", "trap"]);

/**
 * The upgrade gates an instant upgrade shares with `POST /bm/yard/upgrade`,
 * in the order §3.2 lists them, minus the two it skips (resources and a free
 * worker). Returns the step to be skipped, or throws the refusal.
 *
 * TEMPORARY: kept in this one function on purpose. WP1.2 (#96) extracts
 * `planOneUpgrade` from the planner walk (`services/yardplanner/startUpgrades.ts`);
 * once it lands this should call it with the resource and worker checks
 * switched off, so the panel, the planner and the instant route share one rule
 * set.
 *
 * Refusals: `400 badRequest` unknown id or a type with no ladder
 * (decoration, mushroom, placeholder); `400 useBatchRoute` wall or trap;
 * `409 mapRoom`; `409 busy` (`cB`/`cU`/`cF`); `409 damaged`; `409 townHall
 * {have: 0, need: 1}` with no Town Hall; `409 maxLevel {level, max}`;
 * `409 townHall {have, need}` / `409 requirements [[type, count, level]]` for
 * `costs[level].re` (`client/scripts/BASE.as:3828-3932`).
 */
export const instantUpgradeGate = (
  save: InstantUpgradeSave,
  id: number
): { building: BuildingData; level: number; step: CostStep } => {
  const building = buildingOrThrow(save.buildingdata, id);
  const type = Number(building.t);
  const row = costOf(type);

  if (row && BATCH_KINDS.has(row.kind)) {
    throw yardBadRequestErr(
      "Walls and traps are upgraded from the Yard Planner.",
      { id },
      "useBatchRoute"
    );
  }
  if (!row || UNPLANNABLE_KINDS.has(row.kind) || row.costs.length === 0) {
    throw yardBadRequestErr("That building cannot be upgraded.", { id });
  }
  if (type === MAP_ROOM_TYPE) throw mapRoomErr(id);

  if (Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF)) {
    throw yardRefusedErr("busy", "This building is already busy.", { id });
  }
  if (isDamaged(building, save.buildinghealthdata)) throw damagedErr(id);

  const buildings = save.buildingdata ?? {};
  const hall = townHallLevel(buildings);
  if (hall <= 0) {
    throw yardRefusedErr("townHall", "You need a Town Hall first.", {
      id,
      townHall: { have: 0, need: 1 },
    });
  }

  const level = levelOf(building);
  const max = row.costs.length;
  if (level >= max) {
    throw yardRefusedErr("maxLevel", "This building is at its highest level.", {
      id,
      level,
      max,
    });
  }

  const step = row.costs[level]!;
  const unmet = requirementDetail(step[5], buildings, hall);
  if (unmet) {
    throw unmet.townHall
      ? yardRefusedErr("townHall", "Upgrade your Town Hall first.", { id, ...unmet })
      : yardRefusedErr("requirements", "Other buildings need upgrading first.", { id, ...unmet });
  }

  return { building, level, step };
};

/**
 * Works out an instant upgrade against a caught-up yard, or throws the
 * refusal ({@link instantUpgradeGate}). Shiny lock and balance are the
 * wrapper's.
 */
export const planInstantUpgrade = (
  save: InstantUpgradeSave,
  id: number,
  now: number
): InstantUpgradePlan => {
  const { building, level } = instantUpgradeGate(save, id);

  const shiny = instantUpgradePrice(Number(building.t), level);
  const { building: next, job } = finishBuildingJob(building, "cU", now);
  const points = job.detail.points;

  return {
    buildingdata: { ...save.buildingdata, [String(id)]: next },
    shiny,
    points,
    job,
    report: { id, from: level, to: job.detail.level, credits: shiny, points },
  };
};
