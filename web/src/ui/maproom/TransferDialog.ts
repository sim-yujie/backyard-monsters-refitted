import {
  TRANSFER_TEXT,
  clampTransfer,
  countsList,
  freeSpace,
  maxOf,
  partlyMovedText,
  totalOf,
  transferBlobs,
  type TransferYard,
} from "@/game/maproom/moveYards";
import { monsterName, portraitUrl } from "@/ui/attack/ArmyPanel";
import { formatAmount } from "@/ui/format";
import { Popup } from "@/ui/Popup";
import { QuantityStepper } from "@/ui/QuantityStepper";

/**
 * "Move monsters" (outposts WP7, #186): Flash's two-step transfer
 * (`PopupMonstersA.as`, pick the monsters; then click the target yard on the
 * map; `PopupMonstersB.as`, confirm) as one dialog. The player picks where
 * from and where to among their own yards, then how many of each monster; the
 * target's free housing is shown and no count can go past it, the way Flash
 * cut a transfer down as it sent it (`MapRoom.as:811-849`).
 *
 * One end is always an outpost, as the server requires
 * (`transferRules.ts`, "one end of a transfer has to be an outpost"): a main
 * yard only sends to outposts.
 */

/** One of the player's yards the dialog can pick. */
export interface TransferChoice {
  readonly baseid: string;
  /** "Main yard", "Outpost (230, 215)". */
  readonly label: string;
  readonly main: boolean;
}

export interface TransferDialogOptions {
  /** Every yard of the player's, main yard first. */
  readonly yards: readonly TransferChoice[];
  /** The yard the dialog opens from. */
  readonly from: string;
  /** Reads a yard's roster and room as the server has them now. */
  readonly load: (baseid: string) => Promise<TransferYard>;
  /** Housing space one monster of a type takes, at the player's academy level. */
  readonly sizeOf: (id: string) => number;
  /** Sends the two rosters; rejects with the server's refusal. */
  readonly send: (
    from: string,
    to: string,
    rosters: readonly [{ housed: Record<string, number> }, { housed: Record<string, number> }],
  ) => Promise<unknown>;
  /** The move went through. The dialog has closed itself by then. */
  readonly onMoved: (from: string, to: string, message: string) => void;
}

interface Row {
  readonly id: string;
  readonly stepper: QuantityStepper;
}

export class TransferDialog {
  readonly popup: Popup;

  private readonly options: TransferDialogOptions;
  private readonly fromSelect: HTMLSelectElement;
  private readonly toSelect: HTMLSelectElement;
  private readonly room: HTMLElement;
  private readonly list: HTMLElement;
  private readonly goButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private rows: Row[] = [];
  private picked: Record<string, number> = {};
  private from: TransferYard | null = null;
  private to: TransferYard | null = null;
  /** Bumped per load, so an old yard's answer arriving late is dropped. */
  private request = 0;
  private busy = false;

  constructor(options: TransferDialogOptions) {
    this.options = options;
    // Every way out (Cancel, the close button, Escape, the scrim) lets go of the steppers.
    this.popup = new Popup({
      title: TRANSFER_TEXT.title,
      className: "transfer-dialog",
      onClose: () => {
        for (const row of this.rows) row.stepper.destroy();
      },
    });

    const lead = text("p", "transfer-dialog__lead", TRANSFER_TEXT.lead);

    this.fromSelect = select("Move monsters from");
    this.toSelect = select("Move monsters to");
    for (const yard of options.yards) this.fromSelect.append(optionFor(yard));
    this.fromSelect.value = options.from;
    this.fromSelect.addEventListener("change", () => {
      this.fillTargets();
      void this.reload();
    });
    this.toSelect.addEventListener("change", () => void this.reload());
    this.fillTargets();

    const ends = document.createElement("div");
    ends.className = "transfer-dialog__ends";
    ends.append(field(TRANSFER_TEXT.from, this.fromSelect), field(TRANSFER_TEXT.to, this.toSelect));

    this.room = text("p", "transfer-dialog__room", "");
    this.room.setAttribute("aria-live", "polite");
    this.list = document.createElement("ul");
    this.list.className = "transfer-dialog__list";
    this.list.setAttribute("aria-label", "Monsters to move");

    const cancel = button("Cancel", "btn btn--ghost");
    cancel.addEventListener("click", () => this.close());
    this.goButton = button(TRANSFER_TEXT.go, "btn btn--primary transfer-dialog__go");
    this.goButton.addEventListener("click", () => void this.go());
    const actions = document.createElement("div");
    actions.className = "takeover-dialog__actions";
    actions.append(cancel, this.goButton);

    this.status = text("p", "takeover-dialog__status", "");
    this.status.setAttribute("role", "status");
    this.status.setAttribute("aria-live", "polite");
    this.status.hidden = true;

    this.popup.setContent(lead, ends, this.room, this.list, this.status, actions);
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

  /** Targets for the chosen source: the other yards, outposts only from the main yard. */
  private fillTargets(): void {
    const from = this.options.yards.find((yard) => yard.baseid === this.fromSelect.value);
    const previous = this.toSelect.value;
    const targets = this.options.yards.filter(
      (yard) => yard.baseid !== from?.baseid && !(from?.main && yard.main),
    );
    this.toSelect.replaceChildren(...targets.map(optionFor));
    if (targets.some((yard) => yard.baseid === previous)) this.toSelect.value = previous;
  }

  /** Reads both ends afresh, then redraws the rows. */
  private async reload(): Promise<void> {
    const request = ++this.request;
    this.from = null;
    this.to = null;
    this.picked = {};
    this.render();
    const fromId = this.fromSelect.value;
    const toId = this.toSelect.value;
    if (!fromId || !toId) return;
    try {
      const [from, to] = await Promise.all([this.options.load(fromId), this.options.load(toId)]);
      if (request !== this.request) return;
      this.from = from;
      this.to = to;
    } catch (caught) {
      if (request !== this.request) return;
      this.showStatus(TRANSFER_TEXT.problem + messageOf(caught), true);
    }
    this.buildRows();
    this.render();
  }

  private buildRows(): void {
    for (const row of this.rows) row.stepper.destroy();
    this.rows = [];
    this.list.replaceChildren();
    const from = this.from;
    if (!from) return;
    for (const { id, count } of countsList(from.housed)) {
      const name = monsterName(id);
      const stepper = new QuantityStepper({
        block: "transfer-row",
        inputLabel: `${name} to move`,
        fewerLabel: `Fewer ${name}`,
        moreLabel: `More ${name}`,
        fillTitle: `As many ${name} as fit`,
        value: () => this.picked[id] ?? 0,
        set: (value) => this.set(id, value),
        fill: () => this.set(id, Number.POSITIVE_INFINITY),
        commit: () => this.render(),
      });
      const item = document.createElement("li");
      item.className = "transfer-row";
      const picture = document.createElement("img");
      picture.className = "transfer-row__picture";
      picture.src = portraitUrl(id);
      picture.alt = "";
      picture.decoding = "async";
      const have = text("span", "transfer-row__have", `${formatAmount(count)} here`);
      const label = document.createElement("span");
      label.className = "transfer-row__label";
      label.append(text("span", "transfer-row__name", name), have);
      item.append(picture, label, stepper.element);
      this.list.append(item);
      this.rows.push({ id, stepper });
    }
  }

  /** Sets one count, cut to what the source has and the target can house. */
  private set(id: string, value: number): void {
    const { from, to } = this;
    if (!from || !to) return;
    const cap = maxOf(id, this.picked, from, to, this.options.sizeOf);
    const next = Math.max(0, Math.min(Math.floor(value), cap));
    if (next > 0) this.picked = { ...this.picked, [id]: next };
    else {
      const rest = { ...this.picked };
      delete rest[id];
      this.picked = rest;
    }
    this.render();
  }

  private render(): void {
    const { from, to } = this;
    const loading = !from || !to;
    const total = totalOf(this.picked);
    this.goButton.disabled = this.busy || loading || total === 0;
    this.goButton.textContent = total > 0 ? `${TRANSFER_TEXT.go} ${formatAmount(total)}` : TRANSFER_TEXT.go;

    if (loading) {
      this.room.textContent = this.toSelect.value ? "Loading…" : TRANSFER_TEXT.noOutposts;
      this.room.classList.remove("transfer-dialog__room--full");
      return;
    }

    const sizeOf = this.options.sizeOf;
    const used = Object.entries(this.picked).reduce((sum, [id, count]) => sum + count * sizeOf(id), 0);
    const left = Math.max(0, freeSpace(to, sizeOf) - used);
    const toLabel = this.options.yards.find((yard) => yard.baseid === to.baseid)?.label ?? "the target";
    this.room.textContent =
      to.space <= 0
        ? TRANSFER_TEXT.noHousing
        : countsList(from.housed).length === 0
          ? TRANSFER_TEXT.none
          : `Room left at ${toLabel}: ${formatAmount(left)} of ${formatAmount(to.space)}`;
    this.room.classList.toggle("transfer-dialog__room--full", to.space <= 0 || left === 0);

    for (const row of this.rows) {
      const value = this.picked[row.id] ?? 0;
      row.stepper.sync({
        value,
        max: maxOf(row.id, this.picked, from, to, sizeOf),
        disabled: this.busy,
        rewrite: document.activeElement !== row.stepper.input,
      });
    }
  }

  private async go(): Promise<void> {
    const { from, to } = this;
    if (!from || !to || this.busy) return;
    const wanted = totalOf(this.picked);
    const moved = clampTransfer(this.picked, from, to, this.options.sizeOf);
    const count = totalOf(moved);
    if (count === 0) {
      this.showStatus(to.space <= 0 ? TRANSFER_TEXT.noHousing : TRANSFER_TEXT.none, true);
      return;
    }
    this.busy = true;
    this.showStatus(TRANSFER_TEXT.busy, false);
    this.render();
    try {
      await this.options.send(from.baseid, to.baseid, transferBlobs(from, to, moved));
    } catch (caught) {
      this.busy = false;
      this.showStatus(TRANSFER_TEXT.problem + messageOf(caught), true);
      this.render();
      return;
    }
    this.close();
    this.options.onMoved(from.baseid, to.baseid, count < wanted ? partlyMovedText(count) : TRANSFER_TEXT.done);
  }

  private showStatus(message: string, failed: boolean): void {
    this.status.textContent = message;
    this.status.classList.toggle("takeover-dialog__status--failed", failed);
    this.status.hidden = false;
  }
}

const messageOf = (caught: unknown): string => {
  if ((caught as { name?: unknown } | null)?.name === "NetworkError") return "the server could not be reached.";
  return caught instanceof Error && caught.message ? caught.message : "something went wrong.";
};

const text = (tag: "p" | "span", className: string, content: string): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = content;
  return element;
};

const button = (label: string, className: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  return element;
};

const select = (label: string): HTMLSelectElement => {
  const element = document.createElement("select");
  element.className = "field__input transfer-dialog__select";
  element.setAttribute("aria-label", label);
  return element;
};

const optionFor = (yard: TransferChoice): HTMLOptionElement => {
  const element = document.createElement("option");
  element.value = yard.baseid;
  element.textContent = yard.label;
  return element;
};

const field = (label: string, control: HTMLElement): HTMLElement => {
  const element = document.createElement("label");
  element.className = "field transfer-dialog__field";
  element.append(text("span", "field__label", label), control);
  return element;
};
