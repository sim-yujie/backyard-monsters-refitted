/**
 * The attack dock's tab row (owner, Review Desk 18 Nov 2026, proposal A):
 * one pinned row [Army | Catapult | Siege] at the top of the dock. On an
 * upright phone it is the bottom sheet's handle, in sight with the sheet
 * closed; on wider screens it heads the dock column. It never scrolls, so
 * the Catapult is one tap away however long the army list is, and the tab
 * is the window's title (the windows under it show none of their own).
 *
 * Only the tabs that apply are there: the army package adds Army, the drop
 * package adds Catapult and the siege weapon. A screen whose dock holds no
 * tabbed window (a replay, a raid) never shows the row.
 *
 * A window belongs to a tab through `data-dock-tab` on its element
 * ({@link DockTabs.claim}); the stylesheet shows only the selected tab's
 * windows (`attack.css`, `.attack-dock[data-tab]`). Switching tabs only hides
 * and shows: nothing is closed, so a bomb armed on the Catapult stays armed
 * while the player looks at the Army (owner, 18 Nov).
 *
 * On a phone, tapping a tab opens the sheet on it and tapping the open tab
 * closes the sheet. On the side column the dock is always open: a tab tap
 * shows that tab.
 */

export type DockTabId = "army" | "catapult" | "siege";

/** The row's order, whatever order the packages add their tabs in. */
const ORDER: readonly DockTabId[] = ["army", "catapult", "siege"];

export interface DockTabsHost {
  /** The `.attack-dock` element: its `data-tab` and open class are kept here. */
  readonly dock: HTMLElement;
  /** Whether the dock is the phone's bottom sheet right now (it can close). */
  readonly sheet: () => boolean;
  /** After every change of tab or of open/closed, so the scene re-measures. */
  readonly onChange: () => void;
}

export interface DockTabOptions {
  /** The words on the tab. Keep them short. */
  readonly label: string;
  /** The tooltip (a keyboard key, the full name). */
  readonly title?: string;
  /** Called each time the tab is shown, before the change is reported (a package mounts its window lazily here). */
  readonly onShow?: () => void;
}

export interface DockTab {
  readonly button: HTMLButtonElement;
  /** Lights the tab while its tool waits for a tap on the yard. */
  setArmed(armed: boolean): void;
  setLabel(label: string): void;
  /** Takes the tab off the row (a package's teardown). */
  remove(): void;
}

interface Entry {
  readonly id: DockTabId;
  readonly button: HTMLButtonElement;
  readonly onShow: (() => void) | undefined;
}

export class DockTabs {
  /** The row, a tab list; the scene puts it above the dock's scrolling body. */
  readonly element: HTMLElement;

  private readonly host: DockTabsHost;
  private readonly entries = new Map<DockTabId, Entry>();
  private selected: DockTabId = "army";
  private open = false;

  constructor(host: DockTabsHost) {
    this.host = host;
    this.element = document.createElement("div");
    this.element.className = "attack-tools attack-dock__tabs";
    this.element.setAttribute("role", "tablist");
    this.element.setAttribute("aria-label", "Army and tools");
    this.element.hidden = true;
    this.sync();
  }

  /** Adds a tab; the first one added is the one shown until another is picked. */
  add(id: DockTabId, options: DockTabOptions): DockTab {
    this.entries.get(id)?.button.remove();
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn attack-tools__button attack-dock__tab";
    button.setAttribute("role", "tab");
    button.dataset["tab"] = id;
    button.textContent = options.label;
    if (options.title) button.title = options.title;
    button.addEventListener("click", () => this.press(id));
    const entry: Entry = { id, button, onShow: options.onShow };
    this.entries.set(id, entry);
    // Kept in Army, Catapult, Siege order.
    const after = ORDER.slice(ORDER.indexOf(id) + 1)
      .map((later) => this.entries.get(later)?.button)
      .find((later): later is HTMLButtonElement => later !== undefined && later !== button);
    this.element.insertBefore(button, after ?? null);
    if (!this.entries.has(this.selected)) this.selected = id;
    this.sync();
    return {
      button,
      setArmed: (armed) => button.classList.toggle("attack-tools__button--armed", armed),
      setLabel: (label) => {
        if (button.textContent !== label) button.textContent = label;
      },
      remove: () => {
        if (this.entries.get(id)?.button !== button) return;
        this.entries.delete(id);
        button.remove();
        if (this.selected === id) this.selected = this.entries.has("army") ? "army" : [...this.entries.keys()][0] ?? "army";
        this.sync();
        this.host.onChange();
      },
    };
  }

  /** Marks a window as belonging to a tab: shown only while that tab is. */
  claim(id: DockTabId, element: HTMLElement): void {
    element.dataset["dockTab"] = id;
  }

  has(id: DockTabId): boolean {
    return this.entries.has(id);
  }

  /** The tab the dock shows (or would show, with the sheet closed). */
  current(): DockTabId {
    return this.selected;
  }

  /** Whether the dock's windows are in sight: the sheet is open, or the dock is a column. */
  showing(): boolean {
    return this.open || !this.host.sheet();
  }

  isOpen(): boolean {
    return this.open;
  }

  /**
   * A tap on a tab: on the sheet, the open tab closes it and any other tab
   * opens it there; on the column it shows that tab.
   */
  press(id: DockTabId): void {
    if (!this.entries.has(id)) return;
    if (this.host.sheet() && this.open && this.selected === id) {
      this.setOpen(false);
      return;
    }
    this.show(id);
  }

  /**
   * A keyboard shortcut (B, S): opens the tab, or, when it is already up,
   * goes back to the Army (the column) or closes the sheet.
   */
  key(id: DockTabId): void {
    if (!this.entries.has(id)) return;
    if (this.showing() && this.selected === id) {
      if (this.host.sheet()) this.setOpen(false);
      else if (this.entries.has("army")) this.show("army");
      return;
    }
    this.show(id);
  }

  /** Shows a tab and opens the sheet on it. */
  show(id: DockTabId): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const changed = this.selected !== id;
    this.selected = id;
    this.open = true;
    entry.onShow?.();
    this.sync();
    if (changed) this.scrollTop();
    this.host.onChange();
  }

  /** Opens or closes the sheet on the selected tab. */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) this.entries.get(this.selected)?.onShow?.();
    this.sync();
    this.host.onChange();
  }

  /** Re-reads whether the dock is a sheet (the screen turned): the selection marks follow. */
  refresh(): void {
    this.sync();
  }

  destroy(): void {
    this.entries.clear();
    this.element.remove();
  }

  /**
   * A newly shown tab starts at its top, not where the last one was scrolled
   * to: the dock, its body, and the shown windows' own scrolling bodies.
   */
  private scrollTop(): void {
    const dock = this.host.dock;
    const scrollers = [
      dock,
      ...dock.querySelectorAll<HTMLElement>(
        `.attack-dock__body, .attack-dock__body > [data-dock-tab="${this.selected}"] .panel__body`,
      ),
    ];
    for (const scroller of scrollers) scroller.scrollTop = 0;
  }

  private sync(): void {
    const dock = this.host.dock;
    const any = this.entries.size > 0;
    this.element.hidden = !any;
    dock.classList.toggle("attack-dock--tabs", any);
    if (any) dock.dataset["tab"] = this.selected;
    else delete dock.dataset["tab"];
    dock.classList.toggle("attack-dock--open", this.open);
    const showing = this.showing();
    for (const entry of this.entries.values()) {
      const on = showing && entry.id === this.selected;
      entry.button.setAttribute("aria-selected", String(on));
    }
  }
}
