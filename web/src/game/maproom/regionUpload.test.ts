import { describe, expect, it, vi } from "vitest";
import type { BufferImageSource } from "pixi.js";
import { DirtyRect, flushRegion, setRegionRenderer } from "./regionUpload";

describe("DirtyRect", () => {
  it("holds the union of the boxes noted, clamped to the texture, until taken", () => {
    const rect = new DirtyRect(100, 50);
    expect(rect.empty).toBe(true);
    rect.add(10, 10, 12, 12);
    rect.add(-5, 20, 3, 60);
    expect(rect.empty).toBe(false);
    expect(rect.take()).toEqual({ x0: 0, y0: 10, x1: 12, y1: 49 });
    expect(rect.empty).toBe(true);
  });

  it("asks for the whole texture after addAll", () => {
    const rect = new DirtyRect(100, 50);
    rect.add(1, 1, 2, 2);
    rect.addAll();
    expect(rect.empty).toBe(false);
    expect(rect.take()).toBeNull();
    expect(rect.empty).toBe(true);
  });
});

describe("flushRegion", () => {
  it("uploads the whole texture when there is no WebGL2 renderer to send a part through", () => {
    setRegionRenderer(null);
    const update = vi.fn();
    const source = { update, width: 800, height: 800 } as unknown as BufferImageSource;
    flushRegion(source, { x0: 1, y0: 1, x1: 3, y1: 3 });
    flushRegion(source, null);
    expect(update).toHaveBeenCalledTimes(2);
  });
});
