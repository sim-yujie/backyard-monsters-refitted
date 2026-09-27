import { describe, expect, test } from "bun:test";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { catchUpYard } from "./catchUp.js";
import { catchUpHarvesters, type CatchUpHarvestersSave } from "./catchUpHarvesters.js";

const T0 = 1_800_000_000;

/** A level 1 Twig Snapper (2 per 10 s into 720) unless overridden. */
const snapper = (overrides: Partial<BuildingData> = {}): BuildingData => ({
  id: 1,
  t: 1,
  x: 0,
  y: 0,
  st: 0,
  pr: 1,
  cP: 10,
  ...overrides,
});

const yardOf = (
  building: BuildingData,
  extra: Omit<CatchUpHarvestersSave, "buildingdata"> = {}
): CatchUpHarvestersSave & { buildingdata: BuildingDataMap } => ({
  buildinghealthdata: {},
  storedata: {},
  ...extra,
  buildingdata: { [String(building.id)]: building },
});

describe("catchUpHarvesters", () => {
  test("fills the buffer cycle by cycle and keeps the part-way cycle", () => {
    const save = yardOf(snapper({ st: 100, cP: 4 }));
    catchUpHarvesters(save, T0, T0 + 65, []);
    // 4, 14, …, 64: seven cycles, 1 s into the eighth.
    expect(save.buildingdata["1"]).toMatchObject({ st: 114, pr: 1, cP: 9 });
  });

  test("stops at the capacity: pr 0 and no cP", () => {
    const save = yardOf(snapper({ st: 700 }));
    catchUpHarvesters(save, T0, T0 + 3600, []);
    expect(save.buildingdata["1"]).toMatchObject({ st: 720, pr: 0 });
    expect(save.buildingdata["1"]?.cP).toBeUndefined();
  });

  test("leaves a full harvester's row alone", () => {
    const building = snapper({ st: 720, pr: 0, cP: undefined });
    const save = yardOf(building);
    const before = save.buildingdata;
    catchUpHarvesters(save, T0, T0 + 3600, []);
    expect(save.buildingdata).toBe(before);
  });

  test("starts an idle harvester with room at the start of the window", () => {
    const save = yardOf(snapper({ st: 0, pr: 0, cP: undefined }));
    catchUpHarvesters(save, T0, T0 + 25, []);
    expect(save.buildingdata["1"]).toMatchObject({ st: 4, pr: 1, cP: 5 });
  });

  test("produces nothing while a countdown runs", () => {
    const save = yardOf(snapper({ cU: 500 }));
    catchUpHarvesters(save, T0, T0 + 100, []);
    expect(save.buildingdata["1"]).toMatchObject({ st: 0, cP: 10 });
  });

  test("produces nothing below half health, and slower when damaged", () => {
    const max = maxHp(1, 1);
    const broken = yardOf(snapper(), { buildinghealthdata: { "1": Math.floor(max * 0.4) } });
    catchUpHarvesters(broken, T0, T0 + 100, []);
    expect(broken.buildingdata["1"]).toMatchObject({ st: 0 });

    const hurt = yardOf(snapper({ st: 0, pr: 0, cP: undefined, hp: max / 2 }));
    catchUpHarvesters(hurt, T0, T0 + 60, []);
    // Half health: 30 s cycles.
    expect(hurt.buildingdata["1"]).toMatchObject({ st: 4, cP: 30 });
  });

  test("doubles production while the Production Overdrive runs, and not after", () => {
    const running = yardOf(snapper(), { storedata: { POD: { q: 1, s: T0, e: T0 + 20 } } });
    catchUpHarvesters(running, T0, T0 + 40, []);
    // Two overdriven cycles (8), then two plain ones (4).
    expect(running.buildingdata["1"]).toMatchObject({ st: 12 });
  });

  test("reads an overdrive that ran out in the window from step 1's record", () => {
    const save = yardOf(snapper());
    catchUpHarvesters(save, T0, T0 + 40, [
      { kind: "storeItem", id: "POD", t: null, at: T0 + 20, detail: {} },
    ]);
    expect(save.buildingdata["1"]).toMatchObject({ st: 12 });
  });

  test("an upgrade finished in the window produces from then on, at the new level", () => {
    const save = yardOf(snapper({ l: 2 }));
    catchUpHarvesters(save, T0, T0 + 100, [
      { kind: "upgrade", id: 1, t: 1, at: T0 + 80, detail: { from: 1, level: 2, points: 0 } },
    ]);
    // 20 s at level 2 (4 per cycle): two cycles.
    expect(save.buildingdata["1"]).toMatchObject({ st: 8 });
  });

  test("ignores everything that is not a harvester", () => {
    const save = yardOf({ id: 1, t: 20, x: 0, y: 0, st: 5 } as BuildingData);
    const before = save.buildingdata;
    catchUpHarvesters(save, T0, T0 + 100, []);
    expect(save.buildingdata).toBe(before);
  });
});

describe("catchUpYard with harvesters", () => {
  const yard = (): JsonObject & { buildingdata: BuildingDataMap } => ({
    savetime: T0,
    buildingdata: {
      "1": snapper({ st: 0, cP: 10 }),
      // An upgrade with 30 s left: level 2 from T0 + 30.
      "2": { id: 2, t: 2, x: 0, y: 0, l: 1, cU: 30, st: 0, pr: 1, cP: 10 },
    },
    buildinghealthdata: {},
    storedata: {},
    points: "0",
  });

  test("splits the window at the upgrade step 1 finished", () => {
    const save = yard();
    catchUpYard(save, T0 + 60);
    expect(save.buildingdata["1"]).toMatchObject({ st: 12 });
    // 30 s at level 2 after the upgrade: 3 cycles of 4.
    expect(save.buildingdata["2"]).toMatchObject({ l: 2, st: 12 });
  });

  test("is idempotent at the same now", () => {
    const save = yard();
    catchUpYard(save, T0 + 60);
    const once = structuredClone(save);
    catchUpYard(save, T0 + 60);
    expect(save).toEqual(once);
  });

  test("two catch-ups make one", () => {
    const split = yard();
    catchUpYard(split, T0 + 23);
    catchUpYard(split, T0 + 60);
    const whole = yard();
    catchUpYard(whole, T0 + 60);
    expect(split.buildingdata).toEqual(whole.buildingdata);
  });
});
