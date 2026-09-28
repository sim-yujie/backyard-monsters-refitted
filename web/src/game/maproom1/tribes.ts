/**
 * The four wild monster tribes of Map Room 1.
 *
 * Names and blurbs are the Flash client's (`client/scripts/com/monsters/ai/
 * TRIBES.as:34-99`; text `ai_*_description` in
 * `server/public/gamestage/assets/english.json`), in the approved mock-ups'
 * plainer words. The map
 * spot is the tribe's reserved rectangle on the painted map
 * (`com/monsters/maproom/Obstruction.as:8`), picked by the name's first letter
 * as `PlayerLayer.as:301-318` did; the pin sits in its middle.
 */

export const TribeId = {
  LEGIONNAIRE: "legionnaire",
  KOZU: "kozu",
  ABUNAKKI: "abunakki",
  DREADNAUT: "dreadnaut",
} as const;
export type TribeId = (typeof TribeId)[keyof typeof TribeId];

export interface TribeInfo {
  readonly id: TribeId;
  /** "Kozu": the name on a pin or a tile. */
  readonly name: string;
  /** One sentence for the target card. */
  readonly blurb: string;
  /** The 50 px portrait the server ships (`server/public/assets/monsters/`). */
  readonly art: string;
  /** The reserved rectangle on the 1760 x 1760 map, `[x, y, width, height]`. */
  readonly spot: readonly [number, number, number, number];
}

export const TRIBES: readonly TribeInfo[] = [
  {
    id: TribeId.LEGIONNAIRE,
    name: "Legionnaire",
    blurb:
      "The Legionnaires are keen military tacticians, well known for their unwavering valor in battle.",
    art: "/assets/monsters/tribe_legionnaire_50.jpg",
    spot: [196, 771, 209, 184],
  },
  {
    id: TribeId.KOZU,
    name: "Kozu",
    blurb: "The Kozu tribe use exalted masonry to build master mazes that defend their camp.",
    art: "/assets/monsters/tribe_kozu_50.jpg",
    spot: [605, 478, 186, 174],
  },
  {
    id: TribeId.ABUNAKKI,
    name: "Abunakki",
    blurb: "Known for their savagery, the Abunakki wear the bones of their enemies as jewelry.",
    art: "/assets/monsters/tribe_abunakki_50.jpg",
    spot: [917, 1137, 191, 162],
  },
  {
    id: TribeId.DREADNAUT,
    name: "Dreadnaut",
    blurb: "The Dreadnauts use advanced technology and science to build superior weaponry.",
    art: "/assets/monsters/tribe_dreadnaut_50.jpg",
    spot: [1238, 1084, 198, 174],
  },
];

const BY_ID = new Map(TRIBES.map((tribe) => [tribe.id, tribe]));

export const tribeInfo = (id: TribeId): TribeInfo => BY_ID.get(id)!;

/**
 * Which tribe a Map Room 1 base id belongs to (`TRIBES.as:14-20`):
 * Legionnaire 1-10, 41, 42; Kozu 11-20, 43, 44; Abunakki 21-30, 45, 46;
 * Dreadnaut 31-40, 47, 48 and 101-110. Null for any other id.
 */
export const tribeOfBaseId = (baseid: number): TribeId | null => {
  if ((baseid >= 1 && baseid <= 10) || baseid === 41 || baseid === 42)
    return TribeId.LEGIONNAIRE;
  if ((baseid >= 11 && baseid <= 20) || baseid === 43 || baseid === 44) return TribeId.KOZU;
  if ((baseid >= 21 && baseid <= 30) || baseid === 45 || baseid === 46) return TribeId.ABUNAKKI;
  if ((baseid >= 31 && baseid <= 40) || baseid === 47 || baseid === 48)
    return TribeId.DREADNAUT;
  if (baseid >= 101 && baseid <= 110) return TribeId.DREADNAUT;
  return null;
};

/**
 * A tribe named however the server names it: the id, a display name
 * ("Kozu", "Abunaki", "Dreadnaught") or its first letter, which is all the
 * Flash client looked at (`PlayerLayer.as:301-306`).
 */
export const tribeFromName = (name: string): TribeId | null => {
  const first = name.trim().charAt(0).toLowerCase();
  return first === "l"
    ? TribeId.LEGIONNAIRE
    : first === "k"
      ? TribeId.KOZU
      : first === "a"
        ? TribeId.ABUNAKKI
        : first === "d"
          ? TribeId.DREADNAUT
          : null;
};
