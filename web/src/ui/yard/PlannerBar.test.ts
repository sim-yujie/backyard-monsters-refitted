// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
import type { ApplyPreview, PlanTotals } from "@/game/yard/planner/upgrades";
import { YardView } from "@/game/yard/YardRenderer";
import { PlannerBar, type PlannerBarActions } from "./PlannerBar";

/**
 * The planner's bars, and above all what a read-only session leaves out
 * (design §8, Q5).
 *
 * The read-only path has no way into it from the running client yet — every
 * load the yard scene makes is its own base in build mode — so this is the
 * only place the bar's read-only shape is exercised at all.
 */

const noop = (): void => {};

const actions = (): PlannerBarActions => ({
  onTool: noop,
  onView: noop,
  onGroupTool: vi.fn(),
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onFind: noop,
  onLayouts: vi.fn(),
  onChecklist: vi.fn(),
  onUpgradeWalls: vi.fn(),
  onRearmTraps: vi.fn(),
  onApply: vi.fn(),
  onPutBack: vi.fn(),
  onHelp: noop,
  onExit: noop,
});

const stateOf = (overrides: Partial<PlannerState> = {}): PlannerState => ({
  tool: PlannerTool.SELECT,
  selectionCount: 0,
  movedCount: 0,
  plannedCount: 0,
  dirty: false,
  canUndo: false,
  canRedo: false,
  undoLabel: null,
  redoLabel: null,
  slot: null,
  slotName: "",
  dragInvalid: false,
  carrying: false,
  view: YardView.BLUEPRINT,
  previewing: false,
  readOnly: false,
  ...overrides,
});

/** Every button label on the mounted bars, in order. */
const labels = (bar: PlannerBar): string[] =>
  [...bar.toolbar.querySelectorAll("button"), ...bar.actionBar.querySelectorAll("button")].map(
    (button) => button.textContent?.trim() ?? "",
  );

const mount = (options: { readOnly?: boolean } = {}): PlannerBar => mountWith(options).bar;

/** The same, keeping hold of the action callbacks so a click can be observed. */
const mountWith = (
  options: { readOnly?: boolean } = {},
): { bar: PlannerBar; fired: PlannerBarActions } => {
  const container = document.createElement("div");
  document.body.append(container);
  const fired = actions();
  return { bar: new PlannerBar(fired, options).mount(container), fired };
};

/** The two mirror buttons, which are the only ones labelled with an arrow. */
const mirrorButtons = (bar: PlannerBar): HTMLButtonElement[] =>
  [...bar.toolbar.querySelectorAll("button")].filter((button) =>
    button.textContent?.startsWith("Mirror"),
  );

/** The Align and Distribute triggers, in that order. */
const menuTriggers = (bar: PlannerBar): HTMLButtonElement[] => [
  ...bar.toolbar.querySelectorAll<HTMLButtonElement>(".planner-menu__trigger"),
];

const menuItems = (bar: PlannerBar, index: number): HTMLButtonElement[] => {
  const list = bar.toolbar.querySelectorAll(".planner-menu__list")[index];
  return list ? [...list.querySelectorAll<HTMLButtonElement>("button")] : [];
};

/** Every cost cell the player can actually see. */
const visibleCells = (bar: PlannerBar): HTMLElement[] =>
  [...bar.actionBar.querySelectorAll<HTMLElement>(".planner-cost__cell")].filter(
    (cell) => !cell.hidden,
  );

const cell = (bar: PlannerBar, modifier: string): HTMLElement | null =>
  bar.actionBar.querySelector<HTMLElement>(`.planner-cost__cell--${modifier}`);

/** The four resource cells' readouts, in twigs-pebbles-putty-goo order. */
const resourceValues = (bar: PlannerBar): string[] =>
  [...bar.actionBar.querySelectorAll<HTMLElement>(".planner-cost__cell")]
    .slice(0, 4)
    .map((element) => element.querySelector(".planner-cost__value")?.textContent ?? "");

/** A plan's totals, in the shape `planTotals` returns. */
const totalsOf = (over: Partial<PlanTotals> = {}): PlanTotals => ({
  needed: { r1: 20_000, r2: 15_000, r3: 5_000, r4: 0 },
  held: { r1: 50_000, r2: 1_000, r3: 5_000, r4: 0 },
  shortfall: { r1: 0, r2: 14_000, r3: 0, r4: 0 },
  seconds: 1_800,
  longest: 900,
  shiny: 42,
  byType: [
    {
      type: 20,
      name: "Cannon Tower",
      count: 2,
      needed: { r1: 20_000, r2: 15_000, r3: 5_000, r4: 0 },
    },
  ],
  steps: 2,
  planned: 2,
  ...over,
});

/** An Apply preview with nothing in it, for the cases that only need counts. */
const previewOf = (over: Partial<ApplyPreview> = {}): ApplyPreview => ({
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

describe("the editing bar", () => {
  it("carries the actions that write to the yard", () => {
    const bar = mount();
    bar.update(stateOf());
    expect(labels(bar)).toContain("Apply");
    expect(labels(bar)).toContain("Layouts");
    expect(labels(bar)).toContain("Undo");
  });

  it("names the loaded slot and marks it unsaved", () => {
    const bar = mount();
    bar.update(stateOf({ slotName: "Turtle", dirty: true }));
    expect(bar.toolbar.querySelector(".planner-bar__slot")?.textContent).toBe("Turtle · unsaved");
  });
});

describe("the plan cells", () => {
  it("reads needed against held, and marks a resource the plan is short of", () => {
    const bar = mount();
    bar.setPlanSummary(totalsOf(), 5);

    expect(resourceValues(bar)).toEqual(["20.0K / 50.0K", "15.0K / 1.0K", "5.0K / 5.0K", "0 / 0"]);

    const short = bar.actionBar.querySelectorAll(".planner-cost__cell--short");
    expect(short).toHaveLength(1);
    // Colour is never the only channel: the word is in the tooltip too.
    expect((short[0] as HTMLElement).title).toContain("14,000 short");
  });

  it("shows worker seconds, with the wall-clock lower bound in the tooltip", () => {
    const bar = mount();
    bar.setPlanSummary(totalsOf(), 2);

    const time = cell(bar, "time");
    expect(time?.querySelector(".planner-cost__value")?.textContent).toBe("30m 0s");
    // max(longest 900, ceil(1800 / 2)) is 900 seconds either way.
    expect(time?.title).toContain("At least 15m 0s");
    expect(time?.title).toContain("2 free workers");
    expect(time?.title).toContain("lower bound");
  });

  it("counts the free workers and says what Apply would do with them", () => {
    const bar = mount();
    bar.setWorkers(
      { total: 5, busy: 1 },
      previewOf({
        started: [{ id: 1, t: 20, from: 1, to: 2, seconds: 900, cost: { r1: 0, r2: 0, r3: 0, r4: 0 } }],
        waiting: [{ id: 2, t: 20, from: 1, to: 2, reason: "workers" }],
      }),
    );

    const workers = cell(bar, "workers");
    expect(workers?.querySelector(".planner-cost__value")?.textContent).toBe("4 free / 5");
    expect(workers?.title).toContain("1 would start on Apply");
    expect(workers?.title).toContain("1 would wait for a worker");
    // Something waiting is a shortfall of workers, marked like any other.
    expect(workers?.classList.contains("planner-cost__cell--short")).toBe(true);
  });

  it("keeps the workers cell plain when nothing is planned", () => {
    const bar = mount();
    bar.setWorkers({ total: 5, busy: 0 }, null);

    const workers = cell(bar, "workers");
    expect(workers?.querySelector(".planner-cost__value")?.textContent).toBe("5 free / 5");
    expect(workers?.title).not.toContain("would start");
    expect(workers?.classList.contains("planner-cost__cell--short")).toBe(false);
  });

  it("hides the unplaced cell at zero and shows it above", () => {
    const bar = mount();
    bar.setUnplaced(0);
    expect(cell(bar, "unplaced")?.hidden).toBe(true);

    bar.setUnplaced(3);
    const unplaced = cell(bar, "unplaced");
    expect(unplaced?.hidden).toBe(false);
    expect(unplaced?.querySelector(".planner-cost__value")?.textContent).toBe("3");
    expect(unplaced?.title).toContain("Apply is blocked");
  });

  it("counts the plan in the summary sentence, and leaves it out at zero", () => {
    const bar = mount();
    const sentence = (): string =>
      bar.actionBar.querySelector(".planner-bar__summary")?.textContent ?? "";

    bar.update(stateOf({ selectionCount: 1, plannedCount: 6 }));
    expect(sentence()).toBe("1 selected · 0 moved · 6 planned");

    bar.update(stateOf({ selectionCount: 1, plannedCount: 0 }));
    expect(sentence()).toBe("1 selected · 0 moved");
  });
});

describe("the group operations", () => {
  it("offers mirror, six alignments and two distributions", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 3 }));

    expect(mirrorButtons(bar).map((button) => button.textContent)).toEqual([
      "Mirror ↔",
      "Mirror ↕",
    ]);
    expect(menuTriggers(bar).map((button) => button.textContent)).toEqual([
      "Align ▾",
      "Distribute ▾",
    ]);
    expect(menuItems(bar, 0)).toHaveLength(6);
    expect(menuItems(bar, 1)).toHaveLength(2);
  });

  it("stays off until there is a selection big enough to mean something", () => {
    const bar = mount();
    const off = (): boolean[] => [
      ...mirrorButtons(bar).map((button) => button.disabled),
      ...menuTriggers(bar).map((button) => button.disabled),
    ];

    bar.update(stateOf({ selectionCount: 0 }));
    expect(off()).toEqual([true, true, true, true]);

    bar.update(stateOf({ selectionCount: 1 }));
    expect(off()).toEqual([true, true, true, true]);

    // Two is enough to mirror and to align, but distributing holds the
    // outermost two still and so needs a third to move.
    bar.update(stateOf({ selectionCount: 2 }));
    expect(off()).toEqual([false, false, false, true]);

    bar.update(stateOf({ selectionCount: 3 }));
    expect(off()).toEqual([false, false, false, false]);
  });

  it("says what would turn a dead control on", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 2 }));

    const [, distribute] = menuTriggers(bar);
    expect(distribute?.title).toContain("three or more");

    bar.update(stateOf({ selectionCount: 1 }));
    expect(mirrorButtons(bar)[0]?.title).toContain("two or more");
  });

  it("fires the operation the menu row names, then closes", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ selectionCount: 3 }));

    const [align] = menuTriggers(bar);
    align?.click();
    expect(align?.getAttribute("aria-expanded")).toBe("true");

    menuItems(bar, 0)[0]?.click();
    expect(fired.onGroupTool).toHaveBeenCalledWith("align-left");
    expect(align?.getAttribute("aria-expanded")).toBe("false");
  });

  it("fires a mirror straight from the toolbar", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ selectionCount: 2 }));

    mirrorButtons(bar)[1]?.click();
    expect(fired.onGroupTool).toHaveBeenCalledWith("mirror-y");
  });

  it("closes an open menu on Escape and when the selection shrinks under it", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 3 }));

    const [align, distribute] = menuTriggers(bar);
    align?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(align?.getAttribute("aria-expanded")).toBe("false");

    distribute?.click();
    expect(distribute?.getAttribute("aria-expanded")).toBe("true");
    bar.update(stateOf({ selectionCount: 1 }));
    expect(distribute?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the put-back chip (F14)", () => {
  /** The chip, which is in the DOM whether or not it is on screen. */
  const chip = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.actionBar.querySelector(".planner-bar__put-back");

  it("appears only while something is in hand", () => {
    const bar = mount();
    bar.update(stateOf());
    expect(chip(bar)?.hidden).toBe(true);

    bar.update(stateOf({ carrying: true, selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(false);

    bar.update(stateOf({ carrying: false, selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(true);
  });

  it("puts the selection back when it is pressed", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ carrying: true, selectionCount: 1 }));

    chip(bar)?.click();
    expect(fired.onPutBack).toHaveBeenCalledTimes(1);
  });

  it("says both ways of putting it back in the summary line", () => {
    const bar = mount();
    bar.update(stateOf({ carrying: true, selectionCount: 1 }));

    // A finger has no second button, so the chip has to be named where the
    // right-click is.
    expect(bar.actionBar.querySelector(".planner-bar__summary")?.textContent).toContain(
      "right-click or Put back to cancel",
    );
  });

  it("is not mounted at all in a read-only session", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));
    expect(chip(bar)).toBeNull();
  });
});

describe("the read-only bar", () => {
  it("leaves out every control that would change the yard", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const shown = labels(bar);
    for (const gone of ["Apply", "Layouts", "Checklist", "Upgrade walls", "Undo", "Redo"]) {
      expect(shown).not.toContain(gone);
    }
    expect(bar.actionBar.querySelector(".planner-bar__rearm")).toBeNull();
    // Mirror, align and distribute all move buildings, so they go too.
    expect(mirrorButtons(bar)).toHaveLength(0);
    expect(menuTriggers(bar)).toHaveLength(0);
  });

  it("keeps the group operations inert even though they are not mounted", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true, selectionCount: 6 }));
    expect(bar.toolbar.querySelector(".planner-menu")).toBeNull();
  });

  it("keeps the tools that only answer questions", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const shown = labels(bar);
    for (const kept of ["Select", "Box", "Find", "3D", "Blueprint", "Leave planner"]) {
      expect(shown).toContain(kept);
    }
    // The cost cells are the read-only planner's whole point alongside find:
    // four resources, time, shiny and the worker count. Unplaced is in the DOM
    // but hidden, because nothing can be unplaced yet.
    expect(visibleCells(bar)).toHaveLength(7);
    expect(bar.actionBar.querySelectorAll(".planner-cost__cell")).toHaveLength(8);
  });

  it("says Read-only where the slot name goes, and why in the tooltip", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const slot = bar.toolbar.querySelector(".planner-bar__slot");
    expect(slot?.textContent).toBe("Read-only");
    expect(slot?.classList.contains("planner-bar__slot--read-only")).toBe(true);
    expect(slot?.getAttribute("title")).toContain("build mode");
  });

  it("says so in the summary line too", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true, selectionCount: 3 }));
    expect(bar.actionBar.querySelector(".planner-bar__summary")?.textContent).toBe(
      "3 selected · 0 moved · read-only · nothing here can be moved",
    );
  });

  it("cannot be talked back into enabling an action", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    // The counts a selection would normally use to light these up.
    bar.setWallCount(12);
    bar.setRearmCount(4);
    bar.setBlocking(0);

    expect(labels(bar)).not.toContain("Upgrade walls");
    expect(bar.actionBar.querySelector("button:not([disabled])")).toBeNull();
  });
});
