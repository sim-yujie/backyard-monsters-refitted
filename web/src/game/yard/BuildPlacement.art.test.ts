import { Assets, Container, Texture } from "pixi.js";
import type * as Pixi from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import type { Camera } from "@/game/Camera";
import { BuildPlacement } from "./BuildPlacement";
import { ArtState, resolveArt } from "./buildingArt";
import { readYard, type Yard } from "./yardModel";

// A real filter compiles a shader program, which wants a GPU context.
vi.mock("pixi.js", async (importOriginal) => ({
  ...(await importOriginal<typeof Pixi>()),
  AlphaFilter: class {
    constructor(readonly options: { alpha: number }) {}
    destroy(): void {}
  },
}));

/**
 * The ghost of a building being placed is the whole building (#256): its top
 * and the first cell of every animation strip, not the top alone, which left
 * a Sniper Tower without its rifle.
 */

const yard: Yard = readYard({
  error: 0,
  currenttime: 1,
  savetime: 1,
  buildingdata: { "1": { id: 1, t: 14, X: -65, Y: -65, l: 3 } },
  storedata: {},
} as unknown as BaseLoadResponse);

const SNIPER = 21;

const open: BuildPlacement[] = [];
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.spyOn(Assets, "load").mockImplementation(
    (async () => Texture.WHITE) as typeof Assets.load,
  );
});
afterEach(() => {
  while (open.length > 0) open.pop()?.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const carry = (type: number): { placement: BuildPlacement; layer: Container } => {
  const layer = new Container();
  const placement = new BuildPlacement({
    type,
    yard,
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas: new EventTarget() as HTMLCanvasElement,
    layer,
    worldToYard: (x, y) => ({ x, y }),
    onDrop: async () => "placed",
    onCancel: () => {},
    repeat: false,
  });
  open.push(placement);
  return { placement, layer };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe("BuildPlacement ghost art", () => {
  it("draws the Sniper Tower's rifle strip as well as its base", async () => {
    const { placement } = carry(SNIPER);
    await settle();
    const art = resolveArt(SNIPER, 1, ArtState.DEFAULT);
    const urls = placement.artShown.map((layer) => layer.url);
    expect(urls).toEqual([art?.top.url, art?.anims[0]?.url]);
    expect(vi.mocked(Assets.load).mock.calls.map(([url]) => url)).toEqual(urls);
  });

  it("fades the pictures together, not one by one", async () => {
    const { layer } = carry(SNIPER);
    await settle();
    const pictures = (layer.children[0] as Container).children.at(-1) as Container;
    expect(pictures.alpha).toBe(1);
    expect(pictures.filters).toHaveLength(1);
  });

  it("puts each picture at its own offset, the strip cut to its first cell", async () => {
    const { placement, layer } = carry(SNIPER);
    await settle();
    placement.moveTo(300, -300);
    const ghost = layer.children[0] as Container;
    const pictures = ghost.children.at(-1) as Container;
    expect(pictures.children).toHaveLength(2);
    const [base, rifle] = pictures.children;
    expect([base?.x, base?.y]).toEqual([-40, -30]);
    expect([rifle?.x, rifle?.y]).toEqual([-27, -50]);
    expect([rifle?.width, rifle?.height]).toEqual([55, 47]);
  });
});
