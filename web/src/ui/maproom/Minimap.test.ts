// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Minimap } from "./Minimap";

/**
 * The world map in Find works from the keyboard too (issue #153): focus puts
 * a marker on the viewport's centre, the arrow keys move it (Shift for bigger
 * steps), and Enter or Space jumps there.
 */

beforeAll(() => {
  // jsdom has no canvas: a context that draws nothing.
  const context = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as never);
});

const make = () => {
  const onJump = vi.fn();
  const minimap = new Minimap({ onJump }).mount(document.body);
  minimap.setViewport({ minCol: 230, maxCol: 250, minRow: 200, maxRow: 214 });
  return { minimap, onJump, element: minimap.element };
};

const press = (element: HTMLElement, key: string, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
};

describe("Minimap from the keyboard (#153)", () => {
  it("jumps to the viewport's centre on Enter when the marker has not moved", () => {
    const { element, onJump, minimap } = make();
    element.focus();
    press(element, "Enter");
    expect(onJump).toHaveBeenCalledWith({ col: 240, row: 207 });
    minimap.destroy();
  });

  it("moves the marker ten cells an arrow, fifty with Shift, and jumps there on Space", () => {
    const { element, onJump, minimap } = make();
    element.focus();
    press(element, "ArrowRight");
    press(element, "ArrowRight");
    press(element, "ArrowUp", true);
    const space = press(element, " ");
    expect(onJump).toHaveBeenCalledWith({ col: 260, row: 157 });
    // Space would otherwise scroll the Find panel.
    expect(space.defaultPrevented).toBe(true);
    expect(element.getAttribute("aria-label")).toContain("Marker at 260, 157.");
    minimap.destroy();
  });

  it("keeps the marker inside the world", () => {
    const { element, onJump, minimap } = make();
    element.focus();
    for (let step = 0; step < 10; step++) press(element, "ArrowLeft", true);
    press(element, "Enter");
    expect(onJump).toHaveBeenCalledWith({ col: 0, row: 207 });
    minimap.destroy();
  });

  it("starts again from the viewport when focus comes back", () => {
    const { element, onJump, minimap } = make();
    element.focus();
    press(element, "ArrowDown");
    element.blur();
    expect(element.getAttribute("aria-label")).not.toContain("Marker at");
    element.focus();
    press(element, "Enter");
    expect(onJump).toHaveBeenCalledWith({ col: 240, row: 207 });
    minimap.destroy();
  });

  it("leaves other keys alone", () => {
    const { element, onJump, minimap } = make();
    element.focus();
    const tab = press(element, "Tab");
    expect(tab.defaultPrevented).toBe(false);
    expect(onJump).not.toHaveBeenCalled();
    minimap.destroy();
  });
});

describe("sight, outposts and attackers (#331)", () => {
  it("draws the viewer's sight circles, outpost dots and attacker dots without throwing", () => {
    const { minimap } = make();
    expect(() => {
      minimap.setSight([
        { x: 240, y: 207, reach: 4, kind: "own" },
        { x: 300, y: 300, reach: 3, kind: "ally" },
      ]);
      minimap.setOutposts([{ col: 260, row: 220 }]);
      minimap.setAttackers([{ col: 400, row: 400 }]);
      minimap.draw();
    }).not.toThrow();
    minimap.destroy();
  });
});
