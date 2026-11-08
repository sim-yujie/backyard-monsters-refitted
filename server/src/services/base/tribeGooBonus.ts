/**
 * Wild tribes give 25% more Goo (owner, 8 Nov 2026, patch 6.9).
 *
 * Applied to the loot a battle credited from a wild monster tribe on Map Room 1
 * or Map Room 2, before it is banked: Goo (`r4`) goes up 25%, the other
 * resources stay as they are. The extra goes on top of what the server's own
 * replay credited (already capped by what the tribe holds); the tribe does not
 * lose the extra, and the attacker's storage cap still applies when it is
 * banked. Inferno tribes are not included.
 */
export const TRIBE_GOO_BONUS_PERCENT = 25;

export const withTribeGooBonus = <T extends { readonly r4?: number }>(credit: T, fromTribe: boolean): T => {
  const goo = credit.r4;
  if (!fromTribe || typeof goo !== "number" || goo <= 0) return credit;
  return { ...credit, r4: Math.floor((goo * (100 + TRIBE_GOO_BONUS_PERCENT)) / 100) };
};
