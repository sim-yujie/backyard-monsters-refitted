import { OUTPOST_NAME_MAX, OUTPOST_PINS_MAX, pinOutpost, renameOutpost, type OutpostLabels } from "@/api/outpostLabels";
import type { PlayerCell } from "@/api/types";
import { monsterName } from "@/game/combat/rules";
import type { OffsetCell } from "@/game/HexGrid";
import { cellsText } from "@/game/maproom/attackRange";
import { CONSTRUCTION_BADGE_URL, IDLE_HELPER_URL } from "@/game/maproom/mapPicture";
import { housingPercent, yardCardFacts, type YardCardFacts } from "@/game/maproom/yardCard";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { MAIN_YARD_TITLE } from "@/game/yard/ownYards";
import { cellText, onOutpostLabels, outpostLabels, setOutpostLabels } from "@/game/yard/outpostLabels";
import { formatAmount, formatCountdown } from "@/ui/format";
import { gameIcon, iconAmount } from "@/ui/gameIcon";
import { Popup } from "@/ui/Popup";
import { resourceAmount } from "@/ui/resourceIcon";
import type { OwnFlinger, OwnMoves } from "./CellPanel";
import { GROUND_BONUS_TITLE, groundBonusIcons } from "./groundBonus";
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
  pin: "Pin to top",
  unpin: "Unpin",
  pinLimit: `You can pin up to ${OUTPOST_PINS_MAX} outposts.`,
  fromMain: "from main",
} as const;

const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const textButton = (className: string, label: string): HTMLButtonElement => {
  const node = make("button", className);
  node.type = "button";
  // A span keeps the words one box the skin's metrics centre (owner rule: 0 px off).
  node.append(make("span", "yard-card__label", label));
  return node;
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

    const firstRow = make("div", "yard-card__row");
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
    this.renderWhere(cell, outpost);
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

    const pinned = labels.pins.includes(this.baseid());
    const pin = make("button", "yard-card__tool yard-card__pin");
    pin.type = "button";
    pin.setAttribute("aria-pressed", String(pinned));
    pin.setAttribute("aria-label", pinned ? YARD_CARD_TEXT.unpin : YARD_CARD_TEXT.pin);
    pin.title = pinned ? YARD_CARD_TEXT.unpin : YARD_CARD_TEXT.pin;
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

  private renderWhere(cell: OffsetCell, outpost: boolean): void {
    const parts = [cellText(cell)];
    const away = outpost ? this.options.cellsFromHome?.(cell) ?? null : null;
    if (away !== null && away > 0) parts.push(`${cellsText(away)} ${YARD_CARD_TEXT.fromMain}`);
    this.where.textContent = parts.join(" · ");
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
      const ground = make("span", "mr2-chip mr2-chip--info mr2-chip--ground");
      ground.title = GROUND_BONUS_TITLE;
      ground.append(...groundBonusIcons(payload.i));
      this.chips.append(ground, landFeatureChip(payload.lf));
    }
    addNeighbourBonusChip(this.chips, payload);
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
        showPortrait(image, monsterPortrait(id, "icon"));
        image.alt = "";
        image.decoding = "async";
        image.draggable = false;
        const badge = make("span", "yard-card__count", `×${formatAmount(count)}`);
        tile.append(image, badge, make("span", "yard-card__monster-name", name));
        tile.setAttribute("aria-label", `${name}: ${formatAmount(count)}`);
        return tile;
      }),
    );
  }

  private renderActions(cell: OffsetCell, payload: PlayerCell, facts: YardCardFacts): void {
    const outpost = facts.outpost;
    this.setLabel(this.openButton, outpost ? YARD_CARD_TEXT.openOutpost : YARD_CARD_TEXT.openMain);
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
    this.setLabel(this.inviteButton, pending ? YARD_CARD_TEXT.withdraw : YARD_CARD_TEXT.invite);
    this.inviteButton.title = pending
      ? "Withdraw the invitation waiting on this outpost."
      : "Invite a player to move their main yard here. It replaces this outpost.";
    this.bookmarkButton.hidden = !this.options.canBookmark();
    this.secondRow.hidden = this.relocateButton.hidden && this.inviteButton.hidden && this.bookmarkButton.hidden;
  }

  private setLabel(button: HTMLButtonElement, label: string): void {
    const span = button.querySelector(".yard-card__label");
    if (span) span.textContent = label;
  }

  private showError(words: string | null): void {
    this.error.textContent = words ?? "";
    this.error.hidden = !words;
  }
}
