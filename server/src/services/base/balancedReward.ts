import { KorathReward, Reward } from "../../enums/Rewards.js";
import { Save } from "../../database/models/save.model.js";
import { extractTownHall, type TownHall } from "../../utils/extractTownHall.js";

/**
 * Adds rewards to the user's save data based on their Town Hall level.
 *
 * Town Hall Level 7: Korath
 *
 * Nothing else is given here (owner 2026-11-04, patch 5.9). Flash gave
 * Krallen at Town Hall 6, but in this game the Krallen Hunt event is the only
 * way to get or raise her (`services/events/krallenReward.ts`). Rezghul
 * (Town Hall 8) and Diamond Spurtz (Town Hall 9) are held back for now.
 *
 * @param {Save} userSave - The user's save data.
 * @returns {Promise<void>} A promise that resolves when the balanced rewards are added.
 */
export const balancedReward = async (userSave: Save) => {
  let rewards = userSave.rewards!;
  const { KORATH } = Reward;

  // Early return if all rewards are already assigned
  if (rewards[KORATH]) return;

  const townHall: TownHall | null = extractTownHall(userSave.buildingdata ?? {});
  if (!townHall || !townHall.l) return;

  let townHallLevel = townHall.l;

  // Town Hall Level 7
  if (townHallLevel >= 7 && !rewards[KORATH]) {
    rewards[KORATH] = { id: KORATH, value: KorathReward.FISTS_OF_DOOM };
  }
};
