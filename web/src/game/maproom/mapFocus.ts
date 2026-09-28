import type { OffsetCell } from "@/game/HexGrid";
import type { TakeoverKind } from "./takeover";

/**
 * A one-shot handoff to the Map Room 2 screen: which cell to open on, and
 * whether it was just taken over (issue #82). The end-of-attack panel sets
 * it on the way back to the map; the map consumes it once it knows where
 * home is, and centres on this cell instead.
 *
 * A module variable for the same reason as `attackTarget.ts`: `goTo` takes
 * a scene name and nothing else, and the map is reached through the map
 * gate scene.
 */
export interface MapFocus {
  readonly cell: OffsetCell;
  /** Set when the cell has just become the player's outpost: the map says "Veni, Vidi, Vici!". */
  readonly takenOver?: { readonly kind: TakeoverKind; readonly name: string };
}

let focus: MapFocus | null = null;

/** Records the cell the map should open on next. */
export const setMapFocus = (next: MapFocus): void => {
  focus = next;
};

/** Takes the pending focus, clearing it. Null when nothing was set. */
export const consumeMapFocus = (): MapFocus | null => {
  const taken = focus;
  focus = null;
  return taken;
};
