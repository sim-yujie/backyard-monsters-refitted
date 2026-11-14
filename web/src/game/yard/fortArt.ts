import { classicLook } from "@/game/classicLook";
import type { ResolvedImage } from "./buildingArt";

/**
 * The fortification overlay art: a back and a front picture drawn around a
 * fortified building, one pair per tier (`fortImgData` in
 * `client/scripts/YARD_PROPS.as` and `OUTPOST_YARD_PROPS.as`, drawn by
 * `BFOUNDATION.as:955-1032`). The back sits behind the building, the front in
 * front of it, each at a fixed offset from the building's isometric origin, the
 * same origin the building's own picture is placed from.
 *
 * The art ships three sizes: `fort70` for the Storage Silo and the towers,
 * `fort130` for the Town Hall and the outpost core. The offsets are the props
 * table's, per size and tier; the silo's differ from the towers' at the front.
 *
 * With the Modern look the ring is Flash's own design redrawn sharp at twice
 * the size it is drawn (owner, 14 Nov 2026: "a high res version of the
 * original flash client art"): the same thin thorny vines, the bone spikes
 * from tier 3, the bigger ones at tier 4, each shape where Flash has it
 * (`fort70_F1.modern@2x.webp` and so on; made by
 * `art-samples/fort-hires/build.py`). Every Modern piece fills exactly the box
 * of Flash's piece, so both looks use the props table's offsets. Classic keeps
 * Flash's own pictures.
 */

const ASSET_ROOT = "/assets/buildings/fortifications/";

/** `[front x, front y, back x, back y]` for tiers 1 to 4. */
type TierOffsets = readonly (readonly [number, number, number, number])[];

const TOWER: TierOffsets = [
  [-73, 21, -70, -10],
  [-69, 22, -65, -12],
  [-72, 10, -68, -12],
  [-70, -11, -61, -36],
];

const SILO: TierOffsets = [
  [-73, 28, -71, -4],
  [-69, 26, -65, -7],
  [-73, 17, -69, -5],
  [-70, -3, -62, -31],
];

const HALL: TierOffsets = [
  [-127, 46, -122, -10],
  [-124, 48, -120, -15],
  [-124, 32, -110, -11],
  [-124, 15, -116, -49],
];

interface FortSpec {
  readonly size: 70 | 130;
  readonly tiers: TierOffsets;
}

const TOWER_SPEC: FortSpec = { size: 70, tiers: TOWER };
const HALL_SPEC: FortSpec = { size: 130, tiers: HALL };

/** Building type to its art size and offsets. */
const ART: Readonly<Record<number, FortSpec>> = {
  6: { size: 70, tiers: SILO },
  14: HALL_SPEC,
  112: HALL_SPEC,
  20: TOWER_SPEC,
  21: TOWER_SPEC,
  23: TOWER_SPEC,
  25: TOWER_SPEC,
  115: TOWER_SPEC,
  118: TOWER_SPEC,
};

export interface FortArt {
  readonly front: ResolvedImage;
  readonly back: ResolvedImage;
}

/**
 * The overlay pair for a building of `type` fortified to `fort` (1 to 4), or
 * null when it is unfortified or its type has no overlay art. A tier above 4
 * draws as 4. The sharp redraw with the Modern look, Flash's own pictures
 * with Classic, both at Flash's offsets.
 */
export const fortArtFor = (type: number, fort: number): FortArt | null => {
  const art = ART[type];
  const tier = Math.min(4, Math.floor(fort));
  const offsets = art?.tiers[tier - 1];
  if (!art || !offsets) return null;
  const [fx, fy, bx, by] = offsets;
  const ext = classicLook() ? ".png" : ".modern@2x.webp";
  return {
    front: { url: `${ASSET_ROOT}fort${art.size}_F${tier}${ext}`, x: fx, y: fy, frame: null },
    back: { url: `${ASSET_ROOT}fort${art.size}_B${tier}${ext}`, x: bx, y: by, frame: null },
  };
};
