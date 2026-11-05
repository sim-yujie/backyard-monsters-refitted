import { setLocalRoute } from "@/api/http";
import type { TribeId, TribeYardResponse } from "@/api/tribeEditor";
import { TribeYardSim } from "./tribeYardSim";

/**
 * The tribe yard editor's session (LOCAL game only): which camp yard the yard
 * screen has open in place of the player's own, and the {@link TribeYardSim}
 * that answers its yard routes in the browser meanwhile.
 *
 * The picker hands the yard screen a target ({@link setTribeEditTarget}); the
 * screen takes it as it opens ({@link consumeTribeEditTarget}), starts the
 * session and ends it when it closes, so leaving the yard screen in any way
 * leaves the editor and the player's own routes go to the server again.
 */

export interface TribeEdit {
  readonly tribe: TribeId;
  /** The tribe's display name: "Legionnaire", "Kozu", "Abunakki", "Dreadnaut". */
  readonly name: string;
  readonly level: number;
  /** The level the yard it opened with stands at. */
  readonly from: number;
  readonly saved: boolean;
  readonly sim: TribeYardSim;
}

let target: TribeYardResponse & { name: string } | null = null;
let current: TribeEdit | null = null;

/** Asks the next yard screen to open this tribe yard in the editor. */
export const setTribeEditTarget = (response: TribeYardResponse & { name: string }): void => {
  target = response;
};

/** Takes (and clears) the tribe yard the yard screen was asked to open. */
export const consumeTribeEditTarget = (): (TribeYardResponse & { name: string }) | null => {
  const taken = target;
  target = null;
  return taken;
};

/** Starts editing: from now on the yard's routes are answered by the sim. */
export const startTribeEdit = (response: TribeYardResponse & { name: string }): TribeEdit => {
  const sim = new TribeYardSim(response.yard);
  current = {
    tribe: response.tribe,
    name: response.name,
    level: response.level,
    from: response.from,
    saved: response.saved,
    sim,
  };
  setLocalRoute(sim.handle);
  return current;
};

/** Stops editing: the yard's routes go to the server again. */
export const endTribeEdit = (): void => {
  if (!current) return;
  current = null;
  setLocalRoute(null);
};

/** The tribe yard open in the editor, or null. */
export const tribeEdit = (): TribeEdit | null => current;

/** Whether the yard on screen is a tribe yard in the editor (free, instant, no limits). */
export const isTribeEditing = (): boolean => current !== null;
