import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "@/game/yard/yardAtlas";
import { YardRenderer } from "@/game/yard/YardRenderer";
import { readYard } from "@/game/yard/yardModel";
import { TrapReveal, concealTraps, countedBuildings, isTrapType } from "./trapReveal";

/**
 * Hidden enemy traps (issue #66): which types are traps, hiding them through
 * the renderer so they are neither drawn, picked nor given corners, and the
 * diff that says one has just gone off.
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

const rendererOf = () => {
  const renderer = new YardRenderer();
  (renderer as unknown as { atlas: YardArtAtlas }).atlas = fakeAtlas();
  const yard = readYard(yardResponse());
  renderer.show(yard);
  return { renderer, yard };
};

describe("isTrapType", () => {
  it("names the Booby Trap and the Heavy Trap and nothing else", () => {
    expect(isTrapType(24)).toBe(true);
    expect(isTrapType(117)).toBe(true);
    expect(isTrapType(21)).toBe(false);
    expect(isTrapType(14)).toBe(false);
  });
});

describe("countedBuildings (#72)", () => {
  it("counts every building but the traps", () => {
    // A town hall, a wall, a cannon tower, a Booby Trap and a Heavy Trap.
    expect(countedBuildings([14, 17, 20, 24, 117])).toBe(3);
    expect(countedBuildings([])).toBe(0);
  });
});

describe("concealTraps", () => {
  it("conceals every trap in the yard and counts them", () => {
    const hidden: number[] = [];
    const count = concealTraps({ setConcealed: (id, on) => on && hidden.push(id) }, readYard(yardResponse()));
    expect(count).toBe(2);
    expect(hidden.sort()).toEqual([1, 3]);
  });
});

describe("TrapReveal", () => {
  it("reports each fired trap once, in the order the engine lists them", () => {
    const reveal = new TrapReveal();
    expect(reveal.sync([])).toEqual([]);
    expect(reveal.sync([3])).toEqual([3]);
    expect(reveal.sync([3])).toEqual([]);
    expect(reveal.sync([1, 3])).toEqual([1]);
    expect(reveal.has(1)).toBe(true);
    expect(reveal.has(2)).toBe(false);
  });
});

describe("YardRenderer.setConcealed", () => {
  it("takes a building out of picking, corners and centre, and puts it back", () => {
    const { renderer, yard } = rendererOf();
    const trap = yard.buildings.find((building) => building.type === 24);
    if (!trap) throw new Error("no trap");
    expect(renderer.pick(trap.centreX, trap.centreY)?.id).toBe(trap.id);
    expect(renderer.cornersOf(trap.id)).not.toBeNull();

    renderer.setConcealed(trap.id, true);
    expect(renderer.isConcealed(trap.id)).toBe(true);
    expect(renderer.pick(trap.centreX, trap.centreY)).toBeNull();
    expect(renderer.cornersOf(trap.id)).toBeNull();
    expect(renderer.centreOf(trap.id)).toBeNull();
    // The tower is untouched.
    expect(renderer.cornersOf(2)).not.toBeNull();

    renderer.setConcealed(trap.id, false);
    expect(renderer.isConcealed(trap.id)).toBe(false);
    expect(renderer.pick(trap.centreX, trap.centreY)?.id).toBe(trap.id);
    expect(renderer.cornersOf(trap.id)).not.toBeNull();
    renderer.destroy();
  });

  it("keeps a concealed building hidden when the planner puts everything back", () => {
    const { renderer } = rendererOf();
    renderer.setConcealed(1, true);
    renderer.setBuildingStored(2, true);
    renderer.resetPlacements();
    expect(renderer.cornersOf(2)).not.toBeNull();
    expect(renderer.cornersOf(1)).toBeNull();
    renderer.destroy();
  });

  it("is separate from the planner's drawer: storing and un-storing leaves concealment alone", () => {
    const { renderer } = rendererOf();
    renderer.setConcealed(1, true);
    renderer.setBuildingStored(1, true);
    renderer.setBuildingStored(1, false);
    expect(renderer.cornersOf(1)).toBeNull();
    renderer.setConcealed(1, false);
    expect(renderer.cornersOf(1)).not.toBeNull();
    renderer.destroy();
  });

  it("forgets concealment when a new yard is shown", () => {
    const { renderer, yard } = rendererOf();
    renderer.setConcealed(1, true);
    renderer.show(yard);
    expect(renderer.isConcealed(1)).toBe(false);
    expect(renderer.cornersOf(1)).not.toBeNull();
    renderer.destroy();
  });
});
