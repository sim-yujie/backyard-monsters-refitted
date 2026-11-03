// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MissReason } from "@/game/yard/planner/layout";
import {
  applyPanel,
  describeLoadProblems,
  didNotFitPanel,
  type ApplyPanelOptions,
} from "./PlannerDialogs";

/**
 * The Apply dialog and the "did not fit" list.
 *
 * Apply only moves buildings: per-building upgrade planning was removed on
 * 2026-11-03 (owner: there should be no way to queue upgrades at once). A
 * load into a smaller yard still has to name *which* building stayed put and
 * why (issue #17).
 */

const mount = (over: Partial<ApplyPanelOptions> = {}): {
  element: HTMLElement;
  fired: ApplyPanelOptions;
} => {
  const container = document.createElement("div");
  document.body.append(container);
  const fired: ApplyPanelOptions = {
    moved: 42,
    slotName: null,
    dirty: false,
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { element: applyPanel(fired).mount(container).element, fired };
};

const text = (element: HTMLElement): string => element.textContent ?? "";

const applyButton = (element: HTMLElement): HTMLButtonElement =>
  [...element.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Apply",
  )!;

const saveCheck = (element: HTMLElement): HTMLLabelElement | null =>
  element.querySelector<HTMLLabelElement>(".planner-apply__check");

describe("the Apply dialog", () => {
  it("says how many buildings will move, and nothing about upgrades", () => {
    const { element } = mount({ moved: 3 });
    expect(element.querySelector(".planner-apply__heading")?.textContent).toBe("3 buildings will move.");
    expect(text(element)).not.toMatch(/upgrade/i);
    expect(element.querySelector(".planner-apply__list")).toBeNull();
    expect(element.querySelectorAll(".planner-apply__check")).toHaveLength(1);
  });

  it("reads singular for one building, and plainly for none", () => {
    expect(text(mount({ moved: 1 }).element)).toContain("1 building will move.");
    expect(text(mount({ moved: 0 }).element)).toContain("Nothing will move.");
  });

  it("offers to save first only when a dirty slot is loaded", () => {
    const loaded = mount({ slotName: "Turtle", dirty: true });
    const save = saveCheck(loaded.element);
    expect(save?.hidden).toBe(false);
    expect(save?.textContent).toContain("Turtle");
    expect(save?.querySelector("input")?.checked).toBe(true);

    expect(saveCheck(mount({ slotName: "Turtle", dirty: false }).element)?.hidden).toBe(true);
    expect(saveCheck(mount({ slotName: null, dirty: true }).element)?.hidden).toBe(true);
  });

  it("passes the save choice through on Confirm", () => {
    const loaded = mount({ slotName: "Turtle", dirty: true });
    applyButton(loaded.element).click();
    expect(loaded.fired.onConfirm).toHaveBeenCalledWith({ saveFirst: true });

    const unticked = mount({ slotName: "Turtle", dirty: true });
    saveCheck(unticked.element)!.querySelector("input")!.checked = false;
    applyButton(unticked.element).click();
    expect(unticked.fired.onConfirm).toHaveBeenCalledWith({ saveFirst: false });

    const clean = mount();
    applyButton(clean.element).click();
    expect(clean.fired.onConfirm).toHaveBeenCalledWith({ saveFirst: false });
  });
});

describe("the load banner", () => {
  const problems = (over: Partial<Parameters<typeof describeLoadProblems>[0]> = {}) =>
    describeLoadProblems({
      name: "Turtle",
      layoutExpansion: 4,
      yardExpansion: 2,
      didNotFit: 7,
      missing: 0,
      ...over,
    });

  it("names the layout's expansion and the player's own", () => {
    expect(problems()).toBe(
      "“Turtle” was designed for expansion 4 and you are at 2: 7 buildings did not fit and were left where they stood. Nothing was placed for you — move or remove them yourself.",
    );
  });

  it("drops the comparison when the plot is not the reason", () => {
    expect(problems({ layoutExpansion: 2 })).toContain("designed for expansion 2:");
    expect(problems({ layoutExpansion: 2 })).not.toContain("you are at");
  });

  it("counts missing buildings as well", () => {
    const message = problems({ didNotFit: 0, missing: 2 });
    expect(message).toContain("2 saved buildings no longer in this yard");
    expect(message).toContain("Nothing was placed for you");
  });

  it("says nothing when the load did everything the layout asked", () => {
    expect(problems({ didNotFit: 0 })).toBeNull();
  });

  it("reads singular for one of each", () => {
    const message = problems({ didNotFit: 1 });
    expect(message).toContain("1 building did not fit and was left where it stood");
  });
});

describe("what a load could not place", () => {
  it("names each building, its reason and both expansions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const onShow = vi.fn();

    const panel = didNotFitPanel({
      misses: [
        { id: 7, type: 20, reason: MissReason.BOUNDS },
        { id: 9, type: 17, reason: MissReason.BLOCKED },
      ],
      layoutExpansion: 4,
      yardExpansion: 2,
      onShow,
      onClose: vi.fn(),
    }).mount(container);

    const body = panel.element.textContent ?? "";
    expect(body).toContain("designed for expansion 4 and you are at 2");
    expect(body).toContain("Cannon Tower — outside your yard at its current size");
    expect(body).toContain("Block — blocked by a building the layout does not move");

    panel.element.querySelectorAll<HTMLButtonElement>(".planner-misfits__show")[1]?.click();
    expect(onShow).toHaveBeenCalledWith(9);
  });

  it("leaves the expansion clause out when the plot is not the reason", () => {
    const container = document.createElement("div");
    document.body.append(container);

    const panel = didNotFitPanel({
      misses: [{ id: 9, type: 17, reason: MissReason.BLOCKED }],
      layoutExpansion: 6,
      yardExpansion: 6,
      onShow: vi.fn(),
      onClose: vi.fn(),
    }).mount(container);

    expect(panel.element.textContent).not.toContain("designed for expansion");
    expect(panel.element.textContent).toContain("1 building stayed where it stood");
  });
});
