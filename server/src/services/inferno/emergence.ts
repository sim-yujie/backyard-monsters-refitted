import { devConfig } from "../../config/GameConfig.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { townHallLevel } from "../yardplanner/costs.js";
import type { InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The cave on the main yard and Moloch's emergence (`docs/design/inferno.md`
 * §2.2), by Flash's rules (`client/scripts/INFERNO_EMERGENCE_EVENT.as`, owner
 * I14): at Town Hall 5 the cave shows; it goes up one level per emergence
 * raid, at least 12 hours apart, five in all. Pure.
 */

/** The cave shows from this Town Hall level (`INFERNO_EMERGENCE_EVENT.as:13`). */
export const CAVE_TOWN_HALL = 5;

/** The cave's top level: one per raid (`:53-55`). */
export const EMERGENCE_LEVELS = 5;

/** Seconds from one level-up to the next (`:49-51`, `:111-119`). */
export const EMERGENCE_GAP_SECONDS = 43_200;

/** Flash's "tutorial over": `TUTORIAL._stage > 200` (`:212`). */
export const TUTORIAL_OVER_STAGE = 200;

/** The slice of a main save the cave reads. */
export interface CaveSave {
  buildingdata?: BuildingDataMap | null;
  /** The Town Hall's level as the column keeps it (`syncTownHallLevel`). */
  thlevel?: number | null;
  tutorialstage?: unknown;
}

/**
 * The Town Hall's level: the higher of the buildings' and the `thlevel`
 * column's, so a read of only some columns (the raid ping's) still sees it.
 */
const townHallOf = (save: CaveSave): number =>
  Math.max(townHallLevel(save.buildingdata), Number(save.thlevel) || 0);

/** Whether the guided start is over, by Flash's test; always over where the dev config skips it. */
export const tutorialOver = (save: CaveSave, skipTutorial: boolean = devConfig.skipTutorial): boolean =>
  skipTutorial || (Number(save.tutorialstage) || 0) > TUTORIAL_OVER_STAGE;

/**
 * Whether the cave shows on the main yard: Town Hall 5 or more, or a cave
 * that has already gone up a level, once the tutorial is over
 * (`ShouldShowPortal`, `:208-210`).
 */
export const caveShown = (
  save: CaveSave,
  progress: Pick<InfernoProgressRecord, "emergenceLevel">,
  skipTutorial: boolean = devConfig.skipTutorial
): boolean =>
  tutorialOver(save, skipTutorial) && (townHallOf(save) >= CAVE_TOWN_HALL || progress.emergenceLevel > 0);

/** Whether all five emergence raids are done: the Descent is open. */
export const emergenceDone = (progress: Pick<InfernoProgressRecord, "emergenceLevel">): boolean =>
  progress.emergenceLevel >= EMERGENCE_LEVELS;

/**
 * The earliest the next level-up may come, unix seconds: 12 hours after the
 * last; none yet means any time (0). Null once all five are done.
 */
export const nextEmergenceAt = (
  progress: Pick<InfernoProgressRecord, "emergenceLevel" | "emergenceLastAt">
): number | null => {
  if (emergenceDone(progress)) return null;
  return progress.emergenceLastAt === null ? 0 : progress.emergenceLastAt + EMERGENCE_GAP_SECONDS;
};
