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
 * What the phone sheet's handle says when the dock has no tab row (a replay,
 * a defence replay): the name of the window it holds ("Replay"; a Baiter
 * test's replay, its bar's name, "Test replay"), or "Army"
 * before any is mounted. A live attack's sheet has its tab row instead
 * (`DockTabs`, owner 18 Nov 2026), whose tabs name the windows.
 */
export const sheetHandleLabel = (dock: HTMLElement): string => {
  const shown = dock.querySelector(".attack-army .panel__title") ?? dock.querySelector(".panel .panel__title");
  // A Baiter test's replay holds only the test's bar, which has no title plate: its name.
  const bar = dock.querySelector(".baiter-dock")?.getAttribute("aria-label");
  return shown?.textContent?.trim() || bar?.trim() || "Army";
};
