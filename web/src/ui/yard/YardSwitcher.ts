import {
  OUTPOST_NAME_MAX,
  OUTPOST_PINS_MAX,
  pinOutpost,
  renameOutpost,
  type OutpostLabels,
} from "@/api/outpostLabels";
import { tutTarget, TutTarget } from "@/game/guide/targets";
import {
  cellText,
  onOutpostLabels,
  outpostLabels,
  seedOutpostLabels,
  setOutpostLabels,
} from "@/game/yard/outpostLabels";
import { classicLook } from "@/game/classicLook";
import {
  outpostCountText,
  ownYardsOf,
  stepOwnYard,
  yardTitle,
  type OwnYardEntry,
  type OwnYardTarget,
} from "@/game/yard/ownYards";
import type { YardUiBinding } from "@/game/yard/YardStore";
import { HOP_ART_LARGE_SIDES, hopArt } from "@/ui/friends/FriendHopButtons";
import { gameIcon, gameIconUrl, iconAmount } from "@/ui/gameIcon";
import { icon } from "@/ui/icons";
import "@/ui/styles/yard-switcher.css";

/**
 * The HUD's yard switcher (outposts WP5, #146): which of the player's yards is
 * open, how many outposts they hold, and a list of every yard, the main yard
 * first, that opens the one picked.
 *
 * Flash had an outpost counter with a single "next" arrow that walked main,
 * outpost 1, …, main (`client/scripts/UI_TOP.as:163-168`, `:826-832`;
 * `client/scripts/BASE.as:4658-4697`). A list says where each step goes
 * before it is taken, and reaches any yard in one step.
 *
 * Beta 7 (owner 9 Nov 2026: "Bottom left outpost is occupying two rows per
 * outpost. Allow players to name / pin the outpost of their choice"): one
 * line per yard, an outpost's name (or its coordinates) with the coordinates
 * muted beside a name; a pin that lifts it to the top, after the main yard,
 * in the order pinned (up to {@link OUTPOST_PINS_MAX}); and a rename that
 * turns the line into a text box ({@link OUTPOST_NAME_MAX} letters, Enter or
 * leaving the box saves, Escape keeps the old name, empty goes back to the
 * coordinates). Names and pins are the server's (`outpostLabels.ts`).
 *
 * A player can hold hundreds of outposts (the owner had 800 in Flash), so the
 * rows are built only while the list is open, one click listener serves them
 * all, the list scrolls inside a capped height under a heading that stays,
 * and rows off screen skip layout (`content-visibility`).
 *
 * Built like the Account menu (`AccountMenu.ts`): it only reports the yard
 * picked, and a press elsewhere or Escape closes it. It shows only while an
 * own yard is bound. Since the HUD redesign (#171) it is one of the yard's
 * round buttons (`YardDock.ts`), above Map: a flag with the outpost count as
 * a badge, the open yard's title under it, and the list opening upwards.
 *
 * Beta 9 (owner 21-23 Nov 2026, design E, "one capsule"; the "main outpost"
 * name was "very distracting and lengthy"): no name on the HUD. One capsule,
 * `< house 1/12 >`: the arrows step through the player's own yards in the
 * list's order (Main, the pinned outposts, then the rest) and go round at
 * the ends ({@link stepOwnYard}); the middle shows a house on the main yard
 * or a flag on an outpost, and where the open yard stands in that order,
 * Main counting as 1. A tap on the middle opens the list, as the flag did.
 * The yard's name shows over the capsule for about 1.5 s when the player
 * arrives at another of their yards ({@link YARD_NAME_FLASH_MS}), then fades.
 * With the main yard alone there is nowhere to step: no arrows.
 */

export const YARD_SWITCHER_TEXT = {
  heading: "Your yards",
  rename: "Rename",
  pin: "Pin to top",
  unpin: "Unpin",
  pinLimit: `Pinned ${OUTPOST_PINS_MAX} already. Unpin one first.`,
  failed: "Could not save. Try again.",
  pinned: (count: number): string => `${count} of ${OUTPOST_PINS_MAX} pinned`,
  /** The heading's count: every yard, Main included, as the capsule's "/12" counts them (neon, round 1). */
  yards: (count: number): string => (count === 1 ? "1 yard" : `${count} yards`),
  yardsTitle: (count: number): string =>
    `${count === 1 ? "1 yard" : `${count} yards`}: your main yard and ${outpostCountText(count - 1).toLowerCase()}`,
  prev: "Previous yard",
  next: "Next yard",
  stepTitle: (words: string, title: string): string => `${words}: ${title}`,
  /** The middle of the capsule: where the open yard stands, for a screen reader and the tooltip. */
  where: (title: string, at: number, total: number): string =>
    at > 0 ? `Your yards: ${title}, ${at} of ${total}` : `Your yards: ${title}`,
} as const;

/** How long the yard's name shows over the capsule on arrival, before it fades (owner, 22 Nov 2026: about 1.5 s). */
export const YARD_NAME_FLASH_MS = 1500;

/**
 * The capsule's place in the order: "2/12", the open yard's place counting
 * the main yard as 1. Empty for a yard the list does not hold (the Inferno).
 */
export const yardCountText = (entries: readonly OwnYardEntry[]): string => {
  const at = entries.findIndex((entry) => entry.current);
  return at < 0 ? "" : `${at + 1}/${entries.length}`;
};

/**
 * The last own yard a switcher showed, as `kind:baseid`: the dock (and its
 * switcher) is built again for every yard, so whether this is an arrival
 * at another yard is kept here, outside any one switcher. Null before the
 * first, which is no arrival (the game just opened).
 */
let lastYardKey: string | null = null;

const yardKey = (target: OwnYardTarget): string => `${target.kind}:${target.baseid}`;

/** For the tests: forget the last yard shown. */
export const resetYardArrival = (): void => {
  lastYardKey = null;
};

/** The server calls the list makes; the tests pass their own. */
export interface YardSwitcherApi {
  readonly rename: (baseid: string, name: string) => Promise<OutpostLabels>;
  readonly pin: (baseid: string, pin: boolean) => Promise<OutpostLabels>;
}

export interface YardSwitcherOptions {
  /** A yard other than the open one was picked. */
  readonly onSelect: (target: OwnYardTarget) => void;
  readonly api?: YardSwitcherApi;
}

const DEFAULT_API: YardSwitcherApi = { rename: renameOutpost, pin: pinOutpost };

const make = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  element.className = className;
  return element;
};

/**
 * What stands above the list on the left: the World chat tab and, when chat
 * is off, the floating "?". The open list stops this far below the lowest.
 */
const LIST_CEILING = ".chat-box__tab, .guide-help--float";
const LIST_CEILING_GAP = 8;
/** How long the arrows wait for the yard to go before they wake again. */
const STEP_WAIT_MS = 2500;
/** The name's fade, as `.yard-switcher__flash--out` runs it. */
const FLASH_FADE_MS = 400;
/** The list never gets shorter than this, even on a very short screen. */
const LIST_MIN_HEIGHT = 120;

const errorWords = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : YARD_SWITCHER_TEXT.failed;

export class YardSwitcher {
  /** The button and the list, in one wrapper the list hangs from. */
  readonly element: HTMLElement;

  /** The capsule's middle: a tap opens the list. */
  private readonly button: HTMLButtonElement;
  private readonly prev: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly where: HTMLElement;
  private readonly count: HTMLElement;
  /** The yard's name, shown for a moment on arrival. */
  private readonly flash: HTMLElement;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  /** An arrow was pressed and the yard is on its way: the arrows wait. */
  private stepping = false;
  private steppingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly list: HTMLElement;
  private readonly heading: HTMLElement;
  private readonly error: HTMLElement;
  private readonly rows: HTMLElement;
  private readonly onSelect: YardSwitcherOptions["onSelect"];
  private readonly api: YardSwitcherApi;
  private readonly unsubscribe: () => void;
  private binding: YardUiBinding | null = null;
  /** The entries the open list shows, in its order. */
  private shown: OwnYardEntry[] = [];
  /** The outpost whose name is being typed, and whether its save is on its way. */
  private editing: { baseid: string; saving: boolean } | null = null;
  /** Outposts whose pin is on its way to the server. */
  private readonly pinning = new Set<string>();

  constructor(options: YardSwitcherOptions) {
    this.onSelect = options.onSelect;
    this.api = options.api ?? DEFAULT_API;

    this.element = make("div", "yard-switcher");
    this.element.hidden = true;

    const capsule = make("div", "yard-switcher__capsule");
    tutTarget(capsule, TutTarget.YARD_SWITCHER);
    this.prev = this.arrow(-1);
    this.next = this.arrow(1);
    this.button = make("button", "yard-switcher__button");
    this.button.type = "button";
    this.button.setAttribute("aria-haspopup", "true");
    this.button.setAttribute("aria-expanded", "false");
    this.where = make("span", "yard-switcher__where");
    this.count = make("span", "yard-switcher__count");
    // A small up-pointing caret: the middle opens the list (neon, round 1).
    const caret = make("span", "yard-switcher__caret");
    caret.setAttribute("aria-hidden", "true");
    this.button.append(this.where, this.count, caret);
    this.button.addEventListener("click", () => this.toggle(this.list.hidden));
    capsule.append(this.prev, this.button, this.next);

    this.flash = make("div", "yard-dock__label yard-switcher__flash");
    this.flash.setAttribute("role", "status");
    this.flash.setAttribute("aria-live", "polite");
    this.flash.hidden = true;

    this.list = make("div", "yard-switcher__list");
    this.list.setAttribute("role", "dialog");
    this.list.setAttribute("aria-label", YARD_SWITCHER_TEXT.heading);
    this.list.hidden = true;
    this.heading = make("div", "yard-switcher__heading");
    this.error = make("p", "yard-switcher__error");
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;
    this.rows = make("div", "yard-switcher__rows");
    this.rows.setAttribute("role", "list");
    this.rows.addEventListener("click", this.onRowClick);
    this.list.append(this.heading, this.error, this.rows);

    this.element.append(this.flash, capsule, this.list);
    document.addEventListener("pointerdown", this.dismiss, true);
    document.addEventListener("keydown", this.dismiss, true);
    this.unsubscribe = onOutpostLabels(() => this.render());
  }

  get open(): boolean {
    return !this.list.hidden;
  }

  /** Every yard the list shows, in its order, the open one marked; empty while unbound. */
  get entries(): OwnYardEntry[] {
    const store = this.binding?.store;
    return store ? ownYardsOf(store.save, store.target, outpostLabels()) : [];
  }

  /** The own yard's binding, or null to hide the switcher (the map, a visit). */
  bind(binding: YardUiBinding | null): void {
    this.binding = binding;
    this.editing = null;
    this.toggle(false);
    if (binding) seedOutpostLabels(binding.store.save.outpostlabels);
    this.render();
    if (binding) this.arrive(binding.store.target);
  }

  destroy(): void {
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    if (this.steppingTimer !== null) clearTimeout(this.steppingTimer);
    document.removeEventListener("pointerdown", this.dismiss, true);
    document.removeEventListener("keydown", this.dismiss, true);
    this.unsubscribe();
    this.element.remove();
  }

  private render(): void {
    const store = this.binding?.store;
    this.element.hidden = !store;
    if (!store) return;

    const labels = outpostLabels();
    const title = yardTitle(store.target, labels);
    const entries = ownYardsOf(store.save, store.target, labels);
    const at = entries.findIndex((entry) => entry.current) + 1;
    const countText = outpostCountText(entries.length - 1);
    const main = store.target.kind !== "outpost";
    this.where.replaceChildren(
      gameIcon(main ? "townhall" : classicLook() ? "outpostclassic" : "outpost", {
        size: 32,
        decorative: true,
        className: "yard-switcher__icon",
      }),
    );
    this.count.textContent = yardCountText(entries);
    this.count.hidden = this.count.textContent === "";
    // "120/250" takes a smaller size, so the capsule stays beside More on a phone.
    this.count.classList.toggle("yard-switcher__count--long", this.count.textContent.length > 5);
    const words = YARD_SWITCHER_TEXT.where(title, at, entries.length);
    this.button.setAttribute("aria-label", words);
    this.button.title = `${title}. ${countText}. Tap for the list of your yards.`;
    this.element.classList.toggle("yard-switcher--alone", stepOwnYard(entries, 1) === null);
    for (const [arrow, direction, words] of [
      [this.prev, -1, YARD_SWITCHER_TEXT.prev],
      [this.next, 1, YARD_SWITCHER_TEXT.next],
    ] as const) {
      const to = stepOwnYard(entries, direction);
      arrow.hidden = to === null;
      arrow.disabled = this.stepping;
      arrow.title = to ? YARD_SWITCHER_TEXT.stepTitle(words, to.title) : words;
    }
    if (this.open) this.renderList();
  }

  /** One of the capsule's arrows, painted as the friend arrows are (beta 8). */
  private arrow(direction: -1 | 1): HTMLButtonElement {
    const button = make("button", `yard-switcher__arrow yard-switcher__arrow--${direction === 1 ? "next" : "prev"}`);
    button.type = "button";
    button.setAttribute("aria-label", direction === 1 ? YARD_SWITCHER_TEXT.next : YARD_SWITCHER_TEXT.prev);
    const name = hopArt(direction);
    const art = gameIcon(name, { size: 32, decorative: true, className: "yard-switcher__arrow-art" });
    const url64 = gameIconUrl(name, 64);
    art.srcset = [
      art.srcset,
      ...HOP_ART_LARGE_SIDES.map((side) => `${url64.replace(/-64\.webp$/, `-${side}.webp`)} ${side}w`),
    ].join(", ");
    art.sizes = "32px";
    button.append(art);
    button.addEventListener("click", () => this.step(direction));
    return button;
  }

  /**
   * The yard after (1) or before (-1) the open one. The arrows wait until the
   * yard goes; should it not (the planner is open), they wake again shortly.
   */
  private step(direction: -1 | 1): void {
    if (this.stepping) return;
    const to = stepOwnYard(this.entries, direction);
    if (!to || to.current) return;
    this.toggle(false);
    this.stepping = true;
    this.prev.disabled = true;
    this.next.disabled = true;
    this.steppingTimer = setTimeout(() => {
      this.steppingTimer = null;
      this.stepping = false;
      this.render();
    }, STEP_WAIT_MS);
    this.onSelect(to.target);
  }

  /** The yard's name over the capsule for a moment, when this is another yard than the last one shown. */
  private arrive(target: OwnYardTarget): void {
    const key = yardKey(target);
    const before = lastYardKey;
    lastYardKey = key;
    if (before === null || before === key) return;
    this.flash.textContent = yardTitle(target, outpostLabels());
    this.flash.hidden = false;
    this.flash.classList.remove("yard-switcher__flash--out");
    if (this.flashTimer !== null) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => {
      this.flash.classList.add("yard-switcher__flash--out");
      this.flashTimer = setTimeout(() => {
        this.flashTimer = null;
        this.flash.hidden = true;
        this.flash.classList.remove("yard-switcher__flash--out");
      }, FLASH_FADE_MS);
    }, YARD_NAME_FLASH_MS);
  }

  /** The heading and every row; only while the list is open. */
  private renderList(): void {
    this.shown = this.entries;
    const yards = this.shown.length;
    const pinned = this.shown.filter((entry) => entry.pinned).length;

    const words = make("span", "yard-switcher__heading-words");
    words.textContent = YARD_SWITCHER_TEXT.heading;
    const counts = make("span", "yard-switcher__counts");
    const total = make("span", "yard-switcher__outposts");
    total.title = YARD_SWITCHER_TEXT.yardsTitle(yards);
    total.textContent = YARD_SWITCHER_TEXT.yards(yards);
    counts.append(total);
    if (pinned > 0) {
      counts.append(
        iconAmount("pin", `${pinned}/${OUTPOST_PINS_MAX}`, {
          label: YARD_SWITCHER_TEXT.pinned(pinned),
          className: "yard-switcher__pins",
        }),
      );
    }
    this.heading.replaceChildren(words, counts);

    const scroll = this.rows.scrollTop;
    this.rows.replaceChildren(...this.shown.map((entry, index) => this.row(entry, index)));
    this.rows.scrollTop = scroll;
    this.rows.querySelector<HTMLInputElement>(".yard-switcher__input")?.focus();
  }

  private row(entry: OwnYardEntry, index: number): HTMLElement {
    const row = make("div", "yard-switcher__row");
    row.setAttribute("role", "listitem");
    row.dataset["index"] = String(index);
    const outpost = entry.target.kind === "outpost";
    if (entry.pinned) row.classList.add("yard-switcher__row--pinned");

    if (outpost && this.editing?.baseid === entry.target.baseid) {
      row.append(this.renameForm(entry));
      return row;
    }

    const item = make("button", "btn btn--ghost yard-switcher__item");
    item.type = "button";
    item.dataset["action"] = "open";
    item.append(icon(outpost ? "yards" : "home", 16, "yard-switcher__kind"));
    const name = make("span", "yard-switcher__name");
    const cell = entry.target.cell;
    name.textContent = outpost && !entry.name && cell ? cellText(cell) : entry.title;
    item.append(name);
    if (outpost && entry.name && cell) {
      const where = make("span", "yard-switcher__cell");
      where.textContent = cellText(cell);
      item.append(where);
    }
    item.title = entry.current ? `${entry.title}. You are here` : entry.title;
    if (entry.current) item.setAttribute("aria-current", "true");
    row.append(item);
    if (!outpost) return row;

    const pinWords = entry.pinned ? YARD_SWITCHER_TEXT.unpin : YARD_SWITCHER_TEXT.pin;
    const pin = make(
      "button",
      `btn btn--ghost btn--icon yard-switcher__action yard-switcher__pin${entry.pinned ? " yard-switcher__pin--on" : ""}`,
    );
    pin.type = "button";
    pin.dataset["action"] = "pin";
    pin.title = pinWords;
    pin.setAttribute("aria-label", `${pinWords}: ${entry.title}`);
    pin.setAttribute("aria-pressed", String(entry.pinned));
    pin.disabled = this.pinning.has(entry.target.baseid);
    pin.append(gameIcon("pin", { size: 16, decorative: true }));

    const rename = make(
      "button",
      "btn btn--ghost btn--icon yard-switcher__action yard-switcher__rename",
    );
    rename.type = "button";
    rename.dataset["action"] = "rename";
    rename.title = YARD_SWITCHER_TEXT.rename;
    rename.setAttribute("aria-label", `${YARD_SWITCHER_TEXT.rename}: ${entry.title}`);
    // A stand-in until a painted pencil is made (gameIcon.ts: new art, not a new line icon).
    const pencil = make("span", "yard-switcher__pencil");
    pencil.setAttribute("aria-hidden", "true");
    pencil.textContent = "✎";
    rename.append(pencil);
    row.append(pin, rename);
    return row;
  }

  /** The line as a text box: Enter or leaving it saves, Escape keeps the old name. */
  private renameForm(entry: OwnYardEntry): HTMLFormElement {
    const form = make("form", "yard-switcher__rename-form");
    form.noValidate = true;
    const input = make("input", "yard-switcher__input");
    input.type = "text";
    input.maxLength = OUTPOST_NAME_MAX;
    input.value = entry.name;
    input.placeholder = entry.target.cell ? cellText(entry.target.cell) : "";
    input.enterKeyHint = "done";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${YARD_SWITCHER_TEXT.rename}: ${entry.title}`);
    input.disabled = this.editing?.saving ?? false;
    form.append(input);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.commitRename(input.value);
    });
    input.addEventListener("blur", () => void this.commitRename(input.value));
    return form;
  }

  private readonly onRowClick = (event: MouseEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLButtonElement>("button[data-action]");
    const row = control?.closest<HTMLElement>(".yard-switcher__row");
    const entry = row ? this.shown[Number(row.dataset["index"])] : undefined;
    if (!control || !entry || control.disabled) return;
    const action = control.dataset["action"];
    if (action === "open") {
      this.toggle(false);
      if (!entry.current) this.onSelect(entry.target);
    } else if (action === "pin") {
      void this.togglePin(entry);
    } else if (action === "rename") {
      this.showError(null);
      this.editing = { baseid: entry.target.baseid, saving: false };
      this.renderList();
      this.rows.querySelector<HTMLInputElement>(".yard-switcher__input")?.select();
    }
  };

  private async togglePin(entry: OwnYardEntry): Promise<void> {
    const baseid = entry.target.baseid;
    const pin = !entry.pinned;
    if (pin && outpostLabels().pins.length >= OUTPOST_PINS_MAX) {
      this.showError(YARD_SWITCHER_TEXT.pinLimit);
      return;
    }
    this.showError(null);
    this.pinning.add(baseid);
    this.renderList();
    try {
      const labels = await this.api.pin(baseid, pin);
      this.pinning.delete(baseid);
      setOutpostLabels(labels);
    } catch (error) {
      this.pinning.delete(baseid);
      this.showError(errorWords(error));
      if (this.open) this.renderList();
    }
  }

  /** Saves the name typed, unless it is unchanged or a save is already on its way. */
  private async commitRename(raw: string): Promise<void> {
    const editing = this.editing;
    if (!editing || editing.saving) return;
    const name = raw.replace(/\s+/g, " ").trim();
    if (name === (outpostLabels().names[editing.baseid] ?? "")) {
      this.editing = null;
      if (this.open) this.renderList();
      return;
    }
    editing.saving = true;
    if (this.open) this.renderList();
    try {
      const labels = await this.api.rename(editing.baseid, name);
      if (this.editing === editing) this.editing = null;
      setOutpostLabels(labels);
    } catch (error) {
      editing.saving = false;
      this.showError(errorWords(error));
      if (this.editing !== editing) return;
      if (!this.open) {
        this.editing = null;
        return;
      }
      this.renderList();
      const input = this.rows.querySelector<HTMLInputElement>(".yard-switcher__input");
      if (input) input.value = raw;
    }
  }

  private cancelRename(): void {
    this.editing = null;
    this.showError(null);
    this.renderList();
  }

  private showError(words: string | null): void {
    this.error.textContent = words ?? "";
    this.error.hidden = !words;
  }

  private toggle(open: boolean): void {
    if (!open && this.editing && !this.editing.saving) {
      // Closing while typing keeps what was typed, as leaving the box does.
      const input = this.rows.querySelector<HTMLInputElement>(".yard-switcher__input");
      this.list.hidden = true;
      if (input) void this.commitRename(input.value);
      else this.editing = null;
    }
    this.list.hidden = !open;
    this.button.setAttribute("aria-expanded", String(open));
    if (open) {
      this.flash.hidden = true;
      this.showError(null);
      this.renderList();
      this.fitList();
      // The open yard in view, for a player with many outposts (neon, round 1).
      this.rows.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
    }
  }

  /**
   * Caps the open list's height so its top stays clear of what stands above
   * it on the left ({@link LIST_CEILING}), instead of running under the
   * World chat button. The list hangs from the switcher, so only its top moves.
   */
  private fitList(): void {
    this.list.style.removeProperty("max-height");
    const list = this.list.getBoundingClientRect();
    let ceiling = Number.NEGATIVE_INFINITY;
    for (const above of document.querySelectorAll<HTMLElement>(LIST_CEILING)) {
      const box = above.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue; // hidden
      if (box.right <= list.left || box.left >= list.right) continue; // not over the list
      if (box.bottom >= list.bottom) continue; // beside or below it
      ceiling = Math.max(ceiling, box.bottom);
    }
    if (ceiling === Number.NEGATIVE_INFINITY) return;
    const room = Math.max(
      LIST_MIN_HEIGHT,
      Math.floor(list.bottom - ceiling - LIST_CEILING_GAP),
    );
    this.list.style.maxHeight = `min(60vh, 34rem, ${room}px)`;
  }

  /** A press anywhere else, or Escape, closes the list; Escape in a rename only ends it. */
  private readonly dismiss = (event: Event): void => {
    if (this.list.hidden) return;
    if (event instanceof KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (this.editing && !this.editing.saving) {
        event.stopPropagation();
        this.cancelRename();
        return;
      }
      this.toggle(false);
      this.button.focus();
      return;
    }
    if (event.target instanceof Node && this.element.contains(event.target)) return;
    this.toggle(false);
  };
}
