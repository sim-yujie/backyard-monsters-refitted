import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";

/**
 * Workers, server-side.
 *
 * A yard's workers are the one thing that decides how many jobs Apply can
 * start, and the count is never stored as its own field: it is derived from
 * the `BEW` store purchase every time it is needed (spec
 * `docs/specs/base-building.md:741-743`). This file is the one place that
 * derivation lives, so the walk that starts upgrades, the report it returns
 * and the client's preview cannot drift apart
 * (`docs/design/planner-upgrades.md` §3.1).
 *
 * `web/src/game/yard/workers.ts` is the byte-for-byte reading of the same two
 * rules over the shape the web client holds a yard in. Nothing here touches
 * the database: callers hand in the save's `storedata` and `buildingdata`, the
 * same bargain `validateLayout.ts` and `costs.ts` make.
 *
 * ## The count
 *
 * The main yard has `1 + storedata.BEW.q` workers, capped at five
 * (`client/scripts/QUEUE.as:42-53`, the five-busy message at `:103-104`). The
 * store sells `BEW` four times (`game-data/store/storeItems.ts:15-22`), so a
 * legitimate save never reaches the cap from below, but a save that somehow
 * holds more is clamped rather than trusted. Outposts get one worker whatever
 * the purchase says (`QUEUE.as:45-49`); the Yard Planner is main-yard only, so
 * that branch has no home here.
 *
 * ## Busy
 *
 * Every build, upgrade and fortify countdown holds a worker while it runs
 * (spec `:774-782`). A repair does not (`:784-786`), which is why `rE` and a
 * rebuild countdown are not counted. Picking a mushroom holds one in the Flash
 * client (`client/scripts/MUSHROOMS.as:197-206`) but leaves nothing in the
 * save, so no server can see it; the plan records that as a known gap (§8,
 * item 6).
 */

/** The most workers a main yard can ever have (`QUEUE.as:42-53`). */
export const WORKER_CAP = 5;

/**
 * The multiplier Sharper Tools puts on an upgrade countdown: a 20% head start
 * (`client/scripts/STORE.as:2513-2519`; spec `:854-857`).
 */
export const SHARPER_TOOLS_MULTIPLIER = 0.8;

/** A finite number, or null for anything a jsonb column might hold instead. */
const finite = (raw: unknown): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Whether a countdown field names a job that is actually running. */
const running = (raw: unknown): boolean => (finite(raw) ?? 0) > 0;

/**
 * How many workers this yard has: one, plus every extra worker bought, capped
 * at {@link WORKER_CAP}.
 *
 * A save with no `storedata` at all, or none that reads as a number, has the
 * one worker every yard starts with.
 */
export const workerCount = (storedata: JsonObject | null | undefined): number => {
  const bought = finite(storedata?.BEW?.q) ?? 0;
  const extra = bought > 0 ? Math.floor(bought) : 0;
  return Math.min(WORKER_CAP, 1 + extra);
};

/**
 * How many of this yard's workers are already on a job.
 *
 * Counted off the countdowns as the save holds them, so callers must advance
 * the timers first (`services/base/advanceBuildingTimers.ts`) or they will
 * count a job that finished minutes ago.
 */
export const busyWorkers = (buildingdata: BuildingDataMap | null | undefined): number => {
  let busy = 0;
  for (const raw of Object.values(buildingdata ?? {})) {
    const building = raw as BuildingData;
    if (running(building.cB) || running(building.cU) || running(building.cF)) busy++;
  }
  return busy;
};

/**
 * Whether Sharper Tools was still running at `now`
 * (`client/scripts/STORE.as:2513-2519`).
 *
 * The audit reads the same field the same way
 * (`services/base/economy/auditEconomySave.ts:277-278`); WP1 points that copy
 * here so the audit and the upgrade walk cannot disagree about a buff.
 */
export const sharperToolsActive = (
  storedata: JsonObject | null | undefined,
  now: number
): boolean => (finite(storedata?.BST?.e) ?? 0) > now;

/**
 * What to multiply an upgrade's `time` by before writing it as a countdown:
 * {@link SHARPER_TOOLS_MULTIPLIER} while the buff runs, 1 otherwise.
 *
 * `GLOBAL._buildTime` in the Flash client (`BFOUNDATION.as:2295`), and the
 * `bst` the audit checks a started countdown against
 * (`services/base/economy/transitions.ts:258`).
 */
export const sharperToolsMultiplier = (
  storedata: JsonObject | null | undefined,
  now: number
): number => (sharperToolsActive(storedata, now) ? SHARPER_TOOLS_MULTIPLIER : 1);
