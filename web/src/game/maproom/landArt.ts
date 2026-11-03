import { LandFeature, landFeatureOf, type LandFeatureId } from "@/game/combat/rules";

/**
 * Names and picture files of the Map Room 2 land features (`landFeatures.ts`).
 *
 * Each feature has a painted icon for the cell pop-up
 * (`public/maproom/land/<key>-icon.webp`) and painted map sprites
 * (`landSprites.ts`). Painted with Codex in the style of the Map Room 2
 * study's Codex mock-ups (`docs/mr2-civ-study.md` section 6).
 */

/** The word for each feature: the pop-up picture's alt text and hover. */
export const LAND_FEATURE_NAMES: Readonly<Record<LandFeatureId, string>> = {
  [LandFeature.OPEN]: "Open ground",
  [LandFeature.FOREST]: "Forest",
  [LandFeature.ROCKS]: "Rocks",
  [LandFeature.MARSH]: "Marsh",
  [LandFeature.TWIG_NODE]: "Twig grove",
  [LandFeature.PEBBLE_NODE]: "Pebble heap",
  [LandFeature.PUTTY_NODE]: "Putty pool",
  [LandFeature.GOO_NODE]: "Goo spring",
};

/** Each feature's file key. */
export const LAND_FEATURE_KEYS: Readonly<Record<LandFeatureId, string>> = {
  [LandFeature.OPEN]: "open",
  [LandFeature.FOREST]: "forest",
  [LandFeature.ROCKS]: "rocks",
  [LandFeature.MARSH]: "marsh",
  [LandFeature.TWIG_NODE]: "node-twigs",
  [LandFeature.PEBBLE_NODE]: "node-pebbles",
  [LandFeature.PUTTY_NODE]: "node-putty",
  [LandFeature.GOO_NODE]: "node-goo",
};

/** Where the land pictures are served from. */
export const LAND_ART_BASE = `${import.meta.env.BASE_URL}maproom/land/`;

/** The pop-up icon of a feature. */
export const landFeatureIconUrl = (feature: number): string =>
  `${LAND_ART_BASE}${LAND_FEATURE_KEYS[landFeatureOf(feature)]}-icon.webp`;
