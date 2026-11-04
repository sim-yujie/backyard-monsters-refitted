// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { MapRenderer } from "./MapRenderer";
import type { Sight } from "./Sight";
import type { ZoneStore } from "./ZoneStore";

/**
 * The upright marker layer (MR2 look plan step 4): with the tilt on, the
 * chunks' marker layers leave the map's root (so they are not warped) for
 * `markers`, which never takes the pointer; with it off they go back exactly
 * where the flat map has always had them.
 */
describe("MapRenderer marker layer", () => {
  beforeAll(() => {
    // jsdom has no canvas; the far-zoom raster only needs somewhere to write its pixels.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () =>
        ({
          createImageData: (width: number, height: number) => ({
            width,
            height,
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => undefined,
        }) as unknown as ReturnType<HTMLCanvasElement["getContext"]>,
    );
  });

  const renderer = (): MapRenderer => new MapRenderer({} as ZoneStore, {} as Sight);
  const order = (r: MapRenderer): string[] =>
    r.root.children.map((child) => `${child.constructor.name}:${child.children.length}`);

  it("moves the markers over the tilted picture and back into the flat map's order", () => {
    const r = renderer();
    const flat = order(r);
    const flatChildren = [...r.root.children];
    expect(r.markers.children).toHaveLength(0);

    r.setMarkerProjector(() => ({ x: 0, y: 0, scale: 1 }), "a");
    expect(r.markers.children).toHaveLength(2);
    expect(r.root.children).toHaveLength(flatChildren.length - 2);
    for (const moved of r.markers.children) expect(r.root.children).not.toContain(moved);

    r.setMarkerProjector(null, "");
    expect(r.markers.children).toHaveLength(0);
    expect(r.root.children).toEqual(flatChildren);
    expect(order(r)).toEqual(flat);
    r.destroy();
  });

  it("does nothing while the map stays flat", () => {
    const r = renderer();
    const before = [...r.root.children];
    r.setMarkerProjector(null, "");
    expect(r.root.children).toEqual(before);
    r.destroy();
  });

  it("never takes the pointer, so presses go through to the cell under them", () => {
    const r = renderer();
    expect(r.markers.eventMode).toBe("none");
    expect(r.markers.interactiveChildren).toBe(false);
    r.destroy();
  });
});
