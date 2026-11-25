import { describe, expect, it } from "vitest";
import type { GetAreaResponse, MapCell } from "@/api/types";
import { ApiError } from "@/api/http";
import { LIVE_MIN_GAP_MS, ZoneStore, expireCells, firstDue, type AreaFetcher, type AreasFetcher } from "./ZoneStore";
import { zoneFor, zonesForRange } from "./zones";

/** The live map's side of the zone cache (beta 9): versions, live answers, time-only changes. */

const versions = new Map<number, number>();
const cells = new Map<string, MapCell>();

const response = (x: number, y: number): GetAreaResponse => {
  const data: GetAreaResponse["data"] = {};
  for (let cx = x; cx <= x + 10; cx++) {
    const column: Record<string, MapCell> = {};
    for (let cy = y; cy <= y + 10; cy++) column[String(cy)] = cells.get(`${cx},${cy}`) ?? ({ i: 120 } as MapCell);
    data[String(cx)] = column;
  }
  return { error: 0, x, y, data, zv: versions.get(zoneFor(x, y).id) ?? 0 };
};

let clock = 1_000_000;

const setup = () => {
  versions.clear();
  cells.clear();
  clock = 1_000_000;
  const calls: [number, number][] = [];
  const batches: [number, number][][] = [];
  const zones: { id: number; live: boolean | undefined }[] = [];
  let busy = 0;
  const fetcher: AreaFetcher = (x, y) => {
    calls.push([x, y]);
    return Promise.resolve(response(x, y));
  };
  const areasFetcher: AreasFetcher = (list) => {
    batches.push(list.map((zone) => [zone.x, zone.y]));
    if (busy > 0) {
      busy -= 1;
      return Promise.reject(new ApiError("busy", { status: 503, body: { retry: 4 } }));
    }
    return Promise.resolve(list.map((zone) => response(zone.x, zone.y)));
  };
  const store = new ZoneStore({
    fetcher,
    areasFetcher,
    now: () => clock,
    random: () => 0,
    onZone: (zone, _previous, live) => zones.push({ id: zone.id, live }),
  });
  return { store, calls, batches, zones, busyOnce: (n = 1) => (busy = n) };
};

const drain = async (store: ZoneStore) => {
  for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
};

const HOME = zoneFor(712, 347);
const NEXT = zoneFor(721, 347);
const VIEW = { minCol: 705, maxCol: 725, minRow: 345, maxRow: 349 };

describe("ZoneStore live versions", () => {
  it("keeps each answer's version, and only a moved one is asked again, in one batch", async () => {
    const { store, calls, batches } = setup();
    versions.set(HOME.id, 3);
    store.ensureVisible(VIEW);
    await drain(store);
    expect(store.getZone(HOME.id)?.zv).toBe(3);
    calls.length = 0;

    expect(store.applyVersions([[HOME.id, 3], [NEXT.id, 0]])).toBe(0);
    expect(store.applyVersions([[HOME.id, 4], [NEXT.id, 1]])).toBe(2);
    versions.set(HOME.id, 4);
    versions.set(NEXT.id, 1);
    await store.pumpLive();
    expect(batches).toEqual([[[710, 340], [720, 340]]]);
    expect(calls).toEqual([]);
    expect(store.getZone(HOME.id)?.zv).toBe(4);
    expect(store.liveWaiting).toBe(0);
  });

  it("a zone not held is not asked because of a push", async () => {
    const { store, batches } = setup();
    expect(store.applyVersions([[zoneFor(100, 100).id, 9]])).toBe(0);
    await store.pumpLive();
    expect(batches).toEqual([]);
  });

  it("waits its random moment before asking", async () => {
    const { store, batches } = setup();
    store.ensureVisible(VIEW);
    await drain(store);
    const late = new ZoneStore({ fetcher: () => Promise.resolve(response(710, 340)), areasFetcher: (l) => (batches.push(l.map((z) => [z.x, z.y])), Promise.resolve(l.map((z) => response(z.x, z.y)))), now: () => clock, random: () => 0.5 });
    late.ensureVisible(VIEW);
    await drain(late);
    late.applyVersions([[HOME.id, 1]]);
    await late.pumpLive();
    expect(batches).toEqual([]);
    clock += 750;
    await late.pumpLive();
    expect(batches).toHaveLength(1);
  });

  it("a zone off screen waits, and is asked once it comes into view", async () => {
    const { store, batches } = setup();
    store.ensureVisible(VIEW);
    await drain(store);
    store.ensureVisible({ minCol: 100, maxCol: 105, minRow: 100, maxRow: 105 });
    store.applyVersions([[HOME.id, 1]]);
    await store.pumpLive();
    expect(batches).toEqual([]);
    expect(store.liveWaiting).toBe(1);
    store.ensureVisible(VIEW);
    await store.pumpLive();
    expect(batches).toEqual([[[710, 340]]]);
  });

  it("asks a zone at most once per 3 s, however often it changes", async () => {
    const { store, batches } = setup();
    store.ensureVisible(VIEW);
    await drain(store);
    store.applyVersions([[HOME.id, 1]]);
    versions.set(HOME.id, 1);
    await store.pumpLive();
    store.applyVersions([[HOME.id, 2]]);
    versions.set(HOME.id, 2);
    await store.pumpLive();
    expect(batches).toHaveLength(1);
    clock += LIVE_MIN_GAP_MS;
    await store.pumpLive();
    expect(batches).toHaveLength(2);
    expect(store.getZone(HOME.id)?.zv).toBe(2);
  });

  it("the pushed answer is flagged live; one read before the change is asked once more", async () => {
    const { store, batches, zones } = setup();
    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    await drain(store);
    expect(zones.at(-1)).toEqual({ id: HOME.id, live: false });

    // The server still answers 0 (the bump raced the read): one more ask after the gap, then it stops.
    cells.set("712,347", { i: 125 } as MapCell);
    store.applyVersions([[HOME.id, 1]]);
    await store.pumpLive();
    expect(zones.at(-1)).toEqual({ id: HOME.id, live: true });
    clock += LIVE_MIN_GAP_MS;
    await store.pumpLive();
    clock += LIVE_MIN_GAP_MS;
    await store.pumpLive();
    expect(batches).toHaveLength(2);
    expect(store.liveWaiting).toBe(0);
  });

  it("busy: waits as long as the server says, then asks again", async () => {
    const { store, batches, busyOnce } = setup();
    store.ensureVisible(VIEW);
    await drain(store);
    busyOnce();
    store.applyVersions([[HOME.id, 1]]);
    versions.set(HOME.id, 1);
    await store.pumpLive();
    expect(store.liveWaiting).toBe(1);
    clock += 3_000;
    await store.pumpLive();
    expect(batches).toHaveLength(1);
    clock += 1_001;
    await store.pumpLive();
    expect(batches).toHaveLength(2);
    expect(store.liveWaiting).toBe(0);
  });

  it("a batch holds at most 10 zones", async () => {
    const { store, batches } = setup();
    const wide = { minCol: 600, maxCol: 749, minRow: 300, maxRow: 309 };
    store.ensureVisible(wide);
    await drain(store);
    const ids = zonesForRange(wide).map((zone) => zone.id);
    expect(ids.length).toBeGreaterThan(10);
    store.applyVersions(ids.map((id) => [id, 1] as [number, number]));
    await store.pumpLive();
    expect(batches[0]).toHaveLength(10);
  });

  it("the watch list puts own zones first and stops at the limit", async () => {
    const { store } = setup();
    cells.set("105,105", { uid: 1, b: 3, mine: 1, p: 0, lo: 0 } as unknown as MapCell);
    store.ensureVisible({ minCol: 100, maxCol: 109, minRow: 100, maxRow: 109 });
    await drain(store);
    store.ensureVisible({ minCol: 500, maxCol: 540, minRow: 500, maxRow: 540 });
    const list = store.watchList(3);
    expect(list).toHaveLength(3);
    expect(list[0]).toBe(zoneFor(105, 105).id);
  });
});

describe("time-only changes", () => {
  it("a shield, a truce and a camp's damage run out in place; an attack's end asks again", () => {
    const data = {
      "1": {
        "1": { uid: 2, b: 2, p: 1, pe: 100, lo: 0 },
        "2": { uid: 3, b: 2, p: 0, t: 200, lo: 0 },
        "3": { uid: 0, b: 1, dm: 50, d: 0, rg: 300 },
        "4": { uid: 4, b: 2, p: 0, atk: 400, lo: 1 },
      },
    } as unknown as GetAreaResponse["data"];
    expect(firstDue(data)).toBe(100);
    expect(expireCells(data, 150)).toEqual({ changed: true, reask: false });
    expect(data["1"]!["1"]).toMatchObject({ p: 0 });
    expect(data["1"]!["1"]).not.toHaveProperty("pe");
    expect(firstDue(data)).toBe(200);
    expect(expireCells(data, 350)).toEqual({ changed: true, reask: false });
    expect(data["1"]!["3"]).toMatchObject({ dm: 0, d: 0 });
    expect(expireCells(data, 500)).toEqual({ changed: true, reask: true });
    expect(firstDue(data)).toBeUndefined();
    expect(expireCells(data, 600)).toEqual({ changed: false, reask: false });
  });

  it("expireDue redraws a zone whose shield ran out without asking the server", async () => {
    const { store, calls, zones } = setup();
    cells.set("712,347", { uid: 2, b: 2, p: 1, pe: 1000, lo: 0, mine: 0 } as unknown as MapCell);
    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    await drain(store);
    calls.length = 0;
    zones.length = 0;
    store.expireDue(999);
    expect(zones).toEqual([]);
    store.expireDue(1001);
    expect(zones).toEqual([{ id: HOME.id, live: false }]);
    expect((store.getCell(712, 347) as { p: number }).p).toBe(0);
    await drain(store);
    expect(calls).toEqual([]);
  });
});

describe("a zone the sight forgot", () => {
  it("is compared with what it showed when its live answer comes back (an attack that also moved the sight)", async () => {
    const { store, zones } = setup();
    store.ensureVisible(VIEW);
    await drain(store);
    store.applyVersions([[HOME.id, 1]], true);
    store.applySight((zone) => zone.id !== HOME.id, "new-sight");
    expect(store.getZone(HOME.id)).toBeUndefined();
    cells.set("712,347", { i: 125 } as MapCell);
    versions.set(HOME.id, 1);
    store.ensureVisible(VIEW);
    await drain(store);
    const last = zones.filter((z) => z.id === HOME.id).at(-1);
    expect(last).toEqual({ id: HOME.id, live: true });
  });
});
