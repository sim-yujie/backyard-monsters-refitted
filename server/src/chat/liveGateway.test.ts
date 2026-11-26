import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  closeLive,
  fanOutOwn,
  fanOutSight,
  fanOutZones,
  initLiveGateway,
  liveStats,
  MAX_WATCHED,
  resetLiveGateway,
  routeLive,
  type LiveIdentity,
  type LogRead,
} from "./liveGateway.js";
import type { LiveSight } from "../services/maproom/live/liveFog.js";
import type { CellsMessage } from "../services/maproom/live/liveZones.js";

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
    // Stage 1's checks: no fog (every zone visible).
    sight: async () => null,
    shape: () => "flat",
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

/**
 * Stage 2: the cells themselves, cut to each watcher's fog of war on the server. Player 1 ("a")
 * sees only the cell (15, 15) (a revealed cell), player 2 ("b") everything.
 */
describe("live map gateway: pushed cells and the fog (stage 2)", () => {
  const ZONE = 10001; // cells 10..20 x 10..20
  const FAR = 50005; // cells 50..60: nothing of player 1's sight reaches it
  let sights: Map<number, LiveSight | null>;
  let sightDelay = 0;
  let log: LogRead = { entries: [], complete: true };
  let logAsked: string[] = [];

  const cell = (x: number, y: number, uid: number, extra: Record<string, unknown> = {}) =>
    [x, y, { uid, b: 2, n: `p${uid}`, bid: `b${x}${y}`, l: 20, dm: 0, ...extra }] as [number, number, unknown];
  const push = (message: Partial<CellsMessage>) => fanOutZones(JSON.stringify({ w: "w", z: { [ZONE]: 5 }, id: "100-0", ...message }));
  const cellsOf = (frame: Record<string, unknown> | undefined) => ((frame?.c ?? []) as [number, number][]).map(([x, y]) => `${x},${y}`);

  beforeEach(() => {
    sights = new Map([
      [1, { sv: "s1", sources: [], revealed: [{ x: 15, y: 15 }] }],
      [2, null],
    ]);
    sightDelay = 0;
    log = { entries: [], complete: true };
    logAsked = [];
    initLiveGateway({
      authenticate: async (token) => identities[token] ?? null,
      versions: async (_world, ids) => ids.map(() => 5),
      alliancesOf: async (ids) => new Map(ids.map((id) => [id, null])),
      sight: async (userId) => {
        if (sightDelay) await Bun.sleep(sightDelay);
        return sights.has(userId) ? sights.get(userId)! : { sv: "", sources: [], revealed: [] };
      },
      shape: () => "flat",
      readLog: async (since) => {
        logAsked.push(since);
        return log;
      },
      warn: () => {},
    });
  });

  const watching = async (token: string, zones: number[], since?: string) => {
    const s = await signedIn(token);
    await s.frame({ type: "live.watch", z: zones, ...(since && { since }) });
    return s;
  };

  test("a zone the watcher's fog hides entirely is refused: never watched, no version", async () => {
    const a = await watching("a", [ZONE, FAR]);
    expect(a.sent.at(-1)).toEqual({ type: "live.zones", all: 1, z: [[ZONE, 5]] });
    a.sent.length = 0;
    fanOutZones(JSON.stringify({ w: "w", z: { [FAR]: 9 }, c: [cell(55, 55, 8, { atk: 1234 })] }));
    expect(a.sent).toEqual([]);
  });

  test("a fogged watcher never receives a cell its getarea would hide, `atk` included", async () => {
    const a = await watching("a", [ZONE]);
    const b = await watching("b", [ZONE]);
    a.sent.length = 0;
    b.sent.length = 0;
    push({ c: [cell(15, 15, 7, { atk: 1111 }), cell(16, 16, 8, { atk: 2222, n: "hidden" })] });
    expect(cellsOf(a.sent[0])).toEqual(["15,15"]);
    const text = JSON.stringify(a.sent);
    expect(text).not.toContain("2222");
    expect(text).not.toContain("hidden");
    expect(text).toContain("1111");
    // No fog for player 2: both.
    expect(cellsOf(b.sent[0])).toEqual(["15,15", "16,16"]);
  });

  test("a change only to cells the watcher cannot see still moves its version, with no cells", async () => {
    const a = await watching("a", [ZONE]);
    a.sent.length = 0;
    push({ c: [cell(16, 16, 8, { atk: 2222 })] });
    expect(a.sent).toEqual([{ type: "live.cells", id: "100-0", z: [[ZONE, 5]], c: [] }]);
  });

  test("the player's own cell is left out when its full copy went on their own channel, else the zone is asked again", async () => {
    const b = await watching("b", [ZONE]);
    b.sent.length = 0;
    push({ c: [cell(15, 15, 2), cell(16, 16, 8)], ow: [2] });
    expect(cellsOf(b.sent[0])).toEqual(["16,16"]);
    expect(b.sent[0]!.rz).toBeUndefined();
    b.sent.length = 0;
    push({ c: [cell(15, 15, 2), cell(16, 16, 8)] });
    expect(cellsOf(b.sent[0])).toEqual(["16,16"]);
    expect(b.sent[0]!.rz).toEqual([ZONE]);
  });

  test("the own channel reaches only that player's sockets, and never the public", async () => {
    const a = await watching("a", [ZONE]);
    const b = await watching("b", [ZONE]);
    a.sent.length = 0;
    b.sent.length = 0;
    const own = [cell(15, 15, 2, { mine: 1, r: { r1: 5 }, m: { C1: 3 } })];
    fanOutOwn(JSON.stringify({ u: 2, w: "w", c: own }));
    expect(b.sent).toEqual([{ type: "live.own", c: JSON.parse(JSON.stringify(own)) }]);
    expect(a.sent).toEqual([]);
  });

  test("'ask again' after a relation change names only zones the player watches and can see", async () => {
    const a = await watching("a", [ZONE]);
    a.sent.length = 0;
    fanOutOwn(JSON.stringify({ u: 1, w: "w", rz: [ZONE, FAR, 20002] }));
    expect(a.sent).toEqual([{ type: "live.redo", z: [ZONE] }]);
  });

  test("a push that comes while a sight change is being read waits for it, then is cut to the new sight", async () => {
    const a = await watching("a", [ZONE]);
    a.sent.length = 0;
    sightDelay = 30;
    sights.set(1, { sv: "s2", sources: [], revealed: [{ x: 16, y: 16 }] });
    const reading = fanOutSight(JSON.stringify({ u: [1], a: [] }));
    await Bun.sleep(5);
    push({ c: [cell(15, 15, 7, { atk: 1111 }), cell(16, 16, 8)] });
    // Nothing yet but the nudge: not the old sight's cut, and no "ask again".
    expect(a.sent).toEqual([{ type: "live.sight" }]);
    await reading;
    expect(a.sent).toHaveLength(2);
    expect(cellsOf(a.sent[1])).toEqual(["16,16"]);
    expect(JSON.stringify(a.sent)).not.toContain("1111");
  });

  test("a sight that cannot be read sends the held pushes as versions only (the map asks getarea)", async () => {
    const a = await watching("a", [ZONE]);
    a.sent.length = 0;
    sightDelay = 20;
    sights.delete(1);
    const broken = new Error("db down");
    initLiveGateway({
      authenticate: async (token) => identities[token] ?? null,
      versions: async (_world, ids) => ids.map(() => 5),
      alliancesOf: async (ids) => new Map(ids.map((id) => [id, null])),
      sight: async () => {
        await Bun.sleep(20);
        throw broken;
      },
      shape: () => "flat",
      warn: () => {},
    });
    const reading = fanOutSight(JSON.stringify({ u: [1], a: [] }));
    await Bun.sleep(5);
    push({ c: [cell(15, 15, 7, { atk: 1111 })] });
    await reading;
    expect(a.sent).toEqual([{ type: "live.sight" }, { type: "live.zones", z: [[ZONE, 5]] }]);
  });

  test("a sign-in whose sight cannot be read sees nothing (fail closed)", async () => {
    sights.set(1, { sv: "", sources: [], revealed: [] });
    const a = await watching("a", [ZONE]);
    expect(a.sent.at(-1)).toEqual({ type: "live.zones", all: 1, z: [] });
  });

  test("replay after a short break: each cell's latest copy since the last id, cut to the fog, before the versions", async () => {
    log = {
      complete: true,
      entries: [
        { id: "101-0", w: "w", z: { [ZONE]: 3 }, c: [cell(15, 15, 7, { dm: 10 }), cell(16, 16, 8, { atk: 2222 })] },
        { id: "102-0", w: "other", z: { [ZONE]: 9 }, c: [cell(15, 15, 99)] },
        { id: "103-0", w: "w", z: { [ZONE]: 4 }, c: [cell(15, 15, 7, { dm: 40 })] },
      ],
    };
    const a = await watching("a", [ZONE], "100-0");
    expect(logAsked).toEqual(["100-0"]);
    const [replay, versions] = a.sent.slice(-2);
    expect(replay).toEqual({ type: "live.cells", rp: 1, id: "103-0", z: [[ZONE, 4, 3]], c: [cell(15, 15, 7, { dm: 40 })] });
    expect(JSON.stringify(replay)).not.toContain("2222");
    expect(versions).toEqual({ type: "live.zones", all: 1, z: [[ZONE, 5]] });
  });

  test("a log that no longer reaches back sends no replay: the versions catch up alone", async () => {
    log = { complete: false, entries: [] };
    const a = await watching("a", [ZONE], "100-0");
    expect(a.sent.filter((frame) => frame.type === "live.cells")).toEqual([]);
    expect(a.sent.at(-1)).toEqual({ type: "live.zones", all: 1, z: [[ZONE, 5]] });
  });

  test("replay asks again a zone holding the player's own cell, or a push that came without cells", async () => {
    log = {
      complete: true,
      entries: [
        { id: "101-0", w: "w", z: { [ZONE]: 3 }, c: [cell(15, 15, 1)] },
        { id: "102-0", w: "w", z: { [ZONE + 1]: 7 }, x: 1 },
      ],
    };
    const a = await watching("a", [ZONE], "100-0");
    const replay = a.sent.find((frame) => frame.type === "live.cells");
    expect(replay).toMatchObject({ z: [[ZONE, 3, 3]], c: [], rz: [ZONE] });
  });
});
