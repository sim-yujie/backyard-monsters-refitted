import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { AllianceMessageType } from "../enums/Alliance.js";
import { ChannelType, ChatControlType } from "../enums/Chat.js";
import type { HistoryEntry } from "./chatProtocol.js";
import type { ChatClient } from "./chatState.js";

/**
 * The game team in chat (dashboard moderation): only an `ADMIN_USER_IDS`
 * account's lines carry the game team's mark, whatever a client or a stored
 * line claims; a muted player's lines are refused until the mute ends; and a
 * ban closes the player's open connection with the reason.
 *
 * `../server.js`, `./chatTransport.js` and `./chatHistory.js` are replaced so
 * nothing reaches real Postgres or Redis.
 */

const published: { channel: string; payload: string }[] = [];
const pushed: { channel: string; entry: unknown }[] = [];

mock.module("../server.js", () => ({
  postgres: { orm: { em: { fork: () => ({ findOne: async () => null }) } } },
  redis: {},
}));

mock.module("./chatTransport.js", () => ({
  publishToChannel: (channel: string, payload: string) => {
    published.push({ channel, payload });
  },
  subscribeToChannel: () => {},
  unsubscribeFromChannel: () => {},
}));

mock.module("./chatHistory.js", () => ({
  pushMessage: async (channel: string, entry: unknown) => {
    pushed.push({ channel, entry });
  },
  getHistory: async () => [],
}));

const { joinChannel, postMessage } = await import("./chatRooms.js");
const { markGameTeam } = await import("./chatGameTeam.js");
const { applyModeration } = await import("./chatModeration.js");
const { clients } = await import("./chatState.js");

const OWNER = 7;
const PLAYER = 2503;
const GLOBAL = "chat:mr2-global";

const fakeClient = (userId: number, extra: Partial<ChatClient> = {}) => {
  const sent: unknown[] = [];
  let closed = false;
  const client: ChatClient = {
    ws: {
      data: { userId, displayName: `[30] p${userId}`, lastMsgAt: 0 },
      send: (data: string) => sent.push(JSON.parse(data)),
      close: () => {
        closed = true;
      },
    } as unknown as ChatClient["ws"],
    userId,
    displayName: `[30] p${userId}`,
    username: `p${userId}`,
    picSquare: null,
    channels: new Map(),
    lastMsgAt: 0,
    ...extra,
  };
  return { client, sent, closed: () => closed };
};

const entry = (userId: number, gm?: boolean): HistoryEntry => ({
  userId,
  displayName: `[1] p${userId}`,
  picSquare: null,
  allianceImage: null,
  body: "hi",
  messageType: AllianceMessageType.MESSAGE,
  ts: 1,
  ...(gm !== undefined && { gm }),
});

const savedAdmins = process.env.ADMIN_USER_IDS;

beforeEach(() => {
  process.env.ADMIN_USER_IDS = String(OWNER);
  published.length = 0;
  pushed.length = 0;
  clients.clear();
});

afterEach(() => {
  if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = savedAdmins;
});

describe("the game team's mark", () => {
  test("a history read marks exactly the admin accounts' lines", () => {
    expect(markGameTeam([entry(OWNER), entry(PLAYER, true), entry(PLAYER)]).map((e) => e.gm)).toEqual([
      true,
      undefined,
      undefined,
    ]);
  });

  test("an account taken off the list loses the mark on its old lines", () => {
    process.env.ADMIN_USER_IDS = "";
    expect(markGameTeam([entry(OWNER, true)])[0]!.gm).toBeUndefined();
  });

  test("a line from the game team is broadcast and kept with the mark", async () => {
    const { client } = fakeClient(OWNER, { gm: true });
    joinChannel(client, GLOBAL, { type: ChannelType.Global });
    published.length = 0;

    await postMessage(client, GLOBAL, "Please keep chat friendly.");

    expect(pushed[0]!.entry).toMatchObject({ userId: OWNER, gm: true });
    expect(JSON.parse(published[0]!.payload)).toMatchObject({ type: "message", userId: OWNER, gm: true });
  });

  test("a player's line has no mark", async () => {
    const { client } = fakeClient(PLAYER);
    joinChannel(client, GLOBAL, { type: ChannelType.Global });
    published.length = 0;

    await postMessage(client, GLOBAL, "hello");

    expect(JSON.parse(published[0]!.payload).gm).toBeUndefined();
    expect((pushed[0]!.entry as HistoryEntry).gm).toBeUndefined();
  });
});

describe("a mute", () => {
  test("refuses the player's lines until it ends, saying when", async () => {
    const until = Date.now() + 60_000;
    const { client, sent } = fakeClient(PLAYER, { mutedUntil: until });
    joinChannel(client, GLOBAL, { type: ChannelType.Global });
    published.length = 0;

    await postMessage(client, GLOBAL, "still here");

    expect(published).toHaveLength(0);
    expect(pushed).toHaveLength(0);
    expect(sent.at(-1)).toEqual({ type: "error", code: "muted", until });
  });

  test("an ended mute lets lines through", async () => {
    const { client } = fakeClient(PLAYER, { mutedUntil: Date.now() - 1 });
    joinChannel(client, GLOBAL, { type: ChannelType.Global });
    published.length = 0;

    await postMessage(client, GLOBAL, "back");

    expect(published).toHaveLength(1);
  });

  test("a mute from the dashboard reaches the open connection", () => {
    const { client } = fakeClient(PLAYER);
    clients.set(PLAYER, client);
    expect(applyModeration({ type: ChatControlType.Mute, userId: PLAYER, until: 123 })).toBe(true);
    expect(client.mutedUntil).toBe(123);
    applyModeration({ type: ChatControlType.Mute, userId: PLAYER, until: 0 });
    expect(client.mutedUntil).toBe(0);
  });
});

describe("a ban", () => {
  test("tells the player why, closes the connection and takes them out of every room", () => {
    const { client, sent, closed } = fakeClient(PLAYER);
    clients.set(PLAYER, client);
    joinChannel(client, GLOBAL, { type: ChannelType.Global });

    applyModeration({ type: ChatControlType.Kick, userId: PLAYER, until: null, text: "Your account is banned for good." });

    expect(sent).toContainEqual({ type: "kicked", reason: "banned", until: null, text: "Your account is banned for good." });
    expect(closed()).toBe(true);
    expect(clients.has(PLAYER)).toBe(false);
    expect(client.channels.size).toBe(0);
  });

  test("a warning nudges the player's game to show it", () => {
    const { client, sent } = fakeClient(PLAYER);
    clients.set(PLAYER, client);
    applyModeration({ type: ChatControlType.Notice, userId: PLAYER });
    expect(sent).toEqual([{ type: "notice" }]);
  });

  test("other control messages are left to the gateway", () => {
    expect(applyModeration({ type: ChatControlType.AllianceEvict, userId: PLAYER })).toBe(false);
  });
});
