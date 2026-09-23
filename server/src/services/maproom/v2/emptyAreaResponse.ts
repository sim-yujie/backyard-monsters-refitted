import type { Save } from "../../../database/models/save.model.js";

/**
 * True once a save has been placed on a Map Room 2 world.
 *
 * A brand-new account has no `Save` row at all until its first `/base/load`
 * (`Save.createMainSave`), and even once one exists, `worldid` stays null
 * until `/worldmapv2/setmapversion` places it on a world (Town Hall 6 gate).
 * Both are "not on the map yet", not an error.
 */
export const hasWorldPlacement = (save: Pick<Save, "worldid"> | null | undefined): boolean =>
  Boolean(save?.worldid);

/**
 * The clean `getarea` response for a caller with no Map Room 2 placement.
 *
 * Mirrors the rule Map Room 3's `getcells` already applies for the same
 * situation (`controllers/maproom/v3/getCells.ts`): "no world" means nothing
 * to show, not a failure. Before this, `getArea` dereferenced `save.worldid`
 * unconditionally and crashed with a 500 (`TypeError: null is not an object`)
 * for every account that had not yet joined a world (GitHub issue #35).
 *
 * Returning `error: 0` with an empty grid, rather than throwing, also matters
 * for the web client: `ZoneStore` (web/src/game/maproom/ZoneStore.ts) treats
 * a thrown error as transient and requeues the zone with backoff forever,
 * while a resolved empty response is cached like any other zone and needs no
 * client-side special-casing.
 */
export const emptyAreaResponse = (x: number, y: number) => ({
  error: 0,
  x,
  y,
  data: {} as Record<number, Record<number, unknown>>,
  alliancedata: [] as unknown[],
});
