import { KRALLEN_AURA_LEVEL, krallenAuraRadius, lootAuraBonus } from "@/game/combat/rules/champions";
import { LOOT_PROPERTY_BASE, LOOT_PROPERTY_BONUS } from "@/game/combat/rules/stats";

/**
 * Krallen's loot aura from the Krallen Hunt's 3x mark (owner, 13 Nov 2026,
 * server `game-data/events/events.ts`, `KRALLEN_AURA_GOAL_TIMES`): kept on
 * her `champion` entry as `la`, the unix second it runs out, which only the
 * server writes. She fights with it from her level 3
 * ({@link KRALLEN_AURA_LEVEL}); the server's replay decides the loot.
 */

/** Krallen's champion type. */
const KRALLEN = 5;

/** The slice of a champion entry this reads. */
export interface AuraEntry {
  readonly t?: unknown;
  readonly l?: unknown;
  readonly la?: unknown;
}

/** When an entry's aura runs out (unix s), 0 for none or for any champion but Krallen. */
export const krallenAuraUntil = (entry: AuraEntry | null | undefined): number => {
  if (!entry || Number(entry.t) !== KRALLEN) return 0;
  const until = Number(entry.la);
  return Number.isFinite(until) && until > 0 ? Math.floor(until) : 0;
};

/** Whether Krallen's aura is running at `now` (unix s), whatever her level. */
export const krallenAuraRuns = (entry: AuraEntry | null | undefined, now: number | null | undefined): boolean =>
  typeof now === "number" && Number.isFinite(now) && krallenAuraUntil(entry) > now;

/** Whether she fights with it at `now`: running and her level 3 or more. */
export const krallenAuraActive = (entry: AuraEntry | null | undefined, now: number | null | undefined): boolean =>
  krallenAuraRuns(entry, now) && Math.floor(Number(entry?.l) || 0) >= KRALLEN_AURA_LEVEL;

/**
 * How many times more an ordinary monster near her loots at her `level`:
 * its 0.5 plus the aura's bonus, over 0.5 (`lootAuraBonus`); 1 below level 3.
 * "x2", "x2.8", "x3.6" at levels 3, 4 and 5.
 */
export const krallenAuraTimes = (level: number): number =>
  Math.round(((LOOT_PROPERTY_BASE + lootAuraBonus(level)) / LOOT_PROPERTY_BASE) * 10) / 10;

/**
 * The same for a resource hunter or another champion, whose looting value is
 * already 2.0 (`LOOT_PROPERTY_BASE + LOOT_PROPERTY_BONUS`, the rules' looter
 * value): "x1.25", "x1.45", "x1.65" at levels 3, 4 and 5.
 */
export const krallenAuraTimesLooter = (level: number): number => {
  const looter = LOOT_PROPERTY_BASE + LOOT_PROPERTY_BONUS;
  return Math.round(((looter + lootAuraBonus(level)) / looter) * 100) / 100;
};

export { KRALLEN_AURA_LEVEL, krallenAuraRadius };
