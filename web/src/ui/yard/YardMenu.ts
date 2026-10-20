import { tutTarget, TUT_FOLD_ATTRIBUTE, TutTarget } from "@/game/guide/targets";
import { icon } from "@/ui/icons";
import "@/ui/styles/yard-menu.css";

/**
 * The phone's one menu button (#381, direction 1): on a phone the yard keeps
 * only Build, Collect all, Friends and this Menu button along the bottom;
 * every other round button (Map, Mail, Monsters, Alerts, Goals, Defences,
 * Layout, the yard switcher, an outpost's Kits) moves into a grid on a sheet
 * that slides up from the bottom when Menu is pressed. A desktop keeps them
 * all where they were.
 *
 * The buttons themselves move, not copies, so each keeps its own badge, its
 * press and Bob's pointer name. A button another file puts in the dock later
 * (Mail, the bell, Goals) is moved too as it arrives. Menu's badge adds up
 * the counts on the buttons inside it, so nothing waiting is missed.
 */

/** The phone layout: upright by width, sideways by height (beta.3's rule). */
export const MENU_QUERY = "(width <= 620px), (height <= 500px)";

/** A badge's highest count before it shows "n+". */
const BADGE_MAX = 99;

/** What one badge in the menu shows. */
export interface MenuBadge {
  readonly hidden: boolean;
  readonly text: string;
}

/**
 * Menu's badge: the sum of the counts showing in it, "n+" when one of them is
 * already capped ("9+") or the sum passes 99; null when nothing is waiting. A
 * badge with no number counts as one.
 */
export const menuBadgeText = (badges: readonly MenuBadge[]): string | null => {
  let total = 0;
  let capped = false;
  for (const badge of badges) {
    const text = badge.text.trim();
    if (badge.hidden || text === "") continue;
    const count = Number.parseInt(text, 10);
    total += Number.isFinite(count) && count > 0 ? count : 1;
    if (text.endsWith("+")) capped = true;
  }
  if (total <= 0) return null;
  if (total > BADGE_MAX) return `${BADGE_MAX}+`;
  return capped ? `${total}+` : String(total);
};

/** The words for Menu's badge: "3 things are waiting". */
export const menuBadgeLabel = (text: string): string =>
  text === "1" ? "1 thing is waiting" : `${text} things are waiting`;

export interface YardMenuOptions {
  /** Where the folded buttons live on a desktop: the dock's left and right columns. */
  readonly sources: readonly HTMLElement[];
  /** Buttons that stay on the phone's bottom row: Build, Collect all, Menu itself. */
  readonly keep: (element: Element) => boolean;
  /** Wears `is-folded` while the buttons are in the menu, for the bottom row's places. */
  readonly host?: HTMLElement;
  /** The phone test; `matchMedia(MENU_QUERY)` by default, none where there is no window. */
  readonly media?: MediaQueryList | null;
}

export class YardMenu {
  /** Menu's round button, on the phone's bottom row. */
  readonly button: HTMLButtonElement;
  /** The sheet the grid sits on. */
  readonly sheet: HTMLElement;

  private readonly options: YardMenuOptions;
  private readonly grid: HTMLElement;
  private readonly badge: HTMLElement;
  /** Where each folded button came from, so a desktop gets it back in its place. */
  private readonly marks = new Map<Element, Comment>();
  private readonly media: MediaQueryList | null;
  private readonly sourceWatch: MutationObserver | null;
  private readonly gridWatch: MutationObserver | null;
  private folded = false;

  constructor(options: YardMenuOptions) {
    this.options = options;

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "yard-dock__button yard-dock__button--menu";
    this.button.dataset["dock"] = "menu";
    tutTarget(this.button, TutTarget.DOCK_MENU);
    this.button.setAttribute("aria-expanded", "false");
    this.button.setAttribute("aria-haspopup", "true");
    this.button.title = "Map, Mail, Monsters and the rest";
    this.button.hidden = true;
    const disc = document.createElement("span");
    disc.className = "yard-dock__disc";
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge yard-menu__badge";
    this.badge.hidden = true;
    disc.append(icon("menu", 29), this.badge);
    const label = document.createElement("span");
    label.className = "yard-dock__label";
    label.textContent = "Menu";
    this.button.append(disc, label);
    this.button.addEventListener("click", () => this.setOpen(this.sheet.hidden));

    this.sheet = document.createElement("div");
    this.sheet.className = "yard-menu";
    this.sheet.setAttribute("role", "dialog");
    this.sheet.setAttribute("aria-label", "Menu");
    this.sheet.hidden = true;
    // A pointer at a button folded in here points at Menu while the sheet is shut.
    this.sheet.setAttribute(TUT_FOLD_ATTRIBUTE, TutTarget.DOCK_MENU);
    const head = document.createElement("div");
    head.className = "yard-menu__head";
    const title = document.createElement("span");
    title.className = "yard-menu__title";
    title.textContent = "Menu";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "btn btn--ghost btn--icon yard-menu__close";
    close.setAttribute("aria-label", "Close the menu");
    close.append(icon("close", 20));
    close.addEventListener("click", () => this.setOpen(false));
    head.append(title, close);
    this.grid = document.createElement("div");
    this.grid.className = "yard-menu__grid";
    // A press on one of the buttons does its job and puts the menu away; the
    // yard switcher keeps it open while its list of yards is up.
    this.grid.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".yard-dock__button") || target.closest(".yard-switcher")) return;
      this.setOpen(false);
    });
    this.sheet.append(head, this.grid);

    this.sourceWatch =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.foldAll());
    for (const source of options.sources) this.sourceWatch?.observe(source, { childList: true });
    this.gridWatch =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => this.refreshBadge());
    this.gridWatch?.observe(this.grid, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden"],
    });

    this.media =
      options.media !== undefined
        ? options.media
        : typeof window === "undefined"
          ? null
          : (window.matchMedia?.(MENU_QUERY) ?? null);
    this.media?.addEventListener?.("change", this.onMediaChange);
    window.addEventListener("keydown", this.onKeyDown);
    this.setFolded(this.media?.matches === true);
  }

  /** Whether the buttons are in the menu (a phone). */
  get isFolded(): boolean {
    return this.folded;
  }

  get isOpen(): boolean {
    return !this.sheet.hidden;
  }

  /** Moves the buttons into the menu (a phone) or back to their places (a desktop). */
  setFolded(folded: boolean): void {
    this.folded = folded;
    this.button.hidden = !folded;
    this.options.host?.classList.toggle("is-folded", folded);
    if (folded) {
      this.foldAll();
    } else {
      this.setOpen(false);
      this.unfoldAll();
    }
    this.refreshBadge();
  }

  setOpen(open: boolean): void {
    const shown = open && this.folded;
    this.sheet.hidden = !shown;
    this.button.setAttribute("aria-expanded", String(shown));
    this.button.classList.toggle("yard-dock__button--on", shown);
  }

  /** Menu's badge, from the badges on the buttons inside it. */
  refreshBadge(): void {
    const badges = [...this.grid.querySelectorAll<HTMLElement>(".yard-dock__badge")]
      // The switcher's badge is how many outposts there are, not something waiting.
      .filter((badge) => !badge.closest(".yard-switcher"))
      .map((badge) => ({ hidden: this.hiddenInGrid(badge), text: badge.textContent ?? "" }));
    const text = this.folded ? menuBadgeText(badges) : null;
    this.badge.hidden = text === null;
    this.badge.textContent = text ?? "";
    this.button.setAttribute("aria-label", text ? `Menu. ${menuBadgeLabel(text)}` : "Menu");
  }

  destroy(): void {
    this.sourceWatch?.disconnect();
    this.gridWatch?.disconnect();
    this.media?.removeEventListener?.("change", this.onMediaChange);
    window.removeEventListener("keydown", this.onKeyDown);
    this.sheet.remove();
  }

  private readonly onMediaChange = (): void => this.setFolded(this.media?.matches === true);

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.isOpen) this.setOpen(false);
  };

  /** Whether a badge or the button it is on is hidden; the closed sheet does not count. */
  private hiddenInGrid(element: HTMLElement): boolean {
    for (let at: HTMLElement | null = element; at && at !== this.grid; at = at.parentElement) {
      if (at.hidden) return true;
    }
    return false;
  }

  private foldAll(): void {
    if (!this.folded) return;
    for (const source of this.options.sources) {
      for (const child of [...source.children]) {
        if (child === this.button || this.options.keep(child)) continue;
        const mark = document.createComment("menu");
        child.replaceWith(mark);
        this.marks.set(child, mark);
        this.grid.append(child);
      }
    }
  }

  private unfoldAll(): void {
    for (const child of [...this.grid.children]) {
      const mark = this.marks.get(child);
      if (mark?.isConnected) mark.replaceWith(child);
      // Put in while folded (the bell beside Mail): the right-hand buttons' box.
      else this.options.sources.at(-1)?.append(child);
    }
    for (const mark of this.marks.values()) mark.remove();
    this.marks.clear();
  }
}
