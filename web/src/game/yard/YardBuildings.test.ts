// @vitest-environment jsdom
// jsdom: a colour-matrix filter asks for a canvas when it is made.
import { describe, expect, it } from "vitest";
import { Texture, type ColorMatrixFilter } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "./yardAtlas";
import { HIGHLIGHT_MATRIX, YardBuildings } from "./YardBuildings";
import { readYard } from "./yardModel";

/**
 * The frame setter a battle turns a tower's gun with (issue #67), and the
 * rebuild of the gun strip when the damaged art brings its own.
 */

/** A Booby Trap and a Sniper Tower on an otherwise empty plot. */
const yardResponse = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 24, l: 1, X: 0, Y: 0 },
      "2": { id: 2, t: 21, l: 1, X: 200, Y: 200 },
    },
    buildinghealthdata: {},
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    attackid: 77,
    storedata: {},
  }) as unknown as BaseLoadResponse;

/** White squares for every glyph: enough to build sprites without a GPU. */
const fakeAtlas = (): YardArtAtlas => ({
  placeholder: Texture.WHITE,
  mushroom: Texture.WHITE,
  mushroomGolden: Texture.WHITE,
  working: Texture.WHITE,
  destroy() {},
});

describe("YardBuildings.setAnimFrame", () => {
  it("puts a tower's gun strip on a cell before and after the strip arrives", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    expect(buildings.animLayerCount(2)).toBe(1);
    expect(buildings.animLayerCount(1)).toBe(0);
    buildings.setAnimFrame(2, 0, 7);
    expect(buildings.animFrameOf(2, 0)).toBe(7);
    // A layer the building does not have is ignored.
    buildings.setAnimFrame(2, 3, 7);
    buildings.setAnimFrame(1, 0, 7);
    expect(buildings.animFrameOf(1, 0)).toBeNull();
    buildings.destroy();
  });

  it("rebuilds the gun strip from the damaged art and keeps the facing", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    buildings.setAnimFrame(2, 0, 11);
    const before = buildings.tops.children.length;
    // Below half health the sniper swaps to its damaged picture, which ships a
    // damaged strip of its own.
    buildings.setDamage(2, 0.4);
    expect(buildings.animLayerCount(2)).toBe(1);
    expect(buildings.animFrameOf(2, 0)).toBe(11);
    expect(buildings.tops.children.length).toBe(before);
    buildings.destroy();
  });
});

describe("YardBuildings.crownOf", () => {
  it("is the top of the building's picture, raised to its countdown badge, and moves with it (#139)", () => {
    const response = yardResponse();
    response.buildingdata!["2"] = { id: 2, t: 21, l: 1, X: 200, Y: 200, cU: 600 };
    const yard = readYard(response);
    const sniper = yard.buildings.find((one) => one.id === 2)!;

    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    const crown = buildings.crownOf(2)!;
    // The placeholder fills the footprint box; the badge stands above it.
    expect(crown).toBeLessThan(sniper.box.y);

    buildings.offsetBuilding(2, 0, -50);
    expect(buildings.crownOf(2)).toBe(crown - 50);
    expect(buildings.crownOf(99)).toBeNull();
    buildings.destroy();
  });
});

describe("YardBuildings.setHighlight", () => {
  it("lights a building and its layers with Flash's matrix, through a damage swap, and puts it back (#88)", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(yardResponse()), fakeAtlas());
    buildings.setHighlight(2, true);
    expect(buildings.isHighlighted(2)).toBe(true);
    const lit = buildings.tops.children.filter((child) => (child.filters as unknown[] | null)?.length);
    // The sniper's top and its gun strip, sharing one filter.
    expect(lit).toHaveLength(2);
    const filter = (lit[0]!.filters as ColorMatrixFilter[])[0]!;
    expect(filter).toBe((lit[1]!.filters as ColorMatrixFilter[])[0]);
    expect([...filter.matrix]).toEqual([...HIGHLIGHT_MATRIX]);

    // The damaged art brings a new gun strip; it is lit too.
    buildings.setDamage(2, 0.4);
    const relit = buildings.tops.children.filter((child) => (child.filters as unknown[] | null)?.length);
    expect(relit).toHaveLength(2);

    buildings.setHighlight(2, false);
    expect(buildings.isHighlighted(2)).toBe(false);
    expect(buildings.tops.children.some((child) => (child.filters as unknown[] | null)?.length)).toBe(false);
    // An unknown id is ignored.
    buildings.setHighlight(99, true);
    expect(buildings.isHighlighted(99)).toBe(false);
    buildings.destroy();
  });
});
