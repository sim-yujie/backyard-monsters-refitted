import { FRIEND_LIMITS } from "./friendRules.js";

/**
 * Every number the help rules use (`docs/design/friends.md` §4 and §7, owner
 * questions Q1, Q3, Q4 and Q7, approved 2026-10-19), in one place so an owner
 * answer is a one-line change. The friendship age lives in
 * {@link FRIEND_LIMITS} (WP1), which the friends list reads too. There is no
 * daily cap on helps given (owner, 15 Nov 2026: was 20 a day, Q1); only the
 * first {@link HELP_RULES}.rewardedHelpsPerDay of a UTC day pay a reward.
 */
export const HELP_RULES = {
  /** Share of the time left one speed-up takes off, rounded down (`BFOUNDATION.HelpB`). */
  speedupShare: 0.05,
  /** Friends who can speed up one job (`BFOUNDATION.Help`: a sixth is refused). */
  helpersPerJob: 5,
  /** Share of the lower of the two storage caps the helper earns per help, in each resource (Q3). */
  rewardShare: 0.0025,
  /**
   * Helps a UTC day that pay {@link rewardShare}, speed-ups and repairs
   * together (owner, 15 Nov 2026). Later helps still go through, for nothing.
   */
  rewardedHelpsPerDay: 5,
} as const;

/**
 * Who may help, or send a gift (§7 rules 1 and 2, Q7): friends this long, both
 * at this level or above. No account-age rule (owner 2026-10-29: it was 3 days).
 */
export const FRIEND_GATES = {
  friendshipAgeHours: FRIEND_LIMITS.friendshipAgeHours,
  minLevel: 5,
} as const;

/**
 * Every number the gift rules use (`docs/design/friends.md` §5 and §7, issue
 * #375). Who may send a gift is {@link FRIEND_GATES}, as for help.
 */
export const GIFT_RULES = {
  /** Share of the lower of the sender's and the receiver's storage caps one gift is worth, rounded down. */
  share: 0.03,
  /** Gifts a player can collect in a UTC day; the rest wait (owner, 9 Nov 2026: was 5). */
  collectsPerDay: 10,
  /** Days a gift waits to be collected before it lapses. */
  waitDays: 7,
} as const;
