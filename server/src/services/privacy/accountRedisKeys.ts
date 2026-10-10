import { SessionType } from "../../enums/SessionType.js";

/**
 * The Redis keys that belong to one player, for deleting an account
 * (`services/privacy/deleteAccount.ts`).
 *
 * The names are copied from the modules that own them rather than imported,
 * because those modules import `server.ts`, which would boot a server inside
 * the admin script. `accountRedisKeys.test.ts` checks each copy against its
 * owner, so a renamed key fails a test instead of being left behind.
 */

/** Keys named by the player's id or email. */
export const playerKeys = (userid: number, email: string): string[] => [
  // Login tokens (`services/auth/sessions.ts`): dropping them logs the player out everywhere.
  ...Object.values(SessionType).map((sessionType) => `user-token:${sessionType}:${email}`),
  // Chat (`chat/chatChannels.ts`).
  `chat-token:${userid}`,
  `chat-ignore:${userid}`,
  // Fog of war sight cache (`services/maproom/sight/sightService.ts`).
  `sight:${userid}`,
  // Presence (`services/user/online.ts`, `controllers/maproom/presence.ts`).
  `last-action:${userid}`,
  `presence-challenge:${userid}`,
  `last-seen:main:${userid}`,
  `last-seen:inferno:${userid}`,
  // Wild monster raids (`services/raids/raidStore.ts`).
  `wild-raid:${userid}`,
  `raid-screen:${userid}`,
  // Auto attack (`services/base/autoAttack/autoAttack.ts`).
  `auto-attack:${userid}`,
  `auto-attack-replay:${userid}`,
  // Fair-play checks (`services/user/botChallenge.ts`, `services/user/botPatterns.ts`).
  `bot-check:challenge:${userid}`,
  `bot-check:wrong:${userid}`,
  `bot-check:cooldown:${userid}`,
  `bot-check:times:${userid}`,
  `bot-check:stay:${userid}`,
];

/** Keys named by one of the player's saves (`services/base/attackCheckpoint.ts`, `attackSession.ts`, `takeoverGrantStore.ts`). */
export const saveKeys = (basesaveid: number): string[] => [
  `attack-checkpoint:${basesaveid}`,
  `attack-final:${basesaveid}`,
  `attack-session:${basesaveid}`,
  `takeover-grant:${basesaveid}`,
];

/** SCAN patterns for the player's keys with more after the id. */
export const playerKeyPatterns = (userid: number): string[] => [
  `bot-check:routes:${userid}:*`,
  // The player's own battle log cache (`controllers/attacklogs/getAttackLogs.ts`).
  `attackLogs:${userid}:*`,
  // Map Room 1 tribe attacks (`services/maproom/v1/mr1TribeSession.ts`).
  `attack-session:mr1:${userid}:*`,
  `attack-final:mr1:${userid}:*`,
];

/** Another player's cached battle log, which shows the deleted player's name. */
export const attackLogCachePattern = (userid: number): string => `attackLogs:${userid}:*`;

/** An alliance's fog of war sight cache. */
export const allianceSightKey = (allianceId: number): string => `sight:ally:${allianceId}`;

/** Every world chat room's last lines (`chat/chatHistory.ts`): JSON entries with `userId`. */
export const CHAT_HISTORY_PATTERN = "history:*";

/** Every player's chat ignore list (`chat/chatChannels.ts`): sets of user ids. */
export const CHAT_IGNORE_PATTERN = "chat-ignore:*";

/** The fair-play log (`services/user/botCheckLog.ts`): JSON rows with `userid`. */
export const BOT_CHECK_LOG_KEY = "bot-check:log";

/** The Map Room leaderboards cache (`controllers/leaderboards/getLeaderboards.ts`), which lists names. */
export const LEADERBOARD_PATTERN = "leaderboards_*";
