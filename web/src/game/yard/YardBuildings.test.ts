// @vitest-environment jsdom
// jsdom: a colour-matrix filter asks for a canvas when it is made.
import { describe, expect, it } from "vitest";
import { Sprite, Texture, type ColorMatrixFilter } from "pixi.js";
import { creepZIndex } from "@/game/attack/AttackBattleLayer";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "./yardAtlas";
import { HIGHLIGHT_MATRIX, YardBuildings } from "./YardBuildings";
import { readWork } from "./buildingWork";
import { rowOf } from "./buildingCosts";
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

describe("YardBuildings: fortification overlays", () => {
  const fortified = (fort: number): BaseLoadResponse => {
    const response = yardResponse();
    (response.buildingdata as Record<string, Record<string, unknown>>)["2"]!.fort = fort;
    return response;
  };

  it("adds a back and a front picture for a fortified building only", () => {
    const plain = new YardBuildings();
    plain.show(readYard(yardResponse()), fakeAtlas());
    const base = plain.tops.children.length;
    plain.destroy();

    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(2)), fakeAtlas());
    expect(buildings.tops.children.length).toBe(base + 2);
    buildings.destroy();
  });

  it("stands the back behind the building and the front after its strips", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(1)), fakeAtlas());
    const kids = buildings.tops.children;
    // Booby trap (1 sprite), then back, sniper top, its gun strip, front.
    expect(kids.length).toBe(5);
    buildings.setDamage(2, 0.4);
    expect(buildings.tops.children.length).toBe(5);
    buildings.destroy();
  });

  it("moves with the building in the planner", () => {
    const buildings = new YardBuildings();
    buildings.show(readYard(fortified(1)), fakeAtlas());
    const before = buildings.tops.children.map((one) => [one.x, one.y]);
    buildings.offsetBuilding(2, 10, 20);
    const after = buildings.tops.children.map((one) => [one.x, one.y]);
    expect(after.slice(1).every(([x, y], i) => x === before[i + 1]![0]! + 10 && y === before[i + 1]![1]! + 20)).toBe(true);
    buildings.destroy();
  });
});

describe("YardBuildings.pick before the art arrives (#39)", () => {
  it("takes a press on the footprint drawn meanwhile, and none where the picture will stand", () => {
    const yard = readYard(yardResponse());
    const sniper = yard.buildings.find((one) => one.id === 2)!;
    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    // No art is fetched here, so every building is still its placeholder.
    expect(buildings.placeholderCount).toBe(2);
    const { x, y, width, height } = sniper.box;
    expect(buildings.pick(x + width / 2, y + height / 2)?.id).toBe(2);
    // Above the footprint is where the tower's picture rises once it loads;
    // until then nothing is drawn there, so nothing is picked there.
    expect(buildings.pick(x + width / 2, y - 60)).toBeNull();
    buildings.destroy();
  });
});

/** The yard above with the Sniper Tower mid-upgrade, so it carries a countdown badge. */
const upgradingYard = () => {
  const response = yardResponse();
  response.buildingdata!["2"] = { id: 2, t: 21, l: 1, X: 200, Y: 200, cU: 600 };
  return readYard(response);
};

/** The countdown badge: the one sprite in the badge layer. */
const badgeOf = (buildings: YardBuildings) => buildings.markers.children[0]!;

describe("YardBuildings.crownOf", () => {
  it("is the top of the building's picture, not its countdown badge, and moves with it (#139, #230)", () => {
    const yard = upgradingYard();
    const sniper = yard.buildings.find((one) => one.id === 2)!;

    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());
    // The placeholder fills the footprint box. The badge stands above it, a
    // fixed height over the footprint whatever the art does, so counting it
    // lifted the bar far above a low building.
    const badge = badgeOf(buildings);
    expect(badge.y - badge.height).toBeLessThan(sniper.box.y);
    const crown = buildings.crownOf(2)!;
    expect(crown).toBe(sniper.box.y);

    buildings.offsetBuilding(2, 0, -50);
    expect(buildings.crownOf(2)).toBe(crown - 50);
    expect(buildings.crownOf(99)).toBeNull();
    buildings.destroy();
  });
});

describe("YardBuildings.hideBadges", () => {
  it("hides the badge of a building with a bar, through the planner's drawer, and gives it back (#230)", () => {
    const buildings = new YardBuildings();
    buildings.show(upgradingYard(), fakeAtlas());
    const badge = badgeOf(buildings);
    expect(badge.visible).toBe(true);

    buildings.hideBadges(new Set([2]));
    expect(badge.visible).toBe(false);
    // Out of the drawer and back: still hidden, the bar is still there.
    buildings.setHidden(2, true);
    buildings.setHidden(2, false);
    expect(badge.visible).toBe(false);

    // No bar any more (the clock was taken away): the badge comes back.
    buildings.hideBadges(new Set());
    expect(badge.visible).toBe(true);
    // A stored building's badge stays hidden whatever the bars say.
    buildings.setHidden(2, true);
    buildings.hideBadges(new Set());
    expect(badge.visible).toBe(false);
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

describe("YardBuildings.isAnimating, only while working (#255)", () => {
  const capacity = rowOf(1)![6]!.capacity[0]!;
  /** A full Twig Snapper, one with a cycle to go, a fountain and a sniper tower. */
  const workResponse = (): BaseLoadResponse =>
    ({
      ...yardResponse(),
      savetime: 1_700_000_000,
      buildingdata: {
        "1": { id: 1, t: 1, l: 1, X: 0, Y: 0, st: capacity },
        "2": { id: 2, t: 1, l: 1, X: 100, Y: 0, st: 0, cP: 30 },
        "3": { id: 3, t: 105, l: 1, X: 200, Y: 0 },
        "4": { id: 4, t: 21, l: 1, X: 300, Y: 0 },
      },
    }) as unknown as BaseLoadResponse;

  it("holds a full harvester, runs a filling one until it fills, and leaves the rest as they were", () => {
    const response = workResponse();
    const buildings = new YardBuildings();
    buildings.show(readYard(response), fakeAtlas(), readWork(response));
    const now = 1_700_000_000;
    expect(buildings.isAnimating(1, now)).toBe(false);
    expect(buildings.isAnimating(2, now)).toBe(true);
    expect(buildings.isAnimating(3, now)).toBe(true);
    // A tower's strip is a facing, never a loop.
    expect(buildings.isAnimating(4, now)).toBe(false);
    // The buffer fills partway through, and the strip stops with it.
    const full = readWork(response).get(2)!;
    expect(buildings.isAnimating(2, full - 1)).toBe(true);
    expect(buildings.isAnimating(2, full)).toBe(false);
    buildings.destroy();
  });

  it("holds every working building when nobody says what is working, until told", () => {
    const response = workResponse();
    const buildings = new YardBuildings();
    buildings.show(readYard(response), fakeAtlas());
    const now = 1_700_000_000;
    expect(buildings.isAnimating(2, now)).toBe(false);
    expect(buildings.isAnimating(3, now)).toBe(true);
    buildings.setWork(readWork(response));
    expect(buildings.isAnimating(2, now)).toBe(true);
    buildings.destroy();
  });
});

describe("YardBuildings guests (#272)", () => {
  it("stands a walker among the buildings by its depth key, through a redraw, until it leaves", () => {
    const yard = readYard(yardResponse());
    const sniper = yard.buildings.find((one) => one.id === 2)!;
    const buildings = new YardBuildings();
    buildings.show(yard, fakeAtlas());

    const behind = new Sprite(Texture.WHITE);
    behind.zIndex = creepZIndex(sniper.centreX, sniper.centreY - 20, 1);
    const inFront = new Sprite(Texture.WHITE);
    inFront.zIndex = creepZIndex(sniper.centreX, sniper.centreY + 20, 2);
    buildings.addGuest(behind);
    buildings.addGuest(inFront);

    // Where each stands in the draw list once sorted; the Sniper by its key.
    const order = (): number[] => {
      buildings.tops.sortChildren();
      const children = buildings.tops.children;
      const top = children.findIndex((child) => child.zIndex === sniper.depth * 8);
      return [children.indexOf(behind), top, children.indexOf(inFront)];
    };
    const [before, sniperAt, after] = order();
    expect(before).toBeLessThan(sniperAt!);
    expect(after).toBeGreaterThan(sniperAt!);

    // A redraw destroys every building sprite; the walkers stay, sorted.
    buildings.show(readYard(yardResponse()), fakeAtlas());
    expect(behind.destroyed).toBe(false);
    const [again, sniperAgain, afterAgain] = order();
    expect(again).toBeLessThan(sniperAgain!);
    expect(afterAgain).toBeGreaterThan(sniperAgain!);

    buildings.removeGuest(behind);
    expect(behind.parent).toBeNull();
    expect(behind.destroyed).toBe(false);
    buildings.destroy();
    expect(inFront.destroyed).toBe(false);
    behind.destroy();
    inFront.destroy();
  });
});
