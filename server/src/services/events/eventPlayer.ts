import { devConfig } from "../../config/GameConfig.js";
import type { EventDefinition } from "../../game-data/events/events.js";
import type { BuildingDataMap } from "../../types/BuildingData.js";
import { TUTORIAL_DONE_STAGE } from "../onboarding/guidedStart.js";
import { townHallLevel } from "../yardplanner/costs.js";
import { krallenLevelOf } from "./krallenReward.js";

/**
 * What an event needs to know of a player, read off their main yard: whether
 * they may take part (`EventDefinition.requires`) and their Krallen's level
 * for the Krallen Hunt's reward line. Pure.
 */

export interface EventPlayer {
  /** The main yard's Town Hall level, 0 without one. */
  readonly townHall: number;
  /** Whether the guided start is over (`tutorialstage` 205; always off production, as the bank reads it). */
  readonly tutorialDone: boolean;
  /** Krallen's level, 0 for none. */
  readonly krallenLevel: number;
}

/** The slice of a main save this reads. */
export interface EventPlayerSave {
  buildingdata?: BuildingDataMap | null;
  tutorialstage?: unknown;
  champion?: unknown;
}

export const eventPlayerOf = (
  save: EventPlayerSave | null | undefined,
  skipTutorial: boolean = devConfig.skipTutorial
): EventPlayer => ({
  townHall: townHallLevel(save?.buildingdata),
  tutorialDone: skipTutorial || (Number(save?.tutorialstage) || 0) >= TUTORIAL_DONE_STAGE,
  krallenLevel: krallenLevelOf(save?.champion),
});

/** Why the player cannot take part, in the page's words, or null when they can. */
export const lockedReason = (event: EventDefinition, player: EventPlayer): string | null => {
  const needs = event.requires;
  if (!needs) return null;
  if (needs.townHall !== undefined && player.townHall < needs.townHall) {
    return `Reach Town Hall ${needs.townHall} to take part.`;
  }
  if (needs.tutorial && !player.tutorialDone) return "Finish the guided start to take part.";
  return null;
};
