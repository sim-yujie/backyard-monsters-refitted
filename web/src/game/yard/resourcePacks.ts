import type { ResourceCaps, Resources } from "@/api/types";
import type { YardKind } from "./buildingCostData";
import { purseFunds, surfaceInfernoStanding } from "./surfaceInferno";
import type { YardStoreReader } from "./YardStore";

/**
 * Buying resources with Shiny (issue #393, owner: "just follow Flash client"):
 * the display copy of `server/src/services/yard/resourcePacks.ts`, which
 * prices and refuses every purchase itself.
 *
 * Flash's store sold three offers per resource (`client/scripts/STORE.as:212-330`):
 * 10% of the storage cap, 50% of the cap (each only while it fits whole), and
 * fill to the cap, each priced `ceil((sqrt(amount / 2)) ^ 0.75)` Shiny. The
 * resource bar's buttons opened the same three for one resource
 * (`UI_TOP.as:526-536`). The Inferno's (`…I`) are sold in the Inferno yard and,
 * once the Descent is passed, in the main yard, where they fill the Inferno
 * purse. A short build, upgrade or fortification is topped up on the same
 * curve ({@link topUpPrice}, Flash's `BRTOPUP`).
 */

export type PackResource = "r1" | "r2" | "r3" | "r4";
export type PackSize = 1 | 2 | 3;

export const PACK_RESOURCES: readonly PackResource[] = ["r1", "r2", "r3", "r4"];
export const PACK_SIZES: readonly PackSize[] = [1, 2, 3];

/** What each offer's button says: icons and numbers, not sentences. */
export const PACK_LABELS: Readonly<Record<PackSize, string>> = { 1: "+10%", 2: "+50%", 3: "Fill" };

/** Why an offer cannot be bought: no room for it (`str_top_10pct_noroom`, `str_resourcesfull`). */
export const NO_ROOM = "No room.";

/** `STORE.GetShinyCostFromTotalResources` (`STORE.as:183-185`): 0 for nothing. */
export const shinyForResources = (amount: number): number =>
  amount > 0 ? Math.ceil(Math.sqrt(amount / 2) ** 0.75) : 0;

/** Flash's `BRTOPUP`: the shortfall summed over all four, on the same curve. */
export const topUpPrice = (shortfall: Partial<Record<PackResource, number>>): number =>
  shinyForResources(PACK_RESOURCES.reduce((sum, key) => sum + Math.max(0, Number(shortfall[key]) || 0), 0));

/** `BR23`, `BR41I`. */
export const packCode = (resource: PackResource, size: PackSize, inferno: boolean): string =>
  `BR${PACK_RESOURCES.indexOf(resource) + 1}${size}${inferno ? "I" : ""}`;

/** The amount an offer holds, 0 with no room for it (Flash's strict `<`). */
export const packAmount = (size: PackSize, held: number, cap: number): number => {
  const have = Number.isFinite(held) && held > 0 ? held : 0;
  const room = Number.isFinite(cap) && cap > 0 ? cap : 0;
  if (size === 3) return room > have ? room - have : 0;
  const amount = room * (size === 1 ? 0.1 : 0.5);
  return have + amount < room ? amount : 0;
};

/** One offer as a button shows it. */
export interface PackOffer {
  readonly item: string;
  readonly size: PackSize;
  /** What lands, rounded up as the server funds it; 0 with no room. */
  readonly amount: number;
  readonly price: number;
  /** Why it cannot be bought now, or null. */
  readonly blocked: string | null;
}

/** One resource's three offers. */
export interface PackGroup {
  readonly resource: PackResource;
  /** Bone, Coal, Sulfur and Magma rather than the surface four. */
  readonly inferno: boolean;
  readonly held: number;
  readonly cap: number;
  readonly offers: readonly PackOffer[];
}

/** The three offers for one resource held at `held` under `cap`. */
export const packGroup = (
  resource: PackResource,
  held: number,
  cap: number,
  inferno: boolean,
  credits: number,
): PackGroup => ({
  resource,
  inferno,
  held,
  cap,
  offers: PACK_SIZES.map((size) => {
    const amount = packAmount(size, held, cap);
    const price = shinyForResources(amount);
    const blocked = amount <= 0 ? NO_ROOM : price > credits ? "Not enough Shiny." : null;
    return { item: packCode(resource, size, inferno), size, amount: Math.ceil(amount), price, blocked };
  }),
});

const groupsOf = (resources: Resources, caps: ResourceCaps | null, inferno: boolean, credits: number): PackGroup[] =>
  caps
    ? PACK_RESOURCES.map((key) => packGroup(key, Number(resources[key]) || 0, Number(caps[key]) || 0, inferno, credits))
    : [];

/** Whether a yard of `kind` sells the Inferno's packs (`STORE.as:200-211`). */
export const sellsInfernoPacks = (kind: YardKind, descentPassed: boolean): boolean =>
  kind === "inferno" || (kind === "main" && descentPassed);

/**
 * Every resource offer the yard sells now: the surface four (main yard and
 * outposts, into the pool), the Inferno four (the Inferno yard, its own pool;
 * the main yard after the Descent, the Inferno purse).
 */
export const packGroups = (reader: YardStoreReader): PackGroup[] => {
  const kind = reader.kind;
  const credits = reader.credits;
  if (kind === "inferno") return groupsOf(reader.resources, reader.caps, true, credits);
  const surface = groupsOf(reader.resources, reader.caps, false, credits);
  if (kind !== "main" || !sellsInfernoPacks(kind, surfaceInfernoStanding(reader.save).descentPassed)) return surface;
  const purse = purseFunds(reader.save);
  return [...surface, ...groupsOf(purse.resources, purse.caps, true, credits)];
};

/** One resource's group as the HUD's readout opens it: the surface's, or the yard's own realm's. */
export const packGroupFor = (reader: YardStoreReader, resource: PackResource): PackGroup | null =>
  packGroups(reader).find((group) => group.resource === resource && group.inferno === (reader.kind === "inferno")) ??
  null;
