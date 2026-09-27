import { productionOf } from "../../../game-data/buildingCosts.js";

/**
 * Harvester production: the arithmetic of one Twig Snapper, Pebble Shiner,
 * Putty Squisher or Goo Factory filling its own buffer
 * (`docs/specs/base-building.md` §4 "Production";
 * `docs/design/yard-buildings.md` §5.1).
 *
 * Two readers share it, which is why it lives here and not in either:
 *
 * - the economy audit's upper bound on what a yard could have banked since
 *   its last save (`bufferCeiling`, read by `harvestAllowance` in
 *   `resourceBudget.ts`), and
 * - the yard catch-up, which grows every harvester's buffer exactly
 *   (`services/yard/catchUpHarvesters.ts`) and restarts one the player banks
 *   (`services/yard/bank.ts`).
 *
 * The original (`client/scripts/BRESOURCE.as`) runs one cycle at a time: after
 * `productionTimeout` seconds it adds `productionValue` to `_stored`, up to
 * `productionCapacity`, and stops (`_producing = 0`) once full. A save keeps
 * the buffer as `st`, the producing flag as `pr` and the seconds left of the
 * current cycle as `cP` (`Export`, `:481-493`; `Setup`, `:520-523`).
 *
 * Everything here is pure: no save, no clock.
 */

/** Twig Snapper, Pebble Shiner, Putty Squisher, Goo Factory: type id = resource index. */
export const HARVESTER_TYPES = [1, 2, 3, 4] as const;

/** True for the four harvester types. */
export const isHarvester = (type: number): boolean =>
  (HARVESTER_TYPES as readonly number[]).includes(type);

/** Anything that is not a finite number reads as zero. */
const numberOf = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};

/** A production ladder entry at a level, clamped to the ends of the array. */
const atLevel = (ladder: readonly number[] | undefined, level: number): number => {
  if (!ladder || ladder.length === 0) return 0;
  const index = Math.min(Math.max(Math.trunc(level), 1), ladder.length) - 1;
  return numberOf(ladder[index]);
};

/** One harvester's figures at its level and health. */
export interface HarvesterRates {
  /** Added to the buffer per finished cycle, before any Production Overdrive. */
  produce: number;
  /** Seconds per cycle at this health, at least 1. */
  cycle: number;
  /** The buffer's size: production stops when it is reached. */
  capacity: number;
}

/**
 * The cycle length at a health: `cycleTime + ceil(cycleTime × (4 − 4 / maxHealth × health))`
 * (`productionTimeout`, `client/scripts/BRESOURCE.as:384-386`). At full health
 * that is `cycleTime`; at half health three times it. Health above the maximum
 * counts as full, and an unknown maximum leaves the cycle at `cycleTime`.
 */
export const cycleSeconds = (cycleTime: number, health?: number, maxHealth?: number): number => {
  const base = Math.max(1, cycleTime);
  if (health === undefined || maxHealth === undefined || !(maxHealth > 0)) return base;
  const ratio = Math.min(Math.max(health, 0), maxHealth) / maxHealth;
  return base + Math.ceil(base * (4 - 4 * ratio));
};

/**
 * A harvester's figures at `level`, or null for a type that produces nothing.
 *
 * @param health - Current health; omit for full.
 * @param maxHealth - Health at full for this level (`maxHp`).
 */
export const harvesterRates = (
  type: number,
  level: number,
  health?: number,
  maxHealth?: number
): HarvesterRates | null => {
  const production = productionOf(type);
  if (!production) return null;
  return {
    produce: atLevel(production.produce, level),
    cycle: cycleSeconds(atLevel(production.cycleTime, level), health, maxHealth),
    capacity: atLevel(production.capacity, level),
  };
};

/**
 * Whether a harvester runs at all at this health: at least half of its maximum
 * and above zero (`_canFunction = health >= maxHealth * 0.5`,
 * `client/scripts/BRESOURCE.as:302`; `StartProduction` needs `health > 0`,
 * `:367`). Unknown health is full health.
 */
export const canProduce = (health?: number, maxHealth?: number): boolean => {
  if (health === undefined) return true;
  if (health <= 0) return false;
  return maxHealth === undefined || !(maxHealth > 0) || health >= maxHealth * 0.5;
};

/**
 * How many cycles finish in `elapsed` seconds when the first ends after
 * `untilFirst` and each later one after `cycle`.
 */
export const cyclesIn = (elapsed: number, untilFirst: number, cycle: number): number => {
  const time = Math.max(0, elapsed);
  if (time < untilFirst) return 0;
  return 1 + Math.floor((time - Math.max(0, untilFirst)) / Math.max(1, cycle));
};

/**
 * The most a harvester's buffer could hold after `elapsed` seconds: the buffer
 * it was saved with, plus every whole cycle since and one more for the cycle
 * that was already part-way through, capped at the level's buffer
 * (`client/scripts/BRESOURCE.as:384-386`, `:424-439`, `:497`).
 *
 * The audit's bound. A harvester is halted while a countdown runs and stops
 * below half health (`:301-302`), both of which only ever make it produce
 * less, so ignoring them keeps this an upper bound.
 */
export const bufferCeiling = (
  type: number,
  level: number,
  storedBuffer: number,
  elapsed: number
): number => {
  const rates = harvesterRates(type, level);
  if (!rates) return 0;
  const cycles = cyclesIn(elapsed, 0, rates.cycle);
  return Math.min(rates.capacity, Math.max(0, storedBuffer) + cycles * rates.produce);
};

/** A buffer and where its current cycle stands. */
export interface HarvesterBuffer {
  /** What the buffer holds, `st`. */
  stored: number;
  /**
   * Seconds until the current cycle adds to the buffer, `cP`; null when the
   * harvester is not producing (`pr: 0`), which a full one never is.
   */
  countdown: number | null;
}

/**
 * Runs a harvester for `elapsed` seconds: the exact form of the original's
 * offline replay (`Tick`, `client/scripts/BRESOURCE.as:305-322`).
 *
 * A buffer at or over its capacity is clamped to it and stops (`:330-333`). One
 * that is below it and not producing starts a fresh cycle at the start of the
 * window, as the original's next tick does (`StartProduction`, `:363-372`).
 * Otherwise the cycle already under way finishes first, then whole cycles
 * follow, each adding `produce × power` (`power` is the Production Overdrive's
 * 2 while it runs, else 1), until the buffer is full or the time runs out.
 *
 * Running it for 0 seconds changes nothing but that clamp and that start, and
 * running it twice for `a` and then `b` seconds is the same as once for `a + b`.
 */
export const runHarvester = (
  buffer: HarvesterBuffer,
  rates: HarvesterRates,
  elapsed: number,
  power = 1
): HarvesterBuffer => {
  const stored = Math.max(0, buffer.stored);
  if (stored >= rates.capacity) return { stored: rates.capacity, countdown: null };

  const cycle = Math.max(1, rates.cycle);
  const first = buffer.countdown !== null && buffer.countdown > 0 ? buffer.countdown : cycle;
  const time = Math.max(0, elapsed);
  if (time < first) return { stored, countdown: first - time };

  const cycles = cyclesIn(time, first, cycle);
  const after = Math.min(rates.capacity, stored + cycles * rates.produce * power);
  if (after >= rates.capacity) return { stored: after, countdown: null };

  const intoCycle = (time - first) % cycle;
  return { stored: after, countdown: cycle - intoCycle };
};
