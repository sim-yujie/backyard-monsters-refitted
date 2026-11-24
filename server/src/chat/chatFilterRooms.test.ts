import { beforeEach, describe, expect, mock, test } from "bun:test";

import { ChannelType } from "../enums/Chat.js";
import { memoryRedis } from "../testing/memoryRedis.js";
import type { ChatClient } from "./chatState.js";

/**
 * The chat filter in the chat server (owner, 24 Nov 2026): what goes to the
 * room, to its history and to the sender when a line is cut or hidden.
 *
 * The one rule that must never break: the sender's original words reach
 * nobody but the sender. Every published payload, every line in the room's
 * history and another player's join are searched for them.
 *
 * Redis is an in-memory stand-in (history and the sender's own copies are
 * the real code); publishing, photos and the dashboard's watch are recorded.
 */

const redis = memoryRedis();
const published: { channel: string; payload: string; except?: number }[] = [];
const watched: { message: string; shown?: string; filter?: { tags: readonly string[]; hidden: boolean }; lineId?: string; yardAgeHours?: number | null }[] = [];

mock.module("../server.js", () => ({
  postgres: { orm: { em: { fork: () => ({ execute: async () => [] }) } } },
  redis,
}));

mock.module("./chatTransport.js", () => ({
  publishToChannel: (channel: string, payload: string, except?: number) => {
    published.push({ channel, payload, ...(except !== undefined && { except }) });
  },
  subscribeToChannel: () => {},
  unsubscribeFromChannel: () => {},
}));

mock.module("./chatPhotos.js", () => ({
  speakerPhoto: async () => null,
  withCurrentPhotos: async <T>(entries: T) => entries,
}));

mock.module("./chatWatch.js", () => ({
  watchLine: (line: (typeof watched)[number]) => {
    watched.push(line);
  },
}));

const { getChannelHistory, joinChannel, postMessage } = await import("./chatRooms.js");
const { setChatModerators } = await import("./chatModerators.js");
const { LINK_REMOVED } = await import("../services/chat/chatFilter.js");

const PH = "chat:country:PH";
const US = "chat:country:US";
const GLOBAL = "chat:mr2-global";
const HOUR = 3_600_000;

let nextUser = 7100;

interface TestClient extends ChatClient {
  readonly got: Record<string, unknown>[];
}

const client = (yardAgeHours: number | null, extra: Partial<ChatClient> = {}): TestClient => {
  const userId = nextUser++;
  const got: Record<string, unknown>[] = [];
  return {
    ws: { data: { userId, lastMsgAt: 0 }, send: (data: string) => got.push(JSON.parse(data)) } as unknown as ChatClient["ws"],
    userId,
    displayName: `[3] player${userId}`,
    username: `player${userId}`,
    picSquare: null,
    channels: new Map(),
    lastMsgAt: 0,
    yardCreatedAt: yardAgeHours === null ? null : Date.now() - yardAgeHours * HOUR,
    got,
    ...extra,
  };
};

const inRoom = (who: TestClient, channel: string): TestClient => {
  joinChannel(who, channel, channel.startsWith("chat:country:") ? { type: ChannelType.Country, country: channel.slice(-2) } : { type: ChannelType.Global });
  return who;
};

const roomInfo = (channel: string) =>
  channel.startsWith("chat:country:") ? { type: ChannelType.Country as const, country: channel.slice(-2) } : { type: ChannelType.Global as const };

const messages = () => published.filter((p) => JSON.parse(p.payload).type === "message").map((p) => ({ ...p, line: JSON.parse(p.payload) }));

/** Every string anyone but the sender could ever be sent: published payloads and each room's stored history. */
const everythingOthersCanSee = async (): Promise<string> => {
  const history: string[] = [];
  for (const channel of [PH, US, GLOBAL]) history.push(...(await redis.lrange(`history:${channel}`, 0, -1)));
  return [...published.map((p) => p.payload), ...history].join("\n");
};

beforeEach(() => {
  redis.clear();
  published.length = 0;
  watched.length = 0;
  setChatModerators([]);
});

describe("chat filter: a new player's link", () => {
  test("the room gets [link removed], the sender his own words, and nobody else the link", async () => {
    const sender = inRoom(client(30), PH);
    const other = inRoom(client(500), PH);
    await postMessage(sender, PH, "sali na kayo t.me/bymps_ph dito");

    const [room] = messages();
    expect(room?.line.body).toBe(`sali na kayo ${LINK_REMOVED} dito`);
    expect(room?.except).toBe(sender.userId);
    expect(sender.got.filter((m) => m.type === "message").map((m) => m.body)).toEqual(["sali na kayo t.me/bymps_ph dito"]);
    expect(await everythingOthersCanSee()).not.toContain("t.me/bymps_ph");

    // A later join (or a reload) of someone else: the cut line.
    const theirs = await getChannelHistory(PH, roomInfo(PH), other.userId);
    expect(theirs.map((e) => e.body)).toEqual([`sali na kayo ${LINK_REMOVED} dito`]);
    // The sender's own reload: his words, same id as the room's line.
    const his = await getChannelHistory(PH, roomInfo(PH), sender.userId);
    expect(his.map((e) => e.body)).toEqual(["sali na kayo t.me/bymps_ph dito"]);
    expect(his[0]?.id).toBe(theirs[0]?.id);
    expect(typeof his[0]?.id).toBe("string");
  });

  test("a new player's ordinary link is cut; an older player's posts as it is", async () => {
    await postMessage(inRoom(client(2), GLOBAL), GLOBAL, "look youtube.com/watch?v=1");
    await postMessage(inRoom(client(100), GLOBAL), GLOBAL, "look youtube.com/watch?v=2");
    expect(messages().map((m) => m.line.body)).toEqual([`look ${LINK_REMOVED}`, "look youtube.com/watch?v=2"]);
    expect(messages()[1]?.except).toBeUndefined();
  });

  test("a group invite is cut for an older player too, and our own links never are", async () => {
    const old = inRoom(client(1000), US);
    await postMessage(old, US, "join facebook.com/groups/123");
    old.lastMsgAt = 0;
    await postMessage(old, US, "news at bymrevamped.com and discord.gg/wthryBRZHz");
    expect(messages().map((m) => m.line.body)).toEqual([`join ${LINK_REMOVED}`, "news at bymrevamped.com and discord.gg/wthryBRZHz"]);
    expect(await everythingOthersCanSee()).not.toContain("facebook.com/groups/123");
  });
});

describe("chat filter: a new player's watched word", () => {
  test("the line is hidden from the room and its history; only the sender sees it, also after a reload", async () => {
    const sender = inRoom(client(5), PH);
    const other = inRoom(client(800), PH);
    await postMessage(other, PH, "gg sa raid kanina");
    await postMessage(sender, PH, "Hi sino papasok sa private server bmy");

    expect(messages().map((m) => m.line.body)).toEqual(["gg sa raid kanina"]);
    expect(await everythingOthersCanSee()).not.toContain("private server");
    expect(sender.got.filter((m) => m.type === "message").map((m) => m.body)).toEqual(["Hi sino papasok sa private server bmy"]);

    expect((await getChannelHistory(PH, roomInfo(PH), other.userId)).map((e) => e.body)).toEqual(["gg sa raid kanina"]);
    expect((await getChannelHistory(PH, roomInfo(PH))).map((e) => e.body)).toEqual(["gg sa raid kanina"]);
    expect((await getChannelHistory(PH, roomInfo(PH), sender.userId)).map((e) => e.body)).toEqual([
      "gg sa raid kanina",
      "Hi sino papasok sa private server bmy",
    ]);
    expect(watched.at(-1)).toMatchObject({ shown: "", filter: { hidden: true, tags: ["watched", "hidden"] }, yardAgeHours: 5 });
  });

  test("naming BYMR keeps the line up (flagged), links still cut", async () => {
    await postMessage(inRoom(client(5), PH), PH, "may fb group ba ang BYMR? t.me/x");
    expect(messages().map((m) => m.line.body)).toEqual([`may fb group ba ang BYMR? ${LINK_REMOVED}`]);
    expect(watched.at(-1)?.filter).toMatchObject({ hidden: false });
  });

  test("an older player's watched word posts to everyone, the same words", async () => {
    await postMessage(inRoom(client(200), GLOBAL), GLOBAL, "anyone on telegram?");
    expect(messages()).toMatchObject([{ line: { body: "anyone on telegram?" } }]);
    expect(messages()[0]?.except).toBeUndefined();
    expect(watched.at(-1)?.filter).toMatchObject({ hidden: false, tags: ["watched"] });
  });
});

describe("chat filter: who and where", () => {
  test("moderators and the game team are not new players", async () => {
    const mod = inRoom(client(1), GLOBAL);
    setChatModerators([mod.userId]);
    await postMessage(mod, GLOBAL, "no private server ads please, see bymrevamped.com or example.com/rules");
    const gm = inRoom(client(1, { gm: true }), GLOBAL);
    await postMessage(gm, GLOBAL, "example.com/x private server");
    expect(messages().map((m) => m.line.body)).toEqual([
      "no private server ads please, see bymrevamped.com or example.com/rules",
      "example.com/x private server",
    ]);
  });

  test("alliance chat is never filtered", async () => {
    const sender = client(1);
    sender.channels.set("chat:alliance:9", { type: ChannelType.Alliance, allianceId: 9 });
    // The alliance store is Postgres; the line is refused before it if the filter ran on it, so stop at the store.
    await postMessage(sender, "chat:alliance:9", "t.me/abc private server").catch(() => {});
    expect(published.every((p) => !p.payload.includes(LINK_REMOVED))).toBe(true);
  });

  test("every public room is filtered, not only the monitored ones", async () => {
    for (const channel of [GLOBAL, "chat:mr3-global", "chat:inferno-global", US, "chat:country:BR"]) {
      const sender = inRoom(client(1), channel);
      await postMessage(sender, channel, "sali t.me/abc");
    }
    expect(messages().map((m) => m.line.body)).toEqual(Array(5).fill(`sali ${LINK_REMOVED}`));
    expect(watched).toHaveLength(5);
    expect(watched.every((w) => w.filter?.tags.includes("invite"))).toBe(true);
  });

  test("a clean line goes out once, to everyone, with an id", async () => {
    await postMessage(inRoom(client(1), GLOBAL), GLOBAL, "gg");
    expect(messages()).toHaveLength(1);
    expect(messages()[0]?.except).toBeUndefined();
    expect(typeof messages()[0]?.line.id).toBe("string");
  });
});
