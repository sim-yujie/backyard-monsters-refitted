// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { MissReason } from "@/game/yard/planner/layout";
import type { ApplyPreview } from "@/game/yard/planner/upgrades";
import {
  applyPanel,
  describeLoadProblems,
  didNotFitPanel,
  type ApplyPanelOptions,
} from "./PlannerDialogs";

/**
 * The Apply dialog and the "did not fit" list.
 *
 * Both exist to say something a count cannot: Apply's upgrade walk is partial
 * by design (`docs/design/planner-upgrades.md` §3.2), so the dialog has to
 * name *which* job waits, and a load into a smaller yard has to name *which*
 * building stayed put and why (issue #17).
 */

const preview = (over: Partial<ApplyPreview> = {}): ApplyPreview => ({
  started: [],
  finished: [],
  waiting: [],
  skipped: [],
  cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
  points: 0,
  workers: { total: 5, busyBefore: 0, busyAfter: 0 },
  remaining: { r1: 0, r2: 0, r3: 0, r4: 0 },
  ...over,
});

const BUSY_PREVIEW = preview({
  started: [
    { id: 1, t: 20, from: 1, to: 2, seconds: 900, cost: { r1: 10_000, r2: 7_500, r3: 2_500, r4: 0 } },
  ],
  finished: [{ id: 2, t: 17, from: 1, to: 2, cost: { r1: 0, r2: 10_000, r3: 0, r4: 0 } }],
  waiting: [{ id: 3, t: 20, from: 1, to: 2, reason: "workers" }],
  skipped: [
    { id: 4, t: 20, reason: "townHall", from: 7, to: 8, townHall: { have: 6, need: 8 } },
  ],
  cost: { r1: 10_000, r2: 17_500, r3: 2_500, r4: 0 },
  workers: { total: 5, busyBefore: 4, busyAfter: 5 },
  remaining: { r1: 90_000, r2: 0, r3: 7_500, r4: 0 },
});

const mount = (over: Partial<ApplyPanelOptions> = {}): {
  element: HTMLElement;
  fired: ApplyPanelOptions;
} => {
  const container = document.createElement("div");
  document.body.append(container);
  const fired: ApplyPanelOptions = {
    moved: 42,
    preview: BUSY_PREVIEW,
    slotName: null,
    dirty: false,
    onSaveAs: vi.fn(),
    onConfirm: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { element: applyPanel(fired).mount(container).element, fired };
};

const text = (element: HTMLElement): string => element.textContent ?? "";

const rows = (element: HTMLElement): string[] =>
  [...element.querySelectorAll(".planner-apply__list li")].map((row) => row.textContent ?? "");

const checks = (element: HTMLElement): HTMLInputElement[] => [
  ...element.querySelectorAll<HTMLInputElement>(".planner-apply__check input"),
];

const applyButton = (element: HTMLElement): HTMLButtonElement => {
  const button = element.querySelector<HTMLButtonElement>(".btn--primary");
  if (!button) throw new Error("no Apply button");
  return button;
};

describe("the Apply dialog", () => {
  it("itemises what starts, finishes, waits and cannot start", () => {
    const { element } = mount();

    expect(text(element)).toContain("42 buildings will move");
    const listed = rows(element);
    expect(listed[0]).toContain("Cannon Tower L1 → L2");
    expect(listed[0]).toContain("15m 0s");
    expect(listed[1]).toContain("Block L1 → L2");
    expect(listed[2]).toContain("Cannon Tower L1 → L2");
    expect(listed[3]).toContain("needs Town Hall 8");

    expect(text(element)).toContain("1 upgrade starts now");
    expect(text(element)).toContain("1 waits for a free worker");
    expect(text(element)).toContain("1 cannot start");
  });

  it("totals what is deducted and what is left", () => {
    const { element } = mount();
    const totals = element.querySelector(".planner-apply__totals")?.textContent ?? "";
    expect(totals).toContain("Total deducted now");
    expect(totals).toContain("10.0K twigs");
    expect(totals).toContain("17.5K pebbles");
    expect(totals).toContain("You will have left");
    expect(totals).toContain("90.0K twigs");
  });

  it("starts the upgrades by default, and drops the itemisation when told not to", () => {
    const { element, fired } = mount();
    const start = checks(element)[0];
    expect(start?.checked).toBe(true);

    start!.checked = false;
    start!.dispatchEvent(new Event("change"));
    expect(element.querySelector(".planner-apply__list")).toBeNull();

    applyButton(element).click();
    expect(fired.onConfirm).toHaveBeenCalledWith({ startUpgrades: false, saveFirst: false });
  });

  it("passes both choices through on Confirm", () => {
    const { element, fired } = mount({ slotName: "Turtle", dirty: true });
    applyButton(element).click();
    expect(fired.onConfirm).toHaveBeenCalledWith({ startUpgrades: true, saveFirst: true });
  });

  it("offers to save first only when a dirty slot is loaded", () => {
    const loaded = mount({ slotName: "Turtle", dirty: true });
    const save = loaded.element.querySelectorAll<HTMLLabelElement>(".planner-apply__check")[1];
    expect(save?.hidden).toBe(false);
    expect(save?.textContent).toContain("Turtle");
    expect(checks(loaded.element)[1]?.checked).toBe(true);

    const clean = mount({ slotName: "Turtle", dirty: false });
    expect(
      clean.element.querySelectorAll<HTMLLabelElement>(".planner-apply__check")[1]?.hidden,
    ).toBe(true);
    expect(text(clean.element)).toContain("already matches this plan");
  });

  it("says where waiting upgrades live when no slot is loaded", () => {
    const { element, fired } = mount();
    expect(text(element)).toContain("only in a saved layout");

    const saveAs = element.querySelector<HTMLButtonElement>(".planner-apply__save-as");
    expect(saveAs?.hidden).toBe(false);
    saveAs?.click();
    expect(fired.onSaveAs).toHaveBeenCalled();
  });

  it("is one line for a plan with no upgrades in it", () => {
    const { element } = mount({ preview: preview(), moved: 3 });

    expect(text(element)).toContain("3 buildings will move");
    expect(element.querySelector(".planner-apply__list")).toBeNull();
    expect(element.querySelectorAll<HTMLLabelElement>(".planner-apply__check")[0]?.hidden).toBe(
      true,
    );
    expect(element.querySelector<HTMLButtonElement>(".planner-apply__save-as")?.hidden).toBe(true);
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
      plansDropped: 0,
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

  it("counts missing buildings and dropped plans as well", () => {
    const message = problems({ didNotFit: 0, missing: 2, plansDropped: 1 });
    expect(message).toContain("2 saved buildings no longer in this yard");
    expect(message).toContain("1 planned upgrade was dropped");
  });

  it("leaves out the move-them-yourself tail when nothing stayed put", () => {
    const message = problems({ didNotFit: 0, missing: 0, plansDropped: 5 });
    expect(message).toContain("5 planned upgrades were dropped");
    expect(message).not.toContain("Nothing was placed for you");
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
