// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layout } from "@/api/types";
import { LayoutsPanel, type LayoutsPanelActions } from "./LayoutsPanel";

/** The slot rows' Compare (#9): offered only where the planner can compare, and only on a saved slot. */

const layout: Layout = { slot: 1, name: "West", version: 2, expansion: 6, updatedAt: 0, nodes: [] };

const mount = (over: Partial<LayoutsPanelActions> = {}) => {
  const actions: LayoutsPanelActions = {
    onLoad: vi.fn(),
    onPreview: vi.fn(),
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const panel = new LayoutsPanel(actions).mount(document.body);
  panel.show([layout], 3);
  const compares = [...panel.element.querySelectorAll<HTMLButtonElement>("button")].filter(
    (button) => button.textContent === "Compare",
  );
  return { compares };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("LayoutsPanel: Compare", () => {
  it("is on every row, and only a saved slot's can be pressed", () => {
    const onCompare = vi.fn();
    const { compares } = mount({ onCompare });
    expect(compares).toHaveLength(3);
    expect(compares.map((button) => button.disabled)).toEqual([true, false, true]);
    compares[1]!.click();
    expect(onCompare).toHaveBeenCalledWith(layout);
  });

  it("is not offered where the planner cannot compare", () => {
    expect(mount().compares).toHaveLength(0);
  });
});

/**
 * Owner, beta 8: without a built Yard Planner only slot 1 is usable. The other
 * slots stay listed, locked; a save in one keeps its name; Compare is locked;
 * every press on a locked thing says why and does nothing else.
 */
describe("LayoutsPanel: locked without a Yard Planner (beta 8)", () => {
  const LOCKED = "Build a Yard Planner";
  const saved = (slot: number, name: string): Layout => ({ ...layout, slot, name });

  const lockedPanel = (layouts: Layout[]) => {
    const actions: LayoutsPanelActions = {
      onLoad: vi.fn(),
      onPreview: vi.fn(),
      onCompare: vi.fn(),
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onClose: vi.fn(),
      onLocked: vi.fn(),
    };
    const panel = new LayoutsPanel(actions).mount(document.body);
    panel.show(layouts, 10, undefined, { usable: 1, locked: LOCKED });
    const element = panel.element;
    const named = (text: string) =>
      [...element.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent?.trim() === text);
    return { actions, element, named };
  };

  it("keeps slot 1 whole and lists slots 2-10 as locked rows, a save's name in full", () => {
    const { element, named } = lockedPanel([saved(0, "Main"), saved(3, "War base")]);
    expect(element.querySelectorAll(".planner-layouts__row")).toHaveLength(10);
    expect(element.querySelectorAll(".planner-layouts__row--locked")).toHaveLength(9);
    expect(named("Save")).toHaveLength(1);
    expect(named("Load")).toHaveLength(1);
    const locked = [...element.querySelectorAll(".planner-layouts__locked-name")].map((one) => one.textContent);
    expect(locked).toEqual(["Slot 2", "Slot 3", "War base", "Slot 5", "Slot 6", "Slot 7", "Slot 8", "Slot 9", "Slot 10"]);
    expect(element.querySelector(".planner-layouts__gate")?.textContent).toContain("Build a Yard Planner for 10 slots");
    expect(element.querySelector(".planner-layouts__gate")?.textContent).toContain("Existing saves are kept");
  });

  it("a press on a locked slot or on Compare only says why", () => {
    const { actions, element, named } = lockedPanel([saved(0, "Main"), saved(3, "War base")]);
    element.querySelectorAll<HTMLButtonElement>(".planner-layouts__locked")[2]!.click();
    const compare = named("Compare")[0]!;
    expect(compare.getAttribute("aria-disabled")).toBe("true");
    compare.click();
    expect(actions.onLocked).toHaveBeenCalledTimes(2);
    expect(actions.onLoad).not.toHaveBeenCalled();
    expect(actions.onPreview).not.toHaveBeenCalled();
    expect(actions.onCompare).not.toHaveBeenCalled();
    expect(actions.onDelete).not.toHaveBeenCalled();
  });

  it("slot 1 empty and a save in slot 3: slot 1 is still the one to save to, slot 3 stays locked", () => {
    const { actions, element, named } = lockedPanel([saved(2, "Farm")]);
    named("Save")[0]!.click();
    expect(actions.onSave).toHaveBeenCalledWith(0, "Slot 1");
    expect(element.querySelector(".planner-layouts__gate")?.textContent).toContain("Existing saves are kept");
  });

  it("with no save above slot 1, says nothing about kept saves; unlocked, shows no gate at all", () => {
    const { element } = lockedPanel([]);
    expect(element.querySelector(".planner-layouts__gate")?.textContent).not.toContain("kept");
    document.body.replaceChildren();

    const panel = new LayoutsPanel({ onLoad: vi.fn(), onPreview: vi.fn(), onSave: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() }).mount(
      document.body,
    );
    panel.show([saved(3, "War base")], 10, undefined, { usable: 10, locked: null });
    expect(panel.element.querySelector<HTMLElement>(".planner-layouts__gate")?.hidden).toBe(true);
    expect(panel.element.querySelectorAll(".planner-layouts__row--locked")).toHaveLength(0);
  });
});
