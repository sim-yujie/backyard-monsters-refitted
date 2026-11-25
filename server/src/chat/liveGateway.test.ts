import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  closeLive,
  fanOutSight,
  fanOutZones,
  initLiveGateway,
  liveStats,
  MAX_WATCHED,
  resetLiveGateway,
  routeLive,
  type LiveIdentity,
} from "./liveGateway.js";

/** The live map's socket side (beta 9): sign-in, watched zones, pushes only to watchers. */

const identities: Record<string, LiveIdentity> = {
  a: { userId: 1, allianceId: 7, world: "w" },
  b: { userId: 2, allianceId: null, world: "w" },
  c: { userId: 3, allianceId: null, world: "other" },
};
let alliances = new Map<number, number | null>();
let versions = new Map<number, number>();

const socket = () => {
  const sent: Record<string, unknown>[] = [];
  const ws = {
    data: { userId: null, displayName: "", lastMsgAt: 0, loginDeadline: null } as Record<string, unknown>,
    readyState: 1,
    closed: null as null | number,
    send: (text: string) => {
      sent.push(JSON.parse(text));
      return text.length;
    },
    close(code: number) {
      this.closed = code;
    },
  };
  return { ws, sent, frame: (message: unknown) => routeLive(ws as never, JSON.stringify(message)) };
};

beforeEach(() => {
  alliances = new Map();
  versions = new Map();
  initLiveGateway({
    authenticate: async (token) => identities[token] ?? null,
    versions: async (_world, ids) => ids.map((id) => versions.get(id) ?? 0),
    alliancesOf: async (ids) => new Map(ids.map((id) => [id, alliances.get(id) ?? null])),
    warn: () => {},
  });
});
afterEach(resetLiveGateway);

const signedIn = async (token: string) => {
  const s = socket();
  await s.frame({ type: "live.auth", token });
  return s;
};

describe("live map gateway", () => {
  test("signs in with the game token, and refuses a bad one", async () => {
    const good = await signedIn("a");
    expect(good.sent).toEqual([{ type: "live.ok" }]);
    const bad = await signedIn("nope");
    expect(bad.sent).toEqual([{ type: "live.fail" }]);
    expect(bad.ws.closed).toBe(1008);
  });

  test("chat frames, and frames on a chat socket, are left to chat", async () => {
    const s = socket();
    expect(await routeLive(s.ws as never, JSON.stringify({ type: "auth", userId: 1, token: "x" }))).toBe(false);
    s.ws.data.userId = 5;
    expect(await routeLive(s.ws as never, JSON.stringify({ type: "live.auth", token: "a" }))).toBe(false);
  });

  test("a sign-in frame over 512 bytes closes the socket", async () => {
    const s = socket();
    await s.frame({ type: "live.auth", token: "x".repeat(600) });
    expect(s.ws.closed).toBe(1009);
  });

  test("a watch is answered with every watched zone's version, and bad ids are dropped", async () => {
    const s = await signedIn("a");
    versions.set(120034, 5);
    await s.frame({ type: "live.watch", z: [120034, 99999999, "x", 10001] });
    expect(s.sent.at(-1)).toEqual({ type: "live.zones", all: 1, z: [[120034, 5], [10001, 0]] });
  });

  test("a watch is capped at MAX_WATCHED zones", async () => {
    const s = await signedIn("a");
    const many = Array.from({ length: 400 }, (_, i) => Math.floor(i / 80) * 10000 + (i % 80));
    await s.frame({ type: "live.watch", z: many });
    expect((s.sent.at(-1)!.z as unknown[]).length).toBe(MAX_WATCHED);
  });

  test("a change goes only to sockets watching that zone on that world, one frame each", async () => {
    const a = await signedIn("a");
    const b = await signedIn("b");
    const c = await signedIn("c");
    await a.frame({ type: "live.watch", z: [1, 2] });
    await b.frame({ type: "live.watch", z: [3] });
    await c.frame({ type: "live.watch", z: [1] });
    for (const s of [a, b, c]) s.sent.length = 0;

    fanOutZones(JSON.stringify({ w: "w", z: { 1: 4, 2: 9, 50: 1 } }));
    expect(a.sent).toEqual([{ type: "live.zones", z: [[1, 4], [2, 9]] }]);
    expect(b.sent).toEqual([]);
    expect(c.sent).toEqual([]);
  });

  test("a second watch inside the gap still applies, and is answered once the gap is over", async () => {
    const a = await signedIn("a");
    await a.frame({ type: "live.watch", z: [1] });
    await a.frame({ type: "live.watch", z: [2] });
    a.sent.length = 0;
    fanOutZones(JSON.stringify({ w: "w", z: { 1: 5, 2: 6 } }));
    expect(a.sent).toEqual([{ type: "live.zones", z: [[2, 6]] }]);
    await Bun.sleep(250);
    expect(a.sent.at(-1)).toEqual({ type: "live.zones", all: 1, z: [[2, 0]] });
  });

  test("a new watch replaces the old one; a closed socket gets nothing more", async () => {
    const a = await signedIn("a");
    await a.frame({ type: "live.watch", z: [1] });
    await Bun.sleep(210);
    await a.frame({ type: "live.watch", z: [2] });
    a.sent.length = 0;
    fanOutZones(JSON.stringify({ w: "w", z: { 1: 2 } }));
    expect(a.sent).toEqual([]);
    expect(closeLive(a.ws as never)).toBe(true);
    fanOutZones(JSON.stringify({ w: "w", z: { 2: 2 } }));
    expect(a.sent).toEqual([]);
    expect(liveStats()).toEqual({ sockets: 0, zones: 0 });
  });

  test("sight nudges reach the player and their alliance's members, following an alliance change", async () => {
    const a = await signedIn("a");
    const b = await signedIn("b");
    a.sent.length = 0;
    b.sent.length = 0;
    await fanOutSight(JSON.stringify({ u: [], a: [7] }));
    expect(a.sent).toEqual([{ type: "live.sight" }]);
    expect(b.sent).toEqual([]);

    // b joins alliance 7: their own nudge re-reads it, and the next alliance nudge reaches them.
    alliances.set(2, 7);
    await fanOutSight(JSON.stringify({ u: [2], a: [] }));
    expect(b.sent).toEqual([{ type: "live.sight" }]);
    await fanOutSight(JSON.stringify({ u: [], a: [7] }));
    expect(b.sent).toHaveLength(2);
  });

  test("a fifth tab pushes out the player's oldest live socket", async () => {
    const tabs = [];
    for (let i = 0; i < 5; i++) tabs.push(await signedIn("a"));
    expect(tabs[0]!.ws.closed).toBe(1000);
    expect(liveStats().sockets).toBe(4);
  });
});
