import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  allianceSightKey,
  attackLogCachePattern,
  BOT_CHECK_LOG_KEY,
  CHAT_HISTORY_PATTERN,
  CHAT_IGNORE_PATTERN,
  LEADERBOARD_PATTERN,
  playerKeyPatterns,
  playerKeys,
  saveKeys,
} from "./accountRedisKeys.js";

/**
 * The Redis key names account deletion copies (`accountRedisKeys.ts`) still
 * match the modules that write them. Read as source text, since importing
 * those modules would import `server.ts`. A failure here means a key was
 * renamed: update the copy, or the deletion leaves the new key behind.
 */

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

/** Each owner, and the key template it must still contain. */
const OWNERS: [file: string, template: string][] = [
  ["services/auth/sessions.ts", "`user-token:${sessionType}:${email}`"],
  ["chat/chatChannels.ts", "`chat-token:${userId}`"],
  ["chat/chatChannels.ts", "`chat-ignore:${userId}`"],
  ["services/maproom/sight/sightService.ts", "`sight:${userid}`"],
  ["services/maproom/sight/sightService.ts", "`sight:ally:${allianceId}`"],
  ["services/user/online.ts", "`last-action:${userid}`"],
  ["services/user/online.ts", "`presence-challenge:${userid}`"],
  ["services/user/online.ts", "`last-seen:${BaseType.MAIN}:${userid}`"],
  ["controllers/inferno/infernoSave.ts", "`last-seen:inferno:${user.userid}`"],
  ["services/raids/raidStore.ts", "`wild-raid:${userid}`"],
  ["services/raids/raidStore.ts", "`raid-screen:${userid}`"],
  ["services/base/autoAttack/autoAttack.ts", "`auto-attack:${userid}`"],
  ["services/base/autoAttack/autoAttack.ts", "`auto-attack-replay:${userid}`"],
  ["services/user/botChallenge.ts", "`bot-check:challenge:${userid}`"],
  ["services/user/botChallenge.ts", "`bot-check:wrong:${userid}`"],
  ["services/user/botChallenge.ts", "`bot-check:cooldown:${userid}`"],
  ["services/user/botPatterns.ts", "`bot-check:times:${userid}`"],
  ["services/user/botPatterns.ts", "`bot-check:stay:${userid}`"],
  ["services/user/botPatterns.ts", "`bot-check:routes:${userid}:${bucket}`"],
  ["services/base/attackCheckpoint.ts", "`attack-checkpoint:${basesaveid}`"],
  ["services/base/attackCheckpoint.ts", "`attack-final:${basesaveid}`"],
  ["services/base/attackSession.ts", "`attack-session:${basesaveid}`"],
  ["services/maproom/v2/takeoverGrantStore.ts", "`takeover-grant:${basesaveid}`"],
  ["services/maproom/v1/mr1TribeSession.ts", "`attack-session:mr1:${userid}:${baseid}`"],
  ["services/maproom/v1/mr1TribeSession.ts", "`attack-final:mr1:${userid}:${baseid}`"],
  ["controllers/attacklogs/getAttackLogs.ts", "`attackLogs:${userid}:${filter}`"],
  ["chat/chatHistory.ts", "`history:${channel}`"],
  ["controllers/leaderboards/getLeaderboards.ts", "`leaderboards_${worldid}_v${version}`"],
  ["services/user/botCheckLog.ts", `BOT_CHECK_LOG_KEY = "bot-check:log"`],
];

describe("the Redis keys account deletion removes (accountRedisKeys.ts)", () => {
  test.each(OWNERS)("%s still writes %s", (file, template) => {
    expect(source(file)).toContain(template);
  });

  test("a player's own keys, by id and email", () => {
    expect(playerKeys(42, "bob@example.com")).toEqual([
      "user-token:game:bob@example.com",
      "user-token:launcher:bob@example.com",
      "chat-token:42",
      "chat-ignore:42",
      "sight:42",
      "last-action:42",
      "presence-challenge:42",
      "last-seen:main:42",
      "last-seen:inferno:42",
      "wild-raid:42",
      "raid-screen:42",
      "auto-attack:42",
      "auto-attack-replay:42",
      "bot-check:challenge:42",
      "bot-check:wrong:42",
      "bot-check:cooldown:42",
      "bot-check:times:42",
      "bot-check:stay:42",
    ]);
  });

  test("keys by save, the patterns with more after the id, and the shared ones", () => {
    expect(saveKeys(7)).toEqual(["attack-checkpoint:7", "attack-final:7", "attack-session:7", "takeover-grant:7"]);
    expect(playerKeyPatterns(42)).toEqual([
      "bot-check:routes:42:*",
      "attackLogs:42:*",
      "attack-session:mr1:42:*",
      "attack-final:mr1:42:*",
    ]);
    expect(attackLogCachePattern(9)).toBe("attackLogs:9:*");
    expect(allianceSightKey(3)).toBe("sight:ally:3");
    expect([CHAT_HISTORY_PATTERN, CHAT_IGNORE_PATTERN, BOT_CHECK_LOG_KEY, LEADERBOARD_PATTERN]).toEqual([
      "history:*",
      "chat-ignore:*",
      "bot-check:log",
      "leaderboards_*",
    ]);
  });
});
