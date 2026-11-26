import { describe, expect, test } from "bun:test";

import { isLine, isRecentLineOf, removeChatLine, removeRecentChatLines, type CommandRedis } from "./removeChatLines.js";

/** A banned player's lines of the last hour leave every room's history; nothing else does. Redis is a fake. */

const line = (userId: number, ts: number, body = "hi") => JSON.stringify({ userId, displayName: `p${userId}`, body, ts });

const fakeRedis = (lists: Record<string, string[]>, other: Record<string, string> = {}) => {
  const calls: string[] = [];
  const published: { channel: string; payload: string }[] = [];
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
        case "PUBLISH":
          published.push({ channel: args[0]!, payload: args[1]! });
          return 1;
        case "LREM": {
          if (!lists[args[0]!]) return 0;
          const before = lists[args[0]!]!.length;
          lists[args[0]!] = lists[args[0]!]!.filter((entry) => entry !== args[2]);
          return before - lists[args[0]!]!.length;
        }
      }
      throw new Error(`unexpected ${command}`);
    },
  };
  return { redis, calls, lists, published };
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
      { "history:chat:not-a-list": "x", "history:other": "x" },
    );
    expect(await removeRecentChatLines(redis, 9, since)).toBe(4);
    expect(lists["history:chat:mr2-global"]).toEqual([line(4, NOW - 5), line(9, NOW - 7_200_000, "old")]);
    expect(lists["history:chat:country:ph"]).toEqual([]);
  });

  test("open chat boxes are told to drop each removed line, with no words; own copies go too", async () => {
    const own = JSON.stringify({ entry: { id: "x1", userId: 9, body: "t.me/abc", ts: NOW - 10 }, hidden: false });
    const { redis, lists, published } = fakeRedis({
      "history:chat:mr2-global": [JSON.stringify({ id: "x1", userId: 9, body: "[link removed]", ts: NOW - 10 })],
      "chat-own:9:chat:mr2-global": [own],
    });
    expect(await removeRecentChatLines(redis, 9, since)).toBe(1);
    expect(published).toEqual([
      { channel: "chat:mr2-global", payload: JSON.stringify({ type: "removed", channel: "chat:mr2-global", id: "x1", userId: 9, ts: NOW - 10 }) },
    ]);
    expect(lists["chat-own:9:chat:mr2-global"]).toEqual([]);
    expect(published[0]!.payload).not.toContain("t.me");
  });

  test("a line that is not JSON is left alone", () => {
    expect(isRecentLineOf("not json", 9, 0)).toBe(false);
    expect(isRecentLineOf(line(9, 5), 9, 5)).toBe(true);
    expect(isRecentLineOf(line(9, 4), 9, 5)).toBe(false);
    expect(isRecentLineOf(line(8, 5), 9, 5)).toBe(false);
  });
});

describe("a moderator removing one line", () => {
  const NOW = 1_800_000_000_000;

  test("by its id: out of the room's history and the sender's own copies, and announced", async () => {
    const theirs = JSON.stringify({ id: "a1", userId: 9, body: "[link removed]", ts: NOW });
    const keep = JSON.stringify({ id: "b2", userId: 9, body: "gg", ts: NOW + 1 });
    const { redis, lists, published } = fakeRedis({
      "history:chat:country:PH": [keep, theirs],
      "chat-own:9:chat:country:PH": [JSON.stringify({ entry: { id: "a1", userId: 9, body: "t.me/x", ts: NOW }, hidden: false })],
    });
    expect(await removeChatLine(redis, "chat:country:PH", { userId: 9, ts: NOW, id: "a1" })).toBe(1);
    expect(lists["history:chat:country:PH"]).toEqual([keep]);
    expect(lists["chat-own:9:chat:country:PH"]).toEqual([]);
    expect(JSON.parse(published[0]!.payload)).toEqual({ type: "removed", channel: "chat:country:PH", id: "a1", userId: 9, ts: NOW });
  });

  test("a line stored before ids, by speaker and stamp; a hidden line is still announced", async () => {
    const old = line(9, NOW);
    const { redis, lists, published } = fakeRedis({ "history:chat:mr2-global": [old, line(4, NOW)] });
    expect(await removeChatLine(redis, "chat:mr2-global", { userId: 9, ts: NOW })).toBe(1);
    expect(lists["history:chat:mr2-global"]).toEqual([line(4, NOW)]);
    expect(await removeChatLine(redis, "chat:mr2-global", { userId: 9, ts: NOW + 5, id: "gone" })).toBe(0);
    expect(published).toHaveLength(2);
  });

  test("never another speaker's line with the same stamp", () => {
    expect(isLine(line(4, NOW), { userId: 9, ts: NOW })).toBe(false);
    expect(isLine(JSON.stringify({ id: "a1", userId: 4, ts: 1 }), { userId: 9, ts: 2, id: "a1" })).toBe(false);
  });
});
