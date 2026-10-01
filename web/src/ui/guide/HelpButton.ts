import "@/ui/styles/tips.css";

/**
 * The "?" that brings a screen's tips back (issue #227,
 * `docs/design/tutorial.md` §7.1).
 *
 * In a screen's title row it sits just before the close button, sized like
 * it. A screen with no title row (the yard, Map Room 2) gets a small round one
 * floating at the top right, under the HUD. Either way it only calls back:
 * the tip runner decides what to replay, and replaying never marks anything
 * seen.
 */

/** Where the button lives: in a title row, or floating over the screen. */
export type HelpButtonPlace = "header" | "float";

export class HelpButton {
  readonly element: HTMLButtonElement;
  readonly place: HelpButtonPlace;

  constructor(place: HelpButtonPlace, onClick: () => void) {
    this.place = place;
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className =
      place === "header" ? "btn btn--ghost btn--icon guide-help" : "guide-help guide-help--float";
    this.element.textContent = "?";
    this.element.setAttribute("aria-label", "Show Bob's tips for this screen");
    this.element.title = "Bob's tips";
    this.element.addEventListener("click", (event) => {
      // A title row's own handlers (dragging a panel, say) never see it.
      event.stopPropagation();
      onClick();
    });
  }

  /**
   * Puts the button in `host`: before the close button of a title row (its
   * last button), or at the end of anything else.
   */
  attach(host: HTMLElement): this {
    if (this.place === "header") {
      const close = host.querySelector<HTMLElement>(":scope > button[aria-label='Close']");
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
