import { describe, expect, it } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHealth } from "./buildingArt";
import { harvesterNow, harvestWaiting, runBuffer } from "./harvest";

/** The client's prediction of harvester buffers, rule for rule the server's catch-up. */

const T0 = 1_800_000_000;

/** A level 1 Twig Snapper: 2 per 10 s cycle into a 720 buffer. An `undefined` override drops the field. */
const snapper = (overrides: Record<string, unknown> = {}): BuildingData =>
  Object.fromEntries(
    Object.entries({ X: 0, Y: 0, t: 1, id: 1, st: 0, pr: 1, cP: 10, ...overrides }).filter(
      ([, value]) => value !== undefined,
    ),
  ) as unknown as BuildingData;

const saveOf = (
  buildings: BuildingData[],
  extra: Partial<BaseLoadResponse> = {},
): Pick<
  BaseLoadResponse,
  "savetime" | "currenttime" | "buildingdata" | "buildinghealthdata" | "storedata"
> => ({
  savetime: T0,
  currenttime: T0,
  buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
  buildinghealthdata: {},
  storedata: {},
  ...extra,
});

describe("runBuffer", () => {
  it("finishes the running cycle, then whole ones, and stops when full", () => {
    const rates = { produce: 2, cycle: 10, capacity: 720 };
    expect(runBuffer({ stored: 10, countdown: 7 }, rates, 31)).toEqual({ stored: 16, countdown: 6 });
    expect(runBuffer({ stored: 0, countdown: null }, rates, 3600)).toEqual({ stored: 720, countdown: null });
  });
});

describe("harvesterNow", () => {
  it("grows the saved buffer to now", () => {
    const building = snapper({ st: 100, cP: 4 });
    const now = harvesterNow(building, saveOf([building]), T0 + 65);
    expect(now).toMatchObject({ id: 1, resource: "r1", stored: 114, capacity: 720, offer: 114 });
    expect(now).toMatchObject({ bankable: true, collectable: true });
  });

  it("holds still while a countdown runs, and then cannot be banked", () => {
    const building = snapper({ st: 300, cU: 100 });
    expect(harvesterNow(building, saveOf([building]), T0 + 1000)).toMatchObject({
      stored: 300,
      bankable: false,
      collectable: false,
    });
  });

  it("a damaged harvester runs slower, can be tapped, but Collect all leaves it", () => {
    const max = maxHealth(1, 1)!;
    const building = snapper({ st: 0, pr: 0, cP: undefined, hp: max / 2 });
    expect(harvesterNow(building, saveOf([building]), T0 + 60)).toMatchObject({
      stored: 4,
      bankable: true,
      collectable: false,
    });
  });

  it("doubles production while the Production Overdrive runs", () => {
    const building = snapper();
    const save = saveOf([building], { storedata: { POD: { q: 1, e: T0 + 20 } } });
    expect(harvesterNow(building, save, T0 + 40)?.stored).toBe(12);
  });

  it("is null for anything that is not a harvester", () => {
    const tower = { X: 0, Y: 0, t: 20, id: 5 } as BuildingData;
    expect(harvesterNow(tower, saveOf([tower]), T0)).toBeNull();
  });
});

describe("harvestWaiting", () => {
  it("sums what Collect all would take, per resource", () => {
    const save = saveOf([
      snapper({ id: 1, st: 720, pr: 0, cP: undefined }),
      snapper({ id: 2, t: 4, st: 500 }),
      snapper({ id: 3, t: 4, st: 500, cU: 60 }),
      snapper({ id: 4, t: 2, st: 0, pr: 0, cP: undefined }),
      { X: 0, Y: 0, t: 14, id: 9 } as BuildingData,
    ]);
    const waiting = harvestWaiting(save, T0);
    expect(waiting.amounts).toEqual({ r1: 720, r2: 0, r3: 0, r4: 500 });
    expect(waiting.total).toBe(1220);
    expect(waiting.ids).toEqual([1, 2]);
  });
});
