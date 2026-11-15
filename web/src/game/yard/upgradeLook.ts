import { classicLook } from "@/game/classicLook";
import {
  ArtState,
  resolveArt,
  restingLayers,
  type ResolvedArt,
  type ResolvedImage,
} from "./buildingArt";
import type { YardKind } from "./buildingCostData";

/**
 * The upgrade preview (beta 8, owner 15 Nov 2026, from a player's mock-up):
 * while an own building's window offers its Upgrade, the building is drawn as
 * a see-through blue ghost of the level it would go to, in its own spot, but
 * only when that level looks different. `UpgradePreview.ts` draws it.
 */

/**
 * The pictures a building is drawn with at rest, bottom to top: the whole
 * still where a tier keeps one (a tower whose turret turns, a 3D building
 * whose parts are a strip of their own), else its top and the first cell of
 * each strip (`restingLayers`).
 */
export const previewLayers = (art: ResolvedArt): readonly ResolvedImage[] =>
  art.still ? [art.still] : restingLayers(art);

const layersKey = (art: ResolvedArt): string =>
  previewLayers(art)
    .map((layer) => `${layer.url}@${layer.x},${layer.y}`)
    .join("|");

/**
 * The healthy art a building would wear at level `to`, when it looks
 * different from the healthy art of level `from`; null when it would look the
 * same, with the Classic look (Flash's art, no preview: owner), or for a type
 * with no art at all.
 *
 * "Looks different" is the pictures the yard would draw (`resolveArt`), not
 * tier sums: a 3D building changes only where a tier starts
 * (`buildingArtTiers.ts` `from:`), a Town Hall every level, a Map Room 2
 * capped Map Room never, and a type still on Flash's art wherever Flash's
 * art changes. A damaged building is compared healthy to healthy.
 */
export const upgradeLook = (
  type: number,
  from: number,
  to: number,
  kind: YardKind = "main",
): ResolvedArt | null => {
  if (classicLook() || to <= from) return null;
  const now = resolveArt(type, from, ArtState.DEFAULT, kind);
  const next = resolveArt(type, to, ArtState.DEFAULT, kind);
  if (!now || !next) return null;
  return layersKey(now) === layersKey(next) ? null : next;
};
