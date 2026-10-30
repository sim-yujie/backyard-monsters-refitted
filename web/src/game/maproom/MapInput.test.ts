// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "@/game/Camera";
import { mapRoomGrid } from "@/game/HexGrid";
import { MapInput } from "./MapInput";

/**
 * A tap that opens a cell's panel must not click the panel too, as on the
 * yard (`YardInput.test.ts`): the panel's Attack can open under the finger.
 * A tap that ends on the canvas itself keeps its click, so a double tap still
 * zooms.
 */

let input: MapInput | null = null;

afterEach(() => {
  input?.detach();
  input = null;
  Reflect.deleteProperty(document, "elementFromPoint");
  document.body.replaceChildren();
});

const mount = (world: { x: number; y: number }) => {
  const canvas = document.createElement("canvas");
  const panel = document.createElement("div");
  document.body.append(canvas, panel);
  const onSelect = vi.fn();
  input = new MapInput({
    camera: { screenToWorld: () => world } as unknown as Camera,
    canvas,
    onHover: () => {},
    onSelect,
    onZoomToCell: () => {},
    onZoomStep: () => {},
    onCancel: () => {},
  });
  input.attach();
  return { canvas, panel, onSelect };
};

const inside = mapRoomGrid.cellToPixel(10, 10);

const pointer = (type: string, pointerType: string, x = 10): Event => {
  const event = new MouseEvent(type, { clientX: x, clientY: 10, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
};

/** A tap, then its touch's end over `under`; whether that end was cancelled. */
const tap = (canvas: HTMLCanvasElement, pointerType: string, under: Element | null, travel = 0): boolean => {
  document.elementFromPoint = () => under;
  canvas.dispatchEvent(pointer("pointerdown", pointerType));
  canvas.dispatchEvent(pointer("pointerup", pointerType, 10 + travel));
  const end = new Event("touchend", { cancelable: true });
  Object.defineProperty(end, "changedTouches", { value: [{ clientX: 10 + travel, clientY: 10 }] });
  canvas.dispatchEvent(end);
  return end.defaultPrevented;
};

describe("a tap that opens a cell's panel", () => {
  it("drops a finger's click when the panel opened under it", () => {
    const { canvas, panel, onSelect } = mount(inside);
    expect(tap(canvas, "touch", panel)).toBe(true);
    expect(onSelect).toHaveBeenCalledWith({ col: 10, row: 10 });
  });

  it("drops a pen's too", () => {
    const { canvas, panel } = mount(inside);
    expect(tap(canvas, "pen", panel)).toBe(true);
  });

  it("keeps the click when the finger is still on the canvas, for the double tap", () => {
    const { canvas, onSelect } = mount(inside);
    expect(tap(canvas, "touch", canvas)).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("keeps a mouse's click", () => {
    const { canvas, panel, onSelect } = mount(inside);
    expect(tap(canvas, "mouse", panel)).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("drops only that tap's click", () => {
    const { canvas, panel } = mount(inside);
    expect(tap(canvas, "touch", panel)).toBe(true);
    const next = new Event("touchend", { cancelable: true });
    canvas.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);
  });
});

describe("a tap that opens nothing", () => {
  it("keeps its click off the world's edge and after a drag", () => {
    const off = mount({ x: -10_000, y: -10_000 });
    expect(tap(off.canvas, "touch", off.panel)).toBe(false);
    expect(off.onSelect).not.toHaveBeenCalled();
    input?.detach();

    const { canvas, panel, onSelect } = mount(inside);
    expect(tap(canvas, "touch", panel, 40)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
