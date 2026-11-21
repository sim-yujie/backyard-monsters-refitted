import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatClient, SocketData } from "./chatState.js";

/**
 * The presence ping over the chat socket (beta 9, `chatPresence.ts`): it
 * answers what `POST /bm/presence` answers, only for this socket's own
 * signed-in player, and says `ok: false` (send it over HTTP) otherwise.
 *
 * The session check, the route's answer and the API version are replaced, so
 * nothing reaches Postgres or Redis.
 */

let sessionOf: (token: string) => Promise<{ user: { userid: number }; meetsDiscordAgeCheck: boolean } | null>;
const pinged: { userid: number; body: unknown }[] = [];
let validVersion = "v1.6.1-beta";

mock.module("../server.js", () => ({ postgres: { orm: { em: {} } }, redis: {} }));
mock.module("@mikro-orm/core", () => ({
  RequestContext: { create: (_em: unknown, next: () => Promise<unknown>) => next() },
}));
mock.module("../middleware/auth.js", () => ({ sessionUser: (token: string) => sessionOf(token) }));
mock.module("../middleware/apiVersioning.js", () => ({
  isValidApiVersion: (version: unknown) => version === validVersion,
}));
mock.module("../controllers/maproom/presence.js", () => ({
  answerPing: async (user: { userid: number }, body: unknown) => {
    pinged.push({ userid: user.userid, body });
    return { error: 0, now: 100, lastAction: 90, checkPending: false };
  },
}));

const { handlePresence, PRESENCE_MIN_GAP_MS } = await import("./chatPresence.js");
const { ClientMessageType } = await import("./chatProtocol.js");

const socket = () => {
  const sent: Record<string, unknown>[] = [];
  const ws = {
    data: { userId: 2503, displayName: "", lastMsgAt: 0 } as SocketData,
    send: (data: string) => sent.push(JSON.parse(data)),
  };
  return { ws: ws as unknown as Parameters<typeof handlePresence>[0], sent };
};
const client = { userId: 2503 } as ChatClient;

const ping = (extra: Record<string, unknown> = {}) => ({
  type: ClientMessageType.Presence,
  id: 7,
  token: "good",
  apiVersion: "v1.6.1-beta",
  screen: { where: "yard", planner: false },
  ...extra,
});

beforeEach(() => {
  pinged.length = 0;
  validVersion = "v1.6.1-beta";
  sessionOf = async (token) => (token === "good" ? { user: { userid: 2503 }, meetsDiscordAgeCheck: true } : null);
});

describe("presence ping over the chat socket", () => {
  test("answers the route's answer under the ping's id, with the screen passed on", async () => {
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping(), 10_000);
    expect(sent).toEqual([
      { type: "presence", id: 7, ok: true, answer: { error: 0, now: 100, lastAction: 90, checkPending: false } },
    ]);
    expect(pinged).toEqual([{ userid: 2503, body: { where: "yard", planner: false } }]);
  });

  test("a session token that no longer counts (signed in elsewhere, banned) is refused, and nothing is marked", async () => {
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping({ token: "stale" }), 10_000);
    expect(sent).toEqual([{ type: "presence", id: 7, ok: false, reason: "auth" }]);
    expect(pinged).toEqual([]);
  });

  test("another player's token on this socket is refused", async () => {
    sessionOf = async () => ({ user: { userid: 9999 }, meetsDiscordAgeCheck: true });
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping(), 10_000);
    expect(sent).toEqual([{ type: "presence", id: 7, ok: false, reason: "auth" }]);
    expect(pinged).toEqual([]);
  });

  test("a token that cannot be read, or none, is refused", async () => {
    sessionOf = async () => {
      throw new Error("jwt malformed");
    };
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping(), 10_000);
    await handlePresence(ws, client, ping({ id: 8, token: undefined }), 20_000);
    expect(sent).toEqual([
      { type: "presence", id: 7, ok: false, reason: "auth" },
      { type: "presence", id: 8, ok: false, reason: "auth" },
    ]);
  });

  test("an API version the routes would refuse is refused", async () => {
    validVersion = "v9";
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping(), 10_000);
    expect(sent).toEqual([{ type: "presence", id: 7, ok: false, reason: "version" }]);
  });

  test("a second ping within the gap is answered throttled; after it, counted again", async () => {
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping({ id: 1 }), 10_000);
    await handlePresence(ws, client, ping({ id: 2 }), 10_000 + PRESENCE_MIN_GAP_MS - 1);
    await handlePresence(ws, client, ping({ id: 3 }), 10_000 + PRESENCE_MIN_GAP_MS + 1);
    expect(sent.map((m) => [m.id, m.ok, m.reason])).toEqual([
      [1, true, undefined],
      [2, false, "throttled"],
      [3, true, undefined],
    ]);
  });

  test("a ping without a usable id gets no answer", async () => {
    const { ws, sent } = socket();
    await handlePresence(ws, client, ping({ id: "x" }), 10_000);
    expect(sent).toEqual([]);
  });
});
