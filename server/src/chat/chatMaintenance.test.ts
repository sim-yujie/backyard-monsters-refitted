import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ChatClient } from "./chatState.js";

/**
 * The maintenance switch on the chat connection (owner, 22 Nov 2026): a
 * change reaches every open connection at once with the time left; at the
 * cut-off every non-owner is told and closed; past it a non-owner cannot
 * sign in to chat; off cancels the cut-off.
 */

mock.module("../server.js", () => ({
  postgres: { orm: { em: { fork: () => ({ findOne: async () => null }) } } },
  redis: {},
}));
mock.module("./chatTransport.js", () => ({
  publishToChannel: () => {},
  subscribeToChannel: () => {},
  unsubscribeFromChannel: () => {},
}));
mock.module("../utils/logger.js", () => ({
  logger: { warn: mock(() => {}), error: mock(() => {}), info: mock(() => {}), debug: mock(() => {}) },
}));

const { clients } = await import("./chatState.js");
const { initMaintenanceWatch, refusedForMaintenance, resetMaintenanceWatchForTests } = await import("./chatMaintenance.js");
const { setMaintenance, MAINTENANCE_OFF } = await import("../services/admin/maintenance.js");

const OWNER = 7;
const PLAYER = 2503;

const fakeClient = (userId: number) => {
  const sent: Record<string, unknown>[] = [];
  let closed = false;
  const ws = {
    data: { userId },
    send: (data: string) => sent.push(JSON.parse(data)),
    close: () => {
      closed = true;
    },
  } as unknown as ChatClient["ws"];
  const client: ChatClient = {
    ws,
    userId,
    displayName: `p${userId}`,
    username: `p${userId}`,
    picSquare: null,
    channels: new Map(),
    lastMsgAt: 0,
    gm: userId === OWNER,
    mutedUntil: 0,
  } as ChatClient;
  clients.set(userId, client);
  return { client, ws, sent, closed: () => closed };
};

let savedAdmins: string | undefined;

beforeEach(() => {
  savedAdmins = process.env.ADMIN_USER_IDS;
  process.env.ADMIN_USER_IDS = String(OWNER);
  clients.clear();
  initMaintenanceWatch();
});

afterEach(() => {
  setMaintenance(MAINTENANCE_OFF);
  resetMaintenanceWatchForTests();
  clients.clear();
  if (savedAdmins === undefined) delete process.env.ADMIN_USER_IDS;
  else process.env.ADMIN_USER_IDS = savedAdmins;
});

describe("chat and the maintenance switch", () => {
  test("On reaches every open connection at once, with the time left; the owner is marked exempt", () => {
    const player = fakeClient(PLAYER);
    const owner = fakeClient(OWNER);
    setMaintenance({ on: true, message: "Moving.", backAt: null, startedAt: Date.now(), cutoffAt: Date.now() + 5 * 60_000 });
    expect(player.sent).toHaveLength(1);
    expect(player.sent[0]).toMatchObject({ type: "maintenance", on: true, message: "Moving.", exempt: false });
    expect(player.sent[0]!.remainingMs as number).toBeGreaterThan(4 * 60_000);
    expect(owner.sent[0]).toMatchObject({ type: "maintenance", exempt: true });
    expect(player.closed()).toBe(false);
  });

  test("at the cut-off every non-owner is told and closed; the owner stays", async () => {
    const player = fakeClient(PLAYER);
    const owner = fakeClient(OWNER);
    setMaintenance({ on: true, message: "Moving.", backAt: null, startedAt: Date.now(), cutoffAt: Date.now() + 100 });
    await Bun.sleep(160);
    expect(player.closed()).toBe(true);
    expect(player.sent.at(-1)).toMatchObject({ type: "maintenance", on: true, remainingMs: 0 });
    expect(clients.has(PLAYER)).toBe(false);
    expect(owner.closed()).toBe(false);
    expect(clients.has(OWNER)).toBe(true);
  });

  test("Off during the countdown cancels it: everyone told, nobody closed", async () => {
    const player = fakeClient(PLAYER);
    setMaintenance({ on: true, message: "Moving.", backAt: null, startedAt: Date.now(), cutoffAt: Date.now() + 100 });
    setMaintenance(MAINTENANCE_OFF);
    await Bun.sleep(160);
    expect(player.sent.at(-1)).toMatchObject({ type: "maintenance", on: false });
    expect(player.closed()).toBe(false);
  });

  test("past the cut-off a non-owner's chat sign-in is refused; the owner's is not", () => {
    setMaintenance({ on: true, message: "Moving.", backAt: null, startedAt: Date.now() - 60_000, cutoffAt: Date.now() - 1 });
    const player = fakeClient(PLAYER);
    clients.delete(PLAYER);
    expect(refusedForMaintenance(player.ws, PLAYER)).toBe(true);
    expect(player.closed()).toBe(true);
    const owner = fakeClient(OWNER);
    expect(refusedForMaintenance(owner.ws, OWNER)).toBe(false);
  });
});
