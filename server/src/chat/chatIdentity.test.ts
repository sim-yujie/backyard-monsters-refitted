import { beforeEach, describe, expect, test } from "bun:test";
import { mock } from "bun:test";
import { ChannelType } from "../enums/Chat.js";
import type { ChatClient } from "./chatState.js";

/**
 * `notifyLevelChange` (issue #232): the chat server derives a player's
 * `[level] name` itself rather than trusting the client (`chatIdentity.ts`'s
 * file comment on `authenticate`), so a level change is pushed the same way —
 * by recomputing the name and comparing it to what is already broadcast,
 * never by the caller tracking whether the level actually moved.
 *
 * `../server.js` and `./chatTransport.js` are replaced so this never reaches
 * real Postgres or Redis: `notifyLevelChange` itself doesn't use either, but
 * importing `chatIdentity.ts` pulls in `chatRooms.ts` (for `leaveAllChannels`),
 * which does.
 */

const published: { channel: string; payload: string }[] = [];

mock.module("../server.js", () => ({
  postgres: {},
  redis: {},
}));

mock.module("./chatTransport.js", () => ({
  publishToChannel: (channel: string, payload: string) => {
    published.push({ channel, payload });
  },
  subscribeToChannel: () => {},
  unsubscribeFromChannel: () => {},
}));

const { notifyLevelChange } = await import("./chatIdentity.js");
const { clients } = await import("./chatState.js");
const { ServerMessageType } = await import("./chatProtocol.js");

const USERID = 2505;
const USERNAME = "agenttester";

const fakeClient = (displayName: string): ChatClient => ({
  ws: { data: { userId: USERID, displayName, lastMsgAt: 0 } } as unknown as ChatClient["ws"],
  userId: USERID,
  displayName,
  username: USERNAME,
  picSquare: null,
  channels: new Map([["chat:mr2-global", { type: ChannelType.Global }]]),
  lastMsgAt: 0,
});

describe("notifyLevelChange (#232)", () => {
  beforeEach(() => {
    published.length = 0;
    clients.clear();
  });

  test("does nothing when the player has no open chat connection", () => {
    notifyLevelChange(USERID, USERNAME, 5);

    expect(published).toEqual([]);
  });

  test("does nothing when the level is already the one last broadcast", () => {
    const client = fakeClient("[5] agenttester");
    clients.set(USERID, client);

    notifyLevelChange(USERID, USERNAME, 5);

    expect(published).toEqual([]);
    expect(client.displayName).toBe("[5] agenttester");
  });

  test("broadcasts the new name to every channel the player is in, and updates the client", () => {
    const client = fakeClient("[5] agenttester");
    client.channels.set("chat:alliance:9", { type: ChannelType.Alliance, allianceId: 9 });
    clients.set(USERID, client);

    notifyLevelChange(USERID, USERNAME, 6);

    expect(client.displayName).toBe("[6] agenttester");
    expect(client.ws.data.displayName).toBe("[6] agenttester");

    expect(published.map((p) => p.channel).sort()).toEqual(["chat:alliance:9", "chat:mr2-global"]);
    for (const { payload } of published) {
      expect(JSON.parse(payload)).toMatchObject({
        type: ServerMessageType.NameUpdate,
        userId: USERID,
        displayName: "[6] agenttester",
      });
    }
  });

  test("a lower level than last broadcast is pushed too, not just a rise", () => {
    const client = fakeClient("[8] agenttester");
    clients.set(USERID, client);

    notifyLevelChange(USERID, USERNAME, 7);

    expect(client.displayName).toBe("[7] agenttester");
    expect(published).toHaveLength(1);
  });
});
