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
 * The fan replaces the phone's Menu (`YardMenu`): with it on, Map, Monsters
 * and the yard switcher stay on the screen on a phone too, and everything
 * else is in the fan. On a phone held upright the fan is one column up from
 * More; on a phone on its side, too short for a column, the bubbles stand in
 * rows of `GRID_COLUMNS` above More and to its right, where the screen is
 * empty (owner, beta 6), each word under its bubble.
 *
 * Wherever it opens, the fan first measures its room (`planFan`): from More
 * up to the top bar's foot, and to the screen's sides. A column that would
 * run up under the top bar (a 390x664 phone with Safari's bars, eight
 * bubbles: Mail, Alliance and Reports could not be pressed) stands in rows
 * instead, growing left from More, which sits on the right; rows that would
 * reach the top bar (a phone on its side) get wider so there are fewer of
 * them (old-layout fix, beta 9).
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
 * first (Quests, the owner's beta 6 priority). A new one only needs its name
 * here, and its button put in the dock.
 */
export const BUBBLE_ITEMS: readonly string[] = ["quests", "layout", "goals", "bell", "defences", "mail", "alliance", "reports"];

/** Where the fan lays its bubbles out in rows: a phone on its side, too short for one column. */
export const GRID_QUERY = "(min-width: 620.02px) and (max-height: 500px)";

/** Bubbles in one row of the sideways grid: as many as fit between More and the zoom rail. */
export const GRID_COLUMNS = 3;

/** Kept free between the fan and the top bar or the screen's side. */
const FAN_GAP = 8;

/** The fan's room, in px from the middle of More's disc. */
export interface FanRoom {
  /** Up to the top bar's foot. */
  readonly up: number;
  /** To the screen's left edge. */
  readonly left: number;
  /** To the screen's right edge. */
  readonly right: number;
}

/** The fan's sizes from bubble-menu.css, in px. */
export interface FanSizes {
  /** More's middle to the first bubble's middle, and bubble to bubble, in the column. */
  readonly columnStart: number;
  readonly columnStep: number;
  /** More's middle to the first row's middle, and row to row, in the rows. */
  readonly gridStart: number;
  readonly gridStep: number;
  /** One bubble's width in a row, its word under it. */
  readonly pitch: number;
  /** A bubble's disc. */
  readonly disc: number;
}

/** How the fan stands: one column, or rows `columns` wide. */
export interface FanPlan {
  readonly grid: boolean;
  readonly columns: number;
  /** Which way each row runs from More: 1 right (a phone on its side), -1 left. */
  readonly direction: 1 | -1;
  /** Bubbles' widths the rows are moved by (towards the room) from starting over More. */
  readonly offset: number;
}

/** The shape without measuring: the column, or on a phone on its side rows of three running right. */
export const defaultFanPlan = (sideways: boolean): FanPlan =>
  sideways
    ? { grid: true, columns: GRID_COLUMNS, direction: 1, offset: 0 }
    : { grid: false, columns: 1, direction: -1, offset: 0 };

/**
 * How `count` bubbles stand in `room` (null when it cannot be measured: the
 * default). Upright, the column when it fits under the top bar. Else rows:
 * the fewest columns (three or more) whose rows stay under the top bar, the
 * rows running right of More on a phone on its side (owner, beta 6) and left
 * of it otherwise (More is on the right), moved back over More when a side
 * is too narrow. When nothing fits, rows of three.
 */
export const planFan = (
  count: number,
  room: FanRoom | null,
  sizes: FanSizes,
  sideways: boolean,
): FanPlan => {
  const fallback = defaultFanPlan(sideways);
  if (!room || count < 1 || !Object.values(sizes).every((size) => Number.isFinite(size) && size > 0))
    return fallback;
  const half = sizes.disc / 2;
  if (!sideways && sizes.columnStart + (count - 1) * sizes.columnStep + half <= room.up) return fallback;
  const direction: 1 | -1 = sideways ? 1 : -1;
  const first = Math.min(GRID_COLUMNS, count);
  for (let columns = first; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    if (sizes.gridStart + (rows - 1) * sizes.gridStep + half > room.up) continue;
    for (let back = 0; back < columns; back += 1) {
      const offset = back === 0 ? 0 : -direction * back;
      const places = Array.from({ length: columns }, (_, column) => direction * column + offset);
      const leftmost = Math.min(...places);
      const rightmost = Math.max(...places);
      if ((0.5 - leftmost) * sizes.pitch <= room.left && (rightmost + 0.5) * sizes.pitch <= room.right)
        return { grid: true, columns, direction, offset };
    }
  }
  return { grid: true, columns: GRID_COLUMNS, direction, offset: 0 };
};

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
  /** The phone-on-its-side test; `matchMedia(GRID_QUERY)` by default, none where there is no window. */
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
  /** A phone on its side (`GRID_QUERY`). */
  private sideways = false;
  /** How the fan stands now: set as it opens, from its room. */
  private plan: FanPlan = defaultFanPlan(false);
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
          : (window.matchMedia?.(GRID_QUERY) ?? null);
    this.media?.addEventListener?.("change", this.onMediaChange);
    document.addEventListener("pointerdown", this.onOutsidePress, true);
    window.addEventListener("keydown", this.onKeyDown);
    this.gather();
    this.setGrid(this.media?.matches === true);
  }

  /** Whether the bubbles stand in rows (a phone on its side, or no room for the column). */
  get isGrid(): boolean {
    return this.plan.grid;
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

  /** Rows (a phone on its side) or one column; an open fan shuts as the phone turns. */
  setGrid(sideways: boolean): void {
    if (sideways !== this.sideways) this.setOpen(false);
    this.sideways = sideways;
    this.usePlan(defaultFanPlan(sideways));
  }

  /** Opens or shuts the fan; `pinned` for a press, which the mouse leaving does not undo. */
  setOpen(open: boolean, pinned = false): void {
    this.clearHover();
    const shown = open && this.visibleItems().length > 0;
    this.pinned = shown && pinned;
    if (shown === this.open) return;
    this.open = shown;
    this.button.setAttribute("aria-expanded", String(shown));
    this.button.classList.toggle("yard-dock__button--on", shown);
    if (this.foldTimer !== null) clearTimeout(this.foldTimer);
    this.foldTimer = null;
    if (shown) {
      this.usePlan(planFan(this.visibleItems().length, this.measureRoom(), this.sizes(), this.sideways));
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

  private usePlan(plan: FanPlan): void {
    this.plan = plan;
    this.element.classList.toggle("bubble-menu--grid", plan.grid);
    this.refresh();
  }

  /** From the middle of More's disc to the top bar's foot and the screen's sides; null unmeasured. */
  private measureRoom(): FanRoom | null {
    if (typeof window === "undefined") return null;
    const disc = this.button.querySelector(".yard-dock__disc") ?? this.button;
    const box = disc.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return null;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const hud = document.querySelector(".hud")?.getBoundingClientRect();
    const top = hud && hud.height > 0 ? Math.max(0, hud.bottom) : 0;
    return { up: y - top - FAN_GAP, left: x - FAN_GAP, right: window.innerWidth - x - FAN_GAP };
  }

  /** The fan's sizes as bubble-menu.css sets them for this screen. */
  private sizes(): FanSizes {
    const style = typeof getComputedStyle === "undefined" ? null : getComputedStyle(this.element);
    const px = (name: string): number => Number.parseFloat(style?.getPropertyValue(name) ?? "");
    return {
      columnStart: px("--bubble-start"),
      columnStep: px("--bubble-step"),
      gridStart: px("--bubble-grid-start"),
      gridStep: px("--bubble-grid-step"),
      pitch: px("--bubble-pitch"),
      disc: px("--bubble-disc"),
    };
  }

  /** Each shown bubble's place in the fan, More's total, and More itself only while it holds something. */
  private refresh(): void {
    const visible = this.visibleItems();
    const { columns, direction, offset } = this.plan;
    const across = Math.max(1, columns);
    visible.forEach((item, index) => {
      const column = index % across;
      item.style.setProperty("--bubble-k", String(index + 1));
      item.style.setProperty("--bubble-col", String(column));
      item.style.setProperty("--bubble-row", String(Math.floor(index / across)));
      item.style.setProperty("--bubble-dx", String(direction * column + offset));
    });
    this.element.style.setProperty("--bubble-count", String(visible.length));
    this.element.hidden = visible.length === 0;
    if (this.element.hidden && this.open) this.setOpen(false);

    const badges = [...this.fan.querySelectorAll<HTMLElement>(".yard-dock__badge")].map(
      (badge) => ({
        hidden: this.hiddenInFan(badge),
        text: badge.textContent ?? "",
      }),
    );
    const text = menuBadgeText(badges);
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

  private readonly onMediaChange = (): void => this.setGrid(this.media?.matches === true);
}
