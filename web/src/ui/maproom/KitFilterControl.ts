import { KitFilter } from "@/game/maproom/cellVisuals";
import { button, el, icon } from "@/ui/maproom1/icons";

/**
 * The kit filter (#334): five buttons near the map's other controls - All, No
 * kit, Regular, Mega, Ultra. Picking one keeps the viewer's own outposts
 * wearing that kit bright and dims every other cell on the map; All dims
 * nothing. A view only, same split as `RangeControl`: this says which filter
 * is active, the scene tells the renderer what that means.
 *
 * On a phone the row is too wide beside Mail and My range (#381): it folds
 * into the Filter button (`toggle`, which the stylesheet shows only there),
 * and opens as a short list under it. Picking a kit, a press elsewhere or
 * Escape closes it again.
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
  /** The phone's Filter button; goes just before {@link element}. */
  readonly toggle: HTMLButtonElement;

  private readonly buttons = new Map<KitFilter, HTMLButtonElement>();
  private active: KitFilter = KitFilter.ALL;

  constructor(private readonly options: KitFilterControlOptions) {
    this.element = el("div", "mr2-kit-filter");
    this.element.setAttribute("role", "group");
    this.element.setAttribute("aria-label", "Filter outposts by Starter Kit");
    this.element.id = "mr2-kit-filter";

    for (const { filter, label } of OPTIONS) {
      const option = button("mr2-kit-filter__option", label);
      option.addEventListener("click", () => {
        this.set(filter);
        this.fold(false);
      });
      this.buttons.set(filter, option);
      this.element.append(option);
    }

    this.toggle = button("mr2-tool mr2-kit-filter__toggle");
    this.toggle.append(icon("filter", 20, "map-icon"), el("span", "mr2-tool__label", "Filter"));
    this.toggle.setAttribute("aria-controls", this.element.id);
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.addEventListener("click", () => this.fold(!this.open));
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
    this.render();
  }

  get value(): KitFilter {
    return this.active;
  }

  /** Whether the phone's list is open. */
  get open(): boolean {
    return this.element.classList.contains("mr2-kit-filter--open");
  }

  /** Sets the active filter without telling the scene, for its first state. */
  setFilter(filter: KitFilter): void {
    this.active = filter;
    this.render();
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
  }

  private set(filter: KitFilter): void {
    if (filter === this.active) return;
    this.active = filter;
    this.render();
    this.options.onFilterChange(filter);
  }

  private fold(open: boolean): void {
    this.element.classList.toggle("mr2-kit-filter--open", open);
    this.toggle.setAttribute("aria-expanded", String(open));
  }

  private render(): void {
    for (const [filter, option] of this.buttons) {
      option.setAttribute("aria-pressed", String(filter === this.active));
    }
    // Lit while a kit dims the map, so the folded filter is not forgotten.
    const label = OPTIONS.find((option) => option.filter === this.active)?.label ?? "All";
    this.toggle.classList.toggle("mr2-kit-filter__toggle--active", this.active !== KitFilter.ALL);
    this.toggle.setAttribute("aria-label", this.active === KitFilter.ALL ? "Filter" : `Filter: ${label}`);
    this.toggle.title = "Filter outposts by Starter Kit";
  }

  /** A press outside the button and the list, or Escape, closes the list. */
  private readonly dismiss = (event: Event): void => {
    if (!this.open) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      this.fold(false);
      return;
    }
    const target = event.target;
    if (target instanceof Node && (this.element.contains(target) || this.toggle.contains(target))) return;
    this.fold(false);
  };
}
