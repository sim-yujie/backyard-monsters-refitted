// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Assets, Texture, type Container } from "pixi.js";
import type { BaseLoadResponse } from "@/api/types";
import type { YardArtAtlas } from "./yardAtlas";
import { readYard, type Yard } from "./yardModel";
import { YardRenderer, YardView } from "./YardRenderer";
import { SNAPSHOT_SIZE, unionRect } from "./yardSnapshot";

/**
 * The yard picture (owner, 2026-11-11): drawn with every trap concealed and
 * nothing but the ground, the shadows and the buildings showing, framed on
 * the buildings that are not traps, and the screen put back afterwards.
 */

/** A Town Hall and a tower up at the top of the plot, two traps down at the bottom. */
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
      "4": { id: 4, t: 117, l: 1, X: 280, Y: 200 },
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

interface Seen {
  frame: { x: number; y: number; width: number; height: number };
  resolution: number;
  concealed: number[];
  visibleLayers: Container[];
}

/** A renderer showing the yard, with a stand-in graphics card that notes what it was asked to draw. */
const setUp = (): { renderer: YardRenderer; yard: Yard; seen: Seen[]; layers: Record<string, Container> } => {
  const renderer = new YardRenderer();
  const seen: Seen[] = [];
  const yard = readYard(yardResponse());
  const inner = renderer as unknown as {
    atlas: YardArtAtlas;
    pixi: unknown;
    ground: { root: Container };
    buildings: { shadows: Container; tops: Container };
  };
  inner.atlas = fakeAtlas();
  inner.pixi = {
    extract: {
      canvas: (options: { frame: Seen["frame"]; resolution: number }) => {
        seen.push({
          frame: { x: options.frame.x, y: options.frame.y, width: options.frame.width, height: options.frame.height },
          resolution: options.resolution,
          concealed: yard.buildings
            .map((b) => b.id)
            .filter((id) => renderer.isConcealed(id))
            .sort((a, b) => a - b),
          visibleLayers: renderer.root.children.filter((child) => child.visible),
        });
        const canvas = document.createElement("canvas");
        canvas.width = SNAPSHOT_SIZE.width;
        canvas.height = SNAPSHOT_SIZE.height;
        return canvas;
      },
    },
  };
  renderer.show(yard);
  const layers = {
    ground: inner.ground.root,
    shadows: inner.buildings.shadows,
    tops: inner.buildings.tops,
  };
  return { renderer, yard, seen, layers };
};

describe("YardRenderer.snapshot", () => {
  beforeEach(() => {
    // No picture ever arrives: every building stays its placeholder, the size of its footprint.
    vi.spyOn(Assets, "load").mockImplementation((() => new Promise(() => {})) as typeof Assets.load);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws with both traps concealed and only the ground, shadows and buildings showing", () => {
    const { renderer, seen, layers } = setUp();
    expect(renderer.snapshot()).toBeInstanceOf(HTMLCanvasElement);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.concealed).toEqual([3, 4]);
    expect(new Set(seen[0]!.visibleLayers)).toEqual(new Set([layers.ground, layers.shadows, layers.tops]));
  });

  it("frames the buildings that are not traps, centred, at the picture's shape", () => {
    const { renderer, yard, seen } = setUp();
    renderer.snapshot();
    const { frame, resolution } = seen[0]!;
    const shown = unionRect(yard.buildings.filter((b) => b.id <= 2).map((b) => b.box))!;
    expect(frame.x + frame.width / 2).toBeCloseTo(shown.x + shown.width / 2);
    expect(frame.y + frame.height / 2).toBeCloseTo(shown.y + shown.height / 2);
    expect(frame.width * resolution).toBeCloseTo(SNAPSHOT_SIZE.width);
    expect(frame.height * resolution).toBeCloseTo(SNAPSHOT_SIZE.height);
    // The far traps pulled nothing towards themselves: they are out of the picture.
    const trap = yard.buildings.find((b) => b.id === 3)!.box;
    expect(frame.y + frame.height).toBeLessThan(trap.y);
  });

  it("puts the screen back: traps shown, layers as they were, culling to the screen", () => {
    const { renderer, seen } = setUp();
    const before = renderer.root.children.map((child) => child.visible);
    renderer.draw({ x: 0, y: 0, width: 10, height: 10 });
    renderer.snapshot();
    expect(seen).toHaveLength(1);
    expect(renderer.isConcealed(3)).toBe(false);
    expect(renderer.isConcealed(4)).toBe(false);
    expect(renderer.root.children.map((child) => child.visible)).toEqual(before);
    expect(renderer.root.isRenderGroup).toBe(false);
  });

  it("keeps a trap concealed that was concealed before", () => {
    const { renderer, seen } = setUp();
    renderer.setConcealed(3, true);
    renderer.snapshot();
    expect(seen[0]!.concealed).toEqual([3, 4]);
    expect(renderer.isConcealed(3)).toBe(true);
    expect(renderer.isConcealed(4)).toBe(false);
  });

  it("draws the isometric yard from the blueprint too, and leaves the blueprint showing", () => {
    const { renderer, seen, layers } = setUp();
    // As `setView` leaves it, without building the blueprint's lettering, which needs a real canvas.
    (renderer as unknown as { currentView: YardView }).currentView = YardView.BLUEPRINT;
    for (const layer of Object.values(layers)) layer.visible = false;
    const before = renderer.root.children.map((child) => child.visible);
    renderer.snapshot();
    expect(new Set(seen[0]!.visibleLayers)).toEqual(new Set([layers.ground, layers.shadows, layers.tops]));
    expect(renderer.root.children.map((child) => child.visible)).toEqual(before);
    expect(renderer.view).toBe(YardView.BLUEPRINT);
  });

  it("is null before a yard is shown, or when the card gives nothing", () => {
    expect(new YardRenderer().snapshot()).toBeNull();
    const { renderer } = setUp();
    (renderer as unknown as { pixi: unknown }).pixi = {
      extract: {
        canvas: () => {
          throw new Error("context lost");
        },
      },
    };
    expect(renderer.snapshot()).toBeNull();
    expect(renderer.isConcealed(3)).toBe(false);
  });
});
