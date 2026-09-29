import type { Resources } from "@/api/types";
import { OUTPOST_CORE_TYPE } from "./buildingCosts";
import { STARTER_KIT_SUMMARIES, type StarterKitSummary } from "./starterKitData";
import type { Yard } from "./yardModel";

/**
 * The outpost Starter Kits, client-side (outposts WP9, issue #188): what the
 * picker offers and what a press would cost. The server decides and charges
 * (`server/src/services/yard/starterKit.ts`); these are the same rules, read
 * against the store, so the picker shows the price the route will take.
 *
 * - With resources a kit costs twigs, pebbles and putty (never goo). A short
 *   pool can make up the rest in Shiny, `ceil(sqrt(short / 2) ^ 0.75)`, where
 *   `short` is the missing amounts added together
 *   (`client/scripts/popup_prefab.as:147-226`).
 * - With Shiny it costs the kit's own price (`:114-131`).
 * - A yard holding more than its core is warned first that the kit replaces
 *   every building (`kit_warning`, `:99-112`, `:133-145`).
 */

export { STARTER_KIT_SUMMARIES, type StarterKitSummary };

/** `ceil(sqrt(short / 2) ^ 0.75)` Shiny for `short` missing resources; 0 when none. */
export const kitTopUpShiny = (short: number): number =>
  short > 0 ? Math.ceil(Math.pow(Math.sqrt(short / 2), 0.75)) : 0;

/** What the pool is missing of a kit's twigs, pebbles and putty. */
export const kitShortfall = (
  resources: Resources,
  kit: Pick<StarterKitSummary, "resources">,
): { r1: number; r2: number; r3: number } => {
  const missing = { r1: 0, r2: 0, r3: 0 };
  for (const key of ["r1", "r2", "r3"] as const) {
    const have = Math.max(0, Math.floor(Number(resources[key] ?? 0)) || 0);
    missing[key] = Math.max(0, kit.resources[key] - have);
  }
  return missing;
};

/** Where one kit stands for this player now. */
export interface KitOffer {
  readonly kit: StarterKitSummary;
  readonly shortfall: { r1: number; r2: number; r3: number };
  /** Missing resources added together; 0 when the pool covers the kit. */
  readonly short: number;
  /** Shiny that makes up the shortfall; 0 when nothing is short. */
  readonly topUp: number;
  /** Whether the Shiny balance covers the top-up (or the kit's own price). */
  readonly topUpAffordable: boolean;
  readonly shinyAffordable: boolean;
}

export const kitOffer = (
  kit: StarterKitSummary,
  pool: { readonly resources: Resources; readonly credits: number },
): KitOffer => {
  const shortfall = kitShortfall(pool.resources, kit);
  const short = shortfall.r1 + shortfall.r2 + shortfall.r3;
  const topUp = kitTopUpShiny(short);
  return {
    kit,
    shortfall,
    short,
    topUp,
    topUpAffordable: pool.credits >= topUp,
    shinyAffordable: pool.credits >= kit.shiny,
  };
};

/** Whether the kit would replace buildings: the yard holds more than its core. */
export const kitReplacesBuildings = (yard: Pick<Yard, "buildings">): boolean =>
  yard.buildings.some((building) => building.type !== OUTPOST_CORE_TYPE);

/** A kit by id, 1 to 3. */
export const kitSummary = (id: number): StarterKitSummary | null =>
  STARTER_KIT_SUMMARIES.find((kit) => kit.id === id) ?? null;
