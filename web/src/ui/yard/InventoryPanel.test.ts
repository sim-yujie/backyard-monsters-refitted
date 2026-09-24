// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanNode } from "@/game/yard/planner/placement";
import { InventoryPanel } from "./InventoryPanel";

/**
 * The drawer (issue #50).
 *
 * What matters is that it stacks — a 400-wall run has to be one row — that a
 * click hands back one building rather than the stack, and that it says what
 * an empty drawer means instead of showing a blank panel.
 */

const node = (over: Partial<PlanNode> & { id: number }): PlanNode => ({
  type: 20,
  x: 0,
  y: 0,
  width: 70,
  height: 70,
  level: 1,
  fort: 0,
  decoration: false,
  fixed: false,
  stored: true,
  plan: null,
  busy: false,
  damaged: false,
  ...over,
});

const panels: InventoryPanel[] = [];

afterEach(() => {
  while (panels.length > 0) panels.pop()?.close();
  document.body.replaceChildren();
});

const mount = (
  onPlace: (id: number) => boolean = () => true,
): InventoryPanel => {
  const panel = new InventoryPanel({ onPlace, onClose: () => {} }).mount(document.body);
  panels.push(panel);
  return panel;
};

const rows = (panel: InventoryPanel): HTMLButtonElement[] => [
  ...panel.element.querySelectorAll<HTMLButtonElement>(".planner-inventory__row button"),
];

describe("the inventory drawer", () => {
  it("stacks a run of walls into one row", () => {
    const panel = mount();
    // Type 17 is the wall; four of them at level 1, plus one tower.
    panel.setNodes([
      node({ id: 1, type: 17, level: 1 }),
      node({ id: 2, type: 17, level: 1 }),
      node({ id: 3, type: 17, level: 1 }),
      node({ id: 4, type: 17, level: 1 }),
      node({ id: 9, type: 20, level: 3 }),
    ]);

    expect(rows(panel).map((row) => row.textContent)).toEqual([
      "Block L1× 4",
      "Cannon Tower L3× 1",
    ]);
    expect(panel.stacks.map((stack) => stack.ids.length)).toEqual([4, 1]);
  });

  it("splits one type's levels into their own stacks", () => {
    const panel = mount();
    panel.setNodes([
      node({ id: 1, type: 17, level: 1 }),
      node({ id: 2, type: 17, level: 5 }),
    ]);

    expect(panel.stacks.map((stack) => stack.level)).toEqual([1, 5]);
  });

  it("hands back the lowest id of the stack, not the stack", () => {
    const placed: number[] = [];
    const panel = mount((id) => {
      placed.push(id);
      return true;
    });
    panel.setNodes([node({ id: 8, type: 17 }), node({ id: 3, type: 17 })]);

    rows(panel)[0]?.click();

    expect(placed).toEqual([3]);
  });

  it("says how many are waiting and that Apply is blocked", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1 }), node({ id: 2 })]);

    const summary = panel.element.querySelector(".planner-inventory__summary");
    expect(summary?.textContent).toContain("2 buildings waiting");
    expect(summary?.textContent).toContain("Apply is blocked");
  });

  it("says what an empty drawer is for rather than showing nothing", () => {
    const panel = mount();
    panel.setNodes([]);

    const empty = panel.element.querySelector<HTMLElement>(".planner-inventory__empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toContain("Store");
    expect(rows(panel)).toHaveLength(0);
    expect(panel.element.querySelector(".planner-inventory__summary")?.textContent).toBe("");
  });

  it("redraws when the drawer changes under it", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 17 })]);
    expect(rows(panel)[0]?.textContent).toContain("× 2");

    panel.setNodes([node({ id: 2, type: 17 })]);
    expect(rows(panel)[0]?.textContent).toContain("× 1");

    panel.setNodes([]);
    expect(rows(panel)).toHaveLength(0);
    expect(panel.element.querySelector<HTMLElement>(".planner-inventory__empty")?.hidden).toBe(
      false,
    );
  });

  it("closes through its own cross", () => {
    const closed = vi.fn();
    const panel = new InventoryPanel({ onPlace: () => true, onClose: closed }).mount(
      document.body,
    );
    panel.element.querySelector<HTMLButtonElement>("button[aria-label='Close']")?.click();
    expect(closed).toHaveBeenCalled();
  });
});
