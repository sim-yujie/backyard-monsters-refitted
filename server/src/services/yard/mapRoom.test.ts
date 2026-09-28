import { describe, expect, test } from "bun:test";
import type { EntityManager } from "@mikro-orm/core";
import type { Save } from "../../database/models/save.model.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { storageCap } from "../base/economy/resourceBudget.js";
import { catchUpYard, type CatchUpSave } from "./catchUp.js";
import { overlaps, rectOf, withinBounds } from "../yardplanner/layoutGeometry.js";
import { ClientSafeError } from "../../middleware/clientSafeError.js";
import { placementProblem, planBuild } from "./build.js";
import {
  RADIO_BUILD_COST,
  freeSpotFor,
  joinMapRoom2,
  mapRoomLevel,
  migrateYard,
  needsMapRoom2Join,
  type MigrationSave,
  type RadioRemovedJob,
  type WorldJoin,
} from "./mapRoom.js";

/**
 * The Map Room cap, the Map Room 2 world join and the Radio removal
 * (`docs/design/yard-buildings.md` §2.5, §5.7).
 */

const NOW = 1_800_000_000;
const HALL = 14;
const MAP_ROOM = 11;
const RADIO = 113;

const building = (id: number, t: number, extra: Partial<BuildingData> = {}): BuildingData =>
  ({ id, t, x: 0, y: 0, X: id * 100, Y: 0, ...extra }) as BuildingData;

const saveOf = (buildings: BuildingData[], extra: Partial<MigrationSave> = {}): MigrationSave => ({
  buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])) as BuildingDataMap,
  buildinghealthdata: {},
  resources: { r1: 1000, r2: 1000, r3: 1000, r4: 0 },
  storedata: {},
  mr2upgraded: false,
  mapversion: 1,
  ...extra,
});

describe("migrateYard — Radio Tower", () => {
  test("every Radio goes, its health entry with it, and its build cost comes back", () => {
    const save = saveOf([building(0, HALL, { l: 6 }), building(5, RADIO, { l: 1 })], {
      buildinghealthdata: { "5": 300 },
    });

    const jobs = migrateYard(save, NOW);

    expect(save.buildingdata!["5"]).toBeUndefined();
    expect(save.buildinghealthdata).toEqual({});
    expect(save.resources).toEqual({ r1: 3000, r2: 3000, r3: 3000, r4: 0 });
    expect(jobs).toEqual([
      { kind: "radioRemoved", id: 5, t: RADIO, at: NOW, detail: { refund: RADIO_BUILD_COST } },
    ]);
  });

  test("the refund is clamped to the storage cap; a pool over the cap keeps what it has", () => {
    const cap = storageCap(saveOf([]));
    const save = saveOf([building(5, RADIO)], {
      resources: { r1: cap - 500, r2: cap + 10, r3: 0, r4: 0 },
    });

    const [job] = migrateYard(save, NOW) as RadioRemovedJob[];

    expect(job!.detail.refund).toEqual({ r1: 500, r2: 0, r3: 2000, r4: 0 });
    expect(save.resources).toEqual({ r1: cap, r2: cap + 10, r3: 2000, r4: 0 });
  });

  test("a second run finds nothing to do", () => {
    const save = saveOf([building(5, RADIO)]);
    migrateYard(save, NOW);
    const after = structuredClone(save);

    expect(migrateYard(save, NOW)).toEqual([]);
    expect(save).toEqual(after);
  });
});

describe("migrateYard — Map Room", () => {
  test("a level 3 Map Room is written back to 2, a running upgrade past 2 dropped", () => {
    const save = saveOf([building(1, MAP_ROOM, { l: 3 }), building(2, MAP_ROOM, { l: 2, cU: 50, cL: 99 })]);

    expect(migrateYard(save, NOW)).toEqual([]);

    expect(save.buildingdata!["1"]).toMatchObject({ l: 2 });
    expect(save.buildingdata!["2"]).toMatchObject({ l: 2 });
    expect(save.buildingdata!["2"]!.cU).toBeUndefined();
    expect(save.buildingdata!["2"]!.cL).toBeUndefined();
  });

  test("with mr2upgraded a level 1 Map Room becomes level 2, its upgrade no longer needed", () => {
    const idle = saveOf([building(1, MAP_ROOM, { l: 1 })], { mr2upgraded: true });
    migrateYard(idle, NOW);
    expect(idle.buildingdata!["1"]).toMatchObject({ l: 2 });

    const upgrading = saveOf([building(1, MAP_ROOM, { l: 1, cU: 1000, cL: 345_600 })], {
      mr2upgraded: true,
    });
    migrateYard(upgrading, NOW);
    expect(upgrading.buildingdata!["1"]).toEqual(building(1, MAP_ROOM, { l: 2 }));
  });

  test("a Map Room still being built is left alone; a level 1 one without mr2upgraded too", () => {
    const building0 = building(1, MAP_ROOM, { l: 0, cB: 400 });
    const save = saveOf([building0], { mr2upgraded: true });
    expect(migrateYard(save, NOW)).toEqual([]);
    expect(save.buildingdata!["1"]).toEqual(building0);

    const plain = saveOf([building(1, MAP_ROOM, { l: 1, cU: 20 })]);
    const before = structuredClone(plain);
    migrateYard(plain, NOW);
    expect(plain).toEqual(before);
  });
});

describe("migrateYard — a Map Room 2 yard without a Map Room (owner decision 2026-09-28)", () => {
  /** A Town Hall in the middle, as a real yard has it. */
  const hall = () => building(3, HALL, { l: 6, X: -65, Y: -65 });

  const mapRoomsOf = (save: MigrationSave): BuildingData[] =>
    Object.values(save.buildingdata ?? {}).filter((one) => Number(one.t) === MAP_ROOM);

  test("gets one, level 2 and finished, with the next id, on a free spot, reported once", () => {
    const save = saveOf([hall(), building(40, 20, { l: 3, X: 200, Y: 0 })], {
      mr2upgraded: true,
      mapversion: 2,
      buildinghealthdata: { "57": 100 },
      mushrooms: { l: [[1, 100, -40]], s: NOW },
    });

    const jobs = migrateYard(save, NOW);

    const [mapRoom] = mapRoomsOf(save);
    expect(mapRoomsOf(save)).toHaveLength(1);
    const x = Number(mapRoom!.X);
    const y = Number(mapRoom!.Y);
    // One above every id in buildingdata and buildinghealthdata.
    expect(mapRoom).toEqual({ id: 58, t: MAP_ROOM, X: x, Y: y, l: 2 } as unknown as BuildingData);
    expect(save.buildingdata!["58"]).toBe(mapRoom!);
    expect(mapRoomLevel(save.buildingdata)).toBe(2);
    expect(jobs).toEqual([
      { kind: "mapRoomAdded", id: 58, t: MAP_ROOM, at: NOW, detail: { level: 2, x, y } },
    ]);

    // Clear of every other building and the mushroom, inside the plot: the build route's own rule.
    const others = { ...save.buildingdata! };
    delete others["58"];
    expect(placementProblem({ ...save, buildingdata: others }, { type: MAP_ROOM, x, y })).toBeNull();
    expect(overlaps(rectOf(MAP_ROOM, x, y), rectOf(7, 100, -40))).toBe(false);
  });

  test("mapversion 2 alone is enough", () => {
    const save = saveOf([hall()], { mapversion: 2 });
    expect(migrateYard(save, NOW).map((job) => job.kind)).toEqual(["mapRoomAdded"]);
    expect(mapRoomsOf(save)).toHaveLength(1);
  });

  test("a yard not on Map Room 2 gets none: it builds one from the Build menu", () => {
    const save = saveOf([hall()]);
    const before = structuredClone(save);
    expect(migrateYard(save, NOW)).toEqual([]);
    expect(save).toEqual(before);
  });

  test("a yard that has one, even one still being built, gets no second", () => {
    for (const mapRoom of [building(9, MAP_ROOM, { l: 1 }), building(9, MAP_ROOM, { cB: 400 })]) {
      const save = saveOf([hall(), mapRoom], { mr2upgraded: true });
      expect(migrateYard(save, NOW).filter((job) => job.kind === "mapRoomAdded")).toEqual([]);
      expect(mapRoomsOf(save)).toHaveLength(1);
    }
  });

  test("idempotent: a second run adds nothing", () => {
    const save = saveOf([hall()], { mr2upgraded: true });
    migrateYard(save, NOW);
    const after = structuredClone(save);

    expect(migrateYard(save, NOW + 60)).toEqual([]);
    expect(save).toEqual(after);
  });

  test("the spot keeps off mushrooms: one on the first choice moves it", () => {
    const empty = saveOf([hall()], { mr2upgraded: true });
    const first = freeSpotFor(empty, MAP_ROOM)!;
    const save = saveOf([hall()], {
      mr2upgraded: true,
      mushrooms: { l: [[1, first.x + 30, first.y + 30]], s: NOW },
    });

    const spot = freeSpotFor(save, MAP_ROOM)!;

    expect(spot).not.toEqual(first);
    expect(overlaps(rectOf(MAP_ROOM, spot.x, spot.y), rectOf(7, first.x + 30, first.y + 30))).toBe(false);
  });

  test("a packed yard: it finds the one gap left, inside the plot", () => {
    // Town Halls (130 × 130) tiling the 1000 × 800 plot, one left out.
    const halls: BuildingData[] = [];
    let id = 1;
    for (let y = -400; y < 400; y += 120) {
      for (let x = -500; x < 500; x += 120) {
        if (x === 220 && y === 80) continue;
        halls.push(building(id++, HALL, { l: 6, X: x, Y: y }));
      }
    }
    const save = saveOf(halls, { mr2upgraded: true });

    const [job] = migrateYard(save, NOW);

    expect(job?.kind).toBe("mapRoomAdded");
    const mapRoom = save.buildingdata![String(job!.id)]!;
    const rect = rectOf(MAP_ROOM, Number(mapRoom.X), Number(mapRoom.Y));
    expect(withinBounds(rect, MAP_ROOM, 0)).toBe(true);
    expect(halls.some((one) => overlaps(rect, rectOf(HALL, Number(one.X), Number(one.Y))))).toBe(false);
  });

  test("no room at all: nothing is added, and nothing reported", () => {
    const halls: BuildingData[] = [];
    let id = 1;
    for (let y = -400; y < 400; y += 120) {
      for (let x = -500; x < 500; x += 120) halls.push(building(id++, HALL, { l: 6, X: x, Y: y }));
    }
    const save = saveOf(halls, { mr2upgraded: true });

    expect(migrateYard(save, NOW)).toEqual([]);
    expect(mapRoomsOf(save)).toEqual([]);
  });
});

describe("needsMapRoom2Join", () => {
  test("a level 2 Map Room off Map Room 2 needs the join; nothing else does", () => {
    expect(needsMapRoom2Join(saveOf([building(1, MAP_ROOM, { l: 2 })]))).toBe(true);
    expect(needsMapRoom2Join(saveOf([building(1, MAP_ROOM, { l: 1 })]))).toBe(false);
    expect(needsMapRoom2Join(saveOf([building(1, MAP_ROOM, { l: 2 })], { mr2upgraded: true }))).toBe(
      false
    );
    expect(needsMapRoom2Join(saveOf([building(1, MAP_ROOM, { l: 2 })], { mapversion: 3 }))).toBe(
      false
    );
    expect(needsMapRoom2Join(saveOf([]))).toBe(false);
  });

  test("the Map Room level is the highest standing one; one being built is level 0", () => {
    expect(mapRoomLevel(saveOf([building(1, MAP_ROOM, { l: 2, cB: 5 })]).buildingdata)).toBe(0);
    expect(mapRoomLevel(saveOf([building(1, MAP_ROOM)]).buildingdata)).toBe(1);
  });
});

describe("joinMapRoom2", () => {
  const em = {} as EntityManager;

  const recorder = () => {
    const calls: Save[] = [];
    const join: WorldJoin = async (_em, save) => {
      calls.push(save);
      save.worldid = "world-1";
    };
    return { calls, join };
  };

  test("joins a world, then sets mr2upgraded and mapversion 2", async () => {
    const save = saveOf([building(1, MAP_ROOM, { l: 2 })]) as unknown as Save;
    const { calls, join } = recorder();

    expect(await joinMapRoom2(em, save, null, join)).toBe(true);

    expect(calls).toEqual([save]);
    expect(save).toMatchObject({ mr2upgraded: true, mapversion: 2, worldid: "world-1" });
  });

  test("a save that already has a world only gets its flags: no second home cell", async () => {
    const save = saveOf([building(1, MAP_ROOM, { l: 2 })], {}) as unknown as Save;
    save.worldid = "old-world";
    const { calls, join } = recorder();

    expect(await joinMapRoom2(em, save, null, join)).toBe(true);

    expect(calls).toEqual([]);
    expect(save).toMatchObject({ mr2upgraded: true, mapversion: 2, worldid: "old-world" });
  });

  test("nothing happens when the yard does not need it", async () => {
    const save = saveOf([building(1, MAP_ROOM, { l: 1 })]) as unknown as Save;
    const { calls, join } = recorder();

    expect(await joinMapRoom2(em, save, null, join)).toBe(false);
    expect(calls).toEqual([]);
    expect(save.mr2upgraded).toBe(false);
  });
});

describe("catchUpYard runs the migration first", () => {
  test("a Radio is removed and reported; a finished L1 to L2 upgrade leaves a yard that needs the join", () => {
    const save = {
      ...saveOf([
        building(0, HALL, { l: 6 }),
        building(1, MAP_ROOM, { l: 1, cU: 100, cL: 345_600 }),
        building(5, RADIO),
      ]),
      savetime: NOW - 200,
      points: "0",
      mushrooms: { l: [], s: NOW },
    } as CatchUpSave;

    const completed = catchUpYard(save, NOW);

    expect(completed.map((job) => [job.kind, job.id])).toEqual([
      ["upgrade", 1],
      ["radioRemoved", 5],
    ]);
    expect(save.buildingdata!["1"]).toMatchObject({ l: 2 });
    expect(needsMapRoom2Join(save)).toBe(true);
  });

  test("a Map Room 2 yard with none gets one in a full catch-up, once; the build menu then counts it", () => {
    const save = {
      ...saveOf([building(0, HALL, { l: 6, X: -65, Y: -65 })], {
        mr2upgraded: true,
        mapversion: 2,
        resources: { r1: 1e7, r2: 1e7, r3: 1e7, r4: 1e7 },
      }),
      savetime: NOW - 200,
      points: "0",
      mushrooms: { l: [], s: NOW },
    } as CatchUpSave;

    const completed = catchUpYard(save, NOW);

    expect(completed.map((job) => [job.kind, job.t])).toEqual([["mapRoomAdded", MAP_ROOM]]);
    expect(needsMapRoom2Join(save)).toBe(false);

    const after = structuredClone(save);
    expect(catchUpYard(save, NOW)).toEqual([]);
    expect(save).toEqual(after);

    // One allowed at every Town Hall level, and now one owned: a second is refused.
    let refused: ClientSafeError | null = null;
    try {
      planBuild(save, { type: MAP_ROOM, x: 300, y: 200 }, NOW);
    } catch (err) {
      if (err instanceof ClientSafeError) refused = err;
    }
    expect(refused?.status).toBe(409);
    expect(refused?.data).toMatchObject({ reason: "limit", limit: { have: 1, allowed: 1, next: null } });
  });
});
