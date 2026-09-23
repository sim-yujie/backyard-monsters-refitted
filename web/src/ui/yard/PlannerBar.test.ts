// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { PlannerTool, type PlannerState } from "@/game/yard/planner/PlannerSession";
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
  onHelp: noop,
  onExit: noop,
});

const stateOf = (overrides: Partial<PlannerState> = {}): PlannerState => ({
  tool: PlannerTool.SELECT,
  selectionCount: 0,
  movedCount: 0,
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
    // The cost cells are the read-only planner's whole point alongside find.
    expect(bar.actionBar.querySelectorAll(".planner-cost__cell")).toHaveLength(6);
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
