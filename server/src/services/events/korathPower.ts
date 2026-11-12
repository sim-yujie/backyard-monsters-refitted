import { KORATH_MAX_POWER, korathPowerOf } from "../../game-data/events/monsterMadness.js";
import { Reward } from "../../enums/Rewards.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { KORATH_TYPE, readChampions } from "../yard/champion.js";

/**
 * Korath's powers as an event prize (Monster Madness, owner 11 Nov 2026):
 * power 1 Burn, 2 Breath of Fire, 3 Fists of Doom, Flash's `KorathReward`
 * levels (`KorathReward.as`, `Korath.as:11-15`). The fight rules read a
 * champion's `pl` (`championPower`): Breath of Fire from power 2 at stage 4,
 * Fists of Doom from power 3 at stage 5.
 *
 * The power won is kept in the main yard's `rewards` under
 * `Reward.KORATH_POWER`, and every Korath in the `champion` list (frozen
 * ones too) is lifted to it. A Korath raised later at the cage hatches with
 * it (`planChampionRaise`), so a power won before the player has Korath is
 * not lost. A power is never lowered, as Flash's `KorathReward.value` setter
 * refused (`KorathReward.as:15-21`).
 *
 * Pure: hands back fresh `rewards` and, when a Korath changed, a fresh list.
 */

export interface KorathPowerGrant {
  rewards: JsonObject;
  /** The new list, only when a Korath in it changed. */
  champions?: ChampionData[];
  /** The power held after the grant. */
  power: number;
  /** Whether the grant raised the power held. */
  raised: boolean;
  /** Whether the player has a Korath now; without one, the power waits for him. */
  hasKorath: boolean;
}

export const grantKorathPower = (
  save: { rewards?: unknown; champion?: unknown },
  power: number,
  champions: unknown = save.champion
): KorathPowerGrant => {
  const won = Math.min(Math.max(Math.floor(power) || 0, 0), KORATH_MAX_POWER);
  const held = korathPowerOf(save.rewards);
  const next = Math.max(held, won);
  const base = save.rewards && typeof save.rewards === "object" ? (save.rewards as JsonObject) : {};
  const rewards: JsonObject = { ...base, [Reward.KORATH_POWER]: { id: Reward.KORATH_POWER, value: next } };

  const list = readChampions(champions);
  let changed = false;
  for (const [index, one] of list.entries()) {
    if (Math.trunc(Number(one.t)) !== KORATH_TYPE) continue;
    if ((Number(one.pl) || 0) >= next) continue;
    list[index] = { ...one, pl: next };
    changed = true;
  }
  const hasKorath = list.some((one) => Math.trunc(Number(one.t)) === KORATH_TYPE);

  return { rewards, ...(changed && { champions: list }), power: next, raised: next > held, hasKorath };
};
