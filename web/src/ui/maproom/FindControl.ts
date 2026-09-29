import { button, el, icon } from "@/ui/maproom1/icons";
import type { NavPanel } from "./NavPanel";

/**
 * "Find" (#176, R-MR2-Map-A): one button in the corner where the Navigate
 * panel used to stand open. It opens that panel — home and outposts, a jump
 * to coordinates, the bookmarks, the world map — and closes it again, so the
 * map is clear until the player wants to go somewhere.
 */

export class FindControl {
  readonly element: HTMLElement;

  private readonly toggle: HTMLButtonElement;
  private readonly sheet: HTMLElement;
  private open = false;

  constructor(
    private readonly nav: NavPanel,
    private readonly onOpenChange: (open: boolean) => void = () => {},
  ) {
    this.element = el("div", "mr2-find");

    this.toggle = button("mr2-tool mr2-find__button");
    this.toggle.setAttribute("aria-expanded", "false");
    this.toggle.setAttribute("aria-label", "Find a place: coordinates, bookmarks");
    this.toggle.append(
      icon("search", 20, "map-icon"),
      el("span", "mr2-tool__label", "Find"),
      el("span", "mr2-find__hint", "coordinates, bookmarks"),
      el("span", "mr2-find__phone-label", "Find a place"),
    );
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));

    const close = button("btn btn--ghost btn--icon");
    close.setAttribute("aria-label", "Close");
    close.append(icon("close", 16, "map-icon"));
    close.addEventListener("click", () => {
      this.setOpen(false);
      this.toggle.focus();
    });
    nav.titlebar.append(close);

    this.sheet = el("div", "mr2-find__sheet");
    this.sheet.id = `find-sheet-${Math.random().toString(36).slice(2, 8)}`;
    this.toggle.setAttribute("aria-controls", this.sheet.id);
    this.sheet.hidden = true;
    nav.mount(this.sheet);
    this.sheet.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.setOpen(false);
      this.toggle.focus();
    });

    this.element.append(this.sheet, this.toggle);
  }

  get isOpen(): boolean {
    return this.open;
  }

  mount(container: HTMLElement): this {
    container.append(this.element);
    return this;
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.sheet.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    this.element.classList.toggle("mr2-find--open", open);
    this.onOpenChange(open);
  }

  destroy(): void {
    this.nav.destroy();
    this.element.remove();
  }
}
