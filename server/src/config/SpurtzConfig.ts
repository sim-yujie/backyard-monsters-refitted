import { Reward } from "../enums/Rewards.js";

/**
 * The Spurtz Cannons, Brukkarg War's prize (beta 10, bruk-port). Left out of
 * the build menu for everyone else (`services/yard/build.ts`); a player who
 * has won one of these rewards may build that many (Flash
 * `brukkargWar/rewards/SpurtzCannonReward1-3.as`):
 *
 * - {@link Reward.SPURTZ1} (3 yards beaten): 1 Spurtz Cannon;
 * - {@link Reward.SPURTZ2} (4 yards): 2 Spurtz Cannons;
 * - {@link Reward.DIAMOND_SPURTZ} (5 yards): every Spurtz Cannon in the yard
 *   becomes a Black Diamond Spurtz Cannon at its level, and 2 of those may be
 *   built; plain ones no more.
 *
 * The limits are here so the owner's balance decision (desk, 27 Nov 2026)
 * changes one line.
 */
export const SPURTZ_TYPE = 136;
export const BLACK_SPURTZ_TYPE = 137;

/** Plain Spurtz Cannons allowed by each reward the player holds (the highest counts). */
export const SPURTZ_LIMITS: Readonly<Partial<Record<Reward, number>>> = {
  [Reward.SPURTZ1]: 1,
  [Reward.SPURTZ2]: 2,
};

/** Black Diamond Spurtz Cannons allowed once {@link Reward.DIAMOND_SPURTZ} is won. */
export const BLACK_SPURTZ_LIMIT = 2;

/** The reward each Brukkarg War Spurtz prize (1-3) grants. */
export const SPURTZ_PRIZE_REWARDS: Readonly<Record<1 | 2 | 3, Reward>> = {
  1: Reward.SPURTZ1,
  2: Reward.SPURTZ2,
  3: Reward.DIAMOND_SPURTZ,
};

const holds = (rewards: unknown, reward: Reward): boolean =>
  Boolean(rewards && typeof rewards === "object" && (rewards as Record<string, unknown>)[reward]);

/**
 * How many of `type` a yard with these `rewards` may hold by its Spurtz
 * rewards: 0 for a type that is not a Spurtz Cannon, or without the reward.
 */
export const spurtzAllowed = (type: number, rewards: unknown): number => {
  const diamond = holds(rewards, Reward.DIAMOND_SPURTZ);
  if (type === BLACK_SPURTZ_TYPE) return diamond ? BLACK_SPURTZ_LIMIT : 0;
  if (type !== SPURTZ_TYPE || diamond) return 0;
  let allowed = 0;
  for (const [reward, limit] of Object.entries(SPURTZ_LIMITS)) {
    if (holds(rewards, reward as Reward)) allowed = Math.max(allowed, limit ?? 0);
  }
  return allowed;
};
