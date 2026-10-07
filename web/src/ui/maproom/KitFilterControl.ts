import { KitFilter } from "@/game/maproom/cellVisuals";
import { button, el } from "@/ui/maproom1/icons";

/**
 * The kit filter (#334): five buttons near the map's other controls - All, No
 * kit, Regular, Mega, Ultra. Picking one keeps the viewer's own outposts
 * wearing that kit bright and dims every other cell on the map; All dims
 * nothing. A view only, same split as `RangeControl`: this says which filter
 * is active, the scene tells the renderer what that means.
 */

export interface KitFilterControlOptions {
  readonly onFilterChange: (filter: KitFilter) => void;
}

const OPTIONS: { filter: KitFilter; label: string }[] = [
  { filter: KitFilter.ALL, label: "All" },
  { filter: KitFilter.NONE, label: "No kit" },
  { filter: KitFilter.REGULAR, label: "Regular" },
  { filter: KitFilter.MEGA, label: "Mega" },
  { filter: KitFilter.ULTRA, label: "Ultra" },
];

export class KitFilterControl {
  /** Goes beside the other map controls. */
  readonly element: HTMLElement;

  private readonly buttons = new Map<KitFilter, HTMLButtonElement>();
  private active: KitFilter = KitFilter.ALL;

  constructor(private readonly options: KitFilterControlOptions) {
    this.element = el("div", "mr2-kit-filter");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Filter outposts by Starter Kit");

    for (const { filter, label } of OPTIONS) {
      const option = button("mr2-kit-filter__option", label);
      option.addEventListener("click", () => this.set(filter));
      this.buttons.set(filter, option);
      this.element.append(option);
    }
    this.render();
  }

  get value(): KitFilter {
    return this.active;
  }

  /** Sets the active filter without telling the scene, for its first state. */
  setFilter(filter: KitFilter): void {
    this.active = filter;
    this.render();
  }

  private set(filter: KitFilter): void {
    if (filter === this.active) return;
    this.active = filter;
    this.render();
    this.options.onFilterChange(filter);
  }

  private render(): void {
    for (const [filter, option] of this.buttons) {
      option.setAttribute("aria-pressed", String(filter === this.active));
    }
  }
}
