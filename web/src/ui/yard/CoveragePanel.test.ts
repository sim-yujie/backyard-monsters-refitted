// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { computeCoverage } from "@/game/yard/planner/coverage";
import { CoveragePanel, type CoveragePanelOptions } from "./CoveragePanel";

/** The planner's coverage view: the figures and the largest dead zones (#55). */

const mount = (
  over: Partial<CoveragePanelOptions> = {},
): { panel: CoveragePanel; element: HTMLElement } => {
  const container = document.createElement("div");
  document.body.append(container);
  const panel = new CoveragePanel({ onClose: vi.fn(), ...over }).mount(container);
  return { panel, element: panel.element };
};

describe("CoveragePanel (#55)", () => {
  const plot = { halfWidth: 500, halfHeight: 400 };
  // A land wall down the middle, a little left, splits the plot in two.
  const split = computeCoverage(
    [-300, -150, 0, 150, 300].map((y) => ({ x: -100, y, range: 120, land: true, air: false })),
    plot,
  );

  it("leads with the figures and lists each hatched layer's largest dead zones", () => {
    const onShowPoint = vi.fn();
    const { panel, element } = mount({ onShowPoint });
    panel.showCoverage(split, { land: true, air: true });

    expect(element.querySelector(".panel__title")?.textContent).toBe("Coverage");
    expect(element.querySelector(".planner-inspector__heading")?.textContent).toMatch(
      /^Land \d+% · Air 0% of the yard is within reach of a tower\.$/,
    );
    const land = element.querySelectorAll(".planner-inspector__dead--land .planner-inspector__dead-zone");
    expect(land).toHaveLength(2);
    // Air has no tower at all: one zone, the whole plot.
    expect(element.querySelector(".planner-inspector__dead--air li")?.textContent).toContain(
      "100% of the yard",
    );

    land[0]!.querySelector<HTMLButtonElement>(".planner-inspector__show")!.click();
    expect(onShowPoint).toHaveBeenCalledWith(split.land.deadZones[0]!.at);
  });

  it("lists only the layers the overlay hatches", () => {
    const { panel, element } = mount();
    panel.showCoverage(split, { land: true, air: false });
    expect(element.querySelector(".planner-inspector__dead--land")).not.toBeNull();
    expect(element.querySelector(".planner-inspector__dead--air")).toBeNull();
  });

  it("says when a layer is fully covered, and when there are no towers", () => {
    const { panel, element } = mount();
    panel.showCoverage(computeCoverage([{ x: 0, y: 0, range: 700, land: true, air: true }], plot), {
      land: true,
      air: false,
    });
    expect(element.querySelector(".planner-inspector__dead--land")?.textContent).toContain(
      "None: every part of the yard is in reach.",
    );

    panel.showCoverage(computeCoverage([], plot), { land: true, air: true });
    expect(element.textContent).toContain("No towers placed, so there is nothing to cover.");
  });

  it("names a sliver as under 1%, and counts what is not listed", () => {
    const { panel, element } = mount();
    // A 5 x 4 grid of small circles leaves a sliver wherever four meet.
    const towers = [-400, -200, 0, 200, 400].flatMap((x) =>
      [-300, -100, 100, 300].map((y) => ({ x, y, range: 110, land: true, air: false })),
    );
    const slivers = computeCoverage(towers, plot);
    panel.showCoverage(slivers, { land: true, air: false });
    const zones = slivers.land.deadZones.length;
    expect(zones).toBeGreaterThan(3);
    expect(element.querySelectorAll(".planner-inspector__dead-zone")).toHaveLength(3);
    expect(element.querySelector(".planner-inspector__dead-zone")?.textContent).toContain(
      "Under 1% of the yard",
    );
    expect(element.querySelector(".planner-inspector__dead--land")?.textContent).toContain(
      `${zones - 3} smaller ones are hatched on the yard.`,
    );
  });
});
