/**
 * Brukkarg War's Spurtz Cannon prize (beta 10), the web's copy of
 * `server/src/config/SpurtzConfig.ts` (a test on each side pins the numbers):
 * off the build menu for everyone else, a main yard holding the reward may
 * build that many. 3 yards beaten: 1 Spurtz Cannon; 4 yards: 2; 5 yards:
 * Black Diamond Spurtz Cannons, 2 allowed, plain ones no more.
 */
export const SPURTZ_TYPE = 136;
export const BLACK_SPURTZ_TYPE = 137;

/** Reward ids in the save's `rewards` (`server/src/enums/Rewards.ts`): this project's, not Flash's `spurtzCannonReward*`. */
export const SPURTZ_REWARD_1 = "brukwarSpurtz1";
export const SPURTZ_REWARD_2 = "brukwarSpurtz2";
export const DIAMOND_SPURTZ_REWARD = "brukwarSpurtz3";

const LIMITS: Readonly<Record<string, number>> = { [SPURTZ_REWARD_1]: 1, [SPURTZ_REWARD_2]: 2 };
export const BLACK_SPURTZ_LIMIT = 2;

const holds = (rewards: unknown, id: string): boolean =>
  Boolean(rewards && typeof rewards === "object" && (rewards as Record<string, unknown>)[id]);

/** How many of `type` the yard may hold by its Spurtz rewards; 0 when none. */
export const spurtzAllowed = (type: number, rewards: unknown): number => {
  const diamond = holds(rewards, DIAMOND_SPURTZ_REWARD);
  if (type === BLACK_SPURTZ_TYPE) return diamond ? BLACK_SPURTZ_LIMIT : 0;
  if (type !== SPURTZ_TYPE || diamond) return 0;
  let allowed = 0;
  for (const [id, limit] of Object.entries(LIMITS)) if (holds(rewards, id)) allowed = Math.max(allowed, limit);
  return allowed;
};

/** The Spurtz types the Defensive tab adds for these rewards. */
export const spurtzTypesFor = (rewards: unknown): number[] =>
  [SPURTZ_TYPE, BLACK_SPURTZ_TYPE].filter((type) => spurtzAllowed(type, rewards) > 0);
