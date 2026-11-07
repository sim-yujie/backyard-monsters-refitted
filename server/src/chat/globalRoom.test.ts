import { describe, expect, mock, test } from "bun:test";

import { memoryRedis } from "../testing/memoryRedis.js";

/**
 * Patch 6.6 (owner, 7 Nov 2026): Map Room 1 and Map Room 2 players share one
 * global chat room, the Map Room 2 one. A page loaded before the patch still
 * joins with Map Room 1's old key and lands in the shared room.
 */
mock.module("../server.js", () => ({ postgres: {}, redis: memoryRedis() }));

const { getChatChannel, validateChannel } = await import("./chatChannels.js");
const { GLOBAL_CHAT_CHANNEL, INFERNO_CHAT_CHANNEL, LEGACY_MR1_CHAT_CHANNEL } = await import("../config/ChatConfig.js");
const { MapRoomVersion } = await import("../enums/MapRoom.js");

describe("one global room for Map Room 1 and 2", () => {
  test("both map versions get the same room, Map Room 2's", () => {
    expect(GLOBAL_CHAT_CHANNEL).toBe("chat:mr2-global");
    expect(getChatChannel(MapRoomVersion.V1)).toBe(GLOBAL_CHAT_CHANNEL);
    expect(getChatChannel(MapRoomVersion.V2)).toBe(GLOBAL_CHAT_CHANNEL);
    expect(getChatChannel(MapRoomVersion.V3)).toBe("chat:mr3-global");
  });

  test("Map Room 1's old key joins the shared room; other rooms are unchanged", () => {
    expect(validateChannel(LEGACY_MR1_CHAT_CHANNEL)).toBe(GLOBAL_CHAT_CHANNEL);
    expect(validateChannel(GLOBAL_CHAT_CHANNEL)).toBe(GLOBAL_CHAT_CHANNEL);
    expect(validateChannel(INFERNO_CHAT_CHANNEL)).toBe(INFERNO_CHAT_CHANNEL);
    expect(validateChannel("chat:mr9-global")).toBeNull();
    expect(validateChannel("")).toBeNull();
  });
});
