import { afterEach, describe, expect, it, vi } from "vitest";
import { CanvasSource, TextureSource } from "pixi.js";
import { setDeviceTextureLimit } from "@/game/quality";
import { cellTexture, gpuTextureLimit, overLimit } from "./textureLimit";

/**
 * A picture wider or taller than the graphics card holds is refused by WebGL
 * and drawn as a black box, so its cells are copied out through a canvas.
 */

/** A 6144 x 110 strip at 2x, like the Railgun's 3D turret strip. */
const railgunStrip = (): TextureSource =>
  new TextureSource({ width: 3072, height: 55, resolution: 2, resource: { picture: true } as never });

interface FakeCanvas {
  width: number;
  height: number;
  drawn: unknown[][];
  getContext: () => { drawImage: (...args: unknown[]) => void };
}

/** A `document` whose canvases record what is drawn on them. */
const fakeDocument = (): FakeCanvas[] => {
  const made: FakeCanvas[] = [];
  vi.stubGlobal("document", {
    createElement: () => {
      const canvas: FakeCanvas = {
        width: 0,
        height: 0,
        drawn: [],
        getContext: () => ({ drawImage: (...args: unknown[]) => canvas.drawn.push(args) }),
      };
      made.push(canvas);
      return canvas;
    },
  });
  return made;
};

afterEach(() => {
  vi.unstubAllGlobals();
  setDeviceTextureLimit(null);
});

describe("textureLimit", () => {
  it("says a picture is over the limit by its real pixels, and never while the limit is unknown", () => {
    const strip = railgunStrip();
    expect(strip.pixelWidth).toBe(6144);
    expect(overLimit(strip, 4096)).toBe(true);
    expect(overLimit(strip, 8192)).toBe(false);
    expect(overLimit(strip, null)).toBe(false);
    setDeviceTextureLimit(4096);
    expect(overLimit(strip)).toBe(true);
  });

  it("frames a cell over the shared picture when the card holds it", () => {
    const strip = railgunStrip();
    const made = cellTexture(strip, { x: 64, y: 0, width: 64, height: 51 }, 8192);
    expect(made.owned).toBe(false);
    expect(made.texture.source).toBe(strip);
    expect(made.texture.frame.x).toBe(64);
  });

  it("copies a cell out of a picture the card cannot hold, at the picture's resolution", () => {
    const canvases = fakeDocument();
    const strip = railgunStrip();
    const made = cellTexture(strip, { x: 64, y: 0, width: 64, height: 51 }, 4096);
    expect(made.owned).toBe(true);
    expect(made.texture.source).not.toBe(strip);
    expect(made.texture.source).toBeInstanceOf(CanvasSource);
    expect(made.texture.source.resolution).toBe(2);
    expect(canvases).toHaveLength(1);
    expect(canvases[0]!.width).toBe(128);
    expect(canvases[0]!.height).toBe(102);
    expect(canvases[0]!.drawn[0]!.slice(1)).toEqual([128, 0, 128, 102, 0, 0, 128, 102]);
    made.texture.destroy(true);
  });

  it("falls back to framing where no canvas can be had", () => {
    const strip = railgunStrip();
    const made = cellTexture(strip, { x: 0, y: 0, width: 64, height: 51 }, 4096);
    expect(made.owned).toBe(false);
    expect(made.texture.source).toBe(strip);
  });

  it("reads the renderer's limit and remembers it for the whole game", () => {
    const renderer = { gl: { MAX_TEXTURE_SIZE: 0x0d33, getParameter: () => 4096 } } as never;
    expect(gpuTextureLimit(renderer)).toBe(4096);
    expect(overLimit(railgunStrip())).toBe(true);
    expect(gpuTextureLimit({} as never)).toBeNull();
  });
});
