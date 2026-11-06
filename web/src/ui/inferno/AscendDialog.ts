import {
  ASCEND_TEXT,
  ascendedText,
  compoundRows,
  housingBar,
  maxPick,
  pickedSpace,
  type CompoundRow,
  type HousingRoom,
} from "@/game/inferno/transfer";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { monsterName } from "@/game/combat/rules/report";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { QuantityStepper } from "@/ui/QuantityStepper";
import "@/ui/styles/inferno.css";

/**
 * "Transfer Monsters" from the cave on the main yard (WP 2.6,
 * `docs/design/inferno.md` §2.7; Flash's `INFERNO_ASCENSION_POPUP.as`): the
 * Inferno monsters in the Compound, one row each with how many are picked of
 * how many there are, the main yard's Housing as a bar with the picks shown
 * after what is housed, and "Transfer Monsters". No pick can go past what the
 * Compound holds or what still fits in the Housing, as Flash's `+` could not.
 * Free and one way: there is no price and no way back down.
 */

export interface AscendDialogOptions {
  /** The Compound's monsters, as the server has them now (`/bm/inferno/load`). */
  readonly load: () => Promise<Readonly<Record<string, unknown>>>;
  /** The main yard's Housing now. */
  readonly room: () => HousingRoom;
  /** Housing space one monster of a type takes. */
  readonly sizeOf: (id: string) => number;
  /** Sends the picks; resolves with the refusal's sentence, or null once they came up. Rejects when nothing answered. */
  readonly send: (picked: Readonly<Record<string, number>>) => Promise<string | null>;
  /** They came up. The dialog has closed itself by then. */
  readonly onDone: (message: string) => void;
}

interface Row {
  readonly id: string;
  readonly stepper: QuantityStepper;
  readonly have: HTMLElement;
}

export class AscendDialog {
  readonly popup: Popup;

  private readonly options: AscendDialogOptions;
  private readonly list: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly fillQueued: HTMLElement;
  private readonly label: HTMLElement;
  private readonly note: HTMLElement;
  private readonly goButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private compound: CompoundRow[] | null = null;
  private rows: Row[] = [];
  private picked: Record<string, number> = {};
  private busy = false;

  constructor(options: AscendDialogOptions) {
    this.options = options;
    this.popup = new Popup({
      title: ASCEND_TEXT.title,
      className: "inferno-popup ascend-dialog",
      onClose: () => {
        for (const row of this.rows) row.stepper.destroy();
      },
    });

    const heading = text("h3", "ascend-dialog__action", ASCEND_TEXT.action);
    const lead = text("p", "ascend-dialog__lead", ASCEND_TEXT.lead);
    const free = text("p", "ascend-dialog__free", ASCEND_TEXT.free);

    const capacity = document.createElement("div");
    capacity.className = "ascend-dialog__capacity";
    const bar = document.createElement("div");
    bar.className = "ascend-bar";
    this.fill = text("span", "ascend-bar__stored", "");
    this.fillQueued = text("span", "ascend-bar__queued", "");
    bar.append(this.fill, this.fillQueued);
    this.label = text("span", "ascend-dialog__figure", "");
    this.label.setAttribute("aria-live", "polite");
    const head = document.createElement("div");
    head.className = "ascend-dialog__capacity-head";
    head.append(text("span", "ascend-dialog__capacity-name", ASCEND_TEXT.capacity), this.label);
    capacity.append(head, bar);

    this.list = document.createElement("ul");
    this.list.className = "ascend-dialog__list";
    this.list.setAttribute("aria-label", "Inferno monsters to transfer");
    this.note = text("p", "ascend-dialog__note", ASCEND_TEXT.loading);

    this.status = text("p", "ascend-dialog__status", "");
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.goButton = document.createElement("button");
    this.goButton.type = "button";
    this.goButton.className = "btn btn--primary ascend-dialog__go";
    this.goButton.textContent = ASCEND_TEXT.go;
    this.goButton.addEventListener("click", () => void this.go());
    const actions = document.createElement("div");
    actions.className = "inferno-popup__actions";
    actions.append(this.goButton);

    this.popup.setContent(heading, lead, free, capacity, this.note, this.list, this.status, actions);
    this.render();
    void this.reload();
  }

  mount(container: HTMLElement): this {
    this.popup.mount(container);
    return this;
  }

  close(): void {
    this.popup.close();
  }

  /** The picked counts, for the tests. */
  get picks(): Readonly<Record<string, number>> {
    return this.picked;
  }

  private async reload(): Promise<void> {
    try {
      this.compound = compoundRows(await this.options.load());
    } catch (caught) {
      this.compound = [];
      this.showStatus(ASCEND_TEXT.problem + messageOf(caught));
    }
    this.buildRows();
    this.render();
  }

  private buildRows(): void {
    for (const row of this.rows) row.stepper.destroy();
    this.rows = [];
    this.list.replaceChildren();
    for (const { id } of this.compound ?? []) {
      const name = monsterName(id);
      const stepper = new QuantityStepper({
        block: "ascend-row",
        inputLabel: `${name} to transfer`,
        fewerLabel: `Fewer ${name}`,
        moreLabel: `More ${name}`,
        fillTitle: `As many ${name} as fit`,
        value: () => this.picked[id] ?? 0,
        set: (value) => this.set(id, value),
        fill: () => this.set(id, Number.POSITIVE_INFINITY),
        commit: () => this.render(),
      });
      const item = document.createElement("li");
      item.className = "ascend-row";
      item.dataset["monster"] = id;
      const picture = document.createElement("img");
      picture.className = "ascend-row__picture";
      showPortrait(picture, monsterPortrait(id, "icon"));
      picture.alt = "";
      picture.decoding = "async";
      const have = text("span", "ascend-row__have", "");
      const label = document.createElement("span");
      label.className = "ascend-row__label";
      label.append(text("span", "ascend-row__name", name), have);
      item.append(picture, label, stepper.element);
      this.list.append(item);
      this.rows.push({ id, stepper, have });
    }
  }

  private set(id: string, value: number): void {
    const compound = this.compound;
    if (!compound) return;
    const top = maxPick(id, this.picked, compound, this.options.room(), this.options.sizeOf);
    const next = Math.max(0, Math.min(Math.floor(value), top));
    const rest = { ...this.picked };
    if (next > 0) rest[id] = next;
    else delete rest[id];
    this.picked = rest;
    this.render();
  }

  private render(): void {
    const room = this.options.room();
    const space = pickedSpace(this.picked, this.options.sizeOf);
    const bar = housingBar(room, space);
    this.fill.style.width = `${bar.stored * 100}%`;
    this.fillQueued.style.width = `${bar.queued * 100}%`;
    this.label.textContent = bar.label;

    const compound = this.compound;
    const total = Object.values(this.picked).reduce((sum, count) => sum + count, 0);
    this.goButton.disabled = this.busy || !compound || total === 0;

    this.note.hidden = compound !== null && compound.length > 0;
    this.note.textContent = compound === null ? ASCEND_TEXT.loading : ASCEND_TEXT.none;
    if (!compound) return;

    for (const row of this.rows) {
      const picked = this.picked[row.id] ?? 0;
      const have = compound.find((entry) => entry.id === row.id)?.count ?? 0;
      // Flash's "queued / total".
      row.have.textContent = `${formatAmount(picked)} / ${formatAmount(have)}`;
      row.stepper.sync({
        value: picked,
        max: maxPick(row.id, this.picked, compound, room, this.options.sizeOf),
        disabled: this.busy,
        rewrite: document.activeElement !== row.stepper.input,
      });
    }
  }

  private async go(): Promise<void> {
    if (this.busy) return;
    const picked = { ...this.picked };
    const count = Object.values(picked).reduce((sum, n) => sum + n, 0);
    if (count === 0) return;
    this.busy = true;
    this.showStatus(ASCEND_TEXT.busy, false);
    this.render();
    let refusal: string | null;
    try {
      refusal = await this.options.send(picked);
    } catch (caught) {
      refusal = ASCEND_TEXT.problem + messageOf(caught);
    }
    this.busy = false;
    if (refusal !== null) {
      this.showStatus(refusal);
      this.render();
      return;
    }
    this.close();
    this.options.onDone(ascendedText(count));
  }

  private showStatus(message: string, failed = true): void {
    this.status.textContent = message;
    this.status.classList.toggle("ascend-dialog__status--failed", failed);
    this.status.hidden = false;
  }
}

const messageOf = (caught: unknown): string => {
  if ((caught as { name?: unknown } | null)?.name === "NetworkError") return "the server could not be reached.";
  return caught instanceof Error && caught.message ? caught.message : "something went wrong.";
};

const text = (tag: "p" | "span" | "h3", className: string, content: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
};
