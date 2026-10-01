import "@/ui/styles/tips.css";

/**
 * The "?" that brings a screen's tips back (issue #227,
 * `docs/design/tutorial.md` §7.1).
 *
 * In a screen's title row it sits just before the close button, sized like
 * it. A screen with no title row (the yard, Map Room 2) gets a small round one
 * floating at the top left, under the HUD. The attack strip has no room for
 * it on a phone, so there it is a "Bob's tips" item in the strip's menu. Either way it only calls back:
 * the tip runner decides what to replay, and replaying never marks anything
 * seen.
 */

/**
 * Where the button lives: in a title row, floating over the screen, or as an
 * item of a title row's overflow menu (the attack strip's, on a phone).
 */
export type HelpButtonPlace = "header" | "float" | "menu";

const CLASS_NAMES: Record<HelpButtonPlace, string> = {
  header: "btn btn--ghost btn--icon guide-help",
  float: "guide-help guide-help--float",
  menu: "btn btn--ghost attack-menu__item guide-help guide-help--menu",
};

export class HelpButton {
  readonly element: HTMLButtonElement;
  readonly place: HelpButtonPlace;

  constructor(place: HelpButtonPlace, onClick: () => void) {
    this.place = place;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = CLASS_NAMES[place];
    if (place === "menu") {
      this.element.textContent = "Bob's tips";
      this.element.setAttribute("role", "menuitem");
    } else {
      this.element.textContent = "?";
      this.element.setAttribute("aria-label", "Show Bob's tips for this screen");
      this.element.title = "Bob's tips";
    }
    this.element.addEventListener("click", (event) => {
      // A title row's own handlers (dragging a panel, say) never see it.
      event.stopPropagation();
      // The menu closes, as after any of its own items: its own button toggles it.
      if (place === "menu") {
        this.element.closest(".attack-menu")?.querySelector<HTMLElement>(".attack-menu__button")?.click();
      }
      onClick();
    });
  }

  /**
   * Puts the button in `host`: before the close button of a title row, or at
   * the end of anything else.
   */
  attach(host: HTMLElement): this {
    if (this.place === "header") {
      // "Close", "Close Build", …: the last such button in the row.
      const close = [...host.querySelectorAll<HTMLElement>(":scope > button[aria-label^='Close']")].at(-1);
      if (close) host.insertBefore(this.element, close);
      else host.append(this.element);
    } else {
      host.append(this.element);
    }
    return this;
  }

  get attached(): boolean {
    return this.element.isConnected;
  }

  /** Hidden while the guided start runs (Bob is already talking). */
  setHidden(hidden: boolean): void {
    this.element.hidden = hidden;
  }

  remove(): void {
    this.element.remove();
  }
}
