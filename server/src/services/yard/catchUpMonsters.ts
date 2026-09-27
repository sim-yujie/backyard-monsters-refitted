import { hatchCost } from "../../game-data/monsterCatalogue.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { StorageCapSave } from "../base/economy/resourceBudget.js";
import { HOUSING_MIN_HEALTH } from "../monsters/transferRules.js";
import {
  catchUpBuildings,
  type BuildingJob,
  type CatchUpBuildingsSave,
  type StoreItemJob,
} from "./catchUpBuildings.js";
import { creditResources } from "./credit.js";
import { cullHousing, housingCapacity, type HousingYard } from "./housing.js";
import {
  readProduction,
  simulateProduction,
  writeProduction,
  type OverdriveWindow,
  type TimelineStep,
} from "./production.js";

/**
 * Catch-up step 2: the monsters (`docs/design/yard-buildings.md` §2.3, §4.6).
 *
 * Runs after step 1 (buildings) and reads the building jobs it finished, so a
 * Housing upgrade, a hatchery build or upgrade and the Hatchery Control
 * Centre's build that end inside the elapsed window split it at that moment:
 * production before at the old state, after at the new one.
 *
 * 1. **HCC completion hook.** When step 1 finished an HCC build, every
 *    hatchery's own queue is emptied and refunded in goo, capped at the
 *    storage cap (T3); each keeps the monster it is producing
 *    (`client/scripts/BUILDING16.as:238-255`). The refund is what was paid:
 *    each stack's own level (§10 Q2).
 * 2. **Production**, `production.ts`, from `monsters.saved` (the moment the
 *    blob describes, which an attack save can leave behind `savetime`) to
 *    now, clamped to 30 days like the rest of the catch-up.
 * 3. **Cull** if the army no longer fits (§4.5, `housing.ts`).
 * 4. **Write** `saved`, `space` (derived capacity), `hcount`, `hstage`,
 *    `overdrivepower`/`overdrivetime`, and drop the hatchery and HCC
 *    building-field copies `rPS`/`rCP`/`rIP`/`mq`, which nothing reads now
 *    that `monsters` is canonical (§2.5, §9 item 6).
 *
 * Locker completion is its own step (WP2.3). A Map Room 3 yard's monsters
 * (per-creep records) are left alone.
 *
 * Pure: mutates only the save it is handed. A second run at the same moment
 * changes nothing: production starts from `saved`, which is now, the HCC build
 * is not reported twice, and the army already fits.
 */

/** Hatchery (`BUILDING13`), Housing (`BUILDING15`), HCC (`BUILDING16`). */
export const HATCHERY_TYPE = 13;
export const HOUSING_TYPE = 15;
export const HCC_TYPE = 16;

/** The building-field copies of the hatchery state the original kept (`BFOUNDATION.as:3015-3021`). */
const BUILDING_COPIES = ["rPS", "rCP", "rIP", "mq"] as const;

/** Hatchery overdrives and their power (`client/scripts/STORE.as:2388-2400`). */
const OVERDRIVES: Readonly<Record<string, number>> = { HOD: 4, HOD2: 6, HOD3: 10 };

/** Housing Expansion on the surface (`STORE.as:2419-2427`). */
const EXPANSION = "EXH";

/** The original replayed at most 30 days on load (`advanceBuildingTimers.ts`). */
const MAX_ELAPSED_SECONDS = 60 * 60 * 24 * 30;

/** Monsters that finished hatching during the catch-up, per type. */
export interface HatchJob {
  kind: "hatch";
  /** Monster id. */
  id: string;
  t: null;
  /** When the last of them moved into housing. */
  at: number;
  detail: { count: number };
}

/** Monsters removed because housing shrank (`HOUSING.Cull()`), per type. */
export interface CullJob {
  kind: "cull";
  id: string;
  t: null;
  at: number;
  detail: { count: number };
}

/** The hatchery queues the HCC's completion emptied and refunded. */
export interface QueueRefundJob {
  kind: "queueRefund";
  /** The HCC's building id. */
  id: number;
  t: typeof HCC_TYPE;
  at: number;
  detail: {
    /** Goo credited, after the cap. */
    goo: number;
    /** Monsters taken out of the queues, per type. */
    monsters: Record<string, number>;
  };
}

export type MonsterJob = HatchJob | CullJob | QueueRefundJob;

/** The slice of a save step 2 reads and writes. */
export interface CatchUpMonstersSave extends HousingYard, StorageCapSave {
  monsters?: JsonObject | null;
  academy?: JsonObject | null;
  resources?: JsonObject | null;
  mapversion?: number;
}

export interface CatchUpMonstersOptions {
  /** Academy level per monster id; read from `save.academy` when absent. */
  levels?: Readonly<Record<string, number>>;
  /** Where `HOD*` and `EXH` are looked up; `save.storedata` when absent. */
  buffs?: JsonObject | null;
  /**
   * False for an outpost: no HCC hook (nothing to credit it to), and the
   * building fields are left as they are.
   */
  mainYard?: boolean;
}

/** Academy level per monster id, from an `academy` column. */
export const academyLevels = (academy: JsonObject | null | undefined): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(academy ?? {})) {
    const level = Math.floor(Number((entry as JsonObject | null)?.level));
    if (Number.isFinite(level) && level >= 1) levels[id] = level;
  }
  return levels;
};

/**
 * True for a Map Room 3 `monsters` blob: per-creep arrays under monster ids
 * (`docs/specs/monsters-and-hatchery.md` §10), which this step must not touch.
 */
export const isMapRoom3Monsters = (monsters: JsonObject | null | undefined): boolean =>
  Object.entries(monsters ?? {}).some(([key, value]) => /^I?C\d+$/.test(key) && Array.isArray(value)) ||
  Array.isArray(monsters?.Q);

/** A building's health: `buildinghealthdata` first, then its own `hp`; undefined at full. */
const healthOf = (
  yard: HousingYard,
  key: string,
  building: BuildingData
): number | undefined => {
  const id = String(building.id ?? key);
  const health = yard.buildinghealthdata?.[id] ?? building.hp;
  return health === undefined || health === null ? undefined : Number(health);
};

/** Levels of a building, 1 when unset. */
const levelOfBuilding = (building: BuildingData): number =>
  Math.max(1, Math.floor(Number(building.l ?? 1)) || 1);

/** The building jobs of the types the monsters care about. */
const relevantJobs = (completed: readonly unknown[]): BuildingJob[] =>
  completed.filter(
    (job): job is BuildingJob =>
      typeof job === "object" &&
      job !== null &&
      ((job as BuildingJob).kind === "build" || (job as BuildingJob).kind === "upgrade") &&
      [HATCHERY_TYPE, HOUSING_TYPE, HCC_TYPE].includes((job as BuildingJob).t)
  );

/**
 * The buildings as they stood at `t`: every job that ends after `t` undone
 * (a build back under construction, an upgrade back to its old level and
 * still running).
 */
const buildingsAt = (
  final: BuildingDataMap,
  jobs: readonly BuildingJob[],
  t: number
): BuildingDataMap => {
  const later = jobs.filter((job) => job.at > t);
  if (later.length === 0) return final;
  const out: BuildingDataMap = { ...final };
  for (const job of later) {
    const key = String(job.id);
    const building = out[key];
    if (!building) continue;
    out[key] =
      job.kind === "build"
        ? { ...building, cB: 1 }
        : { ...building, l: job.detail.from, cU: 1 };
  }
  return out;
};

/** A store buff's running windows: the one still stored, and any that ran out in the window. */
const buffWindows = (
  buffs: JsonObject | null | undefined,
  completed: readonly unknown[],
  item: string
): { start: number; end: number }[] => {
  const duration = storeItems[item]?.du ?? 0;
  const windows: { start: number; end: number }[] = [];
  const entry = buffs?.[item];
  const end = Number(entry?.e);
  if (Number.isFinite(end) && end > 0) {
    const start = Number(entry?.s);
    windows.push({ start: Number.isFinite(start) && start > 0 ? start : end - duration, end });
  }
  for (const job of completed as StoreItemJob[]) {
    if (job?.kind === "storeItem" && job.id === item) windows.push({ start: job.at - duration, end: job.at });
  }
  return windows;
};

/** The hatcheries in service order: `hid` order first, then new ones by id. */
const hatcheryOrder = (monsters: JsonObject | null | undefined, buildings: BuildingDataMap): number[] => {
  const hatcheries = Object.entries(buildings)
    .filter(([, building]) => Number(building?.t) === HATCHERY_TYPE)
    .map(([key, building]) => Number(building.id ?? key))
    .filter((id) => Number.isFinite(id));
  const present = new Set(hatcheries);
  const stored: number[] = (Array.isArray(monsters?.hid) ? monsters.hid : [])
    .map(Number)
    .filter((id: number, i: number, all: number[]) => present.has(id) && all.indexOf(id) === i);
  const rest = hatcheries.filter((id) => !stored.includes(id)).sort((a, b) => a - b);
  return [...stored, ...rest];
};

/** When a building starts to count, from its final state and the jobs that finished it. */
const availableFrom = (
  id: number,
  jobs: readonly BuildingJob[],
  start: number
): number => {
  const finished = jobs.filter((job) => job.id === id).map((job) => job.at);
  return Math.max(start, ...finished);
};

/**
 * Advances a yard's monsters from `from` to `now`.
 *
 * @param save - The yard, mutated in place: `monsters`, and for a main yard
 *   `resources` (the HCC refund) and the hatchery/HCC building fields.
 * @param from - The yard's `savetime`: where step 1's jobs are measured from,
 *   and where production starts if the blob carries no `saved`.
 * @param now - The moment to advance to.
 * @param completed - What step 1 finished (building and store-item jobs).
 * @param options - See {@link CatchUpMonstersOptions}.
 * @returns What happened, per monster type.
 */
export const catchUpMonsters = (
  save: CatchUpMonstersSave,
  from: number,
  now: number,
  completed: readonly unknown[],
  options: CatchUpMonstersOptions = {}
): MonsterJob[] => {
  if (save.mapversion === 3 || isMapRoom3Monsters(save.monsters)) return [];

  const mainYard = options.mainYard ?? true;
  const levels = options.levels ?? academyLevels(save.academy);
  const buffs = options.buffs === undefined ? save.storedata : options.buffs;
  const final = save.buildingdata ?? {};
  const jobs = relevantJobs(completed);

  const saved = Number(save.monsters?.saved);
  const stored = Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : from;
  const start = Math.min(now, Math.max(stored, now - MAX_ELAPSED_SECONDS));

  // The timeline the walk runs against.
  const expansion = buffWindows(buffs, completed, EXPANSION);
  const expansionAt = (t: number) => expansion.some((w) => w.start <= t && t < w.end);
  const capacityAt = (t: number, minHealth?: number) =>
    housingCapacity(
      { buildingdata: buildingsAt(final, jobs, t), buildinghealthdata: save.buildinghealthdata },
      expansionAt(t),
      minHealth
    );
  const capacityBreaks = [
    ...jobs.filter((job) => job.t === HOUSING_TYPE).map((job) => job.at),
    ...expansion.flatMap((w) => [w.start, w.end]),
  ].filter((t) => t > start && t <= now);
  const capacity: TimelineStep[] = [start, ...new Set(capacityBreaks)]
    .sort((a, b) => a - b)
    .map((at) => ({ at, value: capacityAt(at) }));

  const overdrive: OverdriveWindow[] = Object.entries(OVERDRIVES).flatMap(([item, power]) =>
    buffWindows(buffs, completed, item).map((w) => ({ ...w, power }))
  );

  const order = hatcheryOrder(save.monsters, final);
  const hatcheries = order.map((id) => {
    const building = final[String(id)];
    if (!building || building.cB || building.cU) return { id, workingFrom: null };
    const health = healthOf(save, String(id), building);
    const half = maxHp(HATCHERY_TYPE, levelOfBuilding(building)) * 0.5;
    if (health !== undefined && health < half) return { id, workingFrom: null };
    return { id, workingFrom: availableFrom(id, jobs, start) };
  });

  const hccEntry = Object.entries(final).find(([, building]) => Number(building?.t) === HCC_TYPE);
  const hccId = hccEntry ? Number(hccEntry[1].id ?? hccEntry[0]) : null;
  const hccHealth = hccEntry ? healthOf(save, hccEntry[0], hccEntry[1]) : undefined;
  const hccWorks =
    hccEntry !== undefined && !hccEntry[1].cB && (hccHealth === undefined || hccHealth > HOUSING_MIN_HEALTH);
  const hccFrom = hccWorks && hccId !== null ? availableFrom(hccId, jobs, start) : null;
  const hccBuilt = jobs.find((job) => job.t === HCC_TYPE && job.kind === "build");

  const result: MonsterJob[] = [];
  const inputFor = (monsters: JsonObject | null | undefined, hcc: number | null) => ({
    monsters,
    hatcheries,
    hccFrom: hcc,
    capacity,
    overdrive,
    levels,
  });

  let monsters: JsonObject | null | undefined = save.monsters;
  const events: ReturnType<typeof simulateProduction>["events"] = [];
  let walkedTo = start;

  // 1. The HCC's completion empties the hatchery queues at the moment it finishes.
  if (mainYard && hccBuilt) {
    const at = Math.min(Math.max(hccBuilt.at, start), now);
    const before = simulateProduction(inputFor(monsters, null), start, at);
    events.push(...before.events);
    walkedTo = at;

    const model = readProduction(before.monsters, order, levels);
    const refunded: Record<string, number> = {};
    let goo = 0;
    for (const hatchery of model.hatcheries) {
      for (const [id, count, level] of hatchery.queue) {
        refunded[id] = (refunded[id] ?? 0) + count;
        goo += count * (hatchCost(id, level) ?? 0);
      }
      hatchery.queue = [];
    }
    monsters = writeProduction(before.monsters, model, at);

    const credited = creditResources(save, { r4: goo }).credited.r4;
    if (goo > 0) {
      result.push({
        kind: "queueRefund",
        id: hccBuilt.id,
        t: HCC_TYPE,
        at,
        detail: { goo: credited, monsters: refunded },
      });
    }
  }

  // 2. Production.
  const walk = simulateProduction(inputFor(monsters, hccFrom), walkedTo, now);
  events.push(...walk.events);
  monsters = walk.monsters;

  const hatched = new Map<string, HatchJob>();
  for (const event of events) {
    if (event.kind !== "hatched") continue;
    const job = hatched.get(event.monster);
    if (job) {
      job.detail.count += 1;
      job.at = event.at;
    } else {
      hatched.set(event.monster, { kind: "hatch", id: event.monster, t: null, at: event.at, detail: { count: 1 } });
    }
  }
  result.push(...hatched.values());

  // 3. Cull: housing still standing (health above 0) is what the original
  // measured. A row with no buildings at all is not a yard whose housing went,
  // it is one the caller did not load: it is never culled.
  const measurable = Object.keys(final).length > 0;
  const { housed, culled } = measurable
    ? cullHousing(monsters.housed as Record<string, number>, capacityAt(now, 0), levels)
    : { housed: monsters.housed as Record<string, number>, culled: {} };
  for (const [id, count] of Object.entries(culled)) {
    result.push({ kind: "cull", id, t: null, at: now, detail: { count } });
  }

  // 4. Write.
  const running = overdrive
    .filter((w) => w.start <= now && now < w.end)
    .sort((a, b) => b.power - a.power)[0];
  save.monsters = {
    ...monsters,
    housed,
    space: capacityAt(now),
    overdrivepower: running?.power ?? 0,
    overdrivetime: running ? running.end - now : 0,
  };

  if (mainYard) dropBuildingCopies(save);

  return result;
};

/** Deletes `rPS`/`rCP`/`rIP`/`mq` from every hatchery and HCC, replacing `buildingdata` only if one was there. */
const dropBuildingCopies = (save: CatchUpMonstersSave) => {
  const buildings = save.buildingdata;
  if (!buildings) return;
  let changed = false;
  const out: BuildingDataMap = { ...buildings };
  for (const [key, building] of Object.entries(buildings)) {
    const type = Number(building?.t);
    if (type !== HATCHERY_TYPE && type !== HCC_TYPE) continue;
    if (!BUILDING_COPIES.some((field) => field in building)) continue;
    const copy = { ...building };
    for (const field of BUILDING_COPIES) delete copy[field];
    out[key] = copy;
    changed = true;
  }
  if (changed) save.buildingdata = out;
};

/** A yard row as the army catch-up reads it, outside `catchUpYard`. */
export interface ArmyRow extends CatchUpMonstersSave {
  savetime?: number;
  points?: string;
}

/**
 * Catches up a yard's monsters only, without writing its buildings or moving
 * its `savetime`: for the map (in memory), for an outpost, and for a yard
 * that the attack paths touch while its own row belongs to someone else.
 *
 * Step 1 runs on a copy, only to learn when buildings finished, so the
 * monsters come out exactly as the next full `catchUpYard` would leave them
 * (§2.3: "the next write catches up for real from the same snapshot").
 *
 * @param row - The yard. Not mutated.
 * @param now - The moment to advance to.
 * @param options - Levels (an outpost's are its owner's), buffs, `mainYard`.
 * @returns The new `monsters`, the new `resources` (the HCC refund on a main
 *   yard), and what happened.
 */
export const catchUpArmy = (
  row: ArmyRow,
  now: number,
  options: CatchUpMonstersOptions = {}
): { monsters: JsonObject | null | undefined; resources: JsonObject | null | undefined; jobs: MonsterJob[] } => {
  const stored = Number(row.savetime);
  const from = Number.isFinite(stored) && stored > 0 ? stored : now;

  const buildings: CatchUpBuildingsSave = {
    buildingdata: row.buildingdata ?? {},
    buildinghealthdata: row.buildinghealthdata,
    storedata: row.storedata ? { ...row.storedata } : row.storedata,
    points: row.points ?? "0",
  };
  const completed = catchUpBuildings(buildings, from, now);

  const copy: CatchUpMonstersSave = {
    monsters: row.monsters,
    academy: row.academy,
    resources: row.resources,
    mapversion: row.mapversion,
    outposts: row.outposts,
    buildingdata: buildings.buildingdata,
    buildinghealthdata: row.buildinghealthdata,
    storedata: buildings.storedata,
  };
  const jobs = catchUpMonsters(copy, from, now, completed, options);

  return { monsters: copy.monsters, resources: copy.resources, jobs };
};
