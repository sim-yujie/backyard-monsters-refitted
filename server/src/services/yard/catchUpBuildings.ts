import { costOf, fortifyStepsOf, type YardKind } from "../../game-data/buildingCosts.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { advanceBuildingTimers } from "../base/advanceBuildingTimers.js";
import { pricingType } from "../base/economy/resourceBudget.js";
import {
  TOWN_HALL_TYPE,
  levelOf,
  pointsForBuild,
  pointsForUpgrade,
  upgradeSteps,
  yardKindOf,
} from "../yardplanner/costs.js";
import { syncDerivedLevels, type DerivedLevelsSave } from "./derivedLevels.js";

/**
 * Catch-up step 1: building countdowns and store buffs
 * (`docs/design/yard-buildings.md` §2.3).
 *
 * The countdowns themselves are advanced by `advanceBuildingTimers`, the same
 * function the planner routes and the attack save already use, so the 30-day
 * clamp and the "paused while damaged or repairing" rule are the ones every
 * other server path applies. What this step adds is what the Flash client did
 * on the owner's screen when a countdown reached zero, and which the server
 * never did until now:
 *
 * - **Points** (T5). `Constructed()` adds half the build time plus a tenth of
 *   the resources, and 100 more for a Town Hall
 *   (`client/scripts/BFOUNDATION.as:2913-2917`); `Upgraded()` adds a third of
 *   the step's time and resources (`:2455-2457`). Points are computed from the
 *   step the building just finished, `costs[from]`, which is how the planner
 *   walk already awards them for a free finish
 *   (`services/yardplanner/startUpgrades.ts:363`); `Upgraded()` itself reads
 *   `costs[from - 1]`, one step behind the step it charged, and that quirk is
 *   not copied.
 * - **A record** of each finished job, so the client can say "Cannon Tower
 *   reached level 5" when the finish happened on the server.
 * - **`flinger` / `catapult`**, re-derived once the levels are final (§3.3).
 * - **Store buffs** whose `e` has passed are removed, the rule
 *   `services/base/clearExpiredStoreItems.ts` applies on load, here run against
 *   the catch-up's own `now` so the step stays free of the clock.
 *
 * A fortification that completes on an outpost earns `Fortified()`'s points, a
 * third of the step's time and resources (`:2485-2503`), from the outpost
 * table's fortify ladder. On a main yard it is recorded with 0 points: the
 * main table has no `fortify_costs` (fortifying a main yard is a Map Room 3
 * feature), so the formula has nothing to read.
 *
 * An outpost (`type` `outpost`) prices every job from the outpost table
 * (`yardKindOf`), the table its building was charged from.
 *
 * The step is pure apart from mutating the save it is handed: no database, no
 * clock. Running it twice at the same moment changes nothing the second time,
 * because the first run leaves no countdown that has reached zero and no
 * store entry past its `e`.
 */

/** A building job the catch-up finished. */
export interface BuildingJob {
  kind: "build" | "upgrade" | "fortify";
  /** Building id, the key in `buildingdata`. */
  id: number;
  /** Building type. */
  t: number;
  /** Unix seconds at which the countdown reached zero. */
  at: number;
  detail: {
    /** Level before the job; 0 for a build. */
    from: number;
    /** Level after the job (a fortify leaves it unchanged). */
    level: number;
    /** Fortification tier after the job; present on `fortify` only. */
    fort?: number;
    /** Empire points the finish awarded. */
    points: number;
  };
}

/** A store buff whose time ran out (`storedata[id].e` passed). */
export interface StoreItemJob {
  kind: "storeItem";
  /** The store item code, e.g. `BST`. */
  id: string;
  t: null;
  /** Unix seconds at which it ran out: its `e`. */
  at: number;
  detail: Record<string, never>;
}

/** The slice of a save step 1 reads and writes. */
export interface CatchUpBuildingsSave extends DerivedLevelsSave {
  /** `BaseType`: an outpost's jobs are priced from the outpost table. */
  type?: string;
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  storedata?: JsonObject | null;
  points?: string;
}

/** A countdown the way `advanceBuildingTimers` reads one: any truthy number. */
const COUNTDOWNS = [
  ["cU", "upgrade"],
  ["cB", "build"],
  ["cF", "fortify"],
] as const;

/**
 * Points for one finished job, from the step it finished. `fort` is the
 * fortification a fortify job reached.
 */
const pointsFor = (
  kind: BuildingJob["kind"],
  type: number,
  from: number,
  yard: YardKind,
  fort: number
): number => {
  if (kind === "fortify") {
    const step = fortifyStepsOf(type, yard)[fort - 1];
    return step ? pointsForUpgrade(step) : 0;
  }

  if (kind === "build") {
    const step = costOf(pricingType(type), yard)?.costs[0];
    if (!step) return 0;
    return pointsForBuild(step) + (type === TOWN_HALL_TYPE ? 100 : 0);
  }

  const [step] = upgradeSteps(pricingType(type), from, from + 1, yard);
  return step ? pointsForUpgrade(step) : 0;
};

/**
 * What finished between `before` and `after`, one entry per building whose
 * countdown was running and is now gone.
 *
 * `advanceBuildingTimers` works on at most one countdown per building, in the
 * order upgrade, build, fortify, and deletes the key when it completes; this
 * reads the same keys in the same order.
 */
const finishedJobs = (
  before: BuildingDataMap,
  after: BuildingDataMap,
  from: number,
  yard: YardKind
): BuildingJob[] => {
  const jobs: BuildingJob[] = [];

  for (const [key, old] of Object.entries(before)) {
    const now = after[key];
    if (!now) continue;

    for (const [field, kind] of COUNTDOWNS) {
      const remaining = old[field];
      if (!remaining) continue;
      // The first running countdown is the only one advanced; if it is still
      // there, nothing on this building finished.
      if (now[field] !== undefined) break;

      const type = Number(old.t);
      const level = levelOf(now);
      const startLevel = kind === "build" ? 0 : levelOf(old);
      const fort = Number(now.fort ?? 0);

      jobs.push({
        kind,
        id: Number(old.id ?? key),
        t: type,
        at: from + Math.max(0, Math.floor(Number(remaining))),
        detail: {
          from: startLevel,
          level,
          ...(kind === "fortify" && { fort }),
          points: pointsFor(kind, type, startLevel, yard, fort),
        },
      });
      break;
    }
  }

  return jobs;
};

/**
 * Removes every store entry whose `e` is at or before `now`, and says which.
 *
 * Same rule as `clearExpiredStoreItems` (the client decides "sold out" from
 * `q` and never looks at `e`, so an elapsed entry must go or the item stays
 * unpurchasable).
 */
const expireStoreItems = (save: CatchUpBuildingsSave, now: number): StoreItemJob[] => {
  const storedata = save.storedata;
  if (!storedata) return [];

  const jobs: StoreItemJob[] = [];
  const kept: JsonObject = {};

  for (const [item, entry] of Object.entries(storedata)) {
    const e = Number(entry?.e);
    if (entry?.e && e <= now) {
      jobs.push({ kind: "storeItem", id: item, t: null, at: e, detail: {} });
    } else {
      kept[item] = entry;
    }
  }

  if (jobs.length > 0) save.storedata = kept;
  return jobs;
};

/**
 * Advances a yard's buildings from `from` to `now` and returns what finished.
 *
 * @param save - The yard, mutated in place: `buildingdata`, `points`,
 *   `flinger`, `catapult` and `storedata` may change. `savetime` is left for
 *   the caller (`catchUp.ts`), which moves it once for every step.
 * @param from - The moment the stored countdowns are measured from (the
 *   save's `savetime`).
 * @param now - The moment to advance to.
 */
export const catchUpBuildings = (
  save: CatchUpBuildingsSave,
  from: number,
  now: number
): (BuildingJob | StoreItemJob)[] => {
  const before = save.buildingdata ?? {};
  const after = advanceBuildingTimers(before, save.buildinghealthdata, now - from);
  const jobs = finishedJobs(before, after, from, yardKindOf(save));

  if (save.buildingdata) save.buildingdata = after;

  const points = jobs.reduce((total, job) => total + job.detail.points, 0);
  if (points > 0) save.points = String(Number(save.points ?? "0") + points);

  syncDerivedLevels(save);

  return [...jobs, ...expireStoreItems(save, now)];
};
