// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayoutDiff, StatRow } from "@/game/yard/planner/compare";
import { ComparePanel, diffText, statText } from "./ComparePanel";

/** The compare card (#9): the figures, the better side marked, and the two ways out. */

const rows: StatRow[] = [
  { key: "land", label: "Land coverage", plan: 0.26, slot: 0.3, better: "slot" },
  { key: "levels", label: "Building levels", plan: 716, slot: 659, better: "plan" },
  { key: "cost", label: "Planned upgrades cost", plan: 0, slot: 1_500_000, better: "plan" },
  { key: "seconds", label: "Planned upgrades time", plan: 0, slot: 7_200, better: "plan" },
  { key: "unplaced", label: "Unplaced buildings", plan: 0, slot: 0, better: null },
];

const diff: LayoutDiff = { moved: new Set([1, 2]), onlyPlan: new Set([3]), onlySlot: new Set() };

const mount = () => {
  const onLoad = vi.fn();
  const onClose = vi.fn();
  const panel = new ComparePanel({ slotName: "Slot 3: West", rows, diff, onLoad, onClose }).mount(document.body);
  return { panel, element: panel.element, onLoad, onClose };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("ComparePanel", () => {
  it("prints each row, the better side in green with a ▲", () => {
    const { element } = mount();
    expect(element.querySelector(".panel__title")?.textContent).toBe("Compare with Slot 3: West");
    const land = element.querySelector('[data-row="land"]')!;
    const [plan, slot] = [...land.querySelectorAll("td")];
    expect(plan?.textContent).toBe("26%");
    expect(slot?.classList.contains("planner-compare__figure--better")).toBe(true);
    expect(slot?.textContent).toBe("▲ 30% (better)");
    expect(element.querySelectorAll('[data-row="unplaced"] .planner-compare__figure--better')).toHaveLength(0);
  });

  it("counts the differences", () => {
    const { element } = mount();
    expect(element.querySelector(".planner-compare__diff")?.textContent).toBe("2 moved · 1 only in your plan");
  });

  it("Load and Close hand back to the planner; Escape closes", () => {
    const { element, onLoad, onClose } = mount();
    element.querySelector<HTMLButtonElement>(".planner-compare__load")!.click();
    expect(onLoad).toHaveBeenCalledOnce();
    element.querySelector<HTMLButtonElement>(".planner-compare__close")!.click();
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("statText and diffText", () => {
  it("spells each kind of figure", () => {
    expect(statText("air", 0.999)).toBe("99%");
    expect(statText("cost", 0)).toBe("—");
    expect(statText("cost", 1_500_000)).toBe("1.5M");
    expect(statText("seconds", 7_200)).toBe("2h 0m");
    expect(statText("levels", 42)).toBe("42");
  });

  it("names only the sides that differ", () => {
    expect(diffText({ moved: new Set(), onlyPlan: new Set(), onlySlot: new Set([9]) })).toBe(
      "0 moved · 1 only in the layout",
    );
  });
});
