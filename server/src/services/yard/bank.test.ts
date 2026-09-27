import { describe, expect, test } from "bun:test";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { maxHp } from "../../game-rules/combat/stats.js";
import type { BuildingData } from "../../types/BuildingData.js";
import { BASE_STORAGE } from "../base/economy/resourceBudget.js";
import { bankPoints, planBank, type BankSave } from "./bank.js";

/** A harvester of `type` (level 1: 720 buffer) holding `st`, full and idle unless overridden. */
const harvester = (id: number, type: number, st: number, overrides: Partial<BuildingData> = {}): BuildingData => ({
  id,
  t: type,
  x: 0,
  y: 0,
  st,
  pr: st >= 720 ? 0 : 1,
  ...(st < 720 && { cP: 4 }),
  ...overrides,
});

/** No silos: every cap is 10,000. */
const yardOf = (buildings: BuildingData[], resources = { r1: 0, r2: 0, r3: 0, r4: 0 }): BankSave => ({
  buildingdata: Object.fromEntries(buildings.map((b) => [String(b.id), b])),
  buildinghealthdata: {},
  resources,
  storedata: {},
  outposts: [],
});

describe("planBank", () => {
  test("all: banks every eligible harvester into its own resource", () => {
    const save = yardOf([harvester(1, 1, 720), harvester(2, 2, 300), harvester(3, 4, 0)]);
    const { report, credit, points, slices } = planBank(save, { all: true }, 0);

    expect(credit).toEqual({ r1: 720, r2: 300, r3: 0, r4: 0 });
    expect(report.byBuilding).toEqual({
      "1": { resource: "r1", amount: 720 },
      "2": { resource: "r2", amount: 300 },
    });
    expect(report.leftInBuffers).toEqual({ r1: 0, r2: 0, r3: 0, r4: 0 });
    expect(points).toBe(1020);
    expect(slices?.buildingdata?.["1"]).toMatchObject({ st: 0, pr: 1, cP: 10 });
    // Was producing already: its cycle carries on.
    expect(slices?.buildingdata?.["2"]).toMatchObject({ st: 0, pr: 1, cP: 4 });
    expect(slices?.buildingdata?.["3"]).toBe(save.buildingdata?.["3"]);
  });

  test("all: skips a harvester with a countdown running or below full health", () => {
    const save = yardOf([
      harvester(1, 1, 720, { cU: 100 }),
      harvester(2, 1, 720, { hp: maxHp(1, 1) - 1 }),
      harvester(3, 1, 720, { cB: 5 }),
      harvester(4, 1, 720),
    ]);
    const { report } = planBank(save, { all: true }, 0);
    expect(Object.keys(report.byBuilding)).toEqual(["4"]);
    expect(report.skipped).toEqual([]);
  });

  test("what does not fit under the cap stays in the buffer", () => {
    const save = yardOf([harvester(1, 1, 720), harvester(2, 1, 720)], {
      r1: BASE_STORAGE - 1000,
      r2: 0,
      r3: 0,
      r4: 0,
    });
    const { report, credit, slices } = planBank(save, { all: true }, 0);

    expect(credit.r1).toBe(1000);
    expect(report.byBuilding).toEqual({
      "1": { resource: "r1", amount: 720 },
      "2": { resource: "r1", amount: 280 },
    });
    expect(report.leftInBuffers.r1).toBe(440);
    expect(slices?.buildingdata?.["2"]).toMatchObject({ st: 440, pr: 1, cP: 10 });
  });

  test("a pool already full banks nothing and leaves the buffers", () => {
    const save = yardOf([harvester(1, 3, 720)], { r1: 0, r2: 0, r3: BASE_STORAGE, r4: 0 });
    const { report, credit, slices, points } = planBank(save, { all: true }, 0);
    expect(credit.r3).toBe(0);
    expect(points).toBe(0);
    expect(report.leftInBuffers.r3).toBe(720);
    expect(slices).toBeUndefined();
  });

  test("ids: banks the named ones, damaged included, and names the ones it skipped", () => {
    const save = yardOf([
      harvester(1, 1, 500, { hp: 1 }),
      harvester(2, 2, 720, { cU: 60 }),
      harvester(3, 3, 0),
      harvester(4, 4, 720),
    ]);
    const { report, credit } = planBank(save, { ids: [3, 2, 1, 1] }, 0);

    expect(credit).toEqual({ r1: 500, r2: 0, r3: 0, r4: 0 });
    expect(report.skipped).toEqual([
      { id: 3, reason: "empty" },
      { id: 2, reason: "busy" },
    ]);
  });

  test("ids: an id that is not a harvester is a bad request", () => {
    const save = yardOf([harvester(1, 1, 720), { id: 9, t: 20, x: 0, y: 0 }]);
    expect(() => planBank(save, { ids: [9] }, 0)).toThrow(ClientSafeError);
    expect(() => planBank(save, { ids: [99] }, 0)).toThrow(ClientSafeError);
  });

  test("points are halved, rounded up, from tutorial stage 200", () => {
    expect(bankPoints(721, 199)).toBe(721);
    expect(bankPoints(721, 200)).toBe(361);
    const save = yardOf([harvester(1, 1, 719)]);
    expect(planBank(save, { all: true }, 205).points).toBe(360);
  });

  test("offers at most the level's capacity", () => {
    const save = yardOf([harvester(1, 1, 900)]);
    const { credit, slices } = planBank(save, { all: true }, 0);
    expect(credit.r1).toBe(720);
    expect(slices?.buildingdata?.["1"]).toMatchObject({ st: 180 });
  });
});
