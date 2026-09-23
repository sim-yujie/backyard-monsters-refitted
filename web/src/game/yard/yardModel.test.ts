import { describe, expect, it } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import fixture from "../../../test/fixtures/baseload-sandbox-yard.json";
import { artStateFor, BuildingCondition, readYard, TOWN_HALL_TYPE } from "./yardModel";
import { ArtState } from "./buildingArt";

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

describe("levels and countdowns", () => {
  it("puts a building with a running build countdown at level 0", () => {
    const built = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 3, cB: 600 } });
    const building = built.buildings[0]!;
    expect(building.level).toBe(0);
    expect(building.countdown).toEqual({ kind: "build", endsAt: 1_000_600 });
  });

  it("prefers a build countdown over an upgrade over a fortify", () => {
    const both = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, cB: 10, cU: 20, cF: 30 } });
    expect(both.buildings[0]!.countdown?.kind).toBe("build");

    const upgrading = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, l: 2, cU: 20, cF: 30 } });
    expect(upgrading.buildings[0]!.countdown).toEqual({ kind: "upgrade", endsAt: 1_000_020 });
    // An upgrade does not change the level until it finishes.
    expect(upgrading.buildings[0]!.level).toBe(2);
  });

  it("ignores a zero countdown", () => {
    const idle = yardWith({ "1": { X: 0, Y: 0, t: 14, id: 1, cB: 0, cU: 0 } });
    expect(idle.buildings[0]!.countdown).toBeNull();
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

  it("maps a condition to the art state the Flash client would render", () => {
    expect(artStateFor(BuildingCondition.HEALTHY)).toBe(ArtState.DEFAULT);
    expect(artStateFor(BuildingCondition.DAMAGED)).toBe(ArtState.DAMAGED);
    expect(artStateFor(BuildingCondition.DESTROYED)).toBe(ArtState.DESTROYED);
  });
});

describe("mushrooms", () => {
  it("places them in world pixels and marks about a quarter golden", () => {
    const list = Array.from({ length: 20 }, (_, i) => ({ X: i * 37 - 300, Y: i * 53 - 200, id: i }));
    const withMushrooms = yardWith({}, { mushrooms: { l: list, s: 0 } });

    expect(withMushrooms.mushrooms).toHaveLength(20);
    for (const mushroom of withMushrooms.mushrooms) {
      expect(mushroom.worldX).toBeGreaterThan(0);
      expect(mushroom.worldY).toBeGreaterThan(0);
    }

    const golden = withMushrooms.mushrooms.filter((one) => one.golden).length;
    expect(golden).toBeGreaterThan(0);
    expect(golden).toBeLessThan(withMushrooms.mushrooms.length);
  });
});
