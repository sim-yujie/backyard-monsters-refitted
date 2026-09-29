// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { Camera } from "./Camera";

/**
 * The planner's compare (#9) shares one camera between two panes: a pointer
 * over the second pane is mapped into the first, so a wheel there zooms about
 * the same spot of the yard as one over the first pane would.
 */

const wheel = (element: HTMLElement, clientX: number, clientY: number): void => {
  element.dispatchEvent(new WheelEvent("wheel", { clientX, clientY, deltaY: -200, cancelable: true }));
};

const cameraOn = (): { camera: Camera; element: HTMLElement } => {
  const element = document.createElement("div");
  const camera = new Camera({ minZoom: 0.05, maxZoom: 4, zoom: 1 });
  camera.resize(400, 600);
  camera.centreOn({ x: 1_000, y: 1_000 });
  camera.attach(element);
  return { camera, element };
};

describe("Camera.setPointerMap", () => {
  it("zooms about the mapped point", () => {
    const plain = cameraOn();
    wheel(plain.element, 150, 300);

    const mapped = cameraOn();
    mapped.camera.setPointerMap((point) => ({ x: point.x - 400, y: point.y }));
    wheel(mapped.element, 550, 300);

    expect(mapped.camera.zoom).toBeCloseTo(plain.camera.zoom, 10);
    expect(mapped.camera.position.x).toBeCloseTo(plain.camera.position.x, 6);
    expect(mapped.camera.position.y).toBeCloseTo(plain.camera.position.y, 6);
    plain.camera.detach();
    mapped.camera.detach();
  });

  it("leaves the pointer alone once the map is cleared", () => {
    const plain = cameraOn();
    wheel(plain.element, 550, 300);

    const cleared = cameraOn();
    cleared.camera.setPointerMap((point) => ({ x: point.x - 400, y: point.y }));
    cleared.camera.setPointerMap(null);
    wheel(cleared.element, 550, 300);

    expect(cleared.camera.position.x).toBeCloseTo(plain.camera.position.x, 6);
    plain.camera.detach();
    cleared.camera.detach();
  });
});
