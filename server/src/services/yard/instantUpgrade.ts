import { costOf } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { yardKindOf } from "../yardplanner/costs.js";
import { planOneUpgrade, type UpgradeWalkSave } from "../yardplanner/startUpgrades.js";
import { MAP_ROOM_TYPE, buildingOrThrow, finishBuildingJob, mapRoomErr } from "./buildingJobs.js";
import type { BuildingJob } from "./catchUpBuildings.js";
import { instantUpgradePrice } from "./shiny.js";
import { refusalErr } from "./upgrade.js";
import { yardBadRequestErr } from "./yardErrors.js";

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

/** The slice of a save the instant upgrade reads: what the upgrade gates read. */
export type InstantUpgradeSave = UpgradeWalkSave;

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

/** The two checks an instant upgrade skips: it charges no resources and holds no worker. */
const SKIPPED: ReadonlySet<string> = new Set(["shortfall", "workers"]);

/**
 * The upgrade gates an instant upgrade shares with `POST /bm/yard/upgrade`:
 * the same {@link planOneUpgrade} the panel's upgrade and the planner's walk
 * take each step with, minus its last two checks (resources and a free
 * worker, which it runs after every other gate, so a refusal for either of
 * them means everything else passed). Returns the building and the level it
 * is at, or throws the refusal the upgrade route would.
 *
 * Refusals, in order: `400 badRequest` unknown id; `400 useBatchRoute` wall
 * or trap; `409 mapRoom`; then `planOneUpgrade`'s: `400 badRequest` no ladder
 * (decoration, mushroom, placeholder), `409 busy` (`409 training` for an
 * Academy that is training, #145), `409 damaged`,
 * `409 townHall {have: 0, need: 1}`, `409 maxLevel {level, max}`,
 * `409 townHall {have, need}` / `409 requirements [[type, count, level]]`.
 */
export const instantUpgradeGate = (
  save: InstantUpgradeSave,
  id: number,
  now: number
): { building: BuildingData; level: number } => {
  const building = buildingOrThrow(save.buildingdata, id);
  const type = Number(building.t);
  const yard = yardKindOf(save);

  const kind = costOf(type, yard)?.kind;
  if (kind && BATCH_KINDS.has(kind)) {
    throw yardBadRequestErr(
      "Walls and traps are upgraded from the Yard Planner.",
      { id },
      "useBatchRoute"
    );
  }
  if (type === MAP_ROOM_TYPE) throw mapRoomErr(id);

  const step = planOneUpgrade(save, id, now);
  if (!step.ok && !SKIPPED.has(step.reason)) throw refusalErr(step, yard);

  return { building, level: step.from };
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
  const { building, level } = instantUpgradeGate(save, id, now);
  const yard = yardKindOf(save);

  const shiny = instantUpgradePrice(Number(building.t), level, yard);
  const { building: next, job } = finishBuildingJob(building, "cU", now, yard);
  const points = job.detail.points;

  return {
    buildingdata: { ...save.buildingdata, [String(id)]: next },
    shiny,
    points,
    job,
    report: { id, from: level, to: job.detail.level, credits: shiny, points },
  };
};
