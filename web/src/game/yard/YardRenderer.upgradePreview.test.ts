// @vitest-environment jsdom
// jsdom: a colour-matrix filter asks for a canvas when it is made.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture, type Container } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import { setClassicLook } from "@/game/classicLook";
import type { YardArtAtlas } from "./yardAtlas";
import { readYard, type Yard } from "./yardModel";
import { YardRenderer, YardView } from "./YardRenderer";

/**
 * The upgrade preview on the yard (beta 8): the selected building drawn as a
 * blue ghost of its next look over itself faded, only where the look changes
 * and only with the Modern look, and gone with the selection, a redraw of
 * the yard, or the window's null.
 */

/** A Goo Factory one level below a new look (5 → 6), one mid-tier (3 → 4), and a Town Hall. */
const yardResponse = (): BaseLoadResponse =>
  ({
    error: 0,
    id: 1,
    baseid: "3502",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    buildingdata: {
      "1": { id: 1, t: 4, l: 5, X: -200, Y: -200 },
      "2": { id: 2, t: 4, l: 3, X: 100, Y: 100 },
      "3": { id: 3, t: 14, l: 4, X: 0, Y: -300 },
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

interface Inner {
  atlas: YardArtAtlas;
  buildings: { fadedId: number | null };
  upgradePreview: { root: Container; glow: Container; body: Container; tag: Container };
  upgradePreviewLayer: Container;
}

const setUp = (): { renderer: YardRenderer; yard: Yard; inner: Inner } => {
  const renderer = new YardRenderer();
  const inner = renderer as unknown as Inner;
  inner.atlas = fakeAtlas();
  const yard = readYard(yardResponse());
  renderer.show(yard);
  return { renderer, yard, inner };
};

const pick = (yard: Yard, id: number) => yard.buildings.find((one) => one.id === id)!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let release: () => void = () => {};
beforeEach(() => {
  const gate = new Promise<void>((resolve) => (release = resolve));
  vi.spyOn(Assets, "load").mockImplementation((async () => {
    await gate;
    return Texture.WHITE;
  }) as typeof Assets.load);
});
afterEach(() => {
  vi.restoreAllMocks();
  setClassicLook(false);
});

describe("YardRenderer.setUpgradePreview", () => {
  it("draws the ghost over the selected building, faded, when its next level looks different", async () => {
    const { renderer, yard, inner } = setUp();
    const goo = pick(yard, 1);
    renderer.setSelected(goo);
    renderer.setUpgradePreview(goo, 6);
    expect(renderer.upgradePreviewId).toBe(1);
    expect(inner.buildings.fadedId).toBe(1);
    expect(inner.upgradePreview.root.visible).toBe(true);
    // The footprint and the "Lv 6" tag go up at once; the pictures when they load.
    expect(inner.upgradePreview.tag.children.length).toBeGreaterThan(0);
    expect(inner.upgradePreview.body.children).toHaveLength(0);
    release();
    await settle();
    expect(inner.upgradePreview.body.children.length).toBeGreaterThan(0);
    expect(inner.upgradePreview.glow.children).toHaveLength(
      inner.upgradePreview.body.children.length,
    );
    expect(inner.upgradePreview.body.filters).toHaveLength(1);
    // Asked again (every redraw of the window), nothing is rebuilt.
    const sprites = [...inner.upgradePreview.body.children];
    renderer.setUpgradePreview(goo, 6);
    expect(inner.upgradePreview.body.children).toEqual(sprites);
    renderer.destroy();
  });

  it("draws nothing mid-tier, for a building not selected, or with the Classic look", () => {
    const { renderer, yard, inner } = setUp();
    const mid = pick(yard, 2);
    renderer.setSelected(mid);
    renderer.setUpgradePreview(mid, 4);
    expect(renderer.upgradePreviewId).toBeNull();
    expect(inner.buildings.fadedId).toBeNull();

    // The window's building must be the one selected.
    renderer.setUpgradePreview(pick(yard, 1), 6);
    expect(renderer.upgradePreviewId).toBeNull();

    setClassicLook(true);
    const hall = pick(yard, 3);
    renderer.setSelected(hall);
    renderer.setUpgradePreview(hall, 5);
    expect(renderer.upgradePreviewId).toBeNull();
    expect(inner.upgradePreview.root.visible).toBe(false);
    renderer.destroy();
  });

  it("puts the building back on null, on another selection and on a redraw of the yard", () => {
    const { renderer, yard, inner } = setUp();
    const hall = pick(yard, 3);
    const show = () => {
      renderer.setSelected(hall);
      renderer.setUpgradePreview(hall, 5);
      expect(renderer.upgradePreviewId).toBe(3);
    };
    show();
    renderer.setUpgradePreview(null, null);
    expect(renderer.upgradePreviewId).toBeNull();
    expect(inner.buildings.fadedId).toBeNull();
    expect(inner.upgradePreview.root.visible).toBe(false);

    renderer.setUpgradePreview(hall, 5);
    renderer.setSelected(pick(yard, 2));
    expect(renderer.upgradePreviewId).toBeNull();
    expect(inner.buildings.fadedId).toBeNull();

    show();
    renderer.show(yard);
    expect(renderer.upgradePreviewId).toBeNull();
    expect(inner.buildings.fadedId).toBeNull();
    renderer.destroy();
  });

  it("drops a picture that loads after the preview has gone", async () => {
    const { renderer, yard, inner } = setUp();
    const goo = pick(yard, 1);
    renderer.setSelected(goo);
    renderer.setUpgradePreview(goo, 6);
    renderer.setSelected(null);
    release();
    await settle();
    expect(inner.upgradePreview.body.children).toHaveLength(0);
    expect(inner.upgradePreview.root.visible).toBe(false);
    renderer.destroy();
  });

  it("hides with the isometric yard in the blueprint view", () => {
    const { renderer, yard, inner } = setUp();
    const hall = pick(yard, 3);
    renderer.setSelected(hall);
    renderer.setUpgradePreview(hall, 5);
    // The blueprint's lettering needs a real canvas: it is not built here.
    (renderer as unknown as { blueprint: { setActive: () => void } }).blueprint.setActive =
      () => {};
    renderer.setView(YardView.BLUEPRINT);
    expect(inner.upgradePreviewLayer.visible).toBe(false);
    // The blueprint keeps the selection's own outline round the building.
    const blueprintCorners = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const;
    (renderer as unknown as { blueprint: { cornersOf: () => unknown } }).blueprint.cornersOf =
      () => blueprintCorners;
    const chrome = (
      renderer as unknown as {
        chrome: { clear: () => unknown; poly: (points: number[]) => unknown };
      }
    ).chrome;
    const drawn: number[][] = [];
    const poly = chrome.poly.bind(chrome);
    chrome.poly = (points: number[]) => {
      drawn.push(points);
      return poly(points);
    };
    (renderer as unknown as { drawChrome: () => void }).drawChrome();
    expect(drawn).toHaveLength(1);
    renderer.setView(YardView.ISO);
    expect(inner.upgradePreviewLayer.visible).toBe(true);
    expect(inner.upgradePreview.root.visible).toBe(true);
    renderer.destroy();
  });

  it("draws the building whole in the yard picture, and faded again after", () => {
    const { renderer, yard, inner } = setUp();
    let fadedDuring: number | null | undefined;
    (inner as unknown as { pixi: unknown }).pixi = {
      extract: {
        canvas: () => {
          fadedDuring = inner.buildings.fadedId;
          const canvas = document.createElement("canvas");
          canvas.width = 10;
          canvas.height = 10;
          return canvas;
        },
      },
    };
    const hall = pick(yard, 3);
    renderer.setSelected(hall);
    renderer.setUpgradePreview(hall, 5);
    renderer.snapshot();
    expect(fadedDuring).toBeNull();
    expect(inner.buildings.fadedId).toBe(3);
    renderer.destroy();
  });
});
