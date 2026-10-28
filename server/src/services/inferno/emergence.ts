import { devConfig } from "../../config/GameConfig.js";
import { BaseType } from "../../enums/Base.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingDataMap, BuildingHealthData } from "../../types/BuildingData.js";
import { harvesterHealth } from "../yard/catchUpHarvesters.js";
import { levelOf, townHallLevel } from "../yardplanner/costs.js";
import type { InfernoProgressRecord } from "./infernoProgress.js";

/**
 * The cave on the main yard and Moloch's emergence (`docs/design/inferno.md`
 * §2.2), by Flash's rules (`client/scripts/INFERNO_EMERGENCE_EVENT.as`, owner
 * I14): at Town Hall 5 the cave shows; it goes up one level per emergence
 * raid, at least 23 hours apart (owner's rule, 28 Oct; Flash's was 12),
 * five in all. Pure.
 */

/** The cave shows from this Town Hall level (`INFERNO_EMERGENCE_EVENT.as:13`). */
export const CAVE_TOWN_HALL = 5;

/** The cave's top level: one per raid (`:53-55`). */
export const EMERGENCE_LEVELS = 5;

/**
 * Seconds from one level-up to the next: 23 hours, the owner's rule (28 Oct).
 * Flash waited 12 hours (`:49-51`, `:111-119`).
 */
export const EMERGENCE_GAP_SECONDS = 23 * 60 * 60;

/** Flash's "tutorial over": `TUTORIAL._stage > 200` (`:212`). */
export const TUTORIAL_OVER_STAGE = 200;

/** A raid needs the yard above this share of its full health (`_MINIMUM_BASE_HEALTH`, `:184-196`). */
export const EMERGENCE_MIN_HEALTH = 0.1;

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
 * The earliest the next level-up may come, unix seconds: 23 hours after the
 * last ({@link EMERGENCE_GAP_SECONDS}); none yet means any time (0). Null once all five are done.
 */
export const nextEmergenceAt = (
  progress: Pick<InfernoProgressRecord, "emergenceLevel" | "emergenceLastAt">
): number | null => {
  if (emergenceDone(progress)) return null;
  return progress.emergenceLastAt === null ? 0 : progress.emergenceLastAt + EMERGENCE_GAP_SECONDS;
};

/**
 * The yard's health as a share of full health, over every building with a
 * health ladder (`isBaseReadyForAttack`, `:184-196`: health over max health
 * of every building). A yard with none reads 0, as Flash's 0/0 never passed.
 */
export const yardHealthShare = (save: Pick<EmergenceSave, "buildingdata" | "buildinghealthdata">): number => {
  let health = 0;
  let full = 0;
  for (const [key, building] of Object.entries(save.buildingdata ?? {})) {
    if (!building) continue;
    const max = maxHp(Number(building.t), levelOf(building), "main");
    if (!(max > 0)) continue;
    full += max;
    health += Math.min(max, Math.max(0, harvesterHealth(save, key, building) ?? max));
  }
  return full > 0 ? health / full : 0;
};

/** Why no emergence raid is due; the gates in the order they are checked. */
export type EmergenceNotDue =
  | "off"
  | "notMainYard"
  | "noCave"
  | "done"
  | "tooSoon"
  | "underAttack"
  | "raidOpen"
  | "damaged";

/** The slice of a main save the due rule reads. */
export interface EmergenceSave extends CaveSave {
  type?: string;
  buildinghealthdata?: BuildingHealthData | null;
}

/** Everything the due rule needs, read beforehand. */
export interface EmergenceFacts {
  /** `infernoConfig.enabled`. */
  readonly enabled: boolean;
  /** The player's main yard, caught up. */
  readonly save: EmergenceSave;
  readonly progress: Pick<InfernoProgressRecord, "emergenceLevel" | "emergenceLastAt">;
  /** Unix seconds. */
  readonly now: number;
  /** An attack is running on the yard. */
  readonly underAttack: boolean;
  /** A wild monster raid is open (warning or fight): one raid at a time. */
  readonly raidOpen: boolean;
  readonly skipTutorial?: boolean;
}

/**
 * The emergence due rule, checked on the owner's build-mode load of their
 * main yard (`docs/design/inferno.md` §2.2, §3.2; Flash's rules, owner I14):
 * null when the cave goes up a level and its raid comes now, else the first
 * gate that holds it back.
 *
 * 1. The new Inferno is switched on.
 * 2. The player's main yard.
 * 3. The cave shows ({@link caveShown}: Town Hall 5, tutorial over).
 * 4. Fewer than five raids so far.
 * 5. 23 hours since the last level-up ({@link EMERGENCE_GAP_SECONDS}; Flash's
 *    12, `IsBelowMaxLevel`, `:111-119`); the first has no wait.
 * 6. No attack running on the yard and no wild monster raid open: the
 *    raid waits for the next load.
 * 7. From the second raid on, the yard above 10% of its full health
 *    (`isBaseReadyForAttack`, checked with the wait before the cave is
 *    raised, `SetupPortal`, `INFERNO_EMERGENCE_EVENT.as:98`): a yard at 10%
 *    or less keeps its cave as it is until a load finds it mended. Not our
 *    wild raids' "nothing damaged" rule (I14). The first raise has no such
 *    gate (`:91-95`): the cave goes up to 1 whatever the yard's health, and
 *    only its raid is skipped ({@link emergenceRaidSkipped}).
 */
export const emergenceDueCheck = (facts: EmergenceFacts): EmergenceNotDue | null => {
  const { save, progress, now } = facts;
  if (!facts.enabled) return "off";
  if (save.type !== BaseType.MAIN) return "notMainYard";
  if (!caveShown(save, progress, facts.skipTutorial)) return "noCave";
  const nextAt = nextEmergenceAt(progress);
  if (nextAt === null) return "done";
  if (now < nextAt) return "tooSoon";
  if (facts.underAttack) return "underAttack";
  if (facts.raidOpen) return "raidOpen";
  if (progress.emergenceLevel > 0 && emergenceRaidSkipped(save)) return "damaged";
  return null;
};

/**
 * Whether the cave just raised goes without its raid: the yard at 10% of its
 * full health or less. Flash saved the new level and its time first, then
 * left the attack out (`UpgradePortal`, `INFERNO_EMERGENCE_EVENT.as:172-176`):
 * no earthquake, no warning, no fight and no "stage passed", yet the level
 * stands, so the next raid is the next level's, 23 hours on. Only the first
 * raise gets here ({@link emergenceDueCheck}, rule 7).
 */
export const emergenceRaidSkipped = (save: Pick<EmergenceSave, "buildingdata" | "buildinghealthdata">): boolean =>
  !(yardHealthShare(save) > EMERGENCE_MIN_HEALTH);

/**
 * Whether the emergence holds wild monster raids back: switched on, the
 * player's main yard, the cave showing and fewer than five raids done
 * (Flash: `!INFERNO_EMERGENCE_EVENT.ShouldRunEvent()` on every raid gate,
 * `WMATTACK.as:304`, `:307`, `:327`). From the first raid to the fifth, and
 * from Town Hall 5 before the first, the only raids are Moloch's.
 */
export const emergencePausesWildRaids = (
  enabled: boolean,
  save: EmergenceSave,
  progress: Pick<InfernoProgressRecord, "emergenceLevel">,
  skipTutorial: boolean = devConfig.skipTutorial
): boolean =>
  enabled && save.type === BaseType.MAIN && caveShown(save, progress, skipTutorial) && !emergenceDone(progress);
