import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingDataMap } from "@/api/types";
import {
  mapRoomFor,
  mapRoomLevelIn,
  mapRoomOf,
  primeFromYard,
  primeOwnYard,
  takePrimedOwnYard,
} from "./mapRoute";

const save = (extra: Partial<BaseLoadResponse> = {}): BaseLoadResponse => ({
  error: 0,
  id: 1,
  baseid: "5001",
  basesaveid: 1,
  worldsize: [800, 800],
  currenttime: 1,
  buildingdata: { "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 } },
  ...extra,
});

const withMapRoom = (row: Partial<BuildingDataMap[string]>): BuildingDataMap => ({
  "1": { id: 1, t: 14, l: 1, X: 0, Y: 0 },
  "2": { id: 2, t: 11, X: 10, Y: 10, ...row },
});

describe("mapRoomLevelIn", () => {
  it("reads the built Map Room's level, 0 while on its first build or absent", () => {
    expect(mapRoomLevelIn(undefined)).toBe(0);
    expect(mapRoomLevelIn(withMapRoom({}))).toBe(1);
    expect(mapRoomLevelIn(withMapRoom({ l: 2 }))).toBe(2);
    expect(mapRoomLevelIn(withMapRoom({ l: 1, cB: 900 }))).toBe(0);
    expect(mapRoomLevelIn(withMapRoom({ l: 1, cU: 900 }))).toBe(1);
  });
});

describe("mapRoomOf (#162)", () => {
  it("sends a starter yard with no Map Room to no map at all, home cell or not", () => {
    expect(mapRoomOf(save())).toBe("none");
    // New accounts are placed in a world when they are made (seen on a TH1 account).
    expect(mapRoomOf(save({ homebase: [710, 347] }))).toBe("none");
  });

  it("opens Map Room 1 for a built level 1 Map Room, even one upgrading to 2", () => {
    expect(mapRoomOf(save({ buildingdata: withMapRoom({ l: 1 }) }))).toBe("mr1");
    expect(mapRoomOf(save({ buildingdata: withMapRoom({ l: 1, cU: 1000 }) }))).toBe("mr1");
  });

  it("keeps Map Room 2 for mr2upgraded or a level 2 Map Room", () => {
    expect(mapRoomOf(save({ flags: { mr2upgraded: 1 } }))).toBe("mr2");
    expect(mapRoomOf(save({ buildingdata: withMapRoom({ l: 2 }) }))).toBe("mr2");
    expect(mapRoomFor({ flags: { mr2upgraded: 0 }, mapRoomLevel: 1 })).toBe("mr1");
  });
});

describe("the primed own-yard load", () => {
  it("is handed on once while fresh", () => {
    const load = save();
    primeOwnYard(load, 1_000);
    expect(takePrimedOwnYard(2_000)).toBe(load);
    expect(takePrimedOwnYard(2_000)).toBeNull();
  });

  it("is dropped when stale", () => {
    primeOwnYard(save(), 1_000);
    expect(takePrimedOwnYard(60_000)).toBeNull();
  });
});

describe("the own yard handed from the yard to Map Room 2 (no second load on open)", () => {
  const yard = (extra: { kind?: string; settled?: boolean; serverNow?: number } = {}) => ({
    kind: extra.kind ?? "main",
    serverSave: save({ currenttime: 100, resources: { r1: 5 } }),
    settled: extra.settled ?? true,
    now: () => extra.serverNow ?? 1234.7,
  });

  it("primes the yard's merged save with the server clock as it is now", () => {
    expect(primeFromYard(yard(), 1_000)).toBe(true);
    const primed = takePrimedOwnYard(1_500);
    expect(primed?.currenttime).toBe(1234);
    expect(primed?.resources).toEqual({ r1: 5 });
    expect(primed?.baseid).toBe("5001");
  });

  it("does not prime while a yard request is in flight or queued: the map loads its own", () => {
    expect(primeFromYard(yard({ settled: false }), 1_000)).toBe(false);
    expect(takePrimedOwnYard(1_500)).toBeNull();
  });

  it("only primes the main yard, never an outpost or the Inferno yard", () => {
    expect(primeFromYard(yard({ kind: "outpost" }), 1_000)).toBe(false);
    expect(primeFromYard(yard({ kind: "inferno" }), 1_000)).toBe(false);
    expect(takePrimedOwnYard(1_500)).toBeNull();
  });
});
