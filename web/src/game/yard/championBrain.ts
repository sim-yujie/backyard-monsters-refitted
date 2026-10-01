import { BRAIN_KEYS, parseBrain, parseBrainStats, type BrainKey } from "@/game/combat/rules";

/**
 * A champion's learned brain in plain words (issue #219), for the Champion
 * Cage: what it has come to prefer, strongest first, from the weights its own
 * attacks taught it (`combat/rules/brain.ts`).
 */

/** A weight this far from 0, either way, is a tendency worth naming. */
export const TENDENCY_THRESHOLD = 50;

/** How many tendencies the cage names at most. */
export const TENDENCY_LIMIT = 3;

/** Each feature's words: for a weight above the threshold, and below its negative. */
const WORDS: Readonly<Record<BrainKey, readonly [string, string]>> = {
  tower: ["Goes for towers", "Steers clear of towers"],
  loot: ["Loves loot", "Ignores loot"],
  finish: ["Finishes off the wounded", "Picks fresh targets"],
  focus: ["Sticks with the pack", "Goes its own way"],
  // Threat is a penalty: a higher weight keeps it further from tower fire.
  threat: ["Cautious near towers", "Shrugs off tower fire"],
};

export interface BrainSummary {
  /** The tendencies, strongest first; empty while it is still learning. */
  readonly tendencies: readonly string[];
  /** Attacks it has learned from. */
  readonly attacks: number;
}

/**
 * The tendencies a champion's brain shows, strongest first, ties in the
 * features' own order.
 *
 * @param entry - The champion's save entry; its `b` and `bs` are read, safely.
 */
export const brainSummary = (entry: { readonly b?: unknown; readonly bs?: unknown }): BrainSummary => {
  const brain = parseBrain(entry.b);
  const ranked = BRAIN_KEYS.map((key, order) => ({ key, order, weight: brain[key] }))
    .filter(({ weight }) => Math.abs(weight) >= TENDENCY_THRESHOLD)
    .sort((one, other) => Math.abs(other.weight) - Math.abs(one.weight) || one.order - other.order)
    .slice(0, TENDENCY_LIMIT);
  return {
    tendencies: ranked.map(({ key, weight }) => WORDS[key][weight > 0 ? 0 : 1]),
    attacks: parseBrainStats(entry.bs).n,
  };
};

/** The cage's one line: its tendencies, or that it is still learning. */
export const tendenciesText = (summary: BrainSummary): string =>
  summary.tendencies.length > 0 ? summary.tendencies.join(" · ") : "Still learning";

/** How much it has learned from, in words. */
export const learnedFromText = (summary: BrainSummary): string =>
  summary.attacks === 0
    ? "It learns from every attack it fights in."
    : `Learned from ${summary.attacks} attack${summary.attacks === 1 ? "" : "s"}.`;
