// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanNode } from "@/game/yard/planner/placement";
import { InventoryPanel } from "./InventoryPanel";

/**
 * The drawer (issue #50, categories and search #53).
 *
 * What matters is that it stacks — a 400-wall run has to be one row — that the
 * stacks are filed under their category in a fixed order, that the box and the
 * chips narrow the list without lying about how many buildings are blocking
 * Apply, that a row carries the building's own picture, and that a click hands
 * back one building rather than the stack.
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

const mount = (onPlace: (id: number) => boolean = () => true): InventoryPanel => {
  const panel = new InventoryPanel({ onPlace, onClose: () => {} }).mount(document.body);
  panels.push(panel);
  return panel;
};

/** Every row on screen, in the order the drawer lists them. */
const rows = (panel: InventoryPanel): HTMLButtonElement[] => [
  ...panel.element.querySelectorAll<HTMLButtonElement>(".planner-inventory__row button"),
];

/** A row's name, level chip and count, read off its own spans. */
const readRow = (row: HTMLElement): string =>
  [
    row.querySelector(".planner-inventory__name")?.textContent,
    row.querySelector(".planner-inventory__level")?.textContent,
    row.querySelector(".planner-search__count")?.textContent,
  ].join(" ");

const headers = (panel: InventoryPanel): HTMLButtonElement[] => [
  ...panel.element.querySelectorAll<HTMLButtonElement>(".planner-inventory__header"),
];

const type = (panel: InventoryPanel, text: string): void => {
  const input = panel.element.querySelector<HTMLInputElement>(".planner-inventory__input");
  if (!input) throw new Error("no search box");
  input.value = text;
  input.dispatchEvent(new Event("input"));
};

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

    // The tower comes first: Towers is the first category, Walls the fifth.
    expect(rows(panel).map(readRow)).toEqual(["Cannon Tower L3 × 1", "Block L1 × 4"]);
    expect(panel.stacks.map((stack) => stack.ids.length)).toEqual([4, 1]);
  });

  it("splits one type's levels into their own stacks", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17, level: 1 }), node({ id: 2, type: 17, level: 5 })]);

    expect(panel.stacks.map((stack) => stack.level)).toEqual([1, 5]);
  });

  it("files the stacks under their category, towers first and walls late", () => {
    const panel = mount();
    panel.setNodes([
      node({ id: 1, type: 17, level: 1 }), // Block, a wall
      node({ id: 2, type: 20, level: 1 }), // Cannon Tower, a tower
      node({ id: 3, type: 4, level: 1 }), // Silo, a resource
    ]);

    expect(headers(panel).map((header) => header.dataset["kind"])).toEqual([
      "tower",
      "resource",
      "wall",
    ]);
    expect(panel.sections.map((section) => section.label)).toEqual([
      "Towers",
      "Resources",
      "Walls",
    ]);
  });

  it("counts buildings on a header, not stacks", () => {
    const panel = mount();
    panel.setNodes([
      node({ id: 1, type: 17, level: 1 }),
      node({ id: 2, type: 17, level: 1 }),
      node({ id: 3, type: 17, level: 5 }),
    ]);

    const [walls] = headers(panel);
    expect(walls?.querySelector(".planner-search__count")?.textContent).toBe("3");
    expect(panel.sections[0]?.groups).toHaveLength(2);
  });

  it("sorts a category by name and then by level ascending", () => {
    const panel = mount();
    panel.setNodes([
      node({ id: 1, type: 20, level: 5 }), // Cannon Tower L5
      node({ id: 2, type: 20, level: 2 }), // Cannon Tower L2
      node({ id: 3, type: 22, level: 1 }), // Laser Tower L1
    ]);

    const listed = rows(panel).map(readRow);
    expect(listed[0]).toContain("L2");
    expect(listed[1]).toContain("L5");
    expect(listed[0]?.split(" L")[0]).toBe(listed[1]?.split(" L")[0]);
    expect(listed[2]).not.toContain(listed[0]?.split(" L")[0] ?? "");
  });

  it("folds a category away and remembers it through a redraw", () => {
    const panel = mount();
    const stored = [node({ id: 1, type: 17 }), node({ id: 2, type: 20 })];
    panel.setNodes(stored);
    expect(rows(panel)).toHaveLength(2);

    const walls = headers(panel).find((header) => header.dataset["kind"] === "wall");
    walls?.click();

    expect(rows(panel)).toHaveLength(1);
    expect(
      headers(panel)
        .find((header) => header.dataset["kind"] === "wall")
        ?.getAttribute("aria-expanded"),
    ).toBe("false");

    // The drawer redraws after every edit; the fold must survive that.
    panel.setNodes(stored);
    expect(rows(panel)).toHaveLength(1);
  });

  it("filters the rows by name, case insensitively", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 20 })]);

    type(panel, "cannon");

    expect(rows(panel).map(readRow)).toEqual(["Cannon Tower L1 × 1"]);
    expect(headers(panel)).toHaveLength(1);
  });

  it("matches a query of digits against the type id", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 20 })]);

    type(panel, "20");

    expect(panel.stacks.map((stack) => stack.type)).toEqual([20]);
  });

  it("says what no match was for, and clears the search", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 })]);

    type(panel, "zzz");

    const empty = panel.element.querySelector<HTMLElement>(".planner-inventory__empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toContain("No match for “zzz”");
    expect(rows(panel)).toHaveLength(0);

    empty?.querySelector<HTMLButtonElement>(".planner-search__clear")?.click();
    expect(rows(panel)).toHaveLength(1);
  });

  it("narrows to a kind when its chip is pressed", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 20 })]);

    const chip = panel.element.querySelector<HTMLButtonElement>(
      ".planner-search__chip[data-kind='wall']",
    );
    chip?.click();

    expect(chip?.getAttribute("aria-pressed")).toBe("true");
    expect(rows(panel).map(readRow)).toEqual(["Block L1 × 1"]);
  });

  it("draws each row's own art, lazily", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 20, level: 3 })]);

    const icon = panel.element.querySelector<HTMLImageElement>(".planner-inventory__icon");
    expect(icon?.tagName).toBe("IMG");
    expect(icon?.getAttribute("src")).toContain("/assets/");
    expect(icon?.getAttribute("loading")).toBe("lazy");
    expect(icon?.alt).toBe("Cannon Tower");
  });

  it("crops an animation strip to its first cell rather than squeezing it in", () => {
    // The Monster Bunker ships no still picture: its `top` is a 1350 x 83
    // strip of fifteen 90 x 83 cells. Fitting the whole file into 28 pixels
    // draws a 28 x 2 smear, which is what "no icon" looked like.
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 22, level: 1, width: 90, height: 90 })]);

    const box = panel.element.querySelector<HTMLElement>(".planner-inventory__icon");
    expect(box?.tagName).toBe("SPAN");
    expect(box?.style.overflow).toBe("hidden");

    const icon = box?.querySelector("img");
    expect(icon?.getAttribute("src")).toContain("bunker/anim.1.png");
    expect(icon?.alt).toBe("Monster Bunker");
    // One cell tall at 28 px wide: the strip's own width is never needed.
    expect(icon?.style.width).toBe("auto");
    expect(icon?.style.height).toBe(`${(83 * 28) / 90}px`);
    expect(icon?.style.left).toBe("0px");
  });

  it("shows a swatch rather than a broken image for a type with no art", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 99_999 })]);

    const icon = panel.element.querySelector<HTMLElement>(".planner-inventory__icon");
    expect(icon?.tagName).toBe("SPAN");
    expect(icon?.classList.contains("planner-inventory__swatch")).toBe(true);
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

  it("keeps the blocked count honest while the box is filtering", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 20 })]);

    type(panel, "cannon");

    // One row on screen, two buildings still stopping Apply.
    expect(rows(panel)).toHaveLength(1);
    expect(panel.element.querySelector(".planner-inventory__summary")?.textContent).toContain(
      "2 buildings waiting",
    );
  });

  it("says what an empty drawer is for rather than showing nothing", () => {
    const panel = mount();
    panel.setNodes([]);

    const empty = panel.element.querySelector<HTMLElement>(".planner-inventory__empty");
    expect(empty?.hidden).toBe(false);
    expect(empty?.textContent).toContain("Nothing stored");
    expect(empty?.textContent).toContain("Store");
    expect(rows(panel)).toHaveLength(0);
    expect(panel.element.querySelector(".planner-inventory__summary")?.textContent).toBe("");
    expect(
      panel.element.querySelector<HTMLInputElement>(".planner-inventory__input")?.hidden,
    ).toBe(true);
  });

  it("redraws when the drawer changes under it", () => {
    const panel = mount();
    panel.setNodes([node({ id: 1, type: 17 }), node({ id: 2, type: 17 })]);
    expect(readRow(rows(panel)[0] as HTMLElement)).toContain("× 2");

    panel.setNodes([node({ id: 2, type: 17 })]);
    expect(readRow(rows(panel)[0] as HTMLElement)).toContain("× 1");

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
