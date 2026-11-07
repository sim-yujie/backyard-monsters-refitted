import { describe, expect, mock, test } from "bun:test";
import { ChatControlType } from "../enums/Chat.js";
import type { ChatClient } from "./chatState.js";

/**
 * New mail on the chat connection (`chatMail.ts`): the player's open
 * connection is told "mail", with no mail text; a player with no connection
 * here is skipped; other control messages are left to the other handlers.
 */

mock.module("../server.js", () => ({ postgres: {}, redis: {} }));

const { applyMailNudge } = await import("./chatMail.js");
const { clients } = await import("./chatState.js");

const fakeClient = (userId: number) => {
  const sent: unknown[] = [];
  const client = {
    ws: { data: { userId }, send: (data: string) => sent.push(JSON.parse(data)), close: () => {} },
    userId,
    displayName: `p${userId}`,
    username: `p${userId}`,
    picSquare: null,
    channels: new Map(),
    lastMsgAt: 0,
  } as unknown as ChatClient;
  return { client, sent };
};

describe("new mail on the chat connection", () => {
  test("tells the player's open connection, and only theirs", () => {
    const one = fakeClient(4101);
    const other = fakeClient(4102);
    clients.set(4101, one.client);
    clients.set(4102, other.client);
    expect(applyMailNudge({ type: ChatControlType.Mail, userId: 4101 })).toBe(true);
    expect(one.sent).toEqual([{ type: "mail" }]);
    expect(other.sent).toEqual([]);
    clients.delete(4101);
    clients.delete(4102);
  });

  test("a player with no connection here is skipped quietly", () => {
    expect(applyMailNudge({ type: ChatControlType.Mail, userId: 4199 })).toBe(true);
  });

  test("leaves other control messages alone", () => {
    expect(applyMailNudge({ type: ChatControlType.Moderators })).toBe(false);
    expect(applyMailNudge({ type: ChatControlType.Notice, userId: 4101 })).toBe(false);
  });
});
