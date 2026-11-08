import { BaseType } from "../../enums/Base.js";
import { MapRoomVersion } from "../../enums/MapRoom.js";

/**
 * Map Room 2 wild monster camps give 15% more of every resource (owner, 8 Nov
 * 2026, on top of the camp loot rebalance).
 *
 * Applied where the tribe Goo bonus is (`tribeGooBonus.ts`), after it: Twigs,
 * Pebbles, Putty and Goo (`r1`-`r4`) each go up 15%, rounded down, so Goo gets
 * both bonuses (x1.25, then x1.15). The extra goes on top of what the server's
 * replay credited; the camp does not lose it, and the attacker's storage cap
 * still applies when it is banked. Map Room 2 camps only: Map Room 1 tribes
 * (`scaledMR1Tribes.ts`), Map Room 3, Inferno tribes, outposts and players'
 * yards get nothing extra.
 */
export const CAMP_LOOT_BONUS_PERCENT = 15;

const KEYS = ["r1", "r2", "r3", "r4"] as const;

type Credit = { readonly r1?: number; readonly r2?: number; readonly r3?: number; readonly r4?: number };

/** Whether an attack on a base of `type` by a player on `attackerMapVersion` is on a Map Room 2 camp. */
export const isMR2Camp = (type: string | undefined, attackerMapVersion: number | undefined): boolean =>
  type === BaseType.TRIBE && attackerMapVersion === MapRoomVersion.V2;

export const withCampLootBonus = <T extends Credit>(credit: T, fromMR2Camp: boolean): T => {
  if (!fromMR2Camp) return credit;
  let out: T | null = null;
  for (const key of KEYS) {
    const amount = credit[key];
    if (typeof amount !== "number" || amount <= 0) continue;
    out ??= { ...credit };
    (out as Record<string, unknown>)[key] = Math.floor((amount * (100 + CAMP_LOOT_BONUS_PERCENT)) / 100);
  }
  return out ?? credit;
};
