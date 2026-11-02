import { tutTarget, TUT_FOLD_ATTRIBUTE, TutTarget } from "@/game/guide/targets";
import { icon } from "@/ui/icons";
import "@/ui/styles/bubble-menu.css";
import { menuBadgeLabel, menuBadgeText } from "./YardMenu";

/**
 * The bubble menu (the owner's idea, beta 6 desk sample): one round "More"
 * button on the yard's bottom row whose hover (a mouse) or tap fans Layout,
 * Goals, Alerts, Defences and Mail out of it as bubbles, so the bottom row is
 * just More, Monsters and Build. More's badge adds up the badges inside it.
 *
 * The buttons themselves move into the fan, not copies, as the phone's Menu
 * does (`YardMenu`), so each keeps its own badge, its press and Bob's
 * pointer name; a pointer at one while the fan is shut points at More. A
 * button another file puts in the dock later (Mail, the bell, Goals,
 * Defences) is gathered as it arrives.
 *
 * On a phone held upright More stands above Build, where Layout stood. On a
 * phone on its side the yard's round buttons are all in the Menu sheet, so
 * the fan lets its buttons go back to the dock and the Menu folds them in.
 *
 * Behind a switch: `BUBBLE_MENU`, or `localStorage` `bymr.bubbleMenu` set to
 * "off" or "on" on this browser.
 */

/** The switch: the bubble menu on (true) or the old bottom row (false). */
export const BUBBLE_MENU = true;

/** This browser's own setting, "on" or "off", over `BUBBLE_MENU`. */
export const BUBBLE_MENU_KEY = "bymr.bubbleMenu";

/**
 * The buttons in the fan by their `data-dock` name, the one nearest More
 * first. A new one (Quests, later) only needs its name here, and its button
 * put in the dock.
 */
export const BUBBLE_ITEMS: readonly string[] = ["layout", "goals", "bell", "defences", "mail"];

/** Where the fan lets its buttons go to the Menu sheet: a phone on its side. */
export const UNWRAP_QUERY = "(width > 620px) and (height <= 500px)";

/** How long the mouse rests on More before the fan opens, and off it before it shuts. */
const HOVER_OPEN_MS = 90;
const HOVER_CLOSE_MS = 320;
/** How long the shutting fan takes to fold away, the longest bubble's delay included. */
const CLOSE_MS = 340;

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Whether the yard uses the bubble menu: this browser's setting, else the switch. */
export const bubbleMenuOn = (
  store: Storage | null = storage(),
  fallback: boolean = BUBBLE_MENU,
): boolean => {
  let saved: string | null = null;
  try {
    saved = store?.getItem(BUBBLE_MENU_KEY) ?? null;
  } catch {
    saved = null;
  }
  if (saved === "off") return false;
  if (saved === "on") return true;
  return fallback;
};

export interface BubbleMenuOptions {
  /** Where More sits and where the buttons go back to: the dock's right-hand box. */
  readonly host: HTMLElement;
  /** Where to look for the buttons, wherever they are now: the whole dock. */
  readonly scope: HTMLElement;
  /** The phone-on-its-side test; `matchMedia(UNWRAP_QUERY)` by default, none where there is no window. */
  readonly media?: MediaQueryList | null;
}

export class BubbleMenu {
  /** More and its fan, one box on the bottom row. */
  readonly element: HTMLElement;
  /** More's round button. */
  readonly button: HTMLButtonElement;

  private readonly options: BubbleMenuOptions;
  private readonly fan: HTMLElement;
  private readonly badge: HTMLElement;
  private readonly media: MediaQueryList | null;
  private readonly scopeWatch: MutationObserver | null;
  private readonly fanWatch: MutationObserver | null;
  private active = false;
  private open = false;
  /** Opened by a press, not the mouse resting on it: stays open when the mouse leaves. */
  private pinned = false;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private foldTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BubbleMenuOptions) {
    this.options = options;

    this.element = document.createElement("div");
    this.element.className = "bubble-menu";

    this.button = document.createElement("button");
    this.button.type = "button";
    this.button.className = "yard-dock__button yard-dock__button--more";
    this.button.dataset["dock"] = "more";
    tutTarget(this.button, TutTarget.DOCK_MORE);
    this.button.title = "Layout, Goals, Alerts, Defences and Mail";
    this.button.setAttribute("aria-expanded", "false");
    const disc = document.createElement("span");
    disc.className = "yard-dock__disc";
    this.badge = document.createElement("span");
    this.badge.className = "yard-dock__badge bubble-menu__badge";
    this.badge.hidden = true;
    disc.append(icon("more", 29), this.badge);
    const label = document.createElement("span");
    label.className = "yard-dock__label";
    label.textContent = "More";
    this.button.append(disc, label);

    this.fan = document.createElement("div");
    this.fan.className = "bubble-menu__fan";
    this.fan.id = `bubble-menu-${Math.random().toString(36).slice(2, 8)}`;
    this.fan.setAttribute("role", "group");
    this.fan.setAttribute("aria-label", "More");
    this.fan.hidden = true;
    // A pointer at a button in here points at More while the fan is shut.
    this.fan.setAttribute(TUT_FOLD_ATTRIBUTE, TutTarget.DOCK_MORE);
    this.button.setAttribute("aria-controls", this.fan.id);
    this.element.append(this.button, this.fan);
    options.host.append(this.element);

    this.button.addEventListener("click", () => {
      if (this.open && this.pinned) this.setOpen(false);
      else this.setOpen(true, true);
    });
    // A press on a bubble does its job and puts the fan away.
    this.fan.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".yard-dock__button")) this.setOpen(false);
    });
    this.element.addEventListener("pointerenter", this.onPointerEnter);
    this.element.addEventListener("pointerleave", this.onPointerLeave);

    this.scopeWatch =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => this.gather());
    this.scopeWatch?.observe(options.scope, { childList: true, subtree: true });
    this.fanWatch =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => this.refresh());
    this.fanWatch?.observe(this.fan, {
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
          : (window.matchMedia?.(UNWRAP_QUERY) ?? null);
    this.media?.addEventListener?.("change", this.onMediaChange);
    document.addEventListener("pointerdown", this.onOutsidePress, true);
    window.addEventListener("keydown", this.onKeyDown);
    this.setActive(this.media?.matches !== true);
  }

  /** Whether the buttons are in the fan (not a phone on its side). */
  get isActive(): boolean {
    return this.active;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The buttons in the fan now, nearest More first. */
  get items(): HTMLElement[] {
    return [...this.fan.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
  }

  /** Gathers the buttons into the fan, or lets them go back to the dock (a phone on its side). */
  setActive(active: boolean): void {
    this.active = active;
    if (active) {
      this.gather();
    } else {
      this.setOpen(false);
      for (const item of this.items) this.options.host.append(item);
    }
    this.refresh();
  }

  /** Opens or shuts the fan; `pinned` for a press, which the mouse leaving does not undo. */
  setOpen(open: boolean, pinned = false): void {
    this.clearHover();
    const shown = open && this.active && this.visibleItems().length > 0;
    this.pinned = shown && pinned;
    if (shown === this.open) return;
    this.open = shown;
    this.button.setAttribute("aria-expanded", String(shown));
    this.button.classList.toggle("yard-dock__button--on", shown);
    if (this.foldTimer !== null) clearTimeout(this.foldTimer);
    this.foldTimer = null;
    if (shown) {
      this.fan.hidden = false;
      // Lay the bubbles out folded first, so they fly out of More.
      void this.fan.offsetWidth;
      this.element.classList.add("bubble-menu--open");
    } else {
      this.element.classList.remove("bubble-menu--open");
      if (this.fan.contains(document.activeElement)) this.button.focus();
      this.foldTimer = setTimeout(() => {
        this.foldTimer = null;
        if (!this.open) this.fan.hidden = true;
      }, CLOSE_MS);
    }
  }

  destroy(): void {
    this.clearHover();
    if (this.foldTimer !== null) clearTimeout(this.foldTimer);
    this.scopeWatch?.disconnect();
    this.fanWatch?.disconnect();
    this.media?.removeEventListener?.("change", this.onMediaChange);
    document.removeEventListener("pointerdown", this.onOutsidePress, true);
    window.removeEventListener("keydown", this.onKeyDown);
    this.element.remove();
  }

  /** Moves the fan's buttons in from wherever they are in the dock, in the list's order. */
  private gather(): void {
    if (!this.active) return;
    const wanted: HTMLElement[] = [];
    for (const name of BUBBLE_ITEMS) {
      const found = this.options.scope.querySelector<HTMLElement>(
        `.yard-dock__button[data-dock="${CSS.escape(name)}"]`,
      );
      if (found && found !== this.button) wanted.push(found);
    }
    const current = this.items;
    const inOrder =
      wanted.length === current.length &&
      wanted.every((element, index) => current[index] === element);
    if (!inOrder) this.fan.append(...wanted);
  }

  private visibleItems(): HTMLElement[] {
    return this.items.filter((item) => !item.hidden);
  }

  /** Each shown bubble's place in the fan, More's total, and More itself only while it holds something. */
  private refresh(): void {
    const visible = this.visibleItems();
    visible.forEach((item, index) => item.style.setProperty("--bubble-k", String(index + 1)));
    this.element.style.setProperty("--bubble-count", String(visible.length));
    this.element.hidden = !this.active || visible.length === 0;
    if (this.element.hidden && this.open) this.setOpen(false);

    const badges = [...this.fan.querySelectorAll<HTMLElement>(".yard-dock__badge")].map(
      (badge) => ({
        hidden: this.hiddenInFan(badge),
        text: badge.textContent ?? "",
      }),
    );
    const text = this.active ? menuBadgeText(badges) : null;
    this.badge.hidden = text === null;
    this.badge.textContent = text ?? "";
    this.button.setAttribute("aria-label", text ? `More. ${menuBadgeLabel(text)}` : "More");
  }

  /** Whether a badge or the button it is on is hidden; the shut fan does not count. */
  private hiddenInFan(element: HTMLElement): boolean {
    for (let at: HTMLElement | null = element; at && at !== this.fan; at = at.parentElement) {
      if (at.hidden) return true;
    }
    return false;
  }

  private clearHover(): void {
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
  }

  private readonly onPointerEnter = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    this.clearHover();
    if (this.open) return;
    this.hoverTimer = setTimeout(() => this.setOpen(true), HOVER_OPEN_MS);
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== "mouse") return;
    this.clearHover();
    if (!this.open || this.pinned) return;
    this.hoverTimer = setTimeout(() => this.setOpen(false), HOVER_CLOSE_MS);
  };

  private readonly onOutsidePress = (event: PointerEvent): void => {
    if (!this.open) return;
    const target = event.target instanceof Node ? event.target : null;
    if (target && this.element.contains(target)) return;
    this.setOpen(false);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && this.open) this.setOpen(false);
  };

  private readonly onMediaChange = (): void => this.setActive(this.media?.matches !== true);
}
