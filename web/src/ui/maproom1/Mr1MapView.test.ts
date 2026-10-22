// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { mapRoom1Fixture } from "@/game/maproom1/mr1Fixture";
import { readMapRoom1 } from "@/game/maproom1/mr1Model";
import { Mr1MapView } from "./Mr1MapView";

/** Where a pin's card goes against the legend (jsdom has no layout, so the sizes are set by hand). */

const NOW = 1_800_000_000;

const sized = <T extends HTMLElement>(element: T, box: { width?: number; height: number; top?: number }): T => {
  Object.defineProperty(element, "offsetWidth", { configurable: true, value: box.width ?? 0 });
  Object.defineProperty(element, "offsetHeight", { configurable: true, value: box.height });
  Object.defineProperty(element, "offsetTop", { configurable: true, value: box.top ?? 0 });
  return element;
};

/** A map whose window is 1268 x `height`, with the legend's top at `legendTop` (0 high: hidden, as on a phone). */
const mapView = (height: number, legendTop: number, legendHeight = 34) => {
  const view = new Mr1MapView({ onSelect: () => {} });
  document.body.append(view.element);
  const viewport = view.element.querySelector<HTMLElement>(".mr1-map__viewport")!;
  viewport.getBoundingClientRect = () => ({ width: 1268, height }) as DOMRect;
  sized(view.element.querySelector<HTMLElement>(".mr1-legend")!, { height: legendHeight, top: legendTop });
  const world = readMapRoom1(mapRoom1Fixture(NOW), NOW);
  view.setData(world, null, NOW);
  return { view, key: world.tribes[0]!.key };
};

const card = (height: number): HTMLElement => sized(document.createElement("article"), { width: 320, height });

afterEach(() => {
  document.body.replaceChildren();
});

describe("Mr1MapView's pin card and the legend", () => {
  it("keeps the card's bottom, with View and Attack, above the legend", () => {
    const { view, key } = mapView(508, 460);
    const open = card(420);
    view.setSelected(key, open);
    expect(parseFloat(open.style.top) + 420).toBeLessThanOrEqual(460 - 8);
    expect(view.element.classList.contains("mr1-map--legend-aside")).toBe(false);
  });

  it("in a window too short for both, the legend steps aside and the card scrolls", () => {
    const { view, key } = mapView(400, 352);
    const open = card(420);
    view.setSelected(key, open);
    expect(view.element.classList.contains("mr1-map--legend-aside")).toBe(true);
    // Taller than the window: it scrolls inside, so View and Attack are still a scroll away.
    expect(open.style.maxHeight).toBe("384px");
    view.setSelected(null, null);
    expect(view.element.classList.contains("mr1-map--legend-aside")).toBe(false);
  });

  it("with the legend hidden (a phone), only the window's edge counts", () => {
    const { view, key } = mapView(508, 0, 0);
    const open = card(420);
    view.setSelected(key, open);
    expect(parseFloat(open.style.top) + 420).toBeLessThanOrEqual(508 - 8);
    expect(view.element.classList.contains("mr1-map--legend-aside")).toBe(false);
  });
});
