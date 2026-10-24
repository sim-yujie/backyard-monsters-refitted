import type { YardKind } from "../../game-data/buildingCosts.js";
import type { BuildingData, BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { levelOf, townHallLevel } from "../yardplanner/costs.js";
import { finishBuildingJob, runningCountdown } from "./buildingJobs.js";
import type { BuildingJob } from "./catchUpBuildings.js";
import { healed } from "./repair.js";
import { yardRefusedErr } from "./yardErrors.js";

/**
 * The Shop's wall upgrades, `BLK2` .. `BLK5` (Stone, Metal, Gold and Black
 * Diamond Blocks): one purchase raises every Block below the tier to it
 * (`client/scripts/STORE.as:404-519` prices it, `:1993-2005` applies it).
 *
 * - Price: Shiny per Block, summed over every level it climbs: 3 to reach
 *   level 2, 6 to reach 3, 10 to reach 4, 15 to reach 5. A Block still being
 *   built counts as level 1, so a new one taken to Gold costs 3 + 6 + 10 = 19.
 * - Town Hall: Stone needs Town Hall 3, Metal 4, Gold 5, Black Diamond 6
 *   (`STORE.as:1674-1690`). An outpost has no such gate (Flash read it as
 *   Town Hall 7) and sells all four (`:199`).
 * - Applying it: a Block below the tier first finishes the build or upgrade it
 *   had running, then climbs one level at a time, each level awarding its
 *   points as `Upgraded()` does, through the catch-up's own finish
 *   (`finishBuildingJob`). Each upgrade also heals the Block to full
 *   (`BFOUNDATION.Upgraded()` calls `setHealth(maxHealth)`), so a damaged or
 *   repairing Block comes out whole.
 *
 * One change from Flash: Flash also finished the countdowns of Blocks that
 * were already at the tier or above. Here those are left alone, so a
 * 3-Shiny Stone purchase cannot rush a yard's long Black Diamond upgrades.
 */

/** The Block (`client/scripts/YARD_PROPS.as`, BWALL). */
export const WALL_TYPE = 17;
/** The legacy Stone Block row: Flash rewrote it to `t: 17, l: 2` on load (`BASE.as:1523-1526`). */
export const LEGACY_WALL_TYPE = 18;

/** The tier each item raises the Blocks to. */
export const WALL_BLOCK_ITEMS: Readonly<Record<string, number>> = { BLK2: 2, BLK3: 3, BLK4: 4, BLK5: 5 };

/** Shiny per Block to climb into level `n` (index = n). */
export const WALL_STEP_SHINY: readonly number[] = [0, 0, 3, 6, 10, 15];

/** The Town Hall level each tier needs in the main yard. */
export const WALL_TIER_TOWN_HALL: Readonly<Record<number, number>> = { 2: 3, 3: 4, 4: 5, 5: 6 };

/** A Block's level for pricing: a running build is level 1, a legacy Stone row at least 2. */
export const blockLevel = (building: BuildingData): number => {
  const level = Math.max(1, levelOf(building));
  return Number(building.t) === LEGACY_WALL_TYPE ? Math.max(2, level) : level;
};

/** Shiny to take one Block from `from` to `tier`; 0 when it is already there. */
export const blockPrice = (from: number, tier: number): number => {
  let shiny = 0;
  for (let level = Math.max(1, from) + 1; level <= tier; level++) shiny += WALL_STEP_SHINY[level] ?? 0;
  return shiny;
};

const isBlock = (building: BuildingData | undefined): building is BuildingData =>
  building != null && (Number(building.t) === WALL_TYPE || Number(building.t) === LEGACY_WALL_TYPE);

/** The Blocks below `tier`, keyed as in `buildingdata`. */
const blocksBelow = (buildingdata: BuildingDataMap | null | undefined, tier: number): [string, BuildingData][] =>
  Object.entries(buildingdata ?? {}).filter(
    (entry): entry is [string, BuildingData] => isBlock(entry[1]) && blockLevel(entry[1]) < tier,
  );

/** What a tier would cost and change right now, for the Shop and the route. */
export interface WallBlockQuote {
  tier: number;
  /** Blocks it would raise. */
  blocks: number;
  /** Shiny it would take. */
  shiny: number;
}

export const quoteWallBlocks = (buildingdata: BuildingDataMap | null | undefined, tier: number): WallBlockQuote => {
  const below = blocksBelow(buildingdata, tier);
  const shiny = below.reduce((sum, [, block]) => sum + blockPrice(blockLevel(block), tier), 0);
  return { tier, blocks: below.length, shiny };
};

export interface WallBlockSave {
  buildingdata?: BuildingDataMap | null;
  buildinghealthdata?: BuildingHealthData | null;
}

export interface WallBlockPlan extends WallBlockQuote {
  buildingdata: BuildingDataMap;
  /** Only when a raised Block had damage on record. */
  buildinghealthdata: BuildingHealthData | null;
  points: number;
  /** Every build and upgrade the purchase finished, for the achievements. */
  jobs: BuildingJob[];
}

/**
 * Works out a wall upgrade. Refusals: `409 townHall {have, need}` in a main
 * yard below the tier's Town Hall, `409 nothingToUpgrade {tier}` when every
 * Block is at the tier already (or the yard has none). Shiny lock and balance
 * are the wrapper's.
 */
export const planWallBlocks = (save: WallBlockSave, tier: number, now: number, kind: YardKind): WallBlockPlan => {
  if (kind === "main") {
    const have = townHallLevel(save.buildingdata, kind);
    const need = WALL_TIER_TOWN_HALL[tier] ?? 0;
    if (have < need) {
      throw yardRefusedErr("townHall", `Those Blocks need Town Hall level ${need}.`, { have, need });
    }
  }

  const quote = quoteWallBlocks(save.buildingdata, tier);
  if (quote.blocks === 0) {
    throw yardRefusedErr("nothingToUpgrade", "Every Block is that good already.", { tier });
  }

  const buildingdata: BuildingDataMap = { ...save.buildingdata };
  let health: BuildingHealthData | null = null;
  let points = 0;
  const jobs: BuildingJob[] = [];

  for (const [key, original] of blocksBelow(save.buildingdata, tier)) {
    let block: BuildingData = healed(original);
    if (Number(block.t) === LEGACY_WALL_TYPE) block = { ...block, t: WALL_TYPE, l: blockLevel(original) };
    if (save.buildinghealthdata && String(block.id) in save.buildinghealthdata) {
      health ??= { ...save.buildinghealthdata };
      delete health[String(block.id)];
    }

    const running = runningCountdown(block);
    if (running) {
      const done = finishBuildingJob(block, running, now, kind);
      block = done.building;
      points += done.job.detail.points;
      jobs.push(done.job);
    }
    while (levelOf(block) < tier) {
      const done = finishBuildingJob(block, "cU", now, kind);
      if (levelOf(done.building) <= levelOf(block)) break;
      block = done.building;
      points += done.job.detail.points;
      jobs.push(done.job);
    }
    buildingdata[key] = block;
  }

  return { ...quote, buildingdata, buildinghealthdata: health, points, jobs };
};
