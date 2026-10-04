import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { artStateFor, BuildingCondition, readYard, TOWN_HALL_TYPE } from "./yardModel";
import { ArtState } from "./buildingArt";
import { depthKey, footprintOf, FOREIGN_YARD_MARGIN, YARD_MARGIN } from "./YardGrid";

const yard = readYard(fixture as unknown as BaseLoadResponse);

/** A minimal response, for the cases the captured yard does not cover. */
const yardWith = (
  buildings: Record<string, Record<string, number>>,
  extra: Partial<BaseLoadResponse> = {},
): ReturnType<typeof readYard> =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_000_000,
    savetime: 1_000_000,
    buildingdata: buildings,
    ...extra,
  } as unknown as BaseLoadResponse);

describe("reading the captured yard", () => {
  it("finds every building", () => {
    expect(yard.buildings).toHaveLength(575);
  });

  it("reads the expansion level and the plot it implies", () => {
    expect(yard.expansionLevel).toBe(6);
    expect(yard.bounds.yardWidth).toBe(1780);
    expect(yard.bounds.yardHeight).toBe(1420);
  });

  it("finds the town hall", () => {
    expect(yard.townHall?.type).toBe(TOWN_HALL_TYPE);
    expect(yard.townHall?.level).toBe(10);
    expect(yard.townHall?.name).toBe("Town Hall");
  });

  it("is sorted back to front", () => {
    for (let i = 1; i < yard.buildings.length; i++) {
      expect(yard.buildings[i]!.depth).toBeGreaterThanOrEqual(yard.buildings[i - 1]!.depth);
    }
  });

  it("gives every building a name and a footprint", () => {
    for (const building of yard.buildings) {
      expect(building.name).not.toMatch(/^Type /);
      expect(building.footprint[0]).toBeGreaterThan(0);
      expect(building.footprint[1]).toBeGreaterThan(0);
    }
  });

  it("carries the resources and credits through", () => {
    expect(yard.resources.r1).toBe(11_163_050_000);
    expect(yard.credits).toBe(980_412);
  });

  it("counts the workers off the store purchases and the countdowns", () => {
    // `BEW.q` is 4 in the capture, and nothing is being built.
    expect(yard.workers).toEqual({ total: 5, busy: 0 });
  });

  it("has no damaged buildings, no countdowns and no mushrooms", () => {
    expect(yard.buildings.every((one) => one.condition === BuildingCondition.HEALTHY)).toBe(true);
    expect(yard.buildings.every((one) => one.countdown === null)).toBe(true);
    expect(yard.mushrooms).toHaveLength(0);
  });

  it("treats an omitted level as 1", () => {
    // 400 walls and 75 booby traps have no `l` in the capture.
    const wall = yard.buildings.find((one) => one.type === 17);
    expect(wall?.raw.l).toBeUndefined();
    expect(wall?.level).toBe(1);
  });

  it("falls back to the server clock when the save has never been written", () => {
    // savetime is 0 in the capture, which would put countdowns decades back.
    expect(fixture.savetime).toBe(0);
    expect(yard.savedAt).toBe(fixture.currenttime);
  });
});

describe("whose yard it is", () => {
  it("is the player's own by default, on the store's plot with its edge", () => {
    expect(yard.foreign).toBe(false);
    expect(yard.bounds.margin).toBe(YARD_MARGIN);
    const small = yardWith({});
    expect(small.foreign).toBe(false);
    expect(small.bounds.yardWidth).toBe(1000);
  });

  it("puts a wild monster camp on the plot WMBASE.Setup grows, whatever the caller says", () => {
    // A tribe save has no store purchases (server/src/game-data/tribes/v2/kozu.ts).
    const camp = yardWith({ "1": { X: -640, Y: -580, t: 17, id: 1 } }, { type: "tribe", storedata: {} });
    expect(camp.foreign).toBe(true);
    expect(camp.expansionLevel).toBe(0);
    expect(camp.bounds.yardWidth).toBe(1840);
    expect(camp.bounds.yardHeight).toBe(1500);
    expect(camp.bounds.margin).toBe(FOREIGN_YARD_MARGIN);
    // A wall at the far reach of the level 1 layout is inside the world.
    const wall = camp.buildings[0]!;
    expect(wall.box.x).toBeGreaterThan(0);
    expect(wall.box.y).toBeGreaterThan(0);
  });

  it("keeps a visited player's plot but gives it the wider margin and no edge", () => {
    const visit = readYard(fixture as unknown as BaseLoadResponse, { foreign: true });
    expect(visit.foreign).toBe(true);
    expect(visit.bounds.yardWidth).toBe(1780);
    expect(visit.bounds.yardHeight).toBe(1420);
    expect(visit.bounds.margin).toBe(FOREIGN_YARD_MARGIN);
    // Same plot, so every building is where the own-yard view has it, shifted
    // by the extra margin.
    const shift = FOREIGN_YARD_MARGIN - YARD_MARGIN;
    expect(visit.townHall!.worldX).toBe(yard.townHall!.worldX + shift);
    expect(visit.townHall!.worldY).toBe(yard.townHall!.worldY + shift);
  });
});

describe("the outpost's cell height (#262)", () => {
  it("is 0 where the load sends none, the main yard always", () => {
    expect(yard.cellHeight).toBe(0);
    expect(yardWith({}).cellHeight).toBe(0);
  });

  it("carries the load's cellheight, for the planner's rings and the info panel", () => {
    expect(yardWith({}, { type: "outpost", cellheight: 250 }).cellHeight).toBe(250);
    expect(yardWith({}, { type: "outpost", cellheight: 0 }).cellHeight).toBe(0);
  });

  it("ignores a value that is not a number", () => {
    expect(yardWith({}, { type: "outpost", cellheight: "250" as unknown as number }).cellHeight).toBe(0);
  });
});

describe("levels and countdowns", () => {
  it("puts a building with a running build countdown at level 0", () => {
    const built = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 3, cB: 600 } });
    const building = built.buildings[0]!;
    expect(building.level).toBe(0);
    expect(building.countdown).toEqual({
      kind: "build",
      endsAt: 1_000_600,
      seconds: 600,
      paused: false,
    });
  });

  it("prefers a build countdown over an upgrade over a fortify", () => {
    const both = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, cB: 10, cU: 20, cF: 30 } });
    expect(both.buildings[0]!.countdown?.kind).toBe("build");

    const upgrading = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 2, cU: 20, cF: 30 } });
    expect(upgrading.buildings[0]!.countdown).toEqual({
      kind: "upgrade",
      endsAt: 1_000_020,
      seconds: 20,
      paused: false,
    });
    // An upgrade does not change the level until it finishes.
    expect(upgrading.buildings[0]!.level).toBe(2);
  });

  it("ignores a zero countdown", () => {
    const idle = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, cB: 0, cU: 0 } });
    expect(idle.buildings[0]!.countdown).toBeNull();
  });

  it("marks a countdown paused while the building is damaged or repairing, as the server does", () => {
    const hurt = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 2, cU: 20, hp: 100 } });
    expect(hurt.buildings[0]!.countdown?.paused).toBe(true);

    const repairing = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 2, cU: 20, rE: 1 } });
    expect(repairing.buildings[0]!.countdown?.paused).toBe(true);

    const healthRow = yardWith(
      { "1": { X: 0, Y: 0, t: 14, id: 1, l: 2, cU: 20 } },
      { buildinghealthdata: { "1": 500 } },
    );
    expect(healthRow.buildings[0]!.countdown?.paused).toBe(true);
  });
});

describe("damage", () => {
  it("is healthy at or above half of maximum", () => {
    // A level 1 town hall has 4000 maximum health.
    const hurt = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, hp: 2_000 } });
    expect(hurt.buildings[0]!.condition).toBe(BuildingCondition.HEALTHY);
    expect(hurt.buildings[0]!.maxHp).toBe(4_000);
  });

  it("is damaged below half of maximum", () => {
    const hurt = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, hp: 1_999 } });
    expect(hurt.buildings[0]!.condition).toBe(BuildingCondition.DAMAGED);
  });

  it("is destroyed at zero", () => {
    const dead = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, hp: 0 } });
    expect(dead.buildings[0]!.condition).toBe(BuildingCondition.DESTROYED);
  });

  it("reads buildinghealthdata when the building record omits hp", () => {
    const hurt = yardWith(
      { "7": { X: 0, Y: 0, t: 14, id: 7 } },
      { buildinghealthdata: { "7": 100 } },
    );
    expect(hurt.buildings[0]!.hp).toBe(100);
    expect(hurt.buildings[0]!.condition).toBe(BuildingCondition.DAMAGED);
  });

  // Flash swaps in `OUTPOST_YARD_PROPS` for an outpost (`GLOBAL.as:716-723`), issue #179.
  it("reads an outpost's health from the outpost table, the core's 200,000 among it", () => {
    const buildings = {
      "1": { X: 0, Y: 0, t: 112, id: 1, l: 1 },
      "2": { X: 200, Y: 0, t: 23, id: 2, l: 6 },
      "3": { X: 400, Y: 0, t: 20, id: 3, l: 10 },
    };
    const outpost = yardWith(buildings, { type: "outpost" });
    expect(outpost.buildings.map((one) => one.maxHp)).toEqual([200_000, 60_200, 98_200]);
    const main = yardWith(buildings, { type: "main" });
    expect(main.buildings[1]!.maxHp).toBe(42_200);
  });

  it("maps a condition to the art state the Flash client would render", () => {
    expect(artStateFor(BuildingCondition.HEALTHY)).toBe(ArtState.DEFAULT);
    expect(artStateFor(BuildingCondition.DAMAGED)).toBe(ArtState.DAMAGED);
    expect(artStateFor(BuildingCondition.DESTROYED)).toBe(ArtState.DESTROYED);
  });
});

describe("mushrooms", () => {
  it("reads the save's [frame, X, Y] entries into world pixels, numbered by their place", () => {
    const list = Array.from(
      { length: 20 },
      (_, i): [number, number, number] => [(i % 5) + 1, i * 37 - 300, i * 53 - 200],
    );
    const withMushrooms = yardWith({}, { mushrooms: { l: list, s: 0 } });

    expect(withMushrooms.mushrooms).toHaveLength(20);
    withMushrooms.mushrooms.forEach((mushroom, index) => {
      expect(mushroom.id).toBe(index);
      expect([mushroom.x, mushroom.y]).toEqual([index * 37 - 300, index * 53 - 200]);
      expect(mushroom.variant).toBe((index % 5) + 1);
      expect(mushroom.worldX).toBeGreaterThan(0);
      expect(mushroom.worldY).toBeGreaterThan(0);
    });
  });

  it("still reads an object entry, and carries no golden guess", () => {
    const yard = yardWith({}, { mushrooms: { l: [{ X: 40, Y: -20, frame: 9 }], s: 0 } });

    expect(yard.mushrooms[0]).toMatchObject({ id: 0, x: 40, y: -20, variant: 1 });
    expect(yard.mushrooms[0]).not.toHaveProperty("golden");
  });
});

describe("mushrooms on an outpost (#191)", () => {
  it("are never drawn: Flash shows mushrooms on the main yard only", () => {
    const load = (type: string) =>
      readYard({
        error: 0,
        id: 1,
        baseid: "9",
        basesaveid: 1,
        worldsize: [800, 800],
        currenttime: 1,
        type,
        buildingdata: {},
        mushrooms: { l: [[1, 10, 20]] },
      } as BaseLoadResponse);
    expect(load("outpost").mushrooms).toEqual([]);
    expect(load("main").mushrooms).toHaveLength(1);
  });
});

describe("depth order (#270)", () => {
  const HATCHERY = 13;
  const WALL = 17;

  /** True when `back` is drawn before `front` in a yard holding just the two. */
  const drawnBehind = (
    back: { t: number; X: number; Y: number },
    front: { t: number; X: number; Y: number },
  ): boolean => {
    const { buildings } = yardWith({
      "1": { id: 1, ...back },
      "2": { id: 2, ...front },
    });
    const backDepth = buildings.find((one) => one.id === 1)!.depth;
    const frontDepth = buildings.find((one) => one.id === 2)!.depth;
    return backDepth < frontDepth && buildings[0]!.id === 1;
  };

  it("draws a wall block against a Hatchery's back faces behind it, as the owner's yard showed", () => {
    // A Hatchery is 100 x 100 yard units and a wall block 20 x 20. Each block
    // here touches a back face, so its top corner is further down the screen
    // than the Hatchery's although it stands behind it.
    const hatchery = { t: HATCHERY, X: 0, Y: 0 };
    expect(drawnBehind({ t: WALL, X: -20, Y: 40 }, hatchery)).toBe(true);
    expect(drawnBehind({ t: WALL, X: -20, Y: 80 }, hatchery)).toBe(true);
    expect(drawnBehind({ t: WALL, X: 40, Y: -20 }, hatchery)).toBe(true);
    expect(drawnBehind({ t: WALL, X: 80, Y: -20 }, hatchery)).toBe(true);
  });

  it("draws a wall block against a Hatchery's front faces in front of it", () => {
    const hatchery = { t: HATCHERY, X: 0, Y: 0 };
    expect(drawnBehind(hatchery, { t: WALL, X: 100, Y: 0 })).toBe(true);
    expect(drawnBehind(hatchery, { t: WALL, X: 100, Y: 80 })).toBe(true);
    expect(drawnBehind(hatchery, { t: WALL, X: 0, Y: 100 })).toBe(true);
    expect(drawnBehind(hatchery, { t: WALL, X: 80, Y: 100 })).toBe(true);
  });

  it("orders two touching buildings of any sizes back to front along both axes", () => {
    // One type for every square footprint size the yard has, 20 to 160.
    const types = [17, 52, 1, 6, 5, 13, 14, 27, 15];
    for (const middle of types) {
      const [size] = footprintOf(middle);
      const centre = { t: middle, X: 0, Y: 0 };
      for (const other of types) {
        const [side] = footprintOf(other);
        // Every 10-unit slide of `other` along each face that still touches it.
        for (let along = -side + 10; along < size; along += 10) {
          const backLeft = { t: other, X: -side, Y: along };
          const backRight = { t: other, X: along, Y: -side };
          const frontRight = { t: other, X: size, Y: along };
          const frontLeft = { t: other, X: along, Y: size };
          const where = `type ${other} at ${along} along type ${middle}`;
          expect(drawnBehind(backLeft, centre), `${where}, back left`).toBe(true);
          expect(drawnBehind(backRight, centre), `${where}, back right`).toBe(true);
          expect(drawnBehind(centre, frontRight), `${where}, front right`).toBe(true);
          expect(drawnBehind(centre, frontLeft), `${where}, front left`).toBe(true);
        }
      }
    }
  });

  it("keys a building by its footprint centre, as Flash does", () => {
    const { buildings } = yardWith({ "7": { id: 7, t: HATCHERY, X: 30, Y: -50 } });
    const hatchery = buildings[0]!;
    expect(hatchery.depth).toBe(depthKey(hatchery.centreX, hatchery.centreY, 7));
  });
});
