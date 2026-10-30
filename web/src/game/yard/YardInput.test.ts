// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Camera } from "@/game/Camera";
import { YardInput, type YardInputOptions } from "./YardInput";
import type { YardBuilding, YardMushroom } from "./yardModel";

/**
 * A tap that opens a building's panel must not click the panel too (30 Oct):
 * the Champion Cage's Freeze tile opened under the finger and the same tap
 * froze the champion. The browser's click after a touch comes only if its
 * `touchend` is not cancelled, so that is what these read.
 */

const CAGE = { id: 7 } as unknown as YardBuilding;
const MUSHROOM = { id: 3 } as unknown as YardMushroom;

let input: YardInput | null = null;

afterEach(() => {
  input?.detach();
  input = null;
  document.body.replaceChildren();
});

const mount = (
  pick: YardBuilding | null,
  extra: Partial<YardInputOptions> = {},
): { canvas: HTMLCanvasElement; onSelect: ReturnType<typeof vi.fn> } => {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const onSelect = vi.fn();
  input = new YardInput({
    camera: { screenToWorld: (point: { x: number; y: number }) => point } as unknown as Camera,
    canvas,
    pick: () => pick,
    onHover: () => {},
    onSelect,
    onZoomStep: () => {},
    onZoomReset: () => {},
    onCancel: () => {},
    ...extra,
  });
  input.attach();
  return { canvas, onSelect };
};

/** A pointer event jsdom can build: it has no PointerEvent, and the input reads only these. */
const pointer = (type: string, pointerType: string, x = 10, y = 10): Event => {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
};

/** A press and release where they are, then the touch's end; whether that end was cancelled. */
const tap = (canvas: HTMLCanvasElement, pointerType: string, travel = 0): boolean => {
  canvas.dispatchEvent(pointer("pointerdown", pointerType));
  canvas.dispatchEvent(pointer("pointerup", pointerType, 10 + travel));
  const end = new Event("touchend", { cancelable: true });
  canvas.dispatchEvent(end);
  return end.defaultPrevented;
};

describe("a tap that opens a building's panel", () => {
  it("drops a finger's click, so it cannot press what opens under it", () => {
    const { canvas, onSelect } = mount(CAGE);
    expect(tap(canvas, "touch")).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(CAGE);
  });

  it("drops a pen's too: the iPad's Pencil clicks late like a finger", () => {
    const { canvas } = mount(CAGE);
    expect(tap(canvas, "pen")).toBe(true);
  });

  it("drops only that tap's click: the next tap, on the panel, clicks as ever", () => {
    const { canvas } = mount(CAGE);
    const freeze = vi.fn();
    const button = document.createElement("button");
    button.addEventListener("click", freeze);
    document.body.append(button);
    expect(tap(canvas, "touch")).toBe(true);

    const second = new Event("touchend", { cancelable: true, bubbles: true });
    button.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    button.click();
    expect(freeze).toHaveBeenCalledTimes(1);

    // A touch that somehow ends on the canvas again is not cancelled either.
    const stray = new Event("touchend", { cancelable: true });
    canvas.dispatchEvent(stray);
    expect(stray.defaultPrevented).toBe(false);
  });

  it("keeps a mouse's click: it goes to the canvas it was pressed on", () => {
    const { canvas, onSelect } = mount(CAGE);
    expect(tap(canvas, "mouse")).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(CAGE);
  });

  it("opens a mushroom the same way", () => {
    const onMushroom = vi.fn();
    const { canvas } = mount(null, { pickMushroom: () => MUSHROOM, onMushroom });
    expect(tap(canvas, "touch")).toBe(true);
    expect(onMushroom).toHaveBeenCalledWith(MUSHROOM);
  });
});

describe("a tap that opens nothing", () => {
  it("keeps its click on bare ground, which only clears the selection", () => {
    const { canvas, onSelect } = mount(null);
    expect(tap(canvas, "touch")).toBe(false);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("keeps it after a drag", () => {
    const { canvas, onSelect } = mount(CAGE);
    expect(tap(canvas, "touch", 40)).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps it once detached", () => {
    const { canvas } = mount(CAGE);
    input?.detach();
    expect(tap(canvas, "touch")).toBe(false);
  });
});
