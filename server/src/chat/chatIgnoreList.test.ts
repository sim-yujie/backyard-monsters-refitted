import { beforeEach, describe, expect, mock, test } from "bun:test";

import { memoryRedis } from "../testing/memoryRedis.js";
import type { ChatClient } from "./chatState.js";

/**
 * The chat mute list (`chat-ignore:<id>`): only positive whole-number ids go
 * in, and at most `MAX_MUTED` of them; either way the list is sent back.
 * `../server.js` is replaced so Redis is in memory.
 */
const redis = memoryRedis();
mock.module("../server.js", () => ({ postgres: {}, redis }));

const { addIgnore, removeIgnore, MAX_MUTED } = await import("./chatIgnoreList.js");
const { chatIgnoreKey } = await import("./chatChannels.js");

const sent: { type: string; list: { target: string }[] }[] = [];
const client = {
  userId: 42,
  ws: { send: (raw: string) => sent.push(JSON.parse(raw)) },
} as unknown as ChatClient;
const key = chatIgnoreKey(42);

describe("the chat mute list", () => {
  beforeEach(() => {
    redis.clear();
    sent.length = 0;
  });

  test("a positive whole-number id goes in; anything else is refused, and the list is still sent", async () => {
    await addIgnore(client, "7");
    for (const bad of ["0", "-3", "1.5", "abc", "", "7 ", "1e3", "99999999999999999999"]) {
      await addIgnore(client, bad);
    }
    expect(await redis.smembers(key)).toEqual(["7"]);
    expect(sent).toHaveLength(9);
    expect(sent.at(-1)!.list.map((entry) => entry.target)).toEqual(["7"]);

    await removeIgnore(client, "7");
    expect(await redis.smembers(key)).toEqual([]);
  });

  test(`a list at ${MAX_MUTED} takes no more, but stays as it was`, async () => {
    await redis.sadd(key, ...Array.from({ length: MAX_MUTED }, (_, i) => String(1000 + i)));
    await addIgnore(client, "5");
    expect(await redis.scard(key)).toBe(MAX_MUTED);
    expect(await redis.smembers(key)).not.toContain("5");
    expect(sent.at(-1)!.list).toHaveLength(MAX_MUTED);

    // Unmuting one makes room again.
    await removeIgnore(client, "1000");
    await addIgnore(client, "5");
    expect(await redis.smembers(key)).toContain("5");
    expect(await redis.scard(key)).toBe(MAX_MUTED);
  });
});
