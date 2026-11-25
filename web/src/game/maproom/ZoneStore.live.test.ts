import { describe, expect, it } from "vitest";
import type { GetAreaResponse, MapCell } from "@/api/types";
import { ZoneStore, expireCells, firstDue, type AreaFetcher } from "./ZoneStore";
import { zoneFor } from "./zones";

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

const setup = () => {
  versions.clear();
  cells.clear();
  const calls: [number, number][] = [];
  const zones: { id: number; live: boolean | undefined }[] = [];
  const fetcher: AreaFetcher = (x, y) => {
    calls.push([x, y]);
    return Promise.resolve(response(x, y));
  };
  const store = new ZoneStore({ fetcher, onZone: (zone, _previous, live) => zones.push({ id: zone.id, live }) });
  return { store, calls, zones };
};

const drain = async (store: ZoneStore) => {
  for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
};

const HOME = zoneFor(712, 347);

describe("ZoneStore live versions", () => {
  it("keeps each answer's version and asks again only the zones whose version moved", async () => {
    const { store, calls } = setup();
    versions.set(HOME.id, 3);
    store.ensureVisible({ minCol: 705, maxCol: 725, minRow: 345, maxRow: 349 });
    await drain(store);
    expect(store.getZone(HOME.id)?.zv).toBe(3);
    calls.length = 0;

    const other = zoneFor(721, 347).id;
    expect(store.applyVersions([[HOME.id, 3], [other, 0]])).toBe(0);
    expect(store.applyVersions([[HOME.id, 4]])).toBe(1);
    versions.set(HOME.id, 4);
    await drain(store);
    expect(calls).toEqual([[710, 340]]);
  });

  it("a zone not held is not fetched because of a push", async () => {
    const { store, calls } = setup();
    expect(store.applyVersions([[zoneFor(100, 100).id, 9]])).toBe(0);
    await drain(store);
    expect(calls).toEqual([]);
  });

  it("the pushed answer is flagged live; an answer read before the change is asked once more", async () => {
    const { store, calls, zones } = setup();
    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    await drain(store);
    expect(zones.at(-1)).toEqual({ id: HOME.id, live: false });
    calls.length = 0;

    // The server still answers 0 (the bump raced the read): one retry, then it stops.
    cells.set("712,347", { i: 125 } as MapCell);
    store.applyVersions([[HOME.id, 1]]);
    await drain(store);
    expect(calls).toHaveLength(2);
    expect(zones.at(-1)).toEqual({ id: HOME.id, live: true });
  });

  it("a push for a zone in flight waits for that answer, then asks again if it is older", async () => {
    let release: (() => void) | null = null;
    const calls: number[] = [];
    let held = true;
    const fetcher: AreaFetcher = (x, y) => {
      calls.push(x);
      if (!held) return Promise.resolve(response(x, y));
      held = false;
      // Read now, before the change: the answer carries the old version.
      const old = response(x, y);
      return new Promise((resolve) => {
        release = () => resolve(old);
      });
    };
    versions.clear();
    const store = new ZoneStore({ fetcher });
    store.ensureVisible({ minCol: 710, maxCol: 712, minRow: 345, maxRow: 347 });
    const first = store.pump();
    store.applyVersions([[HOME.id, 2]]);
    versions.set(HOME.id, 2);
    release!();
    await first;
    await drain(store);
    expect(calls).toHaveLength(2);
    expect(store.getZone(HOME.id)?.zv).toBe(2);
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
