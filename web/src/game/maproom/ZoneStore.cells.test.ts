import { describe, expect, it } from "vitest";
import type { GetAreaResponse, MapCell } from "@/api/types";
import { ZoneStore, answersHolding, type AreaFetcher, type AreasFetcher, type ZoneRecord } from "./ZoneStore";
import { zoneFor } from "./zones";

/**
 * The live map, stage 2: cells pushed by the server go straight into the cache, with no request,
 * keeping what only this player sees of each owner; a zone is asked again only when the push
 * cannot be applied in full.
 */

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

const player = (uid: number, extra: Record<string, unknown> = {}): MapCell =>
  ({ uid, b: 2, i: 120, bid: `b${uid}`, n: `p${uid}`, l: 20, p: 0, lo: 0, d: 0, dm: 0, mine: 0, fr: 0, pi: 0, ...extra }) as unknown as MapCell;

const HOME = zoneFor(712, 347); // 710..720 x 340..350
const VIEW = { minCol: 711, maxCol: 719, minRow: 341, maxRow: 349 };

const setup = async () => {
  const batches: [number, number][][] = [];
  const seen: { id: number; previous: ZoneRecord | undefined; live: boolean | undefined }[] = [];
  const rosters: unknown[] = [];
  const fetcher: AreaFetcher = (x, y) => Promise.resolve(response(x, y));
  const areasFetcher: AreasFetcher = (list) => {
    batches.push(list.map((zone) => [zone.x, zone.y]));
    return Promise.resolve(list.map((zone) => response(zone.x, zone.y)));
  };
  const store = new ZoneStore({
    fetcher,
    areasFetcher,
    now: () => 1_000_000,
    random: () => 0,
    onZone: (zone, previous, live) => seen.push({ id: zone.id, previous, live }),
    onAllianceRoster: (roster) => rosters.push(roster),
  });
  store.ensureVisible(VIEW);
  for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
  seen.length = 0;
  return { store, batches, seen, rosters };
};

describe("ZoneStore live cells (stage 2)", () => {
  it("a push one version on is applied with no request; the zone and the ring see the change", async () => {
    versions.clear();
    cells.clear();
    versions.set(HOME.id, 4);
    cells.set("712,345", player(7, { ho: 1, ak: 1, fr: 1 }));
    const { store, batches, seen } = await setup();

    const asked = store.applyLiveCells([[HOME.id, 5]], [[712, 345, player(7, { atk: 999, ho: undefined, fr: 0 })]]);
    expect(asked).toBe(0);
    await store.pumpLive();
    expect(batches).toEqual([]);
    expect(store.getZone(HOME.id)?.zv).toBe(5);
    // The pushed fields, with this player's relations to the owner kept from their own answer.
    expect(store.getCell(712, 345)).toEqual(player(7, { atk: 999, ho: 1, ak: 1, fr: 1 }));
    // Handed on as a live answer, with the copy it replaced (for the ring).
    expect(seen).toHaveLength(1);
    expect(seen[0]!.live).toBe(true);
    expect(seen[0]!.previous?.data["712"]?.["345"]).toEqual(player(7, { ho: 1, ak: 1, fr: 1 }));
  });

  it("a push that skips a version is not applied: the zone is asked again", async () => {
    versions.clear();
    cells.clear();
    versions.set(HOME.id, 4);
    const { store, batches } = await setup();
    expect(store.applyLiveCells([[HOME.id, 7]], [[712, 345, player(8)]])).toBe(1);
    expect(store.getCell(712, 345)).toEqual({ i: 120 });
    versions.set(HOME.id, 7);
    await store.pumpLive();
    expect(batches).toEqual([[[710, 340]]]);
  });

  it("a push no newer than what is held changes nothing", async () => {
    versions.clear();
    cells.clear();
    versions.set(HOME.id, 4);
    const { store, seen } = await setup();
    expect(store.applyLiveCells([[HOME.id, 4]], [[712, 345, player(8)]])).toBe(0);
    expect(store.getCell(712, 345)).toEqual({ i: 120 });
    expect(seen).toEqual([]);
  });

  it("a cell taken by a player the map knows nothing about is shown, and its zone asked again for the relations", async () => {
    versions.clear();
    cells.clear();
    const { store } = await setup();
    expect(store.applyLiveCells([[HOME.id, 1]], [[712, 345, player(9)]])).toBe(1);
    expect(store.getCell(712, 345)).toMatchObject({ uid: 9 });
  });

  it("... but not when another of that player's cells is held: their relations are taken from it", async () => {
    versions.clear();
    cells.clear();
    cells.set("715,345", player(9, { t: 12345 }));
    const { store } = await setup();
    expect(store.applyLiveCells([[HOME.id, 1]], [[712, 345, player(9)]])).toBe(0);
    expect(store.getCell(712, 345)).toMatchObject({ uid: 9, t: 12345 });
  });

  it("a cell on a zone edge is written into every held answer that has it", async () => {
    versions.clear();
    cells.clear();
    const { store } = await setup();
    const left = zoneFor(705, 345).id; // 700..710
    expect(answersHolding(710, 345).sort()).toEqual([HOME.id, left].sort());
    store.ensureVisible({ minCol: 705, maxCol: 719, minRow: 341, maxRow: 349 });
    for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
    store.applyLiveCells([[HOME.id, 1], [left, 1]], [[710, 345, { i: 120, b: 1, uid: 0, n: "Legionnaire", l: 30, dm: 50 } as unknown as MapCell]]);
    expect(store.getZone(HOME.id)!.data["710"]!["345"]).toMatchObject({ dm: 50 });
    expect(store.getZone(left)!.data["710"]!["345"]).toMatchObject({ dm: 50 });
  });

  it("a replay applies when the map held the version just before its first", async () => {
    versions.clear();
    cells.clear();
    versions.set(HOME.id, 4);
    const { store } = await setup();
    expect(store.applyLiveCells([[HOME.id, 9, 5]], [[712, 345, player(8)]], [], undefined)).toBe(1);
    // player 8 is unknown: asked again for relations, but the cell and the version are in.
    expect(store.getZone(HOME.id)?.zv).toBe(9);
    expect(store.getCell(712, 345)).toMatchObject({ uid: 8 });
  });

  it("zones the server names (`rz`) are asked again; crests are handed on before the cells are drawn", async () => {
    versions.clear();
    cells.clear();
    const { store, rosters } = await setup();
    const roster = [{ alliance_id: 3, name: "A", image: 1, relationships: {} }];
    expect(store.applyLiveCells([[HOME.id, 1]], [], [HOME.id], roster)).toBe(1);
    expect(rosters).toHaveLength(1);
  });

  it("own cells from the player's own channel are written as they come, versions untouched", async () => {
    versions.clear();
    cells.clear();
    versions.set(HOME.id, 2);
    cells.set("712,345", player(1, { mine: 1, m: { C1: 1 } }));
    const { store } = await setup();
    store.applyOwnCells([[712, 345, player(1, { mine: 1, m: { C1: 5 }, nh: 123 })]]);
    expect(store.getCell(712, 345)).toMatchObject({ mine: 1, m: { C1: 5 }, nh: 123 });
    expect(store.getZone(HOME.id)?.zv).toBe(2);
  });

  it("a relation change asks again every held zone holding that player's cells, on screen or not", async () => {
    versions.clear();
    cells.clear();
    cells.set("715,345", player(9));
    const { store, batches } = await setup();
    expect(store.reaskOwners([9, 10])).toBe(1);
    expect(store.reaskOwners([10])).toBe(0);
    await store.pumpLive();
    expect(batches).toEqual([[[710, 340]]]);
  });
});

describe("a pushed cell for a zone the sight just forgot (stage 2)", () => {
  it("makes that zone's next answer a live one, so it still rings", async () => {
    versions.clear();
    cells.clear();
    const live: (boolean | undefined)[] = [];
    const store = new ZoneStore({
      fetcher: (x, y) => Promise.resolve(response(x, y)),
      areasFetcher: (list) => Promise.resolve(list.map((zone) => response(zone.x, zone.y))),
      now: () => 1_000_000,
      random: () => 0,
      onZone: (zone, _previous, isLive) => {
        if (zone.id === HOME.id) live.push(isLive);
      },
    });
    store.ensureVisible(VIEW);
    for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
    // An attack on the player's own outpost: the sight changes and forgets the zone, then the cells come.
    store.applySight((zone) => zone.id !== HOME.id, "new-sight");
    store.applyOwnCells([[712, 345, player(1, { mine: 1, atk: 99 })]]);
    store.applyLiveCells([[HOME.id, 1]], [[713, 345, player(8)]]);
    cells.set("712,345", player(1, { mine: 1, atk: 99 }));
    versions.set(HOME.id, 1);
    store.ensureVisible(VIEW);
    for (let i = 0; i < 20 && store.pendingRequests > 0; i++) await store.pump();
    await store.pumpLive();
    expect(live.at(-1)).toBe(true);
  });
});
