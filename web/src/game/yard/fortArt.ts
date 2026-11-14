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
 * With the Modern look the ring is this project's own art, "Thorn and Bone"
 * (owner, 14 Nov 2026): a braided vine rope with thorns, then leather straps,
 * ivory spikes, and at tier 4 iron-banded tusks (`fort70_F1.modern@2x.webp`
 * and so on, twice the size they are drawn; made by
 * `art-samples/b8/build_fort_final.py`). Every tier is the same true 2:1
 * diamond, so its pieces are placed from the ring's centre, which sits a fixed
 * distance below the building's origin. Classic keeps Flash's pictures.
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

/**
 * The Modern pieces, `[front x, front y, back x, back y]` from the ring's
 * centre for tiers 1 to 4 (`offsets.json` of `build_fort_final.py`).
 */
const MODERN: Readonly<Record<70 | 130, TierOffsets>> = {
  70: [
    [-81, -11, -82, -43],
    [-81, -11, -81, -45],
    [-81, -14, -81, -50],
    [-81, -21, -82, -56],
  ],
  130: [
    [-140, -15, -141, -70],
    [-140, -15, -141, -76],
    [-140, -20, -141, -84],
    [-140, -30, -141, -96],
  ],
};

/** The Modern ring's centre below the building's origin: the middle of a 70 or a 130 footprint. */
const TOWER_CENTRE = 35;
/** The Silo's footprint is 80; Flash drops its ring 6 to 7 px below a tower's, and so does Modern. */
const SILO_CENTRE = 41;
const HALL_CENTRE = 65;

interface FortSpec {
  readonly size: 70 | 130;
  /** Flash's offsets (Classic). */
  readonly tiers: TierOffsets;
  /** Where the Modern ring's centre sits below the building's origin. */
  readonly centre: number;
}

const TOWER_SPEC: FortSpec = { size: 70, tiers: TOWER, centre: TOWER_CENTRE };
const HALL_SPEC: FortSpec = { size: 130, tiers: HALL, centre: HALL_CENTRE };

/** Building type to its art size and offsets. */
const ART: Readonly<Record<number, FortSpec>> = {
  6: { size: 70, tiers: SILO, centre: SILO_CENTRE },
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
 * draws as 4. Modern art with the Modern look, Flash's with Classic.
 */
export const fortArtFor = (type: number, fort: number): FortArt | null => {
  const art = ART[type];
  const tier = Math.min(4, Math.floor(fort));
  const offsets = art?.tiers[tier - 1];
  if (!art || !offsets) return null;
  const modern = classicLook() ? undefined : MODERN[art.size][tier - 1];
  if (modern) {
    const [fx, fy, bx, by] = modern;
    return {
      front: { url: `${ASSET_ROOT}fort${art.size}_F${tier}.modern@2x.webp`, x: fx, y: art.centre + fy, frame: null },
      back: { url: `${ASSET_ROOT}fort${art.size}_B${tier}.modern@2x.webp`, x: bx, y: art.centre + by, frame: null },
    };
  }
  const [fx, fy, bx, by] = offsets;
  return {
    front: { url: `${ASSET_ROOT}fort${art.size}_F${tier}.png`, x: fx, y: fy, frame: null },
    back: { url: `${ASSET_ROOT}fort${art.size}_B${tier}.png`, x: bx, y: by, frame: null },
  };
};
