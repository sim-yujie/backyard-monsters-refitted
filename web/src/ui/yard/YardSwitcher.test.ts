// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse } from "@/api/types";
import { MAIN_YARD, outpostTarget, type OwnYardTarget } from "@/game/yard/ownYards";
import type { YardStore, YardUiBinding } from "@/game/yard/YardStore";
import { Notices } from "@/ui/maproom/Notices";
import { YardDock } from "./YardDock";
import { YardSwitcher } from "./YardSwitcher";

/**
 * The HUD's yard switcher (outposts WP5, #146): the open yard's title, the
 * outpost count, and a menu of the main yard and every outpost.
 */

const bindingFor = (
  outposts: BaseLoadResponse["outposts"],
  target: OwnYardTarget,
): YardUiBinding => {
  const store = {
    save: { outposts } as BaseLoadResponse,
    target,
    kind: target.kind,
    // What the rest of the HUD reads once bound.
    caps: null,
    workers: { total: 1, busy: 0 },
    jobs: () => [],
    now: () => 0,
    isRunning: () => false,
    subscribe: () => () => undefined,
  };
  return {
    store: store as unknown as YardStore,
    scene: { selectBuilding: () => undefined },
    notices: new Notices(),
  };
};

const TWO: BaseLoadResponse["outposts"] = [
  [242, 209, "2000242209"],
  [240, 210, "2000240210"],
];

describe("YardSwitcher", () => {
  let onSelect: ReturnType<typeof vi.fn<(target: OwnYardTarget) => void>>;
  let switcher: YardSwitcher;

  beforeEach(() => {
    document.body.replaceChildren();
    onSelect = vi.fn<(target: OwnYardTarget) => void>();
    switcher = new YardSwitcher({ onSelect });
    document.body.append(switcher.element);
  });

  afterEach(() => switcher.destroy());

  const button = (): HTMLButtonElement =>
    switcher.element.querySelector<HTMLButtonElement>(".yard-switcher__button")!;
  const items = (): HTMLButtonElement[] => [
    ...switcher.element.querySelectorAll<HTMLButtonElement>(".yard-switcher__item"),
  ];

  it("is hidden until an own yard is bound", () => {
    expect(switcher.element.hidden).toBe(true);
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    expect(switcher.element.hidden).toBe(false);
    switcher.bind(null);
    expect(switcher.element.hidden).toBe(true);
  });

  it("lists the main yard and each outpost, the open one marked", () => {
    switcher.bind(bindingFor(TWO, outpostTarget("2000242209", { col: 242, row: 209 })));
    expect(button().textContent).toBe("2Outpost (242, 209)");
    expect(button().getAttribute("aria-label")).toBe("Your yards: Outpost (242, 209), 2 outposts");
    expect(items().map((item) => item.textContent)).toEqual([
      "Main yard",
      "Outpost (242, 209)",
      "Outpost (240, 210)",
    ]);
    expect(items().map((item) => item.getAttribute("aria-current"))).toEqual([null, "true", null]);
  });

  it("lists only the main yard for a player with no outposts", () => {
    switcher.bind(bindingFor([], MAIN_YARD));
    // No badge for no outposts; the label is the yard's title.
    expect(button().querySelector<HTMLElement>(".yard-switcher__count")!.hidden).toBe(true);
    expect(button().querySelector(".yard-switcher__title")!.textContent).toBe("Main yard");
    expect(items().map((item) => item.textContent)).toEqual(["Main yard"]);
  });

  it("opens on a click, reports the yard picked, and ignores the open one", () => {
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    button().click();
    expect(switcher.open).toBe(true);
    items()[0]!.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(switcher.open).toBe(false);

    button().click();
    items()[2]!.click();
    expect(onSelect).toHaveBeenCalledWith({
      baseid: "2000240210",
      kind: "outpost",
      cell: { col: 240, row: 210 },
    });
  });

  it("closes on Escape and on a press elsewhere", () => {
    switcher.bind(bindingFor(TWO, MAIN_YARD));
    button().click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(switcher.open).toBe(false);
    button().click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(switcher.open).toBe(false);
  });
});

describe("the dock's switcher", () => {
  it("rides with the round buttons only when the scene can switch yards", () => {
    const plain = new YardDock({ onMap: () => {}, onLayout: () => {} });
    expect(plain.element.querySelector(".yard-switcher")).toBeNull();
    plain.destroy();

    const dock = new YardDock({ onMap: () => {}, onLayout: () => {}, onYardSelect: () => {} });
    const element = dock.element.querySelector<HTMLElement>(".yard-switcher")!;
    expect(element.hidden).toBe(true);
    dock.bind(bindingFor(TWO, MAIN_YARD));
    expect(element.hidden).toBe(false);
    dock.destroy();
  });
});
