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
