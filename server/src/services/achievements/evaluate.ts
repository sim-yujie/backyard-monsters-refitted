import {
  AVAILABLE_ACHIEVEMENTS,
  type AchievementDef,
  type AchievementStat,
} from "../../game-data/achievements.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { readOnboarding } from "../onboarding/state.js";
import { STARTER_MONSTER } from "../yard/locker.js";
import { MAP_ROOM_MAX_LEVEL, mapRoomLevel } from "../yard/mapRoom.js";
import { levelOf, townHallLevel } from "../yardplanner/costs.js";
import { needsBackfill, readAchievements, type Achievements, type AchievementStats } from "./state.js";

/**
 * Counting and unlocking achievements (`docs/design/achievements.md` §7, §8,
 * issue #204): pure functions of the record and a read-only view of the
 * player's main save. Callers (WP2, WP3) build the view, run
 * {@link evaluateAchievements} under the main row's lock, store the record and
 * credit the Shiny in the same transaction.
 *
 * Two kinds of stat (§7.1):
 *
 * - **Derived** stats are read from what the server already holds each time:
 *   Town Hall, Map Room 2, champions, Locker unlocks, the four resources, and
 *   two counters `onboarding` already keeps (`juiced`, `tribes.kozu`). The
 *   stored value becomes the larger of the two, so a stat never drops.
 * - **Event** stats cannot be read from the yard afterwards, so the caller
 *   hands them in as `events` and they are added.
 *
 * Only data the server itself writes is read. `save.stats` and Flash's own
 * records (`stats.achievements`, `quests`, `wmstatus`) are never read: the
 * client wrote them (D1, Q5).
 */

/** Building types the stats read. */
const BLOCK_TYPE = 17;
const HEAVY_TRAP_TYPE = 117;

/** Champion save types: Gorgo, Drull, Fomor (`championCatalogue.ts`). */
const CHAMPION_STATS: readonly [AchievementStat, number][] = [
  ["upgrade_champ1", 1],
  ["upgrade_champ2", 2],
  ["upgrade_champ3", 3],
];

/** A fully evolved champion (`CHAMPIONCAGE.as:597`, `:807`, `:852`). */
const CHAMPION_TOP_LEVEL = 6;

/** "More than" this of each resource (`BASE.as:4725-4726`). */
const STOCKPILE_THRESHOLD = 25_000_000;

/**
 * What the evaluator reads: the player's **main** save (never an outpost seen
 * through `poolView`, whose `buildingdata` is the outpost's), plus two things
 * only the backfill needs, which the caller reads from other rows.
 */
export interface AchievementView {
  buildingdata?: BuildingDataMap | null;
  champion?: unknown;
  lockerdata?: JsonObject | null;
  resources?: JsonObject | null;
  mapversion?: number | null;
  /** The main row's outpost list; any entry means one is owned. */
  outposts?: unknown[] | null;
  /** Read for its server-side counters only. */
  onboarding?: unknown;
  /** Backfill only: the `buildingdata` of each outpost the player owns. */
  outpostBuildings?: readonly (BuildingDataMap | null | undefined)[];
  /** Backfill only: any of the player's Map Room 1 Kozu tribes still marked destroyed. */
  mr1KozuDestroyed?: boolean;
}

/** Event stats to add (§7.1): Block and Heavy Trap builds, takeovers, a Starter Kit, a Kozu hall. */
export type AchievementEvents = Partial<Record<AchievementStat, number>>;

/** One achievement this evaluation unlocked. */
export interface AchievementUnlock {
  id: number;
  name: string;
  shiny: number;
  /** Found by the first read's backfill: one summary pop-up for all of them (§8). */
  backfill?: true;
}

export interface AchievementEvaluation {
  /** The record to store: a new object, the input is untouched. */
  record: Achievements;
  unlocked: AchievementUnlock[];
  /** The Shiny to credit: the sum of `unlocked`. */
  shiny: number;
  /** Whether `record` differs from the input, so it needs writing. */
  changed: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The highest level of a champion of save type `type`; 0 when none was ever hatched. */
const championLevel = (champions: unknown, type: number): number => {
  if (!Array.isArray(champions)) return 0;
  let best = 0;
  for (const champion of champions) {
    if (!isRecord(champion) || Math.trunc(Number(champion.t)) !== type) continue;
    const level = Math.trunc(Number(champion.l));
    best = Math.max(best, Number.isFinite(level) && level > 0 ? level : 1);
  }
  return best;
};

/** Monsters unlocked in the Locker, the free Pokey (#218) left out. */
const unlockedMonsters = (lockerdata: JsonObject | null | undefined): number =>
  Object.entries(lockerdata ?? {}).filter(
    ([id, entry]) => id !== STARTER_MONSTER && isRecord(entry) && Number(entry.t) === 2
  ).length;

/** Whether every one of r1-r4 is above the threshold. */
const stockpiled = (resources: JsonObject | null | undefined): boolean =>
  (["r1", "r2", "r3", "r4"] as const).every((key) => Number(resources?.[key]) > STOCKPILE_THRESHOLD);

/** Finished buildings of `type`. */
const standing = (buildingdata: BuildingDataMap | null | undefined, type: number): number =>
  Object.values(buildingdata ?? {}).filter(
    (building) => building && Number(building.t) === type && levelOf(building) > 0
  ).length;

/** Finished buildings of `type` in the main yard and every outpost. */
const standingEverywhere = (view: AchievementView, type: number): number =>
  [view.buildingdata, ...(view.outpostBuildings ?? [])].reduce((sum, yard) => sum + standing(yard, type), 0);

/**
 * The derived stats (§7.1): what the main save shows now. Only the stats it
 * can read are present.
 */
export const deriveStats = (view: AchievementView): Partial<AchievementStats> => {
  const counters = readOnboarding({ onboarding: view.onboarding }).counters;
  const stats: Partial<AchievementStats> = {
    thlevel: townHallLevel(view.buildingdata, "main"),
    map2:
      mapRoomLevel(view.buildingdata) >= MAP_ROOM_MAX_LEVEL ||
      view.mapversion === MapRoomVersion.V2 ||
      view.mapversion === MapRoomVersion.V3
        ? 1
        : 0,
    monstersblended: counters.juiced,
    wm2hall: counters.tribes.kozu > 0 ? 1 : 0,
    unlock_monster: unlockedMonsters(view.lockerdata),
    stockpile: stockpiled(view.resources) ? 1 : 0,
  };
  for (const [stat, type] of CHAMPION_STATS) {
    stats[stat] = championLevel(view.champion, type) >= CHAMPION_TOP_LEVEL ? 1 : 0;
  }
  return stats;
};

/**
 * What the first read can prove beyond the derived stats (§8): Blocks and
 * Heavy Traps standing now (a lower bound), an outpost owned (approximate:
 * most first outposts are camps), and a Map Room 1 Kozu tribe still marked
 * destroyed. Player outposts and Starter Kits leave no trace and stay 0.
 */
export const backfillStats = (view: AchievementView): Partial<AchievementStats> => ({
  blocksbuilt: standingEverywhere(view, BLOCK_TYPE),
  heavytraps: standingEverywhere(view, HEAVY_TRAP_TYPE),
  wmoutpost: (view.outposts?.length ?? 0) > 0 ? 1 : 0,
  wm2hall: view.mr1KozuDestroyed ? 1 : 0,
});

/** Backfill stats read from the yard as it stands, which already holds this request's event. */
const SNAPSHOT_STATS = Object.keys(backfillStats({})) as AchievementStat[];

/** Raises each stat to `stats`' value where that is higher. */
const raise = (into: AchievementStats, stats: Partial<AchievementStats>): void => {
  for (const [stat, value] of Object.entries(stats) as [AchievementStat, number][]) {
    if (value > into[stat]) into[stat] = value;
  }
};

/** Whether the entry's rule holds for these stats. */
export const achievementMet = (entry: AchievementDef, stats: AchievementStats): boolean => {
  const met = (rule: AchievementDef["rules"][number]) => stats[rule.stat] >= rule.target;
  return entry.mode === "any" ? entry.rules.some(met) : entry.rules.every(met);
};

/** Unlocks every available entry now met and not yet in `c`. */
const unlockMet = (record: Achievements, now: number, backfill: boolean): AchievementUnlock[] => {
  const unlocked: AchievementUnlock[] = [];
  for (const entry of AVAILABLE_ACHIEVEMENTS) {
    const key = String(entry.id);
    if (record.c[key] !== undefined || !achievementMet(entry, record.s)) continue;
    record.c[key] = backfill ? { at: now, shiny: entry.shiny, backfill: 1 } : { at: now, shiny: entry.shiny };
    unlocked.push({ id: entry.id, name: entry.name, shiny: entry.shiny, ...(backfill && { backfill: true as const }) });
  }
  return unlocked;
};

/**
 * Folds the derived stats and `events` into the record and unlocks every
 * available entry now met (§7.2). An entry already in `c` is never unlocked or
 * paid again; unavailable entries are never looked at.
 *
 * A record never worked out (`backfilledAt` absent, §8) is backfilled first:
 * whatever the save already proves unlocks marked `backfill`, then
 * `backfilledAt` is set. In that run an event for a stat the backfill reads
 * from the yard (a Block that just finished is already standing) raises
 * rather than adds, so it is not counted twice. Unlocks only `events` bring
 * about are ordinary ones.
 *
 * @param record - As read by `readAchievements`; not mutated.
 * @param view - The player's main save and, for the backfill, the extra reads.
 * @param now - Unix seconds.
 * @param events - Event stats to add.
 */
export const evaluateAchievements = (
  record: Achievements,
  view: AchievementView,
  now: number,
  events: AchievementEvents = {}
): AchievementEvaluation => {
  const next = structuredClone(record);
  const unlocked: AchievementUnlock[] = [];
  raise(next.s, deriveStats(view));

  const backfilling = needsBackfill(next);
  if (backfilling) {
    raise(next.s, backfillStats(view));
    unlocked.push(...unlockMet(next, now, true));
    next.backfilledAt = now;
  }

  for (const [stat, delta] of Object.entries(events) as [AchievementStat, number | undefined][]) {
    if (delta === undefined || !Number.isFinite(delta) || delta <= 0) continue;
    const add = Math.floor(delta);
    if (backfilling && SNAPSHOT_STATS.includes(stat)) next.s[stat] = Math.max(next.s[stat], add);
    else next.s[stat] += add;
  }
  unlocked.push(...unlockMet(next, now, false));

  return {
    record: next,
    unlocked,
    shiny: unlocked.reduce((sum, unlock) => sum + unlock.shiny, 0),
    changed: JSON.stringify(next) !== JSON.stringify(record),
  };
};

/**
 * What the backfill makes of a save never worked out, without storing
 * anything: the public view of a player or bot whose record is still `NULL`
 * (§8, §9.2).
 */
export const backfillAchievements = (view: AchievementView, now: number): AchievementEvaluation =>
  evaluateAchievements(readAchievements({}), view, now);
