// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData, Resources } from "@/api/types";
import type { PlanNode } from "@/game/yard/planner/placement";
import { Plan } from "@/game/yard/planner/plan";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { wallUpgradePanel } from "./WallUpgradePanel";

/**
 * The batch wall upgrade panel.
 *
 * The arithmetic is `wallBatchPreview`'s and is tested there; what is tested
 * here is the three things the panel decides on its own — which level buttons
 * the yard has earned, what the preview sentence says, and when Confirm is
 * allowed to fire. Those are the rules that stop a player sending a call the
 * server will refuse, so they are worth a DOM.
 *
 * The fixture is the one `summary.test.ts` uses: four blocks at level 1, one
 * already at level 5, a Town Hall whose level the tests vary. A block's four
 * upgrade steps cost 0/10,000, 100,000/100,000, 200,000/200,000 and
 * 400,000/400,000 twigs and pebbles, and level 5 wants Town Hall 6.
 */

const BUILDINGS: readonly BuildingData[] = [
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 20, Y: 0 },
  { id: 3, t: 17, X: 40, Y: 0 },
  { id: 4, t: 17, X: 60, Y: 0 },
  { id: 5, t: 17, X: 100, Y: 0, l: 5 },
  { id: 7, t: 20, X: 200, Y: 0 },
];

const yardOf = (resources: Resources, hallLevel: number): Yard =>
  readYard({
    error: 0,
    id: 1,
    baseid: "1",
    basesaveid: 1,
    worldsize: [800, 800],
    currenttime: 1_700_000_000,
    savetime: 1_700_000_000,
    storedata: { ENL: { q: 0 } },
    resources,
    buildingdata: Object.fromEntries(
      [...BUILDINGS, { id: 8, t: 14, X: -300, Y: 0, l: hallLevel }].map((entry) => [
        String(entry.id),
        entry,
      ]),
    ),
    mushrooms: { l: [] },
  } as unknown as BaseLoadResponse);

const RICH = { r1: 10_000_000, r2: 10_000_000, r3: 10_000_000, r4: 10_000_000 };

const nodesOf = (yard: Yard, ids: readonly number[]): PlanNode[] => {
  const plan = Plan.fromYard(yard);
  return ids.map((id) => {
    const node = plan.get(id);
    if (!node) throw new Error(`no node ${id}`);
    return node;
  });
};

interface Harness {
  root: HTMLElement;
  confirm: HTMLButtonElement;
  levels: HTMLButtonElement[];
  onConfirm: ReturnType<typeof vi.fn>;
}

const open = (yard: Yard, ids: readonly number[]): Harness => {
  const onConfirm = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);

  wallUpgradePanel({
    nodes: nodesOf(yard, ids),
    yard,
    onConfirm,
    onClose: () => undefined,
  }).mount(container);

  const levels = [...container.querySelectorAll<HTMLButtonElement>(".planner-walls__level")];
  const confirm = container.querySelector<HTMLButtonElement>(".btn--primary");
  if (!confirm) throw new Error("no confirm button");

  return { root: container, confirm, levels, onConfirm };
};

const levelButton = (harness: Harness, level: number): HTMLButtonElement => {
  const found = harness.levels.find((button) => button.dataset["level"] === String(level));
  if (!found) throw new Error(`no level ${level} button`);
  return found;
};

const text = (harness: Harness, selector: string): string =>
  harness.root.querySelector(selector)?.textContent ?? "";

describe("wallUpgradePanel", () => {
  it("offers level 2 to 5 and disables the ones the Town Hall has not earned", () => {
    const yard = yardOf(RICH, 5);
    const harness = open(yard, [1, 2, 3, 4]);

    expect(harness.levels.map((button) => button.dataset["level"])).toEqual(["2", "3", "4", "5"]);
    expect(levelButton(harness, 4).disabled).toBe(false);
    expect(levelButton(harness, 5).disabled).toBe(true);
    // The reason is in the tooltip, not only in the disabled state.
    expect(levelButton(harness, 5).title).toContain("Needs Town Hall 6");
  });

  it("opens on the highest level the hall allows", () => {
    const harness = open(yardOf(RICH, 5), [1, 2, 3, 4]);
    expect(levelButton(harness, 4).getAttribute("aria-pressed")).toBe("true");
    expect(text(harness, ".planner-walls__preview")).toContain("level 4");
  });

  it("says how many walls would change and how many are already there", () => {
    const yard = yardOf(RICH, 10);
    const harness = open(yard, [1, 2, 3, 4, 5, 7]);
    levelButton(harness, 5).click();

    const preview = text(harness, ".planner-walls__preview");
    expect(preview).toContain("4 of 5 walls will go to level 5");
    expect(preview).toContain("1 already at level 5");
  });

  it("groups the selection by the level each wall is at now", () => {
    const harness = open(yardOf(RICH, 10), [1, 2, 3, 4, 5]);
    expect(text(harness, ".planner-walls__held")).toBe(
      "5 walls selected: 4 at level 1, 1 at level 5.",
    );
  });

  it("charges every step and hands the eligible ids to Confirm", () => {
    const harness = open(yardOf(RICH, 10), [1, 2, 3, 4, 5, 7]);
    levelButton(harness, 5).click();

    expect(text(harness, ".planner-walls__costs")).toContain("2.8M");
    expect(harness.confirm.disabled).toBe(false);

    harness.confirm.click();
    expect(harness.onConfirm).toHaveBeenCalledWith([1, 2, 3, 4], 5);
  });

  it("disables Confirm and marks the row when a resource is short", () => {
    const yard = yardOf({ r1: 10_000_000, r2: 40_000 }, 10);
    const harness = open(yard, [1, 2, 3, 4]);
    levelButton(harness, 5).click();

    const short = harness.root.querySelector(".planner-cost__row--short");
    expect(short?.textContent).toContain("short");
    expect(harness.confirm.disabled).toBe(true);
    expect(harness.confirm.title).toContain("cannot afford");
    harness.confirm.click();
    expect(harness.onConfirm).not.toHaveBeenCalled();
  });

  it("disables Confirm when nothing selected would change", () => {
    const harness = open(yardOf(RICH, 10), [5]);
    levelButton(harness, 5).click();

    expect(text(harness, ".planner-walls__preview")).toContain("Nothing to do");
    expect(harness.confirm.disabled).toBe(true);
  });

  it("says so rather than showing an empty list when no wall is selected", () => {
    const harness = open(yardOf(RICH, 10), [7]);

    expect(text(harness, ".planner-walls__held")).toBe("No walls are selected.");
    expect(text(harness, ".planner-walls__preview")).toBe("Nothing selected is a wall.");
    expect(harness.confirm.disabled).toBe(true);
  });
});
