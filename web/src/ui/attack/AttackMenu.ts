/**
 * The attack's overflow menu on a phone (`docs/design/attack-flow.md` §4.3,
 * #151): the HUD gives way to the strip there, and this is where its screen
 * buttons and Log out went. A button in the strip opens a short list under
 * it; the stylesheet hides the whole thing on wider screens, where the HUD is
 * still up.
 *
 * It only reports which item was picked. Leaving a running attack goes
 * through the scene's Retreat confirmation, not through here.
 */

export interface AttackMenuItem {
  readonly label: string;
  readonly run: () => void;
}

export class AttackMenu {
  /** The strip's button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  private readonly button: HTMLButtonElement;
  private readonly list: HTMLElement;

  constructor(items: readonly AttackMenuItem[]) {
    this.element = document.createElement("div");
    this.element.className = "attack-menu";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "btn attack-menu__button";
    this.button.textContent = "☰";
    this.button.title = "Map, Yard and Log out";
    this.button.setAttribute("aria-label", "Menu");
    this.button.setAttribute("aria-haspopup", "true");
    this.button.setAttribute("aria-expanded", "false");
    this.button.addEventListener("click", () => this.toggle(this.list.hidden));

    this.list = document.createElement("div");
    this.list.className = "attack-menu__list";
    this.list.setAttribute("role", "menu");
    this.list.hidden = true;
    for (const item of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "btn btn--ghost attack-menu__item";
      row.setAttribute("role", "menuitem");
      row.textContent = item.label;
      row.addEventListener("click", () => {
        this.toggle(false);
        item.run();
      });
      this.list.append(row);
    }

    this.element.append(this.button, this.list);
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    this.element.remove();
  }

  private toggle(open: boolean): void {
    this.list.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
  }

  /** A press anywhere else, or Escape, closes the list. */
  private readonly dismiss = (event: Event): void => {
    if (this.list.hidden) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      this.toggle(false);
      this.button.focus();
      return;
    }
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.toggle(false);
  };
}

/**
 * What the phone sheet's handle says: the panel the sheet is showing, so it
 * reads "Catapult" over the Catapult and the building's name over its info,
 * and "Army" otherwise. Reads the dock's own mode classes (`attack-dock--info`
 * from the scene, `attack-dock--picker` from the drop plugin).
 */
export const sheetHandleLabel = (dock: HTMLElement): string => {
  const shown = dock.classList.contains("attack-dock--info")
    ? dock.querySelector(".attack-info .panel__title")
    : dock.classList.contains("attack-dock--picker")
      ? dock.querySelector(".attack-picker .panel__title")
      : null;
  return shown?.textContent?.trim() || "Army";
};
