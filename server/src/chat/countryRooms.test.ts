import { beforeEach, describe, expect, mock, test } from "bun:test";
import { ChannelType, ChatControlType } from "../enums/Chat.js";
import type { ChatClient } from "./chatState.js";

/**
 * Country chat rooms (owner 3 Nov 2026). A player is let into a country room
 * only when the room is the one their stored country gives them, whatever the
 * client asks for; a country change takes them out of the old room; and a
 * line said there is stored and broadcast as in Global.
 *
 * `../server.js`, `./chatTransport.js` and `./chatHistory.js` are replaced so
 * nothing reaches real Postgres or Redis.
 */

let stored: { country: string | null } | null = null;
const lookups: unknown[] = [];
const published: { channel: string; payload: string }[] = [];
const pushed: { channel: string; entry: unknown }[] = [];

mock.module("../server.js", () => ({
  postgres: {
    orm: {
      em: {
        fork: () => ({
          findOne: async (_entity: unknown, where: unknown, options: unknown) => {
            lookups.push({ where, options });
            return stored;
          },
        }),
      },
    },
  },
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

const { authorizeJoin, evict, joinChannel, postMessage } = await import("./chatRooms.js");

const USERID = 2503;

const fakeClient = (): ChatClient => ({
  ws: {
    data: { userId: USERID, displayName: "[30] yardtester", lastMsgAt: 0 },
    send: () => {},
  } as unknown as ChatClient["ws"],
  userId: USERID,
  displayName: "[30] yardtester",
  username: "yardtester",
  picSquare: null,
  channels: new Map(),
  lastMsgAt: 0,
});

beforeEach(() => {
  stored = null;
  lookups.length = 0;
  published.length = 0;
  pushed.length = 0;
});

describe("authorizeJoin: country rooms", () => {
  test("a player from the Philippines joins the Philippines room", async () => {
    stored = { country: "PH" };
    const resolved = await authorizeJoin(USERID, "chat:country:PH");
    expect(resolved).toEqual({
      key: "chat:country:PH",
      info: { type: ChannelType.Country, country: "PH" },
    });
    expect(lookups).toEqual([{ where: { userid: USERID }, options: { fields: ["country"] } }]);
  });

  test("another country's room is refused, even one that exists", async () => {
    stored = { country: "SG" };
    expect(await authorizeJoin(USERID, "chat:country:PH")).toBeNull();
  });

  test("every country has a room: a player from Singapore joins the Singapore room", async () => {
    stored = { country: "SG" };
    expect(await authorizeJoin(USERID, "chat:country:SG")).toEqual({
      key: "chat:country:SG",
      info: { type: ChannelType.Country, country: "SG" },
    });
  });

  test("no country set, or no such player, means no country room", async () => {
    stored = { country: null };
    expect(await authorizeJoin(USERID, "chat:country:PH")).toBeNull();
    stored = null;
    expect(await authorizeJoin(USERID, "chat:country:PH")).toBeNull();
  });

  test("a stored code that is not a country gets no room", async () => {
    stored = { country: "XX" };
    expect(await authorizeJoin(USERID, "chat:country:XX")).toBeNull();
  });

  test("odd spellings of a room name are refused", async () => {
    stored = { country: "PH" };
    expect(await authorizeJoin(USERID, "chat:country:ph")).toBeNull();
    expect(await authorizeJoin(USERID, "chat:country:")).toBeNull();
    expect(await authorizeJoin(USERID, "country")).toBeNull();
  });

  test("Global is joined as before, without a lookup", async () => {
    stored = { country: "PH" };
    expect(await authorizeJoin(USERID, "chat:mr2-global")).toEqual({
      key: "chat:mr2-global",
      info: { type: ChannelType.Global },
    });
    expect(lookups).toEqual([]);
  });
});

describe("postMessage in a country room", () => {
  test("is kept in the room's history and broadcast with the level name, as Global", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    published.length = 0;

    await postMessage(client, "chat:country:PH", "  kumusta  ");

    expect(pushed).toHaveLength(1);
    expect(pushed[0]!.channel).toBe("chat:country:PH");
    expect(pushed[0]!.entry).toMatchObject({ userId: USERID, displayName: "[30] yardtester", body: "kumusta" });
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]!.payload)).toMatchObject({
      type: "message",
      channel: "chat:country:PH",
      body: "kumusta",
    });
  });

  // Owner, 3 Nov: chatting is playing, so a line said keeps the player
  // protected and connected, as a real game action does.
  test("a line said is a real game action; a refused one is not", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    const recorded: number[] = [];
    const record = async (userid: number) => {
      recorded.push(userid);
    };

    await postMessage(client, "chat:country:PH", "kumusta", record);
    await postMessage(client, "chat:country:PH", "too soon", record);
    await postMessage(client, "chat:country:XX", "not in it", record);

    expect(recorded).toEqual([USERID]);
  });

  test("a line still goes out when its action cannot be written", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    published.length = 0;

    await postMessage(client, "chat:country:PH", "kumusta", async () => {
      throw new Error("redis down");
    });

    expect(published).toHaveLength(1);
  });

  test("the rate limit is shared with Global", async () => {
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });

    await postMessage(client, "chat:mr2-global", "hello");
    await postMessage(client, "chat:country:PH", "kumusta");

    expect(pushed.map((entry) => entry.channel)).toEqual(["chat:mr2-global"]);
  });
});

describe("a country change (CountryEvict)", () => {
  const holding = () => {
    const client = fakeClient();
    joinChannel(client, "chat:mr2-global", { type: ChannelType.Global });
    joinChannel(client, "chat:country:PH", { type: ChannelType.Country, country: "PH" });
    return client;
  };

  test("takes the player out of the old country room and leaves Global", () => {
    const client = holding();
    evict(client, { type: ChatControlType.CountryEvict, userId: USERID, keep: null });
    expect([...client.channels.keys()]).toEqual(["chat:mr2-global"]);
  });

  test("keeps the new country's room when the join overtook the message", () => {
    const client = holding();
    joinChannel(client, "chat:country:SG", { type: ChannelType.Country, country: "SG" });
    evict(client, { type: ChatControlType.CountryEvict, userId: USERID, keep: "chat:country:SG" });
    expect([...client.channels.keys()]).toEqual(["chat:mr2-global", "chat:country:SG"]);
  });

  test("an alliance eviction does not touch country rooms", () => {
    const client = holding();
    evict(client, { type: ChatControlType.AllianceEvict, userId: USERID });
    expect([...client.channels.keys()]).toEqual(["chat:mr2-global", "chat:country:PH"]);
  });
});
