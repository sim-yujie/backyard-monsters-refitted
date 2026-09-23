import { describe, expect, it } from "vitest";
import { Camera } from "./Camera";

/**
 * Covers the shared zoom floor introduced for `setMinZoom`: wheel, pinch and
 * keyboard zoom all end up going through `zoomBy`/`zoomAt`, so pinning the
 * floor there is what keeps every input path from pulling the view out past
 * whatever a scene has decided is "as far as this content fits".
 *
 * Camera only touches `requestAnimationFrame` inside `attach()` and the drag
 * frame loop it starts; none of these tests attach an element or start a
 * drag, so plain construction and direct method calls are safe under
 * vitest's `node` environment (see web/vitest.config.ts).
 */
describe("Camera.setMinZoom", () => {
  it("raises the floor and clamps the current zoom down to it", () => {
    const camera = new Camera({ minZoom: 0.05, maxZoom: 2, zoom: 0.5 });
    camera.resize(800, 600);
    camera.zoom = 0.1;

    camera.setMinZoom(0.3);

    expect(camera.minZoom).toBe(0.3);
    expect(camera.zoom).toBe(0.3);
  });

  it("leaves the zoom alone when it is already above the new floor", () => {
    const camera = new Camera({ minZoom: 0.05, maxZoom: 2, zoom: 0.5 });
    camera.resize(800, 600);

    camera.setMinZoom(0.3);

    expect(camera.minZoom).toBe(0.3);
    expect(camera.zoom).toBe(0.5);
  });

  it("is a no-op when the floor is unchanged", () => {
    const camera = new Camera({ minZoom: 0.05, maxZoom: 2, zoom: 0.5 });
    camera.resize(800, 600);
    camera.centreOn({ x: 100, y: 100 });
    const positionBefore = { ...camera.position };

    camera.setMinZoom(0.05);

    expect(camera.zoom).toBe(0.5);
    expect(camera.position).toEqual(positionBefore);
  });

  it("keeps zoomBy from going below the floor (wheel/pinch/keyboard all route through it)", () => {
    const camera = new Camera({ minZoom: 0.05, maxZoom: 2, zoom: 0.5 });
    camera.resize(800, 600);
    camera.setMinZoom(0.3);

    camera.zoomBy(0.01, { x: 400, y: 300 });

    expect(camera.zoom).toBe(0.3);
  });

  it("lets zoomBy go out further once the floor is lowered again", () => {
    const camera = new Camera({ minZoom: 0.05, maxZoom: 2, zoom: 0.5 });
    camera.resize(800, 600);
    camera.setMinZoom(0.3);
    camera.zoomBy(0.01, { x: 400, y: 300 });
    expect(camera.zoom).toBe(0.3);

    camera.setMinZoom(0.1);
    camera.zoomBy(0.5, { x: 400, y: 300 });

    expect(camera.zoom).toBeCloseTo(0.15);

    camera.zoomBy(0.01, { x: 400, y: 300 });
    expect(camera.zoom).toBe(0.1);
  });
});
