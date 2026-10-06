import { describe, expect, test } from "bun:test";
import { CHAT_SOCKET_LIMITS, SPAM_LIMITS } from "../config/SpamLimitConfig.js";
import {
  armLoginDeadline,
  clearLoginDeadline,
  CLOSE_POLICY_VIOLATION,
  CLOSE_TOO_LARGE,
  closeIfTooLargeBeforeLogin,
  takeAllianceLine,
} from "./chatLimits.js";
import type { SocketData } from "./chatState.js";

/**
 * Chat socket limits and the alliance chat hourly limit (issue #323).
 */

type FakeSocket = { data: SocketData; closed: { code?: number; reason?: string } | null; close: (code?: number, reason?: string) => void };

const socket = (userId: number | null = null): FakeSocket => {
  const ws: FakeSocket = {
    data: { userId, displayName: "", lastMsgAt: 0, loginDeadline: null },
    closed: null,
    close: (code, reason) => {
      ws.closed = { code, reason };
    },
  };
  return ws;
};

const asWs = (ws: FakeSocket) => ws as never;

/** What the web client sends to log in (`chatSession.ts`). */
const LOGIN = JSON.stringify({ type: "auth", userId: 2505, token: crypto.randomUUID() });

/** The web client's longest line: 200 characters, here each four bytes of UTF-8. */
const LONGEST_SAY = JSON.stringify({ type: "say", channel: "chat:mr2-global", message: "😀".repeat(100) });

describe("message size", () => {
  test("lets the web client's login through before login", () => {
    const ws = socket();
    expect(closeIfTooLargeBeforeLogin(asWs(ws), LOGIN)).toBe(false);
    expect(ws.closed).toBeNull();
  });

  test("closes a connection that sends more than a login needs before logging in", () => {
    const ws = socket();
    const big = "x".repeat(CHAT_SOCKET_LIMITS.maxUnauthenticatedBytes + 1);
    expect(closeIfTooLargeBeforeLogin(asWs(ws), big)).toBe(true);
    expect(ws.closed?.code).toBe(CLOSE_TOO_LARGE);
  });

  test("measures text as UTF-8 bytes, and buffers by length", () => {
    const halfAsManyEmoji = "😀".repeat(Math.ceil(CHAT_SOCKET_LIMITS.maxUnauthenticatedBytes / 4) + 1);
    expect(closeIfTooLargeBeforeLogin(asWs(socket()), halfAsManyEmoji)).toBe(true);
    const buffer = Buffer.alloc(CHAT_SOCKET_LIMITS.maxUnauthenticatedBytes + 1);
    expect(closeIfTooLargeBeforeLogin(asWs(socket()), buffer)).toBe(true);
  });

  test("leaves a logged-in connection to Bun's cap, which fits the web client's longest line", () => {
    const ws = socket(2505);
    expect(closeIfTooLargeBeforeLogin(asWs(ws), LONGEST_SAY)).toBe(false);
    expect(ws.closed).toBeNull();
    expect(Buffer.byteLength(LONGEST_SAY)).toBeLessThan(CHAT_SOCKET_LIMITS.maxMessageBytes);
    expect(CHAT_SOCKET_LIMITS.maxMessageBytes).toBeLessThanOrEqual(16 * 1024);
  });
});

describe("login deadline", () => {
  test("closes a connection that has not logged in in time", async () => {
    const ws = socket();
    armLoginDeadline(asWs(ws), 5);
    await Bun.sleep(30);
    expect(ws.closed?.code).toBe(CLOSE_POLICY_VIOLATION);
  });

  test("leaves a connection that logged in", async () => {
    const ws = socket();
    armLoginDeadline(asWs(ws), 5);
    ws.data.userId = 2505;
    await Bun.sleep(30);
    expect(ws.closed).toBeNull();
  });

  test("is cancelled by clearing it", async () => {
    const ws = socket();
    armLoginDeadline(asWs(ws), 5);
    clearLoginDeadline(asWs(ws));
    await Bun.sleep(30);
    expect(ws.closed).toBeNull();
    expect(ws.data.loginDeadline).toBeNull();
  });

  test("gives a real client a few seconds", () => {
    expect(CHAT_SOCKET_LIMITS.authDeadlineMs).toBeGreaterThanOrEqual(5_000);
    expect(CHAT_SOCKET_LIMITS.authDeadlineMs).toBeLessThanOrEqual(30_000);
  });
});

describe("takeAllianceLine", () => {
  const { max, minutes } = SPAM_LIMITS.allianceChat;
  const start = 1_000_000_000;

  test("lets the hourly limit through, then refuses", () => {
    for (let line = 0; line < max; line++) expect(takeAllianceLine(9201, start + line)).toBe(true);
    expect(takeAllianceLine(9201, start + max)).toBe(false);
  });

  test("counts each player apart", () => {
    for (let line = 0; line < max; line++) takeAllianceLine(9202, start);
    expect(takeAllianceLine(9202, start)).toBe(false);
    expect(takeAllianceLine(9203, start)).toBe(true);
  });

  test("starts a new count once the window has passed", () => {
    for (let line = 0; line <= max; line++) takeAllianceLine(9204, start);
    expect(takeAllianceLine(9204, start + minutes * 60_000 - 1)).toBe(false);
    expect(takeAllianceLine(9204, start + minutes * 60_000)).toBe(true);
  });
});
