import type { Resources } from "@/api/types";
import type { BombStats } from "@/game/combat/rules";

/**
 * The attacker's own resources during an attack: what Catapult bombs are
 * bought from, and what the HUD shows while the attack runs (issue #92).
 *
 * Pure arithmetic, so the drop package can keep one pool and hand the same
 * numbers to the Catapult panel and the HUD without either keeping a copy.
 */

/** Twigs, pebbles and putty: the three resources a bomb can cost. */
export type AttackerPool = { readonly r1: number; readonly r2: number; readonly r3: number };

/** The bomb resources from a resources block; anything unreadable is 0. Null for no block. */
export const poolOf = (
  resources: Record<string, number | undefined> | undefined | null,
): AttackerPool | null => {
  if (!resources) return null;
  const read = (key: string): number => {
    const value = resources[key];
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  };
  return { r1: read("r1"), r2: read("r2"), r3: read("r3") };
};

/** The pool after `bomb` is fired: its cost out of its own resource, never below 0. */
export const spendBomb = (pool: AttackerPool, bomb: Pick<BombStats, "resource" | "cost">): AttackerPool => {
  const key = bomb.resource === 1 ? "r1" : bomb.resource === 2 ? "r2" : "r3";
  return { ...pool, [key]: Math.max(0, pool[key] - bomb.cost) };
};

/**
 * What the HUD shows: the resources block as read — goo, the caps — with the
 * three bomb resources replaced by the pool's current numbers.
 */
export const hudResources = (held: Resources, pool: AttackerPool): Resources => ({ ...held, ...pool });
