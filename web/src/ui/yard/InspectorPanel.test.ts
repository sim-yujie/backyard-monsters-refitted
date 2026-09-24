// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import type { PlanNode } from "@/game/yard/planner/placement";
import { Plan } from "@/game/yard/planner/plan";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { InspectorPanel, type InspectorPanelOptions } from "./InspectorPanel";

/**
 * The inspector: one building's ladder, and what a multi-selection gets
 * instead (`docs/design/planner-upgrades.md` §5.2).
 *
 * The numbers below are read by hand out of `buildingCostData.ts` and
 * `buildingArtData.ts`, not derived from them, so a regenerated table that had
 * gone wrong would fail here rather than agree with itself:
 *
 * | Type | Fact |
 * |---|---|
 * | 20 Cannon Tower | level 1 → 2 costs 10,000 / 7,500 / 2,500 over 900 s |
 * | 20 Cannon Tower | health 6,000 at level 1, 9,000 at level 2; max level 10 |
 * | 17 Block | level 1 → 2 costs 10,000 pebbles over 5 s |
 */

const NOW = 1_700_000_000;

const PLENTY = { r1: 1_000_000_000, r2: 1_000_000_000, r3: 1_000_000_000, r4: 1_000_000_000 };

const yardOf = (
  buildings: readonly BuildingData[],
  over: { health?: Record<string, number> } = {},
): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: NOW,
    savetime: NOW,
    storedata: { ENL: { q: 6 }, BEW: { q: 4 } },
    resources: PLENTY,
    buildingdata: Object.fromEntries(buildings.map((one) => [String(one.id), one])),
    buildinghealthdata: over.health ?? {},
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

/** A level 10 Town Hall, which clears every gate in the Map Room 2 table. */
const HALL: BuildingData = { id: 0, t: 14, X: 0, Y: 0, l: 10 };
/** A level 1 Town Hall, which clears almost none of them. */
const SMALL_HALL: BuildingData = { id: 0, t: 14, X: 0, Y: 0, l: 1 };
const CANNON: BuildingData = { id: 1, t: 20, X: 200, Y: 0 };

const nodesOf = (yard: Yard, ids: readonly number[]): { plan: Plan; nodes: PlanNode[] } => {
  const plan = Plan.fromYard(yard);
  return {
    plan,
    nodes: ids.map((id) => {
      const node = plan.get(id);
      if (!node) throw new Error(`no node ${id}`);
      return node;
    }),
  };
};

const mount = (
  over: Partial<InspectorPanelOptions> = {},
): { panel: InspectorPanel; element: HTMLElement; fired: InspectorPanelOptions } => {
  const container = document.createElement("div");
  document.body.append(container);
  const fired: InspectorPanelOptions = {
    onPlan: vi.fn(),
    onUpgradeWalls: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const panel = new InspectorPanel(fired).mount(container);
  return { panel, element: panel.element, fired };
};

const levels = (element: HTMLElement): HTMLButtonElement[] => [
  ...element.querySelectorAll<HTMLButtonElement>(".planner-inspector__level"),
];

const levelButton = (element: HTMLElement, level: number): HTMLButtonElement => {
  const found = levels(element).find((button) => button.dataset["level"] === String(level));
  if (!found) throw new Error(`no button for level ${level}`);
  return found;
};

const facts = (element: HTMLElement): Record<string, string> => {
  const rows: Record<string, string> = {};
  const terms = [...element.querySelectorAll("dt")];
  for (const term of terms) {
    const value = term.nextElementSibling;
    rows[term.textContent ?? ""] = value?.textContent ?? "";
  }
  return rows;
};

const planLine = (element: HTMLElement): string =>
  element.querySelector(".planner-inspector__plan-line")?.textContent ?? "";

const notes = (element: HTMLElement): string[] =>
  [...element.querySelectorAll(".planner-inspector__note")].map(
    (note) => note.textContent ?? "",
  );

describe("one building", () => {
  it("names the level, the health and what one more step costs", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(element.querySelector(".panel__title")?.textContent).toBe("Cannon Tower");
    const rows = facts(element);
    expect(rows["Level"]).toBe("1 of 10");
    expect(rows["Health"]).toBe("6,000");
    expect(rows["Next level"]).toBe("Health 9,000");
    expect(rows["Next step"]).toContain("10.0K twigs");
    expect(rows["Next step"]).toContain("7.5K pebbles");
    expect(rows["Next step"]).toContain("2.5K putty");
    expect(rows["Next step"]).toContain("15m 0s");
  });

  it("offers every level above its own, the top one labelled Max", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(levels(element).map((button) => button.dataset["level"])).toEqual([
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
    ]);
    expect(levelButton(element, 10).textContent).toBe("Max (L10)");
    expect(levelButton(element, 2).textContent).toBe("L2");
  });

  it("prices each button cumulatively from where the building is", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    // 1 → 3 is both steps: 10,000 + 50,000 twigs, 900 + 2,700 seconds.
    const title = levelButton(element, 3).title;
    expect(title).toContain("60.0K twigs");
    expect(title).toContain("45.0K pebbles");
    expect(title).toContain("1h 0m");
  });

  it("plans the level that is clicked, and clears it again", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element, fired } = mount();
    panel.show(nodes, yard);

    levelButton(element, 5).click();
    expect(fired.onPlan).toHaveBeenCalledWith([1], 5);

    // The session is what actually plans; the panel redraws from the node.
    nodes[0]!.plan = { level: 5, order: 0 };
    panel.show(nodes, yard);
    expect(planLine(element)).toContain("L1 → L5");
    expect(planLine(element)).toContain("4 steps");
    expect(levelButton(element, 5).getAttribute("aria-pressed")).toBe("true");

    element.querySelector<HTMLButtonElement>(".planner-inspector__clear")?.click();
    expect(fired.onPlan).toHaveBeenCalledWith([1], null);
  });

  it("says a multi-step plan will not finish in one Apply", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    nodes[0]!.plan = { level: 3, order: 0 };
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(notes(element).join(" ")).toContain("one step at a time");
  });

  it("keeps a gated level clickable and names the gate in its tooltip", () => {
    // A level 1 hall gates the tower's own ladder from very low down.
    const yard = yardOf([SMALL_HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element, fired } = mount();
    panel.show(nodes, yard);

    const gated = levels(element).find((button) => button.title.includes("Needs Town Hall"));
    expect(gated).toBeDefined();
    // §8, Q5: planning past a gate is allowed; Apply reports what it could not
    // start, so the button acts rather than sitting dead.
    expect(gated?.disabled).toBe(false);
    gated?.click();
    expect(fired.onPlan).toHaveBeenCalled();
  });

  it("spells the gate out on the plan line once a gated level is planned", () => {
    const yard = yardOf([SMALL_HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    const gated = levels(element).find((button) => button.title.includes("Needs Town Hall"));
    const level = Number(gated?.dataset["level"]);
    expect(Number.isFinite(level)).toBe(true);

    nodes[0]!.plan = { level, order: 0 };
    panel.show(nodes, yard);
    expect(notes(element).join(" ")).toContain("Needs Town Hall");
  });

  it("disables the whole ladder on a busy building, with the reason", () => {
    const yard = yardOf([HALL, { ...CANNON, cU: 600 }]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(levels(element).every((button) => button.disabled)).toBe(true);
    expect(levelButton(element, 2).title).toContain("already on a job");
    expect(facts(element)["Upgrading"]).toContain("left");
  });

  it("disables the ladder on a damaged building and shows its health", () => {
    const yard = yardOf([HALL, { ...CANNON, hp: 1_200 }]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(levels(element).every((button) => button.disabled)).toBe(true);
    expect(levelButton(element, 2).title).toContain("Repair");
    expect(facts(element)["Health"]).toBe("1,200 of 6,000");
  });

  it("offers nothing on a maxed building", () => {
    const yard = yardOf([HALL, { ...CANNON, l: 10 }]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(levels(element)).toHaveLength(0);
    expect(element.textContent).toContain("Already at the top");
  });

  it("reads the ladder but refuses to plan in a read-only session", () => {
    const yard = yardOf([HALL, CANNON]);
    const { nodes } = nodesOf(yard, [1]);
    const { panel, element } = mount({ readOnly: true });
    panel.show(nodes, yard);

    expect(levels(element)).toHaveLength(9);
    expect(levels(element).every((button) => button.disabled)).toBe(true);
    expect(levelButton(element, 2).title).toContain("not yours");
  });
});

describe("a multi-selection", () => {
  it("shows the batch cost and the wall button instead of a ladder", () => {
    const yard = yardOf([
      HALL,
      { id: 1, t: 17, X: 0, Y: 100 },
      { id: 2, t: 17, X: 20, Y: 100 },
    ]);
    const { nodes } = nodesOf(yard, [1, 2]);
    const { panel, element, fired } = mount();
    panel.show(nodes, yard);

    expect(element.querySelector(".panel__title")?.textContent).toBe("2 buildings selected");
    expect(levels(element)).toHaveLength(0);
    // Two blocks from level 1 to 2: 10,000 pebbles each.
    expect(facts(element)["Pebbles"]).toContain("20.0K");

    const walls = element.querySelector<HTMLButtonElement>(".planner-inspector__walls");
    expect(walls?.textContent).toBe("Upgrade 2 walls");
    walls?.click();
    expect(fired.onUpgradeWalls).toHaveBeenCalled();
  });

  it("clears every plan in the selection in one go", () => {
    const yard = yardOf([HALL, CANNON, { id: 2, t: 20, X: 280, Y: 0 }]);
    const { nodes } = nodesOf(yard, [1, 2]);
    nodes[0]!.plan = { level: 2, order: 0 };
    nodes[1]!.plan = { level: 2, order: 1 };
    const { panel, element, fired } = mount();
    panel.show(nodes, yard);

    const clear = element.querySelector<HTMLButtonElement>(".planner-inspector__clear");
    expect(clear?.textContent).toBe("Clear 2 plans");
    clear?.click();
    expect(fired.onPlan).toHaveBeenCalledWith([1, 2], null);
  });

  it("offers no wall button when nothing selected is a wall", () => {
    const yard = yardOf([HALL, CANNON, { id: 2, t: 20, X: 280, Y: 0 }]);
    const { nodes } = nodesOf(yard, [1, 2]);
    const { panel, element } = mount();
    panel.show(nodes, yard);

    expect(element.querySelector(".planner-inspector__walls")).toBeNull();
  });
});
