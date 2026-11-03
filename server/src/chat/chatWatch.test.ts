import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ChannelType } from "../enums/Chat.js";
import type { ChatClient } from "./chatState.js";

/**
 * What the chat server keeps for the dashboard when a line is said: World and
 * country lines go into the chat log with the player's own words, a line the
 * filter caught in a monitored room (World, the Philippines room) becomes a
 * flag, and players still get the masked line in every room. A
 * database that fails never stops the line going out.
 *
 * `../server.js`, `./chatTransport.js` and `./chatHistory.js` are replaced so
 * nothing reaches real Postgres or Redis.
 */

const executed: { sql: string; params: unknown[] }[] = [];
let failDatabase = false;
const published: { channel: string; payload: string }[] = [];
const pushed: { channel: string; entry: { body: string } }[] = [];

mock.module("../server.js", () => ({
  postgres: {
    orm: {
      em: {
        fork: () => ({
          execute: async (sql: string, params: unknown[]) => {
            if (failDatabase) throw new Error("database down");
            executed.push({ sql, params });
            return [];
          },
        }),
      },
    },
  },
  redis: { setex: async () => {} },
}));

mock.module("./chatTransport.js", () => ({
  publishToChannel: (channel: string, payload: string) => {
    published.push({ channel, payload });
  },
  subscribeToChannel: () => {},
  unsubscribeFromChannel: () => {},
}));

mock.module("./chatHistory.js", () => ({
  pushMessage: async (channel: string, entry: { body: string }) => {
    pushed.push({ channel, entry });
  },
  getHistory: async () => [],
}));

const { joinChannel, postMessage } = await import("./chatRooms.js");
const { flushChatLog, watchLine } = await import("./chatWatch.js");
const { makeWordFilter } = await import("../services/chat/badWords.js");
const { checkLine } = await import("../services/chat/chatFlags.js");

let nextUser = 5000;

const fakeClient = (): ChatClient => {
  const userId = nextUser++;
  return {
    ws: { data: { userId, lastMsgAt: 0 }, send: () => {} } as unknown as ChatClient["ws"],
    userId,
    displayName: `[30] tester${userId}`,
    username: `tester${userId}`,
    picSquare: null,
    channels: new Map(),
    lastMsgAt: 0,
  };
};

const said = () => published.filter((p) => JSON.parse(p.payload).type === "message").map((p) => JSON.parse(p.payload).body);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

beforeEach(async () => {
  failDatabase = false;
  await flushChatLog();
  await settle();
  executed.length = 0;
  published.length = 0;
  pushed.length = 0;
});

describe("chat lines on the dashboard", () => {
  test("a slur in World: players see it masked; the flag and the log keep the player's words", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });
    await postMessage(client, "chat:mr2-global", "  shut up faggot ");
    await settle();

    expect(said()).toEqual(["shut up ******"]);
    expect(pushed.map((p) => p.entry.body)).toEqual(["shut up ******"]);

    const flags = executed.filter((e) => e.sql.includes("bym.chat_flag"));
    expect(flags.length).toBe(1);
    expect(flags[0]!.params.slice(0, 6)).toEqual([
      client.userId,
      "chat:mr2-global",
      "shut up faggot",
      "shut up ******",
      "faggot",
      "slur",
    ]);

    await flushChatLog();
    const logged = executed.filter((e) => e.sql.includes("bym.chat_log"));
    expect(logged.length).toBe(1);
    expect(logged[0]!.params.slice(0, 5)).toEqual([client.userId, "chat:mr2-global", "shut up faggot", "shut up ******", "slur"]);
  });

  test("a clean country room line is logged and not flagged", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    await postMessage(client, "chat:country:PH", "kain na tayo");
    await flushChatLog();
    await settle();

    expect(said()).toEqual(["kain na tayo"]);
    expect(executed.filter((e) => e.sql.includes("bym.chat_flag"))).toEqual([]);
    const logged = executed.filter((e) => e.sql.includes("bym.chat_log"));
    expect(logged.map((e) => e.params.slice(0, 5))).toEqual([
      [client.userId, "chat:country:PH", "kain na tayo", "kain na tayo", null],
    ]);
  });

  test("a line that only has an ordinary word the filter masks is logged but not flagged", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });
    await postMessage(client, "chat:mr2-global", "what the hell");
    await settle();

    expect(said()).toEqual(["what the ****"]);
    expect(executed.filter((e) => e.sql.includes("bym.chat_flag"))).toEqual([]);
  });

  test("when the database fails, the line still goes out and nothing throws", async () => {
    failDatabase = true;
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });

    await postMessage(client, "chat:mr2-global", "fuck this");
    await flushChatLog();
    await settle();

    expect(said()).toEqual(["**** this"]);
    expect(pushed.length).toBe(1);
    expect(executed).toEqual([]);
  });

  test("one player swearing again and again stores a few flags, and logs every line", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });
    for (let i = 0; i < 8; i++) {
      client.lastMsgAt = 0;
      await postMessage(client, "chat:mr2-global", `fuck ${i}`);
    }
    await flushChatLog();
    await settle();

    expect(said().length).toBe(8);
    expect(executed.filter((e) => e.sql.includes("bym.chat_flag")).length).toBe(5);
    const logged = executed.filter((e) => e.sql.includes("bym.chat_log"));
    expect(logged.reduce((sum, e) => sum + e.params.length / 6, 0)).toBe(8);
  });
  test("the Philippines room is monitored: a swear there flags, marked disguised when spelled to get past", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    await postMessage(client, "chat:country:PH", "g4g0 ka talaga");
    await settle();

    expect(said()).toEqual(["**** ka talaga"]);
    const flags = executed.filter((e) => e.sql.includes("bym.chat_flag"));
    expect(flags.map((e) => e.params.slice(0, 7))).toEqual([
      [client.userId, "chat:country:PH", "g4g0 ka talaga", "**** ka talaga", "gago", "swear", "disguised"],
    ]);
  });

  test("another country room: the swear is masked and logged, but makes no flag", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:US", { type: ChannelType.Country, country: "US" });
    await postMessage(client, "chat:country:US", "shut up faggot");
    await flushChatLog();
    await settle();

    expect(said()).toEqual(["shut up ******"]);
    expect(executed.filter((e) => e.sql.includes("bym.chat_flag"))).toEqual([]);
    const logged = executed.filter((e) => e.sql.includes("bym.chat_log"));
    expect(logged.map((e) => e.params.slice(0, 5))).toEqual([
      [client.userId, "chat:country:US", "shut up faggot", "shut up ******", null],
    ]);
  });

  test("alliance chat: the swear is masked, but the line is neither flagged nor logged", async () => {
    const check = checkLine(makeWordFilter({}), "fuck you retard");
    expect(check.shown).toBe("**** you ******");
    watchLine({ userid: 77, channel: "chat:alliance:9", channelType: ChannelType.Alliance, message: "fuck you retard", check, ts: Date.now() });
    await flushChatLog();
    await settle();

    expect(executed).toEqual([]);
  });
});
