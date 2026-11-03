import { percentText, type Coverage, type DeadZone } from "@/game/yard/planner/coverage";
import { Panel } from "@/ui/Panel";

/**
 * The planner's coverage panel (#55): with nothing selected and View › Dead
 * zones on, the coverage figures and the largest dead zones, each with a Show
 * button that pans to it.
 *
 * This used to be one view of the building inspector, which also showed one
 * selected building's upgrade ladder and a multi-selection's plan. Per-building
 * upgrade planning was removed from Layout on 2026-11-03 (owner: nothing may
 * open over the yard while a building is picked up or moved, and there should
 * be no way to queue upgrades at once), so selecting a building opens nothing
 * and this view is all that is left. Its CSS classes keep the old
 * `planner-inspector__` names.
 */

export interface CoveragePanelOptions {
  onClose: () => void;
  /** Pans to a yard point: a dead zone's Show button (#55). */
  onShowPoint?: (point: { readonly x: number; readonly y: number }) => void;
}

/** How many dead zones the coverage view lists per layer (#55). */
export const DEAD_ZONES_LISTED = 3;

export class CoveragePanel {
  readonly element: HTMLElement;

  private readonly panel: Panel;
  private readonly options: CoveragePanelOptions;

  constructor(options: CoveragePanelOptions) {
    this.options = options;
    this.panel = new Panel({
      title: "Coverage",
      className: "map-panel planner-inspector planner-coverage",
      onClose: options.onClose,
    });
    this.element = this.panel.element;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  close(): void {
    this.panel.close();
  }

  /**
   * The coverage
   * figures and, for each layer the overlay hatches, the largest dead zones
   * with a Show button that pans to each (design §4.4, "the three worst dead
   * zones").
   */
  showCoverage(coverage: Coverage, layers: { readonly land: boolean; readonly air: boolean }): void {
    this.panel.setTitle("Coverage");
    if (coverage.towers === 0) {
      this.panel.setContent(note("No towers placed, so there is nothing to cover."));
      return;
    }

    const lead = document.createElement("p");
    lead.className = "planner-inspector__heading";
    lead.textContent = `Land ${percentText(coverage.land.share)} · Air ${percentText(coverage.air.share)} of the yard is within reach of a tower.`;

    const sections: HTMLElement[] = [];
    for (const [key, name, layer] of [
      ["land", "Land", coverage.land],
      ["air", "Air", coverage.air],
    ] as const) {
      if (!layers[key]) continue;
      sections.push(this.deadZoneList(key, name, layer.deadZones));
    }
    this.panel.setContent(lead, ...sections);
  }

  private deadZoneList(key: string, name: string, zones: readonly DeadZone[]): HTMLElement {
    const section = document.createElement("section");
    section.className = `planner-inspector__dead planner-inspector__dead--${key}`;
    const heading = document.createElement("h3");
    heading.className = "planner-inspector__dead-title";
    heading.textContent = `${name} dead zones`;
    section.append(heading);

    if (zones.length === 0) {
      section.append(note("None: every part of the yard is in reach."));
      return section;
    }

    const list = document.createElement("ol");
    list.className = "planner-inspector__dead-list";
    for (const zone of zones.slice(0, DEAD_ZONES_LISTED)) {
      const item = document.createElement("li");
      item.className = "planner-inspector__dead-zone";
      const size = document.createElement("span");
      // A sliver rounds down to 0%, which would read as nothing at all.
      size.textContent = zone.share < 0.01 ? "Under 1% of the yard" : `${percentText(zone.share)} of the yard`;
      const show = document.createElement("button");
      show.type = "button";
      show.className = "btn btn--ghost planner-inspector__show";
      show.textContent = "Show";
      show.setAttribute("aria-label", `Show this ${name.toLowerCase()} dead zone`);
      show.addEventListener("click", () => this.options.onShowPoint?.(zone.at));
      item.append(size, show);
      list.append(item);
    }
    section.append(list);
    if (zones.length > DEAD_ZONES_LISTED) {
      section.append(note(`${zones.length - DEAD_ZONES_LISTED} smaller ones are hatched on the yard.`));
    }
    return section;
  }
}

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "planner-inspector__note u-muted";
  element.textContent = text;
  return element;
};
