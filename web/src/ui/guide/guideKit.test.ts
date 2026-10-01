// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCanvasTargets, registerCanvasTarget } from "@/game/guide/targets";
import { BobBubble } from "./BobBubble";
import { autoSide, HAND_HEIGHT, HAND_WIDTH, handBox, placeArrow } from "./GuideArrow";
import { GuideOverlay, type FrameClock } from "./GuideOverlay";
import { HOLE_PADDING, panesAround } from "./Spotlight";

/** The Bob kit: bubble, hand, blocker, and the overlay that puts them together (issue #227). */

afterEach(() => {
  document.body.replaceChildren();
  clearCanvasTargets();
});

describe("placeArrow", () => {
  const rect = { left: 100, top: 300, width: 40, height: 20 };

  it("comes from above, pointing down, with the fingertip just off the top edge", () => {
    const place = placeArrow(rect);
    expect(place).toMatchObject({ side: "above", x: 120, rotate: 90, mirror: false });
    // The hand's centre is half its length plus the gap above the edge.
    expect(rect.top - place.y).toBe(HAND_WIDTH / 2 + 6);
  });

  it("flips to come from below when the target is near the top of the screen", () => {
    expect(autoSide({ ...rect, top: 40 })).toBe("below");
    expect(placeArrow({ ...rect, top: 40 })).toMatchObject({ side: "below", rotate: -90 });
  });

  it("the box the hand covers is tall when it points up or down, wide otherwise", () => {
    const above = placeArrow(rect, "above");
    expect(handBox(above)).toEqual({
      left: above.x - HAND_HEIGHT / 2,
      top: above.y - HAND_WIDTH / 2,
      width: HAND_HEIGHT,
      height: HAND_WIDTH,
    });
    // It ends just short of the target it points at.
    expect(handBox(above).top + HAND_WIDTH).toBe(rect.top - 6);
    expect(handBox(placeArrow(rect, "left")).width).toBe(HAND_WIDTH);
  });

  it("from the right it is mirrored, not turned upside down", () => {
    expect(placeArrow(rect, "right")).toMatchObject({ x: 140 + HAND_WIDTH / 2 + 6, y: 310, mirror: true });
    expect(placeArrow(rect, "left")).toMatchObject({ x: 100 - HAND_WIDTH / 2 - 6, rotate: 0, mirror: false });
  });
});

describe("panesAround", () => {
  it("covers everything but the padded hole", () => {
    const panes = panesAround({ left: 100, top: 100, width: 50, height: 20 }, 800, 600);
    const top = 100 - HOLE_PADDING;
    const bottom = 120 + HOLE_PADDING;
    expect(panes).toEqual([
      { left: 0, top: 0, width: 800, height: top },
      { left: 0, top: bottom, width: 800, height: 600 - bottom },
      { left: 0, top, width: 100 - HOLE_PADDING, height: bottom - top },
      { left: 150 + HOLE_PADDING, top, width: 800 - 150 - HOLE_PADDING, height: bottom - top },
    ]);
  });

  it("with no hole, one pane over the whole screen", () => {
    expect(panesAround(null, 800, 600)).toEqual([{ left: 0, top: 0, width: 800, height: 600 }]);
  });
});

describe("BobBubble", () => {
  it("says the line with the step's buttons, dots and Skip, and calls back", () => {
    const next = vi.fn();
    const skip = vi.fn();
    const bubble = new BobBubble().mount(document.body);

    bubble.show({
      text: "Tap Build.",
      mood: "worried",
      actions: [{ label: "Next", primary: true, onClick: next }],
      dots: { index: 1, count: 3 },
      skip: { label: "Skip", onClick: skip },
    });

    const element = bubble.element;
    expect(element.hidden).toBe(false);
    expect(element.querySelector(".guide-bob__text")?.textContent).toBe("Tap Build.");
    expect(element.querySelector<HTMLImageElement>(".guide-bob__portrait")?.src).toContain("guide/bob-worried.webp");
    expect(element.querySelectorAll(".guide-bob__dot")).toHaveLength(3);
    expect(element.querySelector(".guide-bob__dot--on")).toBe(element.querySelectorAll(".guide-bob__dot")[1]);
    element.querySelector<HTMLButtonElement>(".guide-bob__action")?.click();
    element.querySelector<HTMLButtonElement>(".guide-bob__skip")?.click();
    expect(next).toHaveBeenCalledOnce();
    expect(skip).toHaveBeenCalledOnce();
  });

  it("a tip shows Bob's head and no controls row when there is nothing to press", () => {
    const bubble = new BobBubble().mount(document.body);
    bubble.show({ text: "Collect all banks everything.", icon: true });
    expect(bubble.element.classList.contains("guide-bob--tip")).toBe(true);
    expect(bubble.element.querySelector<HTMLImageElement>(".guide-bob__portrait")?.src).toContain("guide/bob-icon.webp");
    expect(bubble.element.querySelector<HTMLElement>(".guide-bob__controls")?.hidden).toBe(true);
  });
});

/** A frame clock run by hand. */
const manualClock = (): FrameClock & { tick(): void; pending: number } => {
  let queued: (() => void) | null = null;
  return {
    request: (callback) => {
      queued = callback;
      return 1;
    },
    cancel: () => {
      queued = null;
    },
    tick() {
      const run = queued;
      queued = null;
      run?.();
    },
    get pending() {
      return queued ? 1 : 0;
    },
  };
};

describe("GuideOverlay", () => {
  it("follows its target each frame, blocks round it, and stops when hidden", () => {
    const clock = manualClock();
    const layer = document.createElement("div");
    document.body.append(layer);
    const overlay = new GuideOverlay(layer, clock);
    let rect: { left: number; top: number; width: number; height: number } | null = null;
    registerCanvasTarget("building:", () => rect);
    const found = vi.fn();

    overlay.show({ text: "Tap your Sniper Tower.", target: "building:7", onTargetFound: found });
    const arrow = layer.querySelector<HTMLElement>(".guide-arrow")!;
    const spotlight = layer.querySelector<HTMLElement>(".guide-spotlight")!;
    const ring = layer.querySelector<HTMLElement>(".guide-spotlight__ring")!;

    // Not on screen yet: no hand, everything blocked, no hole.
    expect(arrow.hidden).toBe(true);
    expect(spotlight.hidden).toBe(false);
    expect(ring.hidden).toBe(true);

    rect = { left: 300, top: 400, width: 60, height: 60 };
    clock.tick();
    expect(arrow.hidden).toBe(false);
    expect(ring.hidden).toBe(false);
    expect(found).toHaveBeenCalledOnce();
    clock.tick();
    expect(found).toHaveBeenCalledOnce();

    overlay.hide();
    expect(clock.pending).toBe(0);
    expect(spotlight.hidden).toBe(true);
    expect(layer.querySelector<HTMLElement>(".guide-bob")?.hidden).toBe(true);
  });

  /** Bob's bubble laid out as the stylesheet would: bottom left, or at the top when moved. */
  const layOutBubble = (layer: HTMLElement): HTMLElement => {
    const bubble = layer.querySelector<HTMLElement>(".guide-bob")!;
    vi.spyOn(bubble, "getBoundingClientRect").mockImplementation(() => {
      const top = bubble.classList.contains("guide-bob--alt") ? 200 : 600;
      return { left: 100, top, width: 400, height: 120, right: 500, bottom: top + 120, x: 100, y: top, toJSON: () => ({}) };
    });
    return bubble;
  };

  it("moves the bubble up off its target, starting under an open panel's title row", () => {
    const clock = manualClock();
    const layer = document.createElement("div");
    document.body.append(layer);
    const row = document.createElement("header");
    row.className = "panel__titlebar";
    vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 120, width: 800, height: 50, right: 800, bottom: 170, x: 0, y: 120, toJSON: () => ({}),
    });
    document.body.append(row);
    const overlay = new GuideOverlay(layer, clock);
    const bubble = layOutBubble(layer);
    registerCanvasTarget("collect-all", () => ({ left: 200, top: 640, width: 60, height: 60 }));

    overlay.show({ text: "Collect.", target: "collect-all", block: false });
    expect(bubble.classList.contains("guide-bob--alt")).toBe(true);
    expect(bubble.style.getPropertyValue("--guide-bob-clear-top")).toBe("178px");
    overlay.destroy();
  });

  it("keeps the bubble where it is when the top would cover the target too", () => {
    const layer = document.createElement("div");
    document.body.append(layer);
    const overlay = new GuideOverlay(layer, manualClock());
    const bubble = layOutBubble(layer);
    registerCanvasTarget("mail-threads", () => ({ left: 0, top: 150, width: 800, height: 700 }));

    overlay.show({ text: "Threads.", target: "mail-threads", block: false });
    expect(bubble.classList.contains("guide-bob--alt")).toBe(false);
    expect(bubble.style.getPropertyValue("--guide-bob-clear-top")).toBe("");
    overlay.destroy();
  });

  it("a step that does not block leaves the screen live", () => {
    const layer = document.createElement("div");
    const overlay = new GuideOverlay(layer, manualClock());
    overlay.show({ text: "Drag it onto the grass.", target: "carry-ghost", block: false });
    expect(layer.querySelector<HTMLElement>(".guide-spotlight")?.hidden).toBe(true);
    overlay.destroy();
    expect(layer.children).toHaveLength(0);
  });
});
