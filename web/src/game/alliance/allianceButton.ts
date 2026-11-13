import { OBSERVATORY_TYPE } from "@/game/yard/recycle";

/**
 * When the Alliance button shows in the More menu (owner, 13 Nov 2026:
 * "Alliance button appears ... even before the observatory is built!").
 *
 * The rule: the player is on Map Room 2, and either a finished Observatory
 * stands in their main yard or they are in an alliance already. "Finished" is
 * what the server's join gate asks (`services/alliance/joinGate.ts`) and what
 * the Observatory's own panel asks before it offers Alliance: an Observatory
 * still being built does not count. The Inferno never shows the button.
 *
 * An outpost has no Observatory of its own and its load does not say whether
 * the player is in an alliance, so both facts are remembered here from the
 * main yard: the Observatory whenever the main yard is looked at, the
 * membership from the main yard's load and from the Alliance window whenever
 * it reads the player's alliance (joined, founded, left, kicked).
 */

/** The slice of a yard the rule reads. */
export interface AllianceButtonYard {
  readonly kind: "main" | "outpost" | "inferno";
  /** The player is on Map Room 2 (an outpost is a Map Room 2 cell). */
  readonly mapRoom2: boolean;
  /** The yard's buildings; `level` is 0 while a building is first being built. */
  readonly buildings: readonly { readonly type: number; readonly level: number }[];
}

let member = false;
let mainObservatory = false;

/** Records whether the player is in an alliance. */
export const setInAlliance = (inAlliance: boolean): void => {
  member = inAlliance;
};

/** The player is in an alliance, as last heard. */
export const inAlliance = (): boolean => member;

/** A finished Observatory stands among `buildings`. */
export const hasObservatory = (buildings: AllianceButtonYard["buildings"]): boolean =>
  buildings.some((one) => one.type === OBSERVATORY_TYPE && one.level > 0);

/** Whether the Alliance button shows on `yard`; a main yard's Observatory is remembered for the outposts. */
export const allianceButtonShows = (yard: AllianceButtonYard): boolean => {
  if (yard.kind === "main") mainObservatory = hasObservatory(yard.buildings);
  if (yard.kind === "inferno" || !yard.mapRoom2) return false;
  return mainObservatory || member;
};

/** Forgets both facts, for a test. */
export const resetAllianceButton = (): void => {
  member = false;
  mainObservatory = false;
};
