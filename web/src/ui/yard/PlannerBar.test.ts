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

const mount = (options: { readOnly?: boolean } = {}): PlannerBar => {
  const container = document.createElement("div");
  document.body.append(container);
  return new PlannerBar(actions(), options).mount(container);
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

describe("the read-only bar", () => {
  it("leaves out every control that would change the yard", () => {
    const bar = mount({ readOnly: true });
    bar.update(stateOf({ readOnly: true, previewing: true }));

    const shown = labels(bar);
    for (const gone of ["Apply", "Layouts", "Checklist", "Upgrade walls", "Undo", "Redo"]) {
      expect(shown).not.toContain(gone);
    }
    expect(bar.actionBar.querySelector(".planner-bar__rearm")).toBeNull();
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
