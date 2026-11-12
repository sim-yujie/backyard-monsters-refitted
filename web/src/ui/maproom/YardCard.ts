import { OUTPOST_NAME_MAX, OUTPOST_PINS_MAX, pinOutpost, renameOutpost, type OutpostLabels } from "@/api/outpostLabels";
import type { PlayerCell } from "@/api/types";
import { monsterName } from "@/game/combat/rules";
import type { OffsetCell } from "@/game/HexGrid";
import { cellsText } from "@/game/maproom/attackRange";
import { CONSTRUCTION_BADGE_URL, IDLE_HELPER_URL } from "@/game/maproom/mapPicture";
import { heightBonus } from "@/game/maproom/heightBonus";
import { housingPercent, yardCardFacts, type YardCardFacts } from "@/game/maproom/yardCard";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { MAIN_YARD_TITLE } from "@/game/yard/ownYards";
import { cellText, onOutpostLabels, outpostLabels, setOutpostLabels } from "@/game/yard/outpostLabels";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, iconAmount } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { resourceAmount } from "@/ui/resourceIcon";
import type { OwnFlinger, OwnMoves } from "./CellPanel";
import { landFeatureChip } from "./landFeatureRow";
import { addNeighbourBonusChip } from "./neighbourBonusChip";
import "@/ui/styles/yard-card.css";

/**
 * The yard info card (beta 7, owner's design B, 9 Nov 2026): clicking one of
 * the player's OWN yards on Map Room 2 opens this centred window instead of
 * the side panel, as Flash opened `PopupInfoMine` (owner's reference
 * `archive/owner-refs/2026-11-09/2-flash-yard-info-monsters-housed.png`).
 *
 * Left: the yard's name (an outpost's renames and pins in place, the names of
 * `game/yard/outpostLabels.ts`), where it is, its Starter Kit as the kit's
 * own picture, what its ground gives, its Flinger's reach and its worker.
 * Right: the monsters housed there, painted portrait and count, under a
 * housing bar (used / capacity). Under both: Open, the moves between yards
 * the game already has (`TransferDialog`, `RelocateDialog`, invitations) and
 * Bookmark.
 *
 * It is a `Popup`, so it wears the Modern or Classic window skin like every
 * other window and opens in the middle. Other players' yards keep the side
 * panel (`CellPanel`).
 */

export interface YardCardOptions {
  /** Opens the yard (the map's "Open yard"). */
  readonly onOpen: () => void;
  readonly onBookmark: (cell: OffsetCell) => void;
  readonly canBookmark: () => boolean;
  /** Housing one monster of a type takes, at the player's academy level. */
  readonly sizeOf: (id: string) => number;
  /** The yard's Flinger and how far it reaches. */
  readonly ownFlinger: (cell: OffsetCell, payload: PlayerCell) => OwnFlinger;
  /** Which moves between yards this yard offers. Absent: none. */
  readonly ownMoves?: (cell: OffsetCell, payload: PlayerCell) => OwnMoves;
  /** Move monsters from this yard to another of the player's. */
  readonly onMoveFrom?: (cell: OffsetCell, payload: PlayerCell) => void;
  /** Bring monsters to this yard from another of the player's. */
  readonly onBringHere?: (cell: OffsetCell, payload: PlayerCell) => void;
  readonly onRelocate?: (cell: OffsetCell, payload: PlayerCell) => void;
  readonly onInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  readonly onWithdrawInvite?: (cell: OffsetCell, payload: PlayerCell) => void;
  /** Cells between this yard and the main yard, or null when not known. */
  readonly cellsFromHome?: (cell: OffsetCell) => number | null;
  /** Renames and pins (the yard switcher's own routes); replaced in the tests. */
  readonly rename?: (baseid: string, name: string) => Promise<OutpostLabels>;
  readonly pin?: (baseid: string, pin: boolean) => Promise<OutpostLabels>;
  /** After the card closes itself (close button, Escape, the scrim). */
  readonly onClose: () => void;
}

/** The card's words, in one place for the tests. */
export const YARD_CARD_TEXT = {
  titleOutpost: "Your outpost",
  titleMain: "Your main yard",
  housed: "Monsters housed",
  noMonsters: "No monsters here",
  noKit: "No Starter Kit",
  kit: "Starter Kit",
  flinger: "Flinger",
  noFlinger: "No Flinger",
  worker: "Worker",
  idle: "Idle",
  busy: "Building",
  storage: "Storage",
  openOutpost: "Open outpost",
  openMain: "Open yard",
  moveFrom: "Move monsters from here",
  bringHere: "Bring monsters here",
  relocate: "Move main yard here",
  invite: "Invite to move here",
  withdraw: "Withdraw invite",
  bookmark: "Bookmark",
  rename: "Rename",
  pin: "Pin to top of your yards list",
  pinned: "Pinned to the top of your yards list. Click to unpin.",
  pinLimit: `You can pin up to ${OUTPOST_PINS_MAX} outposts.`,
  fromMain: "from main",
  towerReach: "Tower reach",
  income: "Income",
  neighbours: "Neighbours",
} as const;

/**
 * The short words a button wears on a phone (≤ 620 px wide, or a phone on its
 * side), where three plates share a line: the full words stay its name.
 */
export const YARD_CARD_SHORT: Readonly<Record<string, string>> = {
  [YARD_CARD_TEXT.openOutpost]: "Open",
  [YARD_CARD_TEXT.openMain]: "Open",
  [YARD_CARD_TEXT.moveFrom]: "Move out",
  [YARD_CARD_TEXT.bringHere]: "Bring in",
  [YARD_CARD_TEXT.relocate]: "Relocate",
  [YARD_CARD_TEXT.invite]: "Invite",
  [YARD_CARD_TEXT.withdraw]: "Uninvite",
  [YARD_CARD_TEXT.bookmark]: "Bookmark",
};

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const textButton = (className: string, label: string): HTMLButtonElement => {
  const node = make("button", className);
  node.type = "button";
  // Each set of words is one box the skin's metrics centre (owner rule: 0 px
  // off); the stylesheet shows the long words or, on a phone, the short ones.
  node.append(make("span", "yard-card__label yard-card__label--long"), make("span", "yard-card__label yard-card__label--short"));
  setLabel(node, label);
  return node;
};

const setLabel = (button: HTMLButtonElement, label: string): void => {
  button.setAttribute("aria-label", label);
  const long = button.querySelector(".yard-card__label--long");
  const short = button.querySelector(".yard-card__label--short");
  if (long) long.textContent = label;
  if (short) short.textContent = YARD_CARD_SHORT[label] ?? label;
};

/**
 * Fades a scrolling box's edge where more is hidden (the attack window's
 * way), so a phone shows the card goes on below rather than a box cut
 * mid-line. `block` names the classes: `<block>--more-above` and
 * `<block>--more-below`. The card body uses it upright; on a phone on its
 * side the yard's details and the monster tiles each scroll on their own.
 * Returns what stops it.
 */
export const yardCardScrollHint = (box: HTMLElement, block = "yard-card__body"): (() => void) => {
  const update = (): void => {
    box.classList.toggle(`${block}--more-above`, box.scrollTop > 1);
    box.classList.toggle(`${block}--more-below`, box.scrollTop + box.clientHeight < box.scrollHeight - 2);
  };
  box.addEventListener("scroll", update, { passive: true });
  const resized = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
  resized?.observe(box);
  for (const child of box.children) resized?.observe(child);
  // The monster tiles are redrawn when the yard changes: watch the new ones too.
  const redrawn =
    typeof MutationObserver === "function"
      ? new MutationObserver(() => {
          for (const child of box.children) resized?.observe(child);
          update();
        })
      : null;
  redrawn?.observe(box, { childList: true });
  update();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(update);
  return () => {
    box.removeEventListener("scroll", update);
    resized?.disconnect();
    redrawn?.disconnect();
  };
};

const picture = (src: string, className: string): HTMLImageElement => {
  const node = make("img", className);
  node.src = src;
  node.alt = "";
  node.decoding = "async";
  node.draggable = false;
  return node;
};

const errorWords = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "That did not work. Try again.";

export class YardCard {
  readonly popup: Popup;

  private readonly options: YardCardOptions;
  private readonly nameRow: HTMLElement;
  private readonly where: HTMLElement;
  private readonly kit: HTMLElement;
  private readonly chips: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly housedCount: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly error: HTMLElement;
  private readonly openButton: HTMLButtonElement;
  private readonly moveFromButton: HTMLButtonElement;
  private readonly bringButton: HTMLButtonElement;
  private readonly relocateButton: HTMLButtonElement;
  private readonly inviteButton: HTMLButtonElement;
  private readonly bookmarkButton: HTMLButtonElement;
  private readonly secondRow: HTMLElement;
  private readonly unsubscribe: () => void;
  private stopScrollHint: () => void = () => undefined;

  private shown: OffsetCell;
  private payload: PlayerCell;
  /** The payload last drawn, so the map's once-a-second refresh redraws only on news. */
  private drawn: PlayerCell | null = null;
  private facts: YardCardFacts | null = null;
  /** The rename box is open; a refresh leaves the name line alone. */
  private renaming = false;
  private saving = false;
  private pinning = false;
  /** The protection countdown, refreshed by `tick`. */
  private countdown: { node: HTMLElement; expiresAt: number } | null = null;
  private closedByOwner = false;

  constructor(cell: OffsetCell, payload: PlayerCell, options: YardCardOptions) {
    this.options = options;
    this.shown = cell;
    this.payload = payload;

    this.popup = new Popup({
      title: YARD_CARD_TEXT.titleOutpost,
      className: "yard-card",
      onClose: () => {
        this.unsubscribe();
        this.stopScrollHint();
        if (!this.closedByOwner) options.onClose();
      },
    });

    // ── Left: about this yard ──
    this.nameRow = make("div", "yard-card__name-row");
    this.where = make("p", "yard-card__where");
    this.kit = make("div", "yard-card__kit");
    this.chips = make("div", "yard-card__chips");
    this.stats = make("div", "yard-card__stats");
    const about = make("section", "yard-card__about");
    about.append(this.nameRow, this.where, this.kit, this.chips, this.stats);

    // ── Right: the monsters housed ──
    const housedTitle = make("h3", "yard-card__housed-title");
    housedTitle.append(gameIcon("housing", { size: 24, decorative: true }), make("span", "", YARD_CARD_TEXT.housed));
    this.housedCount = make("span", "yard-card__housed-count");
    const housedHead = make("div", "yard-card__housed-head");
    housedHead.append(housedTitle, this.housedCount);
    this.bar = make("div", "yard-card__bar");
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Housing used");
    this.bar.setAttribute("aria-valuemin", "0");
    this.bar.setAttribute("aria-valuemax", "100");
    this.barFill = make("span", "yard-card__bar-fill");
    this.bar.append(this.barFill);
    this.grid = make("ul", "yard-card__grid");
    this.grid.setAttribute("aria-label", YARD_CARD_TEXT.housed);
    const housed = make("section", "yard-card__housed");
    housed.append(housedHead, this.bar, this.grid);

    const columns = make("div", "yard-card__columns");
    columns.append(about, housed);

    this.error = make("p", "yard-card__error");
    this.error.setAttribute("role", "alert");
    this.error.hidden = true;

    // ── Foot: the actions, outside the scrolling body so they always show ──
    this.openButton = textButton("btn btn--primary yard-card__open", YARD_CARD_TEXT.openOutpost);
    this.openButton.addEventListener("click", () => options.onOpen());
    this.moveFromButton = textButton("btn btn--outline yard-card__move-from", YARD_CARD_TEXT.moveFrom);
    this.moveFromButton.addEventListener("click", () => options.onMoveFrom?.(this.shown, this.payload));
    this.bringButton = textButton("btn btn--outline yard-card__bring", YARD_CARD_TEXT.bringHere);
    this.bringButton.addEventListener("click", () => options.onBringHere?.(this.shown, this.payload));
    this.relocateButton = textButton("btn btn--outline yard-card__relocate", YARD_CARD_TEXT.relocate);
    this.relocateButton.title = "Move your main yard onto this outpost.";
    this.relocateButton.addEventListener("click", () => options.onRelocate?.(this.shown, this.payload));
    this.inviteButton = textButton("btn btn--outline yard-card__invite", YARD_CARD_TEXT.invite);
    this.inviteButton.addEventListener("click", () => {
      if (this.payload.pi > 0) options.onWithdrawInvite?.(this.shown, this.payload);
      else options.onInvite?.(this.shown, this.payload);
    });
    this.bookmarkButton = textButton("btn btn--outline yard-card__bookmark", YARD_CARD_TEXT.bookmark);
    this.bookmarkButton.title = "Bookmark this cell";
    this.bookmarkButton.addEventListener("click", () => options.onBookmark(this.shown));

    const firstRow = make("div", "yard-card__row yard-card__row--main");
    firstRow.append(this.openButton, this.moveFromButton, this.bringButton);
    this.secondRow = make("div", "yard-card__row yard-card__row--second");
    this.secondRow.append(this.relocateButton, this.inviteButton, this.bookmarkButton);
    const foot = make("footer", "yard-card__foot");
    foot.append(firstRow, this.secondRow);

    this.popup.setContent(columns, this.error);
    this.popup.element.append(foot);

    this.unsubscribe = onOutpostLabels(() => {
      if (!this.renaming) this.renderName();
    });
    this.render();
    const stops = [
      yardCardScrollHint(this.popup.body),
      yardCardScrollHint(about, "yard-card__about"),
      yardCardScrollHint(this.grid, "yard-card__grid"),
    ];
    this.stopScrollHint = () => {
      for (const stop of stops) stop();
    };
  }

  /** The cell shown. */
  get cell(): OffsetCell {
    return this.shown;
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    return this;
  }

  /** Closes the card without telling `onClose`: the map closed it itself. */
  dismiss(): void {
    this.closedByOwner = true;
    this.popup.close();
  }

  /** Redraws with the cell's fresh payload, when it is news. */
  update(cell: OffsetCell, payload: PlayerCell): void {
    const moved = cell.col !== this.shown.col || cell.row !== this.shown.row;
    this.shown = cell;
    this.payload = payload;
    if (moved) {
      this.renaming = false;
      this.showError(null);
    }
    if (!moved && payload === this.drawn) return;
    this.render();
  }

  /** Advances the protection countdown. Called once a second by the map. */
  tick(nowSeconds: number): void {
    const countdown = this.countdown;
    if (countdown) countdown.node.textContent = `Protected ${formatCountdown(countdown.expiresAt - nowSeconds)}`;
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const payload = this.payload;
    const cell = this.shown;
    this.drawn = payload;
    const facts = yardCardFacts(payload, this.options.sizeOf);
    this.facts = facts;
    const outpost = facts.outpost;

    this.popup.setTitle(outpost ? YARD_CARD_TEXT.titleOutpost : YARD_CARD_TEXT.titleMain);
    this.popup.element.classList.toggle("yard-card--main", !outpost);
    if (!this.renaming) this.renderName();
    else this.renderWhere();
    this.renderKit(facts);
    this.renderChips(payload, outpost);
    this.renderStats(cell, payload, facts);
    this.renderHoused(facts);
    this.renderActions(cell, payload, facts);
  }

  private baseid(): string {
    return this.payload.bid;
  }

  private renderName(): void {
    const outpost = this.facts?.outpost ?? false;
    const name = make("h3", "yard-card__name");
    this.renderWhere();
    if (!outpost) {
      name.textContent = MAIN_YARD_TITLE;
      this.nameRow.replaceChildren(name);
      return;
    }
    const labels = outpostLabels();
    const own = labels.names[this.baseid()] ?? "";
    // An unnamed outpost is called by its cell, as the yard list calls it.
    name.textContent = own || `Outpost ${cellText(this.shown)}`;
    name.classList.toggle("yard-card__name--unnamed", own === "");

    const rename = make("button", "yard-card__tool yard-card__rename");
    rename.type = "button";
    rename.setAttribute("aria-label", YARD_CARD_TEXT.rename);
    rename.title = YARD_CARD_TEXT.rename;
    rename.disabled = this.saving;
    const pencil = make("span", "yard-card__pencil", "✎");
    pencil.setAttribute("aria-hidden", "true");
    rename.append(pencil);
    rename.addEventListener("click", () => this.startRename());

    // The crown stands in for a painted pin. Pinned it is gold on a gold
    // plate; unpinned, grey on a plain one, so the two read apart at a glance.
    const pinned = labels.pins.includes(this.baseid());
    const pin = make("button", `yard-card__tool yard-card__pin${pinned ? " yard-card__pin--on" : ""}`);
    pin.type = "button";
    pin.setAttribute("aria-pressed", String(pinned));
    pin.setAttribute("aria-label", YARD_CARD_TEXT.pin);
    pin.title = pinned ? YARD_CARD_TEXT.pinned : YARD_CARD_TEXT.pin;
    pin.disabled = this.pinning;
    pin.append(gameIcon("pin", { size: 24, decorative: true }));
    pin.addEventListener("click", () => void this.togglePin(!pinned));

    this.nameRow.replaceChildren(name, rename, pin);
  }

  private startRename(): void {
    this.renaming = true;
    this.showError(null);
    const form = make("form", "yard-card__rename-form");
    form.noValidate = true;
    const input = make("input", "yard-card__input");
    input.type = "text";
    input.maxLength = OUTPOST_NAME_MAX;
    input.value = outpostLabels().names[this.baseid()] ?? "";
    input.placeholder = `Outpost ${cellText(this.shown)}`;
    input.enterKeyHint = "done";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("aria-label", YARD_CARD_TEXT.rename);
    form.append(input);
    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      if (save) void this.commitRename(input.value);
      else this.stopRename();
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      finish(true);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      // Escape leaves the name as it was; it does not close the card.
      event.preventDefault();
      event.stopPropagation();
      finish(false);
    });
    input.addEventListener("blur", () => finish(true));
    this.nameRow.replaceChildren(form);
    input.focus();
    input.select();
  }

  private stopRename(): void {
    this.renaming = false;
    this.renderName();
  }

  private async commitRename(raw: string): Promise<void> {
    const baseid = this.baseid();
    const name = raw.replace(/\s+/g, " ").trim();
    if (name === (outpostLabels().names[baseid] ?? "")) {
      this.stopRename();
      return;
    }
    this.saving = true;
    this.stopRename();
    try {
      setOutpostLabels(await (this.options.rename ?? renameOutpost)(baseid, name));
    } catch (error) {
      this.showError(errorWords(error));
    } finally {
      this.saving = false;
      if (!this.renaming) this.renderName();
    }
  }

  private async togglePin(pin: boolean): Promise<void> {
    if (pin && outpostLabels().pins.length >= OUTPOST_PINS_MAX) {
      this.showError(YARD_CARD_TEXT.pinLimit);
      return;
    }
    this.showError(null);
    this.pinning = true;
    this.renderName();
    try {
      setOutpostLabels(await (this.options.pin ?? pinOutpost)(this.baseid(), pin));
    } catch (error) {
      this.showError(errorWords(error));
    } finally {
      this.pinning = false;
      if (!this.renaming) this.renderName();
    }
  }

  /**
   * Where the yard is: its cell and, for an outpost, how far from the main
   * yard. An unnamed outpost already says its cell in its name, so the cell
   * is said once.
   */
  private renderWhere(): void {
    const cell = this.shown;
    const outpost = this.facts?.outpost ?? false;
    const named = outpost && (outpostLabels().names[this.baseid()] ?? "") !== "";
    const parts = !outpost || named ? [cellText(cell)] : [];
    const away = outpost ? this.options.cellsFromHome?.(cell) ?? null : null;
    if (away !== null && away > 0) parts.push(`${cellsText(away)} ${YARD_CARD_TEXT.fromMain}`);
    this.where.textContent = parts.join(" · ");
    this.where.hidden = parts.length === 0;
  }

  /** The outpost's Starter Kit as the kit's own picture and name; nothing on the main yard. */
  private renderKit(facts: YardCardFacts): void {
    this.kit.hidden = !facts.outpost;
    if (!facts.outpost) {
      this.kit.replaceChildren();
      return;
    }
    const kit = facts.kit;
    this.kit.classList.toggle("yard-card__kit--none", kit === null);
    this.kit.dataset["kit"] = kit ? String(kit.id) : "0";
    const words = make("span", "yard-card__kit-words");
    if (kit) {
      words.append(make("span", "yard-card__kit-label", YARD_CARD_TEXT.kit), make("span", "yard-card__kit-name", kit.name));
      this.kit.replaceChildren(picture(kit.thumbnail, "yard-card__kit-picture"), words);
    } else {
      words.append(make("span", "yard-card__kit-name", YARD_CARD_TEXT.noKit));
      this.kit.replaceChildren(words);
    }
  }

  private renderChips(payload: PlayerCell, outpost: boolean): void {
    this.chips.replaceChildren();
    this.countdown = null;
    // Height only matters on an outpost: towers reach and income scale by it.
    if (outpost) {
      const bonus = heightBonus(payload.i);
      this.chips.append(
        this.bonusChip("range", YARD_CARD_TEXT.towerReach, bonus.towerPct, (more) =>
          `This outpost's height: its towers reach ${Math.abs(bonus.towerPct)}% ${more ? "farther" : "less far"}.`,
        ),
        this.bonusChip("income", YARD_CARD_TEXT.income, bonus.incomePct, (more) =>
          `This outpost's height: it earns ${Math.abs(bonus.incomePct)}% ${more ? "more" : "less"} resources.`,
        ),
      );
      const land = landFeatureChip(payload.lf);
      // A land with a bonus says its name beside its picture, not only on hover.
      const picture = land.querySelector<HTMLImageElement>(".mr2-land-icon");
      if (picture?.alt) picture.after(make("span", "yard-card__chip-label", picture.alt));
      this.chips.append(land);
    }
    addNeighbourBonusChip(this.chips, payload);
    const neighbours = this.chips.querySelector(".mr2-chip--neighbours .icon-amount > :first-child");
    neighbours?.after(make("span", "yard-card__chip-label", YARD_CARD_TEXT.neighbours));
    if (payload.d === 1) this.chips.append(this.chip("yarddamage", "Destroyed", "danger"));
    else if (payload.dm > 0) this.chips.append(this.chip("yarddamage", `${payload.dm}%`, "danger", "Damage"));
    const now = Date.now() / 1000;
    if (payload.p === 1) {
      const chip = this.chip("shield", "Protected", "info", "Under damage protection.");
      if (payload.pe !== undefined && payload.pe > now) {
        const label = chip.querySelector<HTMLElement>(".yard-card__chip-text");
        if (label) {
          this.countdown = { node: label, expiresAt: payload.pe };
          label.textContent = `Protected ${formatCountdown(payload.pe - now)}`;
        }
      }
      this.chips.append(chip);
    }
    if (outpost && payload.pi > 0) {
      this.chips.append(this.chip("time", "Invite pending", "info", "A player is invited to move their main yard here."));
    }
    this.chips.hidden = this.chips.childElementCount === 0;
  }

  /** "[tower] Tower reach +34%": what the ground's bonus is for, its sign coloured. */
  private bonusChip(name: "range" | "income", label: string, percent: number, sentence: (more: boolean) => string): HTMLElement {
    const chip = make("span", "mr2-chip mr2-chip--info yard-card__bonus");
    chip.dataset["bonus"] = name;
    const amount = iconAmount(name, `${Math.abs(percent)}%`, {
      size: 24,
      decorative: true,
      className: "ground-bonus",
      ...(percent > 0 ? { change: "gain" as const } : percent < 0 ? { change: "loss" as const } : {}),
    });
    amount.firstElementChild?.after(make("span", "yard-card__chip-label", label));
    chip.append(amount);
    chip.title = percent === 0 ? `${label}: no change from this outpost's height.` : sentence(percent > 0);
    return chip;
  }

  private chip(
    name: "yarddamage" | "shield" | "time",
    text: string,
    tone: "danger" | "info",
    title?: string,
  ): HTMLElement {
    const chip = make("span", `mr2-chip mr2-chip--${tone} yard-card__chip`);
    chip.append(gameIcon(name, { size: 24, decorative: true }), make("span", "yard-card__chip-text", text));
    if (title) chip.title = title;
    return chip;
  }

  private renderStats(cell: OffsetCell, payload: PlayerCell, facts: YardCardFacts): void {
    const tiles: HTMLElement[] = [];

    const flinger = this.options.ownFlinger(cell, payload);
    const reach = flinger.reach > 0 ? cellsText(flinger.reach) : YARD_CARD_TEXT.noFlinger;
    const detail =
      flinger.level <= 0
        ? "Build one to attack"
        : flinger.bonus > 0
          ? `Level ${flinger.level} · +${flinger.bonus} war`
          : `Level ${flinger.level}`;
    tiles.push(
      this.stat(gameIcon("range", { size: 32, decorative: true }), YARD_CARD_TEXT.flinger, reach, detail, "flinger"),
    );

    if (facts.worker) {
      const art = picture(facts.worker === "idle" ? IDLE_HELPER_URL : CONSTRUCTION_BADGE_URL, "yard-card__worker-art");
      tiles.push(
        this.stat(
          art,
          YARD_CARD_TEXT.worker,
          facts.worker === "idle" ? YARD_CARD_TEXT.idle : YARD_CARD_TEXT.busy,
          null,
          `worker yard-card__stat--${facts.worker}`,
        ),
      );
    }

    if (facts.storage) {
      const stores = make("div", "yard-card__stat yard-card__stat--storage");
      stores.setAttribute("aria-label", YARD_CARD_TEXT.storage);
      const row = make("div", "yard-card__stores");
      for (const store of facts.storage) {
        row.append(
          resourceAmount(store.key, `${store.percent}%`, {
            className: store.percent >= 100 ? "yard-card__store yard-card__store--full" : "yard-card__store",
          }),
        );
      }
      stores.append(make("span", "yard-card__stat-label", YARD_CARD_TEXT.storage), row);
      tiles.push(stores);
    }

    this.stats.replaceChildren(...tiles);
  }

  private stat(art: HTMLElement, label: string, value: string, detail: string | null, kind: string): HTMLElement {
    const tile = make("div", `yard-card__stat yard-card__stat--${kind}`);
    const holder = make("span", "yard-card__stat-art");
    holder.append(art);
    const words = make("span", "yard-card__stat-words");
    words.append(make("span", "yard-card__stat-label", label), make("span", "yard-card__stat-value", value));
    if (detail) words.append(make("span", "yard-card__stat-detail", detail));
    tile.append(holder, words);
    return tile;
  }

  private renderHoused(facts: YardCardFacts): void {
    const percent = housingPercent(facts);
    this.housedCount.replaceChildren(
      iconAmount("housing", facts.capacity > 0 ? `${formatAmount(facts.used)} / ${formatAmount(facts.capacity)}` : formatAmount(facts.used), {
        size: 16,
        decorative: true,
        className: "yard-card__housing",
      }),
    );
    this.housedCount.title = facts.capacity > 0 ? `Housing used: ${formatAmount(facts.used)} of ${formatAmount(facts.capacity)}` : "Housing used";
    this.bar.hidden = facts.capacity <= 0;
    this.bar.setAttribute("aria-valuenow", String(percent));
    this.bar.classList.toggle("yard-card__bar--full", percent >= 100);
    this.barFill.style.width = `${percent}%`;

    if (facts.housed.length === 0) {
      const empty = make("li", "yard-card__empty", YARD_CARD_TEXT.noMonsters);
      this.grid.replaceChildren(empty);
      return;
    }
    this.grid.replaceChildren(
      ...facts.housed.map(({ id, count }) => {
        const name = monsterName(id);
        const tile = make("li", "yard-card__monster");
        tile.dataset["monster"] = id;
        tile.title = `${name}: ${formatAmount(count)}`;
        const image = make("img", "yard-card__portrait");
        const portrait = monsterPortrait(id, "icon");
        showPortrait(image, portrait);
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        // Modern's painted portraits bring their own painted ground: the
        // picture fills the tile as one painted card, name and count on a dark
        // strip over its foot (the attack window's way). Classic's cut-outs
        // stand on the tile, as does a painted one that failed to its cut-out.
        if (portrait.fallback !== null) {
          tile.classList.add("yard-card__monster--painted");
          image.addEventListener("load", () => {
            if (image.getAttribute("src") !== portrait.src) tile.classList.remove("yard-card__monster--painted");
          });
        }
        const caption = make("span", "yard-card__caption");
        caption.append(make("span", "yard-card__monster-name", name), make("span", "yard-card__count", `×${formatAmount(count)}`));
        tile.append(image, caption);
        tile.setAttribute("aria-label", `${name}: ${formatAmount(count)}`);
        return tile;
      }),
    );
  }

  private renderActions(cell: OffsetCell, payload: PlayerCell, facts: YardCardFacts): void {
    const outpost = facts.outpost;
    setLabel(this.openButton, outpost ? YARD_CARD_TEXT.openOutpost : YARD_CARD_TEXT.openMain);
    this.openButton.title = outpost ? "Open your outpost" : "Open your yard";

    const moves = this.options.ownMoves?.(cell, payload) ?? { monsters: false, relocate: false };
    this.moveFromButton.hidden = !moves.monsters || !this.options.onMoveFrom;
    this.moveFromButton.disabled = facts.monsters === 0;
    this.moveFromButton.title = facts.monsters === 0 ? YARD_CARD_TEXT.noMonsters : "Send monsters from here to another of your yards.";
    this.bringButton.hidden = !moves.monsters || !this.options.onBringHere;
    this.bringButton.title = "Bring monsters here from another of your yards.";

    this.relocateButton.hidden = !moves.relocate || !this.options.onRelocate;
    // Invite is an own outpost's, as Flash's `bInviteMigrate` was (`PopupInfoMine.as:171`).
    const pending = outpost && payload.pi > 0;
    this.inviteButton.hidden = !outpost || !this.options.onInvite;
    setLabel(this.inviteButton, pending ? YARD_CARD_TEXT.withdraw : YARD_CARD_TEXT.invite);
    this.inviteButton.title = pending
      ? "Withdraw the invitation waiting on this outpost."
      : "Invite a player to move their main yard here. It replaces this outpost.";
    this.bookmarkButton.hidden = !this.options.canBookmark();
    this.secondRow.hidden = this.relocateButton.hidden && this.inviteButton.hidden && this.bookmarkButton.hidden;
  }

  private showError(words: string | null): void {
    this.error.textContent = words ?? "";
    this.error.hidden = !words;
  }
}
