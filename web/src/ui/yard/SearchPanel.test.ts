// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { Plan } from "@/game/yard/planner/plan";
import { readYard, type Yard } from "@/game/yard/yardModel";
import { SearchPanel } from "./SearchPanel";

/**
 * The find panel.
 *
 * `searchNodes` and `countByKind` are tested where they live; this covers the
 * panel's own behaviour — the stacked rows it draws, the chip badges, what
 * Enter does, and the empty state's way out of itself.
 *
 * The fixture is small and deliberate: four blocks at level 1 and one at level
 * 5 make two rows of one type, and a Cannon Tower gives a second chip to filter
 * with.
 */

const BUILDINGS: readonly BuildingData[] = [
  { id: 1, t: 17, X: 0, Y: 0 },
  { id: 2, t: 17, X: 20, Y: 0 },
  { id: 3, t: 17, X: 40, Y: 0 },
  { id: 4, t: 17, X: 60, Y: 0 },
  { id: 5, t: 17, X: 100, Y: 0, l: 5 },
  { id: 7, t: 20, X: 200, Y: 0 },
  { id: 8, t: 14, X: -300, Y: 0, l: 10 },
];

const YARD: Yard = readYard({
  error: 0,
  id: 1,
  baseid: "1",
  basesaveid: 1,
  worldsize: [800, 800],
  currenttime: 1_700_000_000,
  savetime: 1_700_000_000,
  storedata: { ENL: { q: 0 } },
  resources: { r1: 1_000, r2: 1_000 },
  buildingdata: Object.fromEntries(BUILDINGS.map((entry) => [String(entry.id), entry])),
  mushrooms: { l: [{ id: 1, X: 300, Y: 200 }] },
} as unknown as BaseLoadResponse);

interface Harness {
  panel: SearchPanel;
  root: HTMLElement;
  input: HTMLInputElement;
  onSelect: ReturnType<typeof vi.fn>;
}

const open = (yard: Yard = YARD): Harness => {
  const onSelect = vi.fn();
  const container = document.createElement("div");
  document.body.append(container);

  const panel = new SearchPanel({ onSelect, onClose: () => undefined }).mount(container);
  panel.setNodes(Plan.fromYard(yard).buildings());

  const input = container.querySelector<HTMLInputElement>(".planner-search__input");
  if (!input) throw new Error("no search input");

  return { panel, root: container, input, onSelect };
};

const type = (harness: Harness, value: string): void => {
  harness.input.value = value;
  harness.input.dispatchEvent(new Event("input"));
};

const rows = (harness: Harness): string[] =>
  [...harness.root.querySelectorAll(".planner-search__pick")].map(
    (row) => row.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const chip = (harness: Harness, kind: string): HTMLButtonElement => {
  const found = harness.root.querySelector<HTMLButtonElement>(
    `.planner-search__chip[data-kind="${kind}"]`,
  );
  if (!found) throw new Error(`no ${kind} chip`);
  return found;
};

describe("SearchPanel", () => {
  it("stacks a type's buildings into one row per level", () => {
    const harness = open();
    expect(rows(harness)).toEqual(["Block L1× 4", "Block L5× 1", "Cannon Tower L1× 1", "Town Hall L10× 1"]);
  });

  it("counts every kind the yard holds on its chip", () => {
    const harness = open();
    expect(chip(harness, "wall").textContent).toContain("5");
    expect(chip(harness, "tower").textContent).toContain("1");
  });

  it("narrows the rows to what the query matches", () => {
    const harness = open();
    type(harness, "cannon");
    expect(rows(harness)).toEqual(["Cannon Tower L1× 1"]);
  });

  it("matches on the type id as well as the name", () => {
    const harness = open();
    type(harness, "17");
    expect(rows(harness)).toEqual(["Block L1× 4", "Block L5× 1"]);
  });

  it("filters by chip, and the badges do not move as the query is typed", () => {
    const harness = open();
    chip(harness, "tower").click();

    expect(chip(harness, "tower").getAttribute("aria-pressed")).toBe("true");
    expect(rows(harness)).toEqual(["Cannon Tower L1× 1"]);
    // The wall chip still reports the yard, not the filtered list.
    expect(chip(harness, "wall").textContent).toContain("5");
  });

  it("selects and frames a whole stack when its row is clicked", () => {
    const harness = open();
    harness.root.querySelectorAll<HTMLButtonElement>(".planner-search__pick")[0]?.click();
    expect(harness.onSelect).toHaveBeenCalledWith([1, 2, 3, 4]);
  });

  it("selects every match on Enter", () => {
    const harness = open();
    type(harness, "block");
    harness.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(harness.onSelect).toHaveBeenCalledWith([1, 2, 3, 4, 5]);
  });

  it("does nothing on Enter with no matches", () => {
    const harness = open();
    type(harness, "zzz");
    harness.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(harness.onSelect).not.toHaveBeenCalled();
  });

  it("names what was searched for in the empty state and offers a way out", () => {
    const harness = open();
    type(harness, "xyz");

    const empty = harness.root.querySelector<HTMLElement>(".planner-search__empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toContain("No buildings match “xyz”.");

    harness.root.querySelector<HTMLButtonElement>(".planner-search__clear")?.click();
    expect(harness.input.value).toBe("");
    expect(rows(harness)).toHaveLength(4);
  });

  it("takes the empty state away again once a later query matches", () => {
    const harness = open();
    type(harness, "xyz");
    expect(harness.root.querySelector(".planner-search__empty")).not.toBeNull();

    type(harness, "block");
    // Gone from the document, not merely hidden: the class sets `display:
    // flex`, which the `hidden` attribute does not override.
    expect(harness.root.querySelector(".planner-search__empty")).toBeNull();
    expect(rows(harness)).toEqual(["Block L1× 4", "Block L5× 1"]);
  });

  it("names the query in the empty state even when a chip is also excluding", () => {
    const harness = open();
    chip(harness, "tower").click();
    type(harness, "block");

    const empty = harness.root.querySelector<HTMLElement>(".planner-search__empty");
    expect(empty?.textContent).toContain("No buildings match “block”.");
  });

  it("never offers a mushroom, which cannot be selected", () => {
    const harness = open();
    expect(rows(harness).some((row) => row.toLowerCase().includes("mushroom"))).toBe(false);
  });
});
