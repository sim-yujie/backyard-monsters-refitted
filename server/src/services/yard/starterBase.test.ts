import { afterEach, describe, expect, test } from "bun:test";
import { devConfig } from "../../config/GameConfig.js";
import type { User } from "../../database/models/user.model.js";
import { BaseType } from "../../enums/Base.js";
import { getDefaultBaseData } from "../../game-data/getDefaultBaseData.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { overlaps, rectOf, withinBounds } from "../yardplanner/layoutGeometry.js";
import { placementProblem } from "./build.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import {
  STARTER_BUILDINGS,
  addStarterBase,
  starterBuildingData,
  type StarterBaseSave,
} from "./starterBase.js";

/** The starter base (issue #154, `client/scripts/BASE.as:1661-1702`). */

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const HALL = 14;
const SNAPPER = 1;
const SHINER = 2;
const STORE = 12;
const MAP_ROOM = 11;
/** A mushroom's type (`game-data/buildingFootprints.ts`). */
const MUSHROOM = 7;

const emptyYard = (extra: Partial<StarterBaseSave> = {}): StarterBaseSave => ({
  type: BaseType.MAIN,
  buildingdata: {},
  buildinghealthdata: {},
  resources: { r1: 0, r2: 0, r3: 0, r4: 0, r1max: 10000, r2max: 10000, r3max: 10000, r4max: 10000 },
  storedata: {},
  mr2upgraded: false,
  mapversion: 1,
  ...extra,
});

/** Every footprint in the yard is inside the plot and none touches another. */
const expectPlaceable = (buildings: BuildingDataMap) => {
  const rects = Object.values(buildings).map((one) => rectOf(Number(one.t), Number(one.X), Number(one.Y)));
  Object.values(buildings).forEach((one, index) => {
    expect(withinBounds(rects[index]!, Number(one.t), 0)).toBe(true);
  });
  for (let a = 0; a < rects.length; a++) {
    for (let b = a + 1; b < rects.length; b++) expect(overlaps(rects[a]!, rects[b]!)).toBe(false);
  }
};

describe("starterBuildingData — a new save's yard", () => {
  test("the original's four buildings on its spots, level 1, the Twig Snapper holding 200 twigs", () => {
    expect(starterBuildingData()).toEqual({
      "1": { id: 1, t: HALL, X: -70, Y: 0, l: 1 },
      "2": { id: 2, t: SNAPPER, X: 60, Y: 0, l: 1, st: 200 },
      "3": { id: 3, t: SHINER, X: 60, Y: 70, l: 1 },
      "4": { id: 4, t: STORE, X: 60, Y: -70, l: 1 },
    } as unknown as BuildingDataMap);
  });

  test("every spot passes the build route's placement rule on an empty plot", () => {
    const save: StarterBaseSave = emptyYard();
    for (const [key, building] of Object.entries(starterBuildingData())) {
      const request = { type: Number(building.t), x: Number(building.X), y: Number(building.Y) };
      expect(placementProblem(save, request)).toBeNull();
      save.buildingdata = { ...save.buildingdata, [key]: building };
    }
    expectPlaceable(save.buildingdata!);
  });
});

describe("getDefaultBaseData — the starter base on a new main save", () => {
  const user = { userid: 77, username: "newbie" } as User;
  const sandbox = devConfig.devSandbox;
  afterEach(() => {
    devConfig.devSandbox = sandbox;
  });

  test("a new main yard starts with the set and 1,600 twigs and pebbles", () => {
    devConfig.devSandbox = false;
    const data = getDefaultBaseData(user, BaseType.MAIN) as { buildingdata?: BuildingDataMap; resources: object };
    expect(data.buildingdata).toEqual(starterBuildingData());
    expect(data.resources).toMatchObject({ r1: 1600, r2: 1600, r3: 0, r4: 0 });
  });

  test("an Inferno yard gets neither", () => {
    const data = getDefaultBaseData(user, BaseType.INFERNO) as { buildingdata?: BuildingDataMap; resources: object };
    expect(data.buildingdata).toBeUndefined();
    expect(data.resources).toMatchObject({ r1: 0, r2: 0, r3: 0, r4: 0 });
  });

  test("DEV_SANDBOX still gives the sandbox yard", () => {
    devConfig.devSandbox = true;
    const data = getDefaultBaseData(user, BaseType.MAIN) as { buildingdata?: BuildingDataMap };
    expect(Object.keys(data.buildingdata ?? {}).length).toBeGreaterThan(STARTER_BUILDINGS.length);
  });
});

describe("addStarterBase — an existing empty main yard", () => {
  test("places the set on the original's spots, credits 1,600 twigs and pebbles and reports it", () => {
    const save = emptyYard();

    const jobs = addStarterBase(save, NOW);

    expect(save.buildingdata).toEqual(starterBuildingData());
    expect(save.resources).toMatchObject({ r1: 1600, r2: 1600, r3: 0, r4: 0 });
    expect(jobs).toEqual([
      {
        kind: "starterBase",
        id: 1,
        t: HALL,
        at: NOW,
        detail: {
          buildings: [
            { id: 1, t: HALL, x: -70, y: 0, level: 1 },
            { id: 2, t: SNAPPER, x: 60, y: 0, level: 1 },
            { id: 3, t: SHINER, x: 60, y: 70, level: 1 },
            { id: 4, t: STORE, x: 60, y: -70, level: 1 },
          ],
          resources: { r1: 1600, r2: 1600, r3: 0, r4: 0 },
        },
      },
    ]);
  });

  test("a second run adds nothing", () => {
    const save = emptyYard();
    addStarterBase(save, NOW);
    const after = structuredClone(save);

    expect(addStarterBase(save, NOW + 60)).toEqual([]);
    expect(save).toEqual(after);
  });

  test("a null buildingdata counts as empty", () => {
    const save = emptyYard({ buildingdata: null });
    expect(addStarterBase(save, NOW)).toHaveLength(1);
    expect(Object.keys(save.buildingdata!)).toHaveLength(4);
  });

  test("a yard with any building at all is left alone", () => {
    const lone = { id: 9, t: MAP_ROOM, X: 300, Y: 200, l: 2 } as unknown as BuildingData;
    const save = emptyYard({ buildingdata: { "9": lone } });
    const before = structuredClone(save);

    expect(addStarterBase(save, NOW)).toEqual([]);
    expect(save).toEqual(before);
  });

  test.each([BaseType.OUTPOST, BaseType.INFERNO, BaseType.TRIBE, BaseType.INFERNO_TRIBE, undefined])(
    "a %s yard never gets it",
    (type) => {
      const save = emptyYard({ type });
      expect(addStarterBase(save, NOW)).toEqual([]);
      expect(save.buildingdata).toEqual({});
      expect(save.resources).toMatchObject({ r1: 0, r2: 0 });
    }
  );

  test("a mushroom on a spot moves that building to the nearest free spot, clear of everything", () => {
    // A mushroom right on the Town Hall's spot.
    const save = emptyYard({ mushrooms: { l: [[1, -40, 30]] } });

    const [job] = addStarterBase(save, NOW);

    const hall = job!.detail.buildings[0]!;
    expect(hall.t).toBe(HALL);
    expect([hall.x, hall.y]).not.toEqual([-70, 0]);
    expect(job!.detail.buildings.slice(1).map(({ x, y }) => [x, y])).toEqual([
      [60, 0],
      [60, 70],
      [60, -70],
    ]);
    const mushroom = rectOf(MUSHROOM, -40, 30);
    const rects = Object.values(save.buildingdata!).map((one) => rectOf(Number(one.t), Number(one.X), Number(one.Y)));
    expect(rects.some((rect) => overlaps(rect, mushroom))).toBe(false);
    expectPlaceable(save.buildingdata!);
  });

  test("ids go past a health entry a gone building left behind", () => {
    const save = emptyYard({ buildinghealthdata: { "7": 100 } });
    const [job] = addStarterBase(save, NOW);
    expect(job!.detail.buildings.map((one) => one.id)).toEqual([8, 9, 10, 11]);
    expect(job!.id).toBe(8);
  });

  test("the twigs and pebbles stop at the storage cap, and the job says what landed", () => {
    const save = emptyYard({ resources: { r1: 9500, r2: 10000, r3: 0, r4: 0 } });
    const [job] = addStarterBase(save, NOW);
    expect(save.resources).toMatchObject({ r1: 10000, r2: 10000 });
    expect(job!.detail.resources).toEqual({ r1: 500, r2: 0, r3: 0, r4: 0 });
  });
});

describe("catchUpYard — the starter base", () => {
  const catchUpSave = (extra: Partial<CatchUpSave> = {}): CatchUpSave => ({
    ...emptyYard(),
    savetime: NOW - 20 * DAY,
    points: "0",
    ...extra,
  });

  test("an empty main yard gets it first, and the Twig Snapper does not fill for the time it did not stand", () => {
    const save = catchUpSave();

    const completed = catchUpYard(save, NOW);

    expect(completed.map((job) => job.kind)).toEqual(["starterBase"]);
    expect(Object.values(save.buildingdata!).map((one) => one.t)).toEqual([HALL, SNAPPER, SHINER, STORE]);
    expect(save.buildingdata!["2"]).toMatchObject({ st: 200 });
    expect(save.buildingdata!["3"]!.st ?? 0).toBe(0);
    expect(save.points).toBe("0");
    expect(save.savetime).toBe(NOW);
  });

  test("a second catch-up adds nothing", () => {
    const save = catchUpSave();
    catchUpYard(save, NOW);
    const buildings = structuredClone(save.buildingdata);
    const resources = structuredClone(save.resources);

    const completed = catchUpYard(save, NOW);

    expect(completed).toEqual([]);
    expect(save.buildingdata).toEqual(buildings);
    expect(save.resources).toEqual(resources);
  });

  test("an empty Map Room 2 yard gets the set, then its Map Room beside it", () => {
    const save = catchUpSave({ mr2upgraded: true, mapversion: 2 });

    const completed = catchUpYard(save, NOW);

    expect(completed.map((job) => job.kind)).toEqual(["starterBase", "mapRoomAdded"]);
    expect(Object.values(save.buildingdata!).map((one) => one.t)).toEqual([HALL, SNAPPER, SHINER, STORE, MAP_ROOM]);
    expectPlaceable(save.buildingdata!);
  });

  test("an empty outpost is not given it", () => {
    const save = catchUpSave({ type: BaseType.OUTPOST });
    expect(catchUpYard(save, NOW)).toEqual([]);
    expect(save.buildingdata).toEqual({});
  });
});
