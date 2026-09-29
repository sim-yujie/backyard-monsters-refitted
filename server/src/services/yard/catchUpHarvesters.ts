import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import {
  canProduce,
  harvesterRates,
  isHarvester,
  runHarvester,
  type HarvesterBuffer,
} from "../base/economy/production.js";
import { levelOf } from "../yardplanner/costs.js";
import type { BuildingJob, StoreItemJob } from "./catchUpBuildings.js";
import type { RepairJob } from "./catchUpRepairs.js";

/**
 * Catch-up step 3: harvester buffers (`docs/design/yard-buildings.md` §2.3,
 * §5.1).
 *
 * Every Twig Snapper, Pebble Shiner, Putty Squisher and Goo Factory fills its
 * own buffer `st` while the player is away, one cycle at a time, exactly as the
 * original's offline replay did (`production.ts`, `runHarvester`). Nothing is
 * banked here: collection stays manual (`POST /bm/yard/bank`), and a full
 * buffer simply stops, as it did.
 *
 * Per harvester:
 *
 * - **Nothing while a countdown runs** (`client/scripts/BRESOURCE.as:301`): a
 *   build, upgrade or fortify still running after step 1 leaves the harvester
 *   as it was. One that step 1 finished inside the window produces from the
 *   moment it finished, at its new level (the window is split there, §2.3).
 * - **Nothing below half health** (`:302`), and a damaged one cycles slower
 *   (`cycleSeconds`). A repair the repairs step finished inside the window
 *   splits it (`catchUpRepairs.ts`): up to the repair's end the harvester
 *   works at the health it had at the start of the window, then at full
 *   health. The original's health rose second by second in between, so this
 *   undercounts a little, never over. A repair still running at `now` is read
 *   at the health it has reached (the window is then under an hour).
 * - **Production Overdrive** (`POD`, twice the production for 12 hours,
 *   `client/scripts/STORE.as:2413-2418`) doubles each cycle's `produce` up to
 *   its `e`. Step 1 removes a `POD` whose `e` has passed, so its end comes from
 *   the `storeItem` job that step reported.
 *
 * The buffer is written in the original's own fields: `st`, `pr` (1 while
 * producing) and `cP` (seconds left of the running cycle, absent when idle).
 *
 * Pure apart from mutating the save it is handed; idempotent at the same `now`.
 */

/** The Production Overdrive store code and its power. */
const PRODUCTION_OVERDRIVE = "POD";
const OVERDRIVE_POWER = 2;

/** The slice of a save this step reads and writes. */
export interface CatchUpHarvestersSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
  storedata?: JsonObject | null;
}

/** Anything that is not a finite number reads as undefined. */
const finite = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/** A building's health: `buildinghealthdata` first, then its own `hp`; undefined at full. */
export const harvesterHealth = (
  save: Pick<CatchUpHarvestersSave, "buildinghealthdata">,
  key: string,
  building: BuildingData
): number | undefined =>
  finite(save.buildinghealthdata?.[String(building.id ?? key)]) ?? finite(building.hp);

/** True while a build, upgrade or fortify countdown runs (any truthy value, as `advanceBuildingTimers` reads it). */
export const counting = (building: BuildingData): boolean =>
  Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF);

/** The buffer as the save holds it. */
export const bufferOf = (building: BuildingData): HarvesterBuffer => {
  const countdown = finite(building.cP);
  const producing = finite(building.pr) !== 0;
  return {
    stored: Math.max(0, finite(building.st) ?? 0),
    countdown: producing && countdown !== undefined && countdown > 0 ? countdown : null,
  };
};

/** The building with its buffer written back in the original's fields. */
export const withBuffer = (building: BuildingData, buffer: HarvesterBuffer): BuildingData => {
  const { cP: _cycle, ...rest } = building;
  return {
    ...rest,
    st: buffer.stored,
    pr: buffer.countdown === null ? 0 : 1,
    ...(buffer.countdown !== null && { cP: buffer.countdown }),
  };
};

/**
 * When the Production Overdrive stops counting inside the window: its `e`
 * while it is still in `storedata`, or the moment step 1 said it ran out.
 * Undefined when there was none.
 */
export const overdriveEnd = (
  save: CatchUpHarvestersSave,
  completed: readonly unknown[]
): number | undefined => {
  const running = finite((save.storedata?.[PRODUCTION_OVERDRIVE] as JsonObject | undefined)?.e);
  if (running !== undefined) return running;
  const expired = completed.find(
    (job): job is StoreItemJob =>
      (job as StoreItemJob)?.kind === "storeItem" && (job as StoreItemJob).id === PRODUCTION_OVERDRIVE
  );
  return expired?.at;
};

/** When step 1 finished a countdown on this building inside the window, if it did. */
const finishedAt = (completed: readonly unknown[], id: number): number | undefined => {
  let at: number | undefined;
  for (const job of completed) {
    const building = job as BuildingJob;
    if (
      (building?.kind === "build" || building?.kind === "upgrade" || building?.kind === "fortify") &&
      building.id === id
    ) {
      at = Math.max(at ?? building.at, building.at);
    }
  }
  return at;
};

/** The repair the repairs step finished on this building inside the window, if it did. */
const repairOf = (completed: readonly unknown[], id: number): RepairJob | undefined =>
  completed.find(
    (job): job is RepairJob => (job as RepairJob)?.kind === "repair" && (job as RepairJob).id === id
  );

/**
 * Runs one harvester from `start` to `now`, overdriven until `podEnd`.
 * Returns the new buffer, or null when the harvester does not produce.
 */
export const advanceHarvester = (
  save: CatchUpHarvestersSave,
  key: string,
  building: BuildingData,
  start: number,
  now: number,
  podEnd: number | undefined
): HarvesterBuffer | null => {
  const type = Number(building.t);
  if (!isHarvester(type) || counting(building)) return null;
  const level = levelOf(building);
  if (level <= 0) return null;

  const health = harvesterHealth(save, key, building);
  const max = maxHp(type, level) || undefined;
  if (!canProduce(health, max)) return null;

  const rates = harvesterRates(type, level, health, max);
  if (!rates) return null;

  let buffer = bufferOf(building);
  const overdriven = podEnd === undefined ? 0 : Math.max(0, Math.min(now, podEnd) - start);
  if (overdriven > 0) buffer = runHarvester(buffer, rates, overdriven, OVERDRIVE_POWER);
  return runHarvester(buffer, rates, Math.max(0, now - start - overdriven));
};

/**
 * Runs one harvester across a repair that finished at `repair.at`, inside
 * `start`..`now`: at the health it had before the repair up to then, at full
 * health after. Returns null when it produced in neither part.
 */
const advanceAcrossRepair = (
  save: CatchUpHarvestersSave,
  key: string,
  building: BuildingData,
  start: number,
  now: number,
  podEnd: number | undefined,
  repair: RepairJob
): HarvesterBuffer | null => {
  const damaged = repair.detail.from;
  const before: CatchUpHarvestersSave = {
    ...save,
    buildinghealthdata: { ...(save.buildinghealthdata ?? {}), [String(building.id ?? key)]: damaged },
  };
  const first = advanceHarvester(before, key, { ...building, hp: damaged }, start, repair.at, podEnd);
  const mid = first ? withBuffer(building, first) : building;
  return advanceHarvester(save, key, mid, repair.at, now, podEnd) ?? first;
};

/**
 * Grows every harvester's buffer from `from` to `now`.
 *
 * @param save - The yard, mutated in place: `buildingdata` is replaced when a
 *   buffer changed.
 * @param from - The moment the stored buffers are measured from (`savetime`).
 * @param now - The moment to advance to.
 * @param completed - What the earlier steps finished in this window, for the
 *   building completions and repairs that split it and the Production
 *   Overdrive's end.
 */
export const catchUpHarvesters = (
  save: CatchUpHarvestersSave,
  from: number,
  now: number,
  completed: readonly unknown[]
): void => {
  const buildings = save.buildingdata;
  if (!buildings) return;

  const podEnd = overdriveEnd(save, completed);
  let out: BuildingDataMap | null = null;

  for (const [key, building] of Object.entries(buildings)) {
    if (!building || !isHarvester(Number(building.t))) continue;

    const id = Number(building.id ?? key);
    const start = Math.min(now, Math.max(from, finishedAt(completed, id) ?? from));
    const repair = repairOf(completed, id);
    const buffer =
      repair && repair.at > start
        ? advanceAcrossRepair(save, key, building, start, now, podEnd, repair)
        : advanceHarvester(save, key, building, start, now, podEnd);
    if (!buffer) continue;

    const before = bufferOf(building);
    const unchanged =
      before.stored === buffer.stored &&
      before.countdown === buffer.countdown &&
      finite(building.pr) === (buffer.countdown === null ? 0 : 1);
    if (unchanged) continue;

    out ??= { ...buildings };
    out[key] = withBuffer(building, buffer);
  }

  if (out) save.buildingdata = out;
};
