import { Tribe, Tribes } from "../../../enums/Tribes.js";
import type { SaveData } from "../../../types/EntityData.js";
import { abunaki } from "../../../game-data/tribes/v2/abunaki.js";
import { dreadnaught } from "../../../game-data/tribes/v2/dreadnaught.js";
import { kozu } from "../../../game-data/tribes/v2/kozu.js";
import { legionnaire } from "../../../game-data/tribes/v2/legionnaire.js";
import { savedTribeLevels } from "../../../game-data/tribes/v2/levels/index.js";
import { minimumTribeLevels } from "./calculateTribeLevel.js";

/**
 * The Map Room 2 wild monster camps' yards, by tribe and level.
 *
 * Each tribe has a few original layouts (`game-data/tribes/v2/<tribe>.ts`,
 * keyed 0, 1, 2, …). They used to be picked by splitting the tribe's levels
 * (its minimum up to 45) into equal bands, one per layout: Legionnaire 25-31,
 * 32-38 and 39-44; Kozu 29-36 and 37-44; Abunakki and Dreadnaut 25-34 and
 * 35-44. Each original layout now stands at the first level of its band
 * ({@link originalLayoutLevels}).
 *
 * The tribe yard editor (local servers only, `controllers/tribeEditor`) saves
 * a yard for any single level into `game-data/tribes/v2/levels/<tribe>.ts`,
 * which replaces the yard at exactly that level.
 *
 * A camp uses the yard saved for its own level or, when its level has none,
 * the nearest one below it ({@link tribeLayoutFor}). With no per-level saves
 * that is exactly the old banding, so today's camps keep their yards.
 */

/** The level every tribe's camps stop below (`calculateTribeLevel.ts`). */
export const TRIBE_LEVEL_CAP = 45;

/** The Map Room 2 tribes, in `Tribes` order, by the short id the editor and the data files use. */
export const TRIBE_IDS = ["legionnaire", "kozu", "abunaki", "dreadnaught"] as const;
export type TribeId = (typeof TRIBE_IDS)[number];

/** The `Tribe` enum value for each id. */
export const TRIBE_OF: Readonly<Record<TribeId, Tribe>> = {
  legionnaire: Tribe.LEGIONNAIRE,
  kozu: Tribe.KOZU,
  abunaki: Tribe.ABUNAKKI,
  dreadnaught: Tribe.DREADNAUT,
};

/** The original layouts of each tribe, keyed 0, 1, 2, … */
const ORIGINAL_LAYOUTS: Readonly<Record<TribeId, Record<number, SaveData>>> = {
  legionnaire,
  kozu,
  abunaki,
  dreadnaught,
};

export const isTribeId = (value: unknown): value is TribeId =>
  typeof value === "string" && (TRIBE_IDS as readonly string[]).includes(value);

/** The tribe id for a `Tribes` index (0 Legionnaire … 3 Dreadnaut). */
export const tribeIdAt = (tribeIndex: number): TribeId => {
  const id = TRIBE_IDS[tribeIndex];
  if (!id || TRIBE_OF[id] !== Tribes[tribeIndex]) throw new Error(`No Map Room 2 tribe at index ${tribeIndex}`);
  return id;
};

/** The lowest level a tribe's camps have. */
export const lowestTribeLevel = (tribe: TribeId): number => minimumTribeLevels[TRIBE_OF[tribe]];

/** The levels a tribe's camps can have: its minimum up to 44. */
export const tribeLevels = (tribe: TribeId): number[] => {
  const levels: number[] = [];
  for (let level = lowestTribeLevel(tribe); level < TRIBE_LEVEL_CAP; level++) levels.push(level);
  return levels;
};

/**
 * The level each original layout stands at: the first level of the band the
 * old equal split gave it (`levelsPerKey = ceil((45 - min) / layouts)`).
 */
export const originalLayoutLevels = (tribe: TribeId): Map<number, SaveData> => {
  const layouts = ORIGINAL_LAYOUTS[tribe];
  const keys = Object.keys(layouts)
    .map(Number)
    .sort((a, b) => a - b);
  const lowest = lowestTribeLevel(tribe);
  const levelsPerKey = Math.ceil((TRIBE_LEVEL_CAP - lowest) / keys.length);
  const byLevel = new Map<number, SaveData>();
  keys.forEach((key, index) => byLevel.set(lowest + index * levelsPerKey, layouts[key]));
  return byLevel;
};

/**
 * Yards saved by the editor while this server runs, on top of the data files
 * the server started with: a save shows at once, without a restart.
 */
const savedThisRun: Record<TribeId, Record<number, SaveData>> = {
  legionnaire: {},
  kozu: {},
  abunaki: {},
  dreadnaught: {},
};

/** The yards saved per level for a tribe: the data file's, then this run's on top. */
export const savedLayouts = (tribe: TribeId): Record<number, SaveData> => ({
  ...(savedTribeLevels[tribe] ?? {}),
  ...savedThisRun[tribe],
});

/** Every yard a tribe has, by the level it stands at: the originals, then the saved ones over them. */
export const tribeLayoutsByLevel = (tribe: TribeId): Map<number, SaveData> => {
  const byLevel = originalLayoutLevels(tribe);
  for (const [level, save] of Object.entries(savedLayouts(tribe))) byLevel.set(Number(level), save);
  return byLevel;
};

/** Where a level's yard comes from: the level it was saved at, and whether that was an editor save. */
export interface TribeLayoutPick {
  /** The level the yard stands at: `level` itself or the nearest below it. */
  readonly from: number;
  readonly save: SaveData;
  /** True for a yard the editor saved; false for an original layout. */
  readonly saved: boolean;
}

/**
 * The yard a camp of this tribe and level uses: the one at its level, or the
 * nearest one below it. A level below every yard (never a real camp's) takes
 * the lowest.
 */
export const tribeLayoutFor = (tribe: TribeId, level: number): TribeLayoutPick => {
  const byLevel = tribeLayoutsByLevel(tribe);
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  let from = levels[0]!;
  for (const candidate of levels) if (candidate <= level) from = candidate;
  return { from, save: byLevel.get(from)!, saved: from in savedLayouts(tribe) };
};

/** Records a yard the editor saved, so camps use it straight away. */
export const rememberSavedLayout = (tribe: TribeId, level: number, save: SaveData): void => {
  savedThisRun[tribe][level] = save;
};

/** Forgets this run's saves (tests). */
export const forgetSavedLayouts = (): void => {
  for (const tribe of TRIBE_IDS) savedThisRun[tribe] = {};
};
