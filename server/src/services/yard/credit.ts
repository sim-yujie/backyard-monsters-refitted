import type { JsonObject } from "../../types/JsonObject.js";
import {
  RESOURCE_KEYS,
  noAmounts,
  storageCap,
  type StorageCapSave,
} from "../base/economy/resourceBudget.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";

/**
 * Crediting resources to a yard: the storage cap on everything the yard is
 * given (`docs/design/yard-buildings.md` §5.2, technical default T3).
 *
 * The original funds through `BASE.Fund`, which clamps every credit to the
 * resource's cap and returns what it actually added
 * (`client/scripts/BASE.as:4494-4536`); charges are not clamped. Every server
 * credit goes through here: the yard action wrapper's `credit`
 * (`controllers/yard/yardAction.ts`, which carries every refund — upgrade
 * cancel, locker cancel, hatchery remove — and every bank), the catch-up's HCC
 * queue refund (`catchUpMonsters.ts`), and the reports that say what came back
 * ({@link fitCredit}, worked out before the wrapper applies it).
 *
 * The cap is `storageCap` (silos, packing, outposts), one figure for all four
 * resources. A pool already at or over the cap (an old save, a cap that
 * shrank) takes nothing and loses nothing. An outpost has no pool of its own:
 * the yard action wrapper hands its rules the outpost seen through the owner's
 * main yard (`poolView.ts`), whose `poolCap` is the main yard's cap, and
 * {@link capOf} reads that instead of the outpost's own buildings.
 */

/** The slice of a save a credit reads and writes. */
export interface CreditSave extends StorageCapSave {
  resources?: JsonObject | null;
  /** The cap of the pool `resources` belongs to, when that is not this yard's own (an outpost's). */
  poolCap?: number;
}

/**
 * The storage cap a yard's credits are clamped to: its own `storageCap`, or,
 * for an outpost, its owner's main-yard cap (`poolCap`).
 */
export const capOf = (save: CreditSave): number =>
  typeof save.poolCap === "number" ? save.poolCap : storageCap(save);

/** What a credit came to, per resource. */
export interface CreditResult {
  /** What landed in the pool. */
  credited: ResourceAmounts;
  /** What did not fit under the cap. */
  overflow: ResourceAmounts;
}

/** A non-negative whole amount, 0 for anything else (as the wrapper reads amounts). */
const wholeOf = (raw: number | undefined): number =>
  raw !== undefined && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;

/** One resource as the save holds it; anything unreadable is zero. */
const heldOf = (save: CreditSave, key: string): number => {
  const value = Number(save.resources?.[key]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * What crediting `amounts` would do, without doing it: for a report, or to
 * decide how much of something to hand over before the wrapper credits it.
 *
 * @param save - The yard as it will stand when the credit lands (its silos set the cap).
 * @param amounts - Any of `r1`..`r4`; missing, negative or unreadable amounts are 0.
 * @param cap - The cap to fill up to; `capOf(save)` unless a credit raises
 *   it (Krallen's buff on attack loot, `services/base/combat/attackLoot.ts`).
 */
export const fitCredit = (
  save: CreditSave,
  amounts: Partial<ResourceAmounts>,
  cap: number = capOf(save)
): CreditResult => {
  const credited = noAmounts();
  const overflow = noAmounts();
  for (const key of RESOURCE_KEYS) {
    const amount = wholeOf(amounts[key]);
    const held = heldOf(save, key);
    credited[key] = Math.max(held, Math.min(held + amount, cap)) - held;
    overflow[key] = amount - credited[key];
  }
  return { credited, overflow };
};

/**
 * Credits `amounts` to `save.resources`, each clamped to the storage cap, and
 * says what landed and what did not fit.
 *
 * @param save - Mutated: `resources` is replaced when anything landed.
 * @param amounts - Any of `r1`..`r4`.
 * @param cap - As {@link fitCredit}'s.
 */
export const creditResources = (
  save: CreditSave,
  amounts: Partial<ResourceAmounts>,
  cap: number = capOf(save)
): CreditResult => {
  const result = fitCredit(save, amounts, cap);
  if (RESOURCE_KEYS.some((key) => result.credited[key] > 0)) {
    const resources = { ...(save.resources ?? {}) };
    for (const key of RESOURCE_KEYS) {
      if (result.credited[key] > 0) resources[key] = heldOf(save, key) + result.credited[key];
    }
    save.resources = resources;
  }
  return result;
};
