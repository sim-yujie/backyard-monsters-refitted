// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  onStore: vi.fn(),
  onClearYard: vi.fn(),
  onInventory: vi.fn(),
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
  storedCount: 0,
  placing: false,
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

/**
 * The group-operation menus: Align and Distribute, in that order.
 *
 * The Yard menu — which holds Clear yard — is a menu in the same toolbar and
 * is left out here, so these helpers go on meaning the same thing they did
 * before it existed.
 */
const groupMenus = (bar: PlannerBar): HTMLElement[] =>
  [...bar.toolbar.querySelectorAll<HTMLElement>(".planner-menu")].filter(
    (menu) =>
      !menu.querySelector(".planner-menu__trigger")?.textContent?.startsWith("Yard"),
  );

/**
 * The demo wrapper around the first Mirror button.
 *
 * By name rather than by position: Store is wrapped the same way and sits
 * ahead of it in the toolbar, so "the first `.planner-tip`" stopped meaning
 * "a mirror" the moment storing existed.
 */
const mirrorTip = (bar: PlannerBar): HTMLElement => {
  const wrapper = [...bar.toolbar.querySelectorAll<HTMLElement>(".planner-tip")].find(
    (tip) => tip.querySelector("button")?.textContent?.startsWith("Mirror"),
  );
  if (!wrapper) throw new Error("no mirror tip in the toolbar");
  return wrapper;
};

const menuTriggers = (bar: PlannerBar): HTMLButtonElement[] =>
  groupMenus(bar).flatMap((menu) => [
    ...menu.querySelectorAll<HTMLButtonElement>(".planner-menu__trigger"),
  ]);

const menuItems = (bar: PlannerBar, index: number): HTMLButtonElement[] => {
  const list = groupMenus(bar)[index]?.querySelector(".planner-menu__list");
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

/**
 * The demos that replaced the tooltips (#49).
 *
 * The owner's verdict on the old ones was "your words aren't exactly helpful",
 * and the fix is a picture of the move. What can be checked here is that the
 * picture reaches the player: on hover, on a disabled control as much as a
 * live one, and without the `title` a screen reader relies on going anywhere.
 */
describe("the tool demos", () => {
  const popovers = (): Element[] => [...document.querySelectorAll(".popover")];

  const hover = (element: Element): void => {
    element.dispatchEvent(new Event("pointerenter"));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    for (const stale of popovers()) stale.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a moving picture when a group tool is hovered", () => {
    const bar = mount();
    const mirror = bar.toolbar.querySelector(".planner-tip");
    expect(mirror).not.toBeNull();

    hover(mirror!);
    // Not instantly: sweeping a pointer across nine buttons should not strobe.
    expect(popovers()).toHaveLength(0);
    vi.advanceTimersByTime(400);

    const [bubble] = popovers();
    expect(bubble).toBeDefined();
    expect(bubble?.querySelector("svg.planner-demo")).not.toBeNull();
    expect(bubble?.querySelectorAll(".planner-demo__anim").length ?? 0).toBeGreaterThan(0);
    bar.destroy();
  });

  it("shows one for a tool that is off, which is when it is most wanted", () => {
    const bar = mount();
    bar.setGroupEnabled(0);

    const wrapper = mirrorTip(bar);
    expect(wrapper.querySelector("button")?.disabled).toBe(true);
    hover(wrapper);
    vi.advanceTimersByTime(400);

    const [bubble] = popovers();
    // The reason it is off, rather than the hint for what it would do.
    expect(bubble?.textContent).toContain("two or more");
    expect(bubble?.querySelector("svg.planner-demo")).not.toBeNull();
    bar.destroy();
  });

  it("leaves the native tooltip where the wrapper can still show it", () => {
    const bar = mount();
    const wrapper = mirrorTip(bar);
    const button = wrapper.querySelector("button");
    bar.setGroupEnabled(4);
    expect(button?.title).toContain("Flip the selection left to right");
    // A disabled button takes no pointer events, so the wrapper carries the
    // same words for the browser to show instead.
    expect(wrapper.title).toBe(button?.title);
    bar.destroy();
  });

  it("takes its bubbles down with it", () => {
    const bar = mount();
    hover(bar.toolbar.querySelector(".planner-tip")!);
    vi.advanceTimersByTime(400);
    expect(popovers()).toHaveLength(1);

    bar.destroy();
    expect(popovers()).toHaveLength(0);
  });
});

describe("store, clear and the drawer (issue #50)", () => {
  const storeButton = (bar: PlannerBar): HTMLButtonElement | null =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Store",
    ) ?? null;

  const chip = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.actionBar.querySelector(".planner-bar__store-chip");

  const drawer = (bar: PlannerBar): HTMLButtonElement | null =>
    bar.toolbar.querySelector(".planner-bar__inventory");

  const yardMenu = (bar: PlannerBar): HTMLButtonElement | null =>
    [...bar.toolbar.querySelectorAll<HTMLButtonElement>(".planner-menu__trigger")].find(
      (button) => button.textContent?.startsWith("Yard"),
    ) ?? null;

  it("keeps Store off until there is something to store, and says why", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 0 }));
    expect(storeButton(bar)?.disabled).toBe(true);
    expect(storeButton(bar)?.title).toContain("Select something");

    bar.update(stateOf({ selectionCount: 3 }));
    expect(storeButton(bar)?.disabled).toBe(false);
    expect(storeButton(bar)?.title).toContain("all 3");
  });

  it("shows the chip beside the selection, and takes it away mid-carry", () => {
    const bar = mount();
    bar.update(stateOf({ selectionCount: 0 }));
    expect(chip(bar)?.hidden).toBe(true);

    bar.update(stateOf({ selectionCount: 2 }));
    expect(chip(bar)?.hidden).toBe(false);

    // Something already in hand is not something to store, and the chip would
    // sit next to Put back saying the opposite thing.
    bar.update(stateOf({ selectionCount: 2, carrying: true }));
    expect(chip(bar)?.hidden).toBe(true);
  });

  it("fires the same action from the toolbar and from the chip", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ selectionCount: 1 }));

    storeButton(bar)?.click();
    chip(bar)?.click();

    expect(fired.onStore).toHaveBeenCalledTimes(2);
  });

  it("offers Clear yard in a menu rather than as a bare button", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf());

    const trigger = yardMenu(bar);
    expect(trigger).not.toBeNull();
    trigger?.click();

    const items = [
      ...(trigger?.closest(".planner-menu")?.querySelectorAll<HTMLButtonElement>(
        ".planner-menu__item",
      ) ?? []),
    ];
    expect(items.map((item) => item.textContent)).toEqual(["Clear yard"]);

    items[0]?.click();
    expect(fired.onClearYard).toHaveBeenCalledTimes(1);
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
  });

  it("shuts the Yard menu while a preview is up", () => {
    const bar = mount();
    bar.update(stateOf({ previewing: true }));
    expect(yardMenu(bar)?.disabled).toBe(true);
    expect(yardMenu(bar)?.title).toContain("preview");
  });

  it("badges the drawer with what it holds, and opens only when it holds something", () => {
    const { bar, fired } = mountWith();
    bar.update(stateOf({ storedCount: 0 }));
    expect(drawer(bar)?.disabled).toBe(true);
    expect(drawer(bar)?.querySelector<HTMLElement>(".planner-bar__badge")?.hidden).toBe(true);

    bar.update(stateOf({ storedCount: 12 }));
    expect(drawer(bar)?.disabled).toBe(false);
    expect(drawer(bar)?.querySelector<HTMLElement>(".planner-bar__badge")?.hidden).toBe(false);
    expect(drawer(bar)?.querySelector(".planner-bar__badge")?.textContent).toBe("12");

    drawer(bar)?.click();
    expect(fired.onInventory).toHaveBeenCalledTimes(1);
  });

  it("turns the Unplaced cell on with the drawer and says Apply is blocked", () => {
    const bar = mount();
    bar.update(stateOf({ storedCount: 0 }));
    expect(cell(bar, "unplaced")?.hidden).toBe(true);

    bar.update(stateOf({ storedCount: 3 }));
    const unplaced = cell(bar, "unplaced");
    expect(unplaced?.hidden).toBe(false);
    expect(unplaced?.querySelector(".planner-cost__value")?.textContent).toBe("3");
    expect(unplaced?.title).toContain("Apply is blocked");
    expect(unplaced?.classList.contains("planner-cost__cell--short")).toBe(true);
  });

  it("counts the drawer in the summary line, and words a placement its own way", () => {
    const bar = mount();
    const summary = (): string =>
      bar.actionBar.querySelector(".planner-bar__summary")?.textContent ?? "";

    bar.update(stateOf({ storedCount: 4 }));
    expect(summary()).toContain("4 stored");

    bar.update(stateOf({ storedCount: 4, carrying: true, placing: true, selectionCount: 1 }));
    expect(summary()).toContain("out of the drawer");
    expect(summary()).not.toContain("right-click or Put back");
  });

  it("gives a read-only session none of it", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true, storedCount: 2 }));

    expect(storeButton(bar)).toBeNull();
    expect(chip(bar)).toBeNull();
    expect(drawer(bar)).toBeNull();
    expect(yardMenu(bar)).toBeNull();
  });
});
