import { describe, expect, test } from "bun:test";

import { isRecentLineOf, removeRecentChatLines, type CommandRedis } from "./removeChatLines.js";

/** A banned player's lines of the last hour leave every room's history; nothing else does. Redis is a fake. */

const line = (userId: number, ts: number, body = "hi") => JSON.stringify({ userId, displayName: `p${userId}`, body, ts });

const fakeRedis = (lists: Record<string, string[]>, other: Record<string, string> = {}) => {
  const calls: string[] = [];
  const redis: CommandRedis = {
    send: async (command, args) => {
      calls.push(`${command} ${args[0]}`);
      switch (command) {
        case "SCAN": {
          const pattern = new RegExp(`^${args[2]!.replace(/\*/g, ".*")}$`);
          return ["0", [...Object.keys(lists), ...Object.keys(other)].filter((k) => pattern.test(k))];
        }
        case "TYPE":
          return lists[args[0]!] ? "list" : "string";
        case "LRANGE":
          return [...(lists[args[0]!] ?? [])];
        case "LREM": {
          const before = lists[args[0]!]!.length;
          lists[args[0]!] = lists[args[0]!]!.filter((entry) => entry !== args[2]);
          return before - lists[args[0]!]!.length;
        }
      }
      throw new Error(`unexpected ${command}`);
    },
  };
  return { redis, calls, lists };
};

describe("removing a banned player's recent chat lines", () => {
  const NOW = 1_800_000_000_000;
  const since = NOW - 3_600_000;

  test("only their lines, only since the hour began, in every room", async () => {
    const { redis, lists } = fakeRedis(
      {
        "history:chat:mr2-global": [line(9, NOW - 10), line(4, NOW - 5), line(9, NOW - 7_200_000, "old"), line(9, NOW - 20)],
        "history:chat:country:ph": [line(9, NOW - 1000), line(9, NOW - 1000)],
      },
      { "history:not-a-list": "x" },
    );
    expect(await removeRecentChatLines(redis, 9, since)).toBe(4);
    expect(lists["history:chat:mr2-global"]).toEqual([line(4, NOW - 5), line(9, NOW - 7_200_000, "old")]);
    expect(lists["history:chat:country:ph"]).toEqual([]);
  });

  test("a line that is not JSON is left alone", () => {
    expect(isRecentLineOf("not json", 9, 0)).toBe(false);
    expect(isRecentLineOf(line(9, 5), 9, 5)).toBe(true);
    expect(isRecentLineOf(line(9, 4), 9, 5)).toBe(false);
    expect(isRecentLineOf(line(8, 5), 9, 5)).toBe(false);
  });
});
