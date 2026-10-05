import { describe, expect, it, vi } from "vitest";
import type * as Pixi from "pixi.js";
import { Texture } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "@/game/yard/yardAtlas";
import { YardRenderer, YardView } from "@/game/yard/YardRenderer";
import { readYard } from "@/game/yard/yardModel";
import { tileRect } from "./blueprint";

// Bitmap text measures glyphs on a DOM canvas, which the node environment
// has not got. The tiles' words are not what these tests are about.
vi.mock("pixi.js", async (importOriginal) => {
  const pixi = await importOriginal<typeof Pixi>();
  class FakeBitmapText extends pixi.Container {
    text: string;
    readonly anchor = { set: () => {} };
    constructor(options: { text: string }) {
      super();
      this.text = options.text;
    }
  }
  return {
    ...pixi,
    BitmapFontManager: { install: () => {} },
    BitmapText: FakeBitmapText,
  };
});

/**
 * The blueprint builds its tiles on the first switch to it, from the yard as
 * saved. Whatever the planner did before that switch — Clear yard, a store,
 * a move in the isometric view — has to be on the tiles when they appear.
 */

/** A Booby Trap, a Sniper Tower and a Heavy Trap on an otherwise empty plot. */
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
      "3": { id: 3, t: 117, l: 1, X: -200, Y: 100 },
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

const rendererOf = () => {
  const renderer = new YardRenderer();
  (renderer as unknown as { atlas: YardArtAtlas }).atlas = fakeAtlas();
  const yard = readYard(yardResponse());
  renderer.show(yard);
  return { renderer, yard };
};

/** The middle of a tile at a yard position, in blueprint world pixels. */
const tileCentre = (type: number, x: number, y: number) => {
  const rect = tileRect(type, x, y);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
};

describe("BlueprintLayer's first build", () => {
  it("hides what the planner stored before the first switch (Clear yard)", () => {
    const { renderer } = rendererOf();
    for (const id of [1, 2, 3]) renderer.setBuildingStored(id, true);

    renderer.setView(YardView.BLUEPRINT);

    const tower = tileCentre(21, 200, 200);
    expect(renderer.pick(tower.x, tower.y)).toBeNull();
    const trap = tileCentre(24, 0, 0);
    expect(renderer.pick(trap.x, trap.y)).toBeNull();
    renderer.destroy();
  });

  it("draws a building moved in the isometric view at its new spot", () => {
    const { renderer } = rendererOf();
    renderer.placeBuilding(2, -100, -300);

    renderer.setView(YardView.BLUEPRINT);

    const old = tileCentre(21, 200, 200);
    expect(renderer.pick(old.x, old.y)).toBeNull();
    const moved = tileCentre(21, -100, -300);
    expect(renderer.pick(moved.x, moved.y)?.id).toBe(2);
    renderer.destroy();
  });

  it("brings a stored building back when it is put down after the build", () => {
    const { renderer } = rendererOf();
    renderer.setBuildingStored(2, true);
    renderer.setView(YardView.BLUEPRINT);
    renderer.placeBuilding(2, -100, -300);
    renderer.setBuildingStored(2, false);

    const moved = tileCentre(21, -100, -300);
    expect(renderer.pick(moved.x, moved.y)?.id).toBe(2);
    renderer.destroy();
  });

  it("keeps an enemy's trap hidden when the blueprint is built after it was concealed", () => {
    const { renderer } = rendererOf();
    renderer.setConcealed(3, true);

    renderer.setView(YardView.BLUEPRINT);

    const trap = tileCentre(117, -200, 100);
    expect(renderer.pick(trap.x, trap.y)).toBeNull();
    renderer.destroy();
  });

  it("forgets the planner's edits when the planner puts everything back", () => {
    const { renderer } = rendererOf();
    renderer.setBuildingStored(1, true);
    renderer.placeBuilding(2, -100, -300);
    renderer.resetPlacements();

    renderer.setView(YardView.BLUEPRINT);

    const trap = tileCentre(24, 0, 0);
    expect(renderer.pick(trap.x, trap.y)?.id).toBe(1);
    const tower = tileCentre(21, 200, 200);
    expect(renderer.pick(tower.x, tower.y)?.id).toBe(2);
    renderer.destroy();
  });
});
