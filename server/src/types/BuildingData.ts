export interface BuildingData {
  x: number;              // x position
  y: number;              // y position
  t: number;              // building type
  id: number;             // building ID
  l?: number;             // current level
  fort?: number;          // fortification level
  cB?: number;            // countdown build
  cU?: number;            // countdown upgrade
  cF?: number;            // countdown fortify
  hp?: number;            // health, only when damaged (not written on MR3)
  rE?: number;            // repairing flag
  prefab?: number;        // kit type for outpost buildings
  [key: string]: unknown; // allow for future expansion without breaking type safety
}

/**
 * A base's buildingdata column: every building on the base, keyed by building id.
 */
export type BuildingDataMap = Record<string, BuildingData>;

/**
 * A base's buildinghealthdata column: current health keyed by building id.
 * The client only writes buildings below full health, and 0 for traps that have fired.
 */
export type BuildingHealthData = Record<string, number>;

/**
 * One trap that fired and was removed from the yard, kept so the Yard Planner
 * can offer to put it back where it was.
 *
 * A fired trap leaves nothing behind but a zero in `buildinghealthdata`
 * (`client/scripts/BFOUNDATION.as:439-441`), so the position is gone from the
 * save the moment the attack lands. `buildingDataHandler.ts` records it here as
 * the trap is dropped, using the same `X`/`Y` spelling `buildingdata` does.
 * `at` is unix seconds, for nothing more than ordering and eviction.
 */
export interface FiredTrap {
  t: number;
  X: number;
  Y: number;
  at: number;
}

/** How many fired traps a save remembers; the oldest fall off the front. */
export const FIRED_TRAP_MAX = 200;