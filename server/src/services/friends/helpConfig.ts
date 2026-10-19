import { FRIEND_LIMITS } from "./friendRules.js";

/**
 * Every number the help rules use (`docs/design/friends.md` §4 and §7, owner
 * questions Q1, Q3, Q4 and Q7, approved 2026-10-19), in one place so an owner
 * answer is a one-line change. The daily cap and the friendship age live in
 * {@link FRIEND_LIMITS} (WP1), which the friends list reads too.
 */
export const HELP_RULES = {
  /** Helps a player can give in a UTC day, speed-ups and repairs together (Q1). */
  dailyHelps: FRIEND_LIMITS.dailyHelps,
  /** Share of the time left one speed-up takes off, rounded down (`BFOUNDATION.HelpB`). */
  speedupShare: 0.05,
  /** Friends who can speed up one job (`BFOUNDATION.Help`: a sixth is refused). */
  helpersPerJob: 5,
  /** Share of the lower of the two storage caps the helper earns per help, in each resource (Q3). */
  rewardShare: 0.0025,
} as const;

/**
 * Who may help, or send a gift (§7 rules 1 and 2, Q7): friends this long, both
 * accounts this old, both at this level or above.
 */
export const FRIEND_GATES = {
  friendshipAgeHours: FRIEND_LIMITS.friendshipAgeHours,
  accountAgeDays: 3,
  minLevel: 5,
} as const;
