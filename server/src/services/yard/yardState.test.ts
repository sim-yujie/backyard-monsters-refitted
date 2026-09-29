import { describe, expect, test } from "bun:test";
import type { BuildingData } from "../../types/BuildingData.js";
import { BASE_STORAGE, OUTPOST_STORAGE } from "../base/economy/resourceBudget.js";
import { yardState, type YardStateSave } from "./yardState.js";

const NOW = 1_800_000_000;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, X: 0, Y: 0, ...extra }) as unknown as BuildingData;

const saveOf = (overrides: Partial<YardStateSave> = {}): YardStateSave => ({
  savetime: NOW,
  credits: 250,
  resources: { r1: 100, r2: 200, r3: 300, r4: 400 },
  buildingdata: {
    "0": building(0, 14, { l: 3 }),
    "1": building(1, 20, { l: 1, cU: 100 }),
    "2": building(2, 21, { l: 0, cB: 50 }),
  },
  buildinghealthdata: { "1": 10 },
  storedata: { BEW: { q: 2 } },
  monsters: { h: [] },
  lockerdata: { C1: { t: 2 } },
  academy: { C1: { level: 1 } },
  champion: [],
  mushrooms: { s: 1, l: [] },
  researchdata: {},
  outposts: [],
  ...overrides,
});

/** The frozen key set, in the order `docs/server-api.md` lists it. */
const FROZEN_KEYS = [
  "savetime",
  "currenttime",
  "resources",
  "credits",
  "caps",
  "workers",
  "protected",
  "buildingdata",
  "buildinghealthdata",
  "storedata",
  "monsters",
  "lockerdata",
  "academy",
  "champion",
  "mushrooms",
  "researchdata",
];

describe("yardState", () => {
  test("carries exactly the frozen keys", () => {
    expect(Object.keys(yardState(saveOf(), NOW, false))).toEqual(FROZEN_KEYS);
  });

  test("passes the save slices through under their /base/load names", () => {
    const save = saveOf();
    const state = yardState(save, NOW + 5, false);

    expect(state.savetime).toBe(NOW);
    expect(state.currenttime).toBe(NOW + 5);
    expect(state.resources).toBe(save.resources!);
    expect(state.buildingdata).toBe(save.buildingdata!);
    expect(state.lockerdata).toBe(save.lockerdata!);
    expect(state.credits).toBe(250);
  });

  test("counts workers the way the server does: bought ones, and every running countdown", () => {
    // BEW q 2: one worker plus two bought. Busy: the upgrade and the build.
    expect(yardState(saveOf(), NOW, false).workers).toEqual({ total: 3, busy: 2 });
  });

  test("caps are the storage cap, repeated per resource", () => {
    const cap = BASE_STORAGE + 2 * OUTPOST_STORAGE;
    expect(yardState(saveOf({ outposts: [[1, 1, "a"], [2, 2, "b"]] }), NOW, false).caps).toEqual({
      r1: cap,
      r2: cap,
      r3: cap,
      r4: cap,
    });
  });

  test("a Shiny-locked account sees 0 credits, as /base/load reports it", () => {
    expect(yardState(saveOf(), NOW, true).credits).toBe(0);
  });

  test("null columns come out empty so the client can merge without checks", () => {
    const state = yardState(
      saveOf({
        resources: null,
        buildingdata: null,
        buildinghealthdata: null,
        storedata: null,
        monsters: null,
        lockerdata: null,
        academy: null,
        champion: null,
        mushrooms: null,
        researchdata: null,
      }),
      NOW,
      false
    );

    expect(state).toMatchObject({
      resources: {},
      buildingdata: {},
      buildinghealthdata: {},
      storedata: {},
      monsters: {},
      lockerdata: {},
      academy: {},
      champion: [],
      mushrooms: {},
      researchdata: {},
      workers: { total: 1, busy: 0 },
    });
  });
});
