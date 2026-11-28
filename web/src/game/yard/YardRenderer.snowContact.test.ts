// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "./yardAtlas";
import { readYard } from "./yardModel";
import { YardRenderer } from "./YardRenderer";

/**
 * Christmas's contact patches (`snowContact.ts`) come with the snow: the yard
 * is shown again when the season arrives, and what was stored or concealed
 * (an enemy's traps) stays hidden through it.
 */

const yardResponse = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 14, l: 1, X: -300, Y: -300 },
      "2": { id: 2, t: 21, l: 1, X: -220, Y: -300 },
      "3": { id: 3, t: 24, l: 1, X: 300, Y: 300 },
    },
    buildinghealthdata: {},
    resources: { r1: 0, r2: 0, r3: 0, r4: 0 },
    storedata: {},
  }) as unknown as BaseLoadResponse;

const fakeAtlas = (): YardArtAtlas => ({
  placeholder: Texture.WHITE,
  mushroom: Texture.WHITE,
  working: Texture.WHITE,
  destroy() {},
});

afterEach(() => vi.restoreAllMocks());

describe("YardRenderer: snow contact patches", () => {
  it("lays them when Christmas comes, keeping concealed traps and stored buildings hidden", () => {
    vi.spyOn(Assets, "load").mockImplementation((() => Promise.reject(new Error("offline"))) as typeof Assets.load);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const renderer = new YardRenderer();
    (renderer as unknown as { atlas: YardArtAtlas }).atlas = fakeAtlas();
    renderer.show(readYard(yardResponse()));
    renderer.setConcealed(3, true);
    renderer.setBuildingStored(2, true);
    const inner = renderer as unknown as { buildings: { snowContact: boolean } };
    expect(inner.buildings.snowContact).toBe(false);

    renderer.setSeason("christmas");

    expect(inner.buildings.snowContact).toBe(true);
    expect(renderer.isConcealed(3)).toBe(true);
    expect((renderer as unknown as { stored: Set<number> }).stored.has(2)).toBe(true);
    renderer.destroy();
  });
});
