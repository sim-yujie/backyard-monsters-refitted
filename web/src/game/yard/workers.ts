import type { BaseLoadResponse } from "@/api/types";
import type { Yard, YardBuilding } from "./yardModel";

/**
 * Workers, client-side.
 *
 * The client copy of `server/src/services/yardplanner/workers.ts`, rule for
 * rule, because the planner has to show "2 free / 5" before Apply and the
 * server has to charge against the same number afterwards
 * (`docs/design/planner-upgrades.md` §3.1, §5.1). Anything that changes here
 * changes there.
 *
 * ## The count
 *
 * The main yard has `1 + storedata.BEW.q` workers, capped at five
 * (`client/scripts/QUEUE.as:42-53`, the five-busy message at `:103-104`; spec
 * `docs/specs/base-building.md:728-739`). The count is derived from the `BEW`
 * store purchase and never stored as its own field (spec `:741-743`), so this
 * reads the same blob `readYard` takes `ENL.q` out of. Outposts get one worker
 * whatever the purchase says (`QUEUE.as:45-49`); the planner is main-yard only.
 *
 * ## Busy
 *
 * Every build, upgrade and fortify countdown holds a worker while it runs
 * (spec `:774-782`). A repair does not (`:784-786`), which is why a rebuild
 * countdown is not counted. There is no queue: a job is either given a slot or
 * refused (spec `:745-752`), which is what makes a free-worker count the whole
 * of the answer to "can this start now".
 */

/** The most workers a main yard can ever have (`QUEUE.as:42-53`). */
export const WORKER_CAP = 5;

/** The countdowns that hold a worker; a rebuild does not. */
const WORKER_HELD_BY: ReadonlySet<string> = new Set(["build", "upgrade", "fortify"]);

/**
 * How many workers this yard has: one, plus every extra worker bought, capped
 * at {@link WORKER_CAP}.
 *
 * A yard with no `storedata`, or none that reads as a number, has the one
 * worker every yard starts with.
 */
export const workerCount = (storedata: BaseLoadResponse["storedata"]): number => {
  const bought = Number(storedata?.["BEW"]?.q);
  const extra = Number.isFinite(bought) && bought > 0 ? Math.floor(bought) : 0;
  return Math.min(WORKER_CAP, 1 + extra);
};

/**
 * How many of this yard's workers are already on a job.
 *
 * Takes anything with a building list, so `readYard` can call it while it is
 * still assembling the yard the planner will later hand it.
 */
export const busyWorkers = (yard: { readonly buildings: readonly YardBuilding[] }): number => {
  let busy = 0;
  for (const building of yard.buildings) {
    if (building.countdown && WORKER_HELD_BY.has(building.countdown.kind)) busy++;
  }
  return busy;
};

/**
 * How many workers are free to take a new job right now.
 *
 * Never negative: a save holding more running jobs than the session has
 * workers is a state the Flash client resolves by cancelling the extras (spec
 * `:804-815`), not something the planner should read as a negative budget.
 */
export const freeWorkers = (yard: Pick<Yard, "workers">): number =>
  Math.max(0, yard.workers.total - yard.workers.busy);
