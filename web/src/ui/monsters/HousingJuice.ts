import type { YardRefusal } from "@/api/yard";
import { JUICE_KEY, juiceActions, type JuiceActions } from "@/api/yardJuice";
import { housedRows, type HousedRow } from "@/game/monsters/housing";
import { juicePreview, juicerProblemText, juicerStatus, type JuicerStatus } from "@/game/monsters/juice";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount } from "@/ui/format";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { resourceAmount } from "@/ui/resourceIcon";
import { monsterPicture } from "./LockerTab";

/**
 * The Housing tab's Monster Juicer section (`docs/design/yard-buildings.md`
 * §7.3, issue #122): pick how many of each housed monster to juice, see the
 * goo it comes to, and juice them in one request.
 *
 * One row per housed type with a {@link QuantityStepper} (its Fill takes every
 * one of that type), then **Select all**, **Clear** and **Juice selected ·
 * goo**. Juicing destroys the monsters, so the button opens an inline
 * confirmation that states the goo, and what the goo cap would swallow, before
 * anything is sent. Without a working Juicer the section says why instead
 * (none built, still building, upgrading, too damaged), in the server's words.
 *
 * The selection is the section's own; it is clamped to what housing holds on
 * every redraw, so a monster that left (fed, hatched away, culled) drops out.
 * A step redraws only the figures and the buttons, never the rows, so a held
 * `+` keeps its button.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export interface HousingJuiceOptions {
  readonly store: YardStore;
  /** Tells the tab to show an outcome on its status line. */
  readonly onStatus: (status: Status) => void;
  /** The juice route; `juiceActions(store)` unless a test swaps it. */
  readonly actions?: JuiceActions;
}

export class HousingJuice {
  readonly element: HTMLElement;

  private readonly store: YardStore;
  private readonly actions: JuiceActions;
  private readonly onStatus: HousingJuiceOptions["onStatus"];
  private readonly selection = new Map<string, number>();
  private readonly steppers = new Map<string, QuantityStepper>();
  private rows: readonly HousedRow[] = [];
  private status: JuicerStatus | null = null;
  private confirming = false;
  private footer: HTMLElement | null = null;
  private juiceButton: HTMLButtonElement | null = null;
  private selectAll: HTMLButtonElement | null = null;
  private clear: HTMLButtonElement | null = null;
  private confirmButton: HTMLButtonElement | null = null;

  constructor(options: HousingJuiceOptions) {
    this.store = options.store;
    this.onStatus = options.onStatus;
    this.actions = options.actions ?? juiceActions(options.store);
    this.element = document.createElement("div");
    this.element.className = "housing-juice";
  }

  /** Redraws from the store: the rows, the selection clamped to housing, the footer. */
  render(): void {
    this.status = juicerStatus(this.store.save);
    this.rows = housedRows(this.store.save);
    for (const [id, count] of this.selection) {
      const have = this.rows.find((row) => row.monster.id === id)?.count ?? 0;
      if (count > have) this.setSelected(id, have);
    }
    for (const stepper of this.steppers.values()) stepper.destroy();
    this.steppers.clear();
    this.footer = null;
    this.juiceButton = null;
    this.selectAll = null;
    this.clear = null;
    this.confirmButton = null;

    const status = this.status;
    if (!status.ok) {
      this.selection.clear();
      this.confirming = false;
      const note = document.createElement("p");
      note.className =
        status.problem === "noJuicer" ? "housing-juice__note" : "housing-juice__note housing-juice__note--bad";
      note.textContent = juicerProblemText(status.problem);
      this.element.replaceChildren(note);
      return;
    }

    const intro = document.createElement("p");
    intro.className = "housing-juice__note";
    intro.textContent = `Level ${status.level} Juicer: each monster gives back ${Math.round(status.rate * 100)}% of its hatch cost in goo. Juiced monsters are gone for good.`;

    if (this.rows.length === 0) {
      this.selection.clear();
      this.confirming = false;
      const empty = document.createElement("p");
      empty.className = "housing-juice__note";
      empty.textContent = "No monsters housed to juice.";
      this.element.replaceChildren(intro, empty);
      return;
    }

    const list = document.createElement("ul");
    list.className = "housing-juice__list";
    list.setAttribute("aria-label", "Monsters to juice");
    for (const row of this.rows) list.append(this.rowItem(row));

    this.footer = document.createElement("div");
    this.footer.className = "housing-juice__footer";
    this.element.replaceChildren(intro, list, this.footer);
    this.drawFooter();
    this.sync();
  }

  /** Disables the buttons while the juice request runs. */
  syncPending(): void {
    const running = this.store.isRunning(JUICE_KEY);
    if (this.juiceButton) this.juiceButton.disabled = running || this.selectedCount() === 0;
    if (this.confirmButton) this.confirmButton.disabled = running;
  }

  destroy(): void {
    for (const stepper of this.steppers.values()) stepper.destroy();
    this.steppers.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private rowItem(row: HousedRow): HTMLElement {
    const { monster } = row;
    const item = document.createElement("li");
    item.className = "housing-juice__row";
    item.dataset["monster"] = monster.id;

    const name = document.createElement("span");
    name.className = "housing-juice__name";
    const label = document.createElement("strong");
    label.textContent = monster.name;
    const have = document.createElement("span");
    have.className = "housing-juice__have";
    have.textContent = `${formatAmount(row.count)} housed`;
    const words = document.createElement("span");
    words.className = "housing-juice__words";
    words.append(label, have);
    name.append(monsterPicture(monster, "small", "housing-juice__picture"), words);

    const stepper = new QuantityStepper({
      block: "housing-juice",
      inputLabel: `${monster.name} to juice`,
      fewerLabel: `Fewer ${monster.name}`,
      moreLabel: `More ${monster.name}`,
      fillTitle: `Every ${monster.name} you have`,
      value: () => this.selection.get(monster.id) ?? 0,
      set: (value) => this.change(monster.id, value),
      fill: () => this.change(monster.id, row.count),
      commit: () => this.sync(true),
    });
    stepper.fill.textContent = "All";
    this.steppers.set(monster.id, stepper);

    item.append(name, stepper.element);
    return item;
  }

  private drawFooter(): void {
    const footer = this.footer;
    if (!footer) return;
    this.juiceButton = null;
    this.confirmButton = null;

    if (this.confirming) {
      const preview = this.preview();
      const wrap = document.createElement("div");
      wrap.className = "housing-juice__confirm";
      wrap.setAttribute("role", "group");
      wrap.setAttribute("aria-label", "Confirm juice");
      const question = document.createElement("p");
      question.className = "housing-juice__question";
      question.append(
        `Juice ${formatAmount(preview.count)} ${preview.count === 1 ? "monster" : "monsters"} for `,
        resourceAmount("r4", formatAmount(preview.credited)),
        "? They are gone for good.",
      );
      wrap.append(question);
      if (preview.lost > 0) {
        const lost = document.createElement("p");
        lost.className = "housing-juice__lost";
        lost.append("Your goo storage is full: ", resourceAmount("r4", formatAmount(preview.lost)), " will not fit and is lost.");
        wrap.append(lost);
      }
      const row = document.createElement("div");
      row.className = "map-row";
      const confirm = button("Yes, juice", () => void this.runJuice(), "btn--danger");
      confirm.classList.add("housing-juice__yes");
      const keep = button("Keep them", () => this.setConfirming(false));
      this.confirmButton = confirm;
      row.append(confirm, keep);
      wrap.append(row);
      wrap.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        this.setConfirming(false);
      });
      footer.replaceChildren(wrap);
      this.syncPending();
      return;
    }

    this.selectAll = button("Select all", () => {
      for (const row of this.rows) this.selection.set(row.monster.id, row.count);
      this.sync(true);
    }, "btn--ghost");
    this.clear = button("Clear", () => {
      this.selection.clear();
      this.sync(true);
    }, "btn--ghost");
    this.juiceButton = button("", () => this.setConfirming(true), "btn--primary");
    this.juiceButton.classList.add("housing-juice__go");
    footer.replaceChildren(this.selectAll, this.clear, this.juiceButton);
  }

  /** Redraws the figures and buttons after the selection changed; `rewrite` also rewrites typed boxes. */
  private sync(rewrite = false): void {
    for (const row of this.rows) {
      const stepper = this.steppers.get(row.monster.id);
      if (!stepper) continue;
      stepper.sync({
        value: this.selection.get(row.monster.id) ?? 0,
        max: row.count,
        disabled: this.confirming,
        rewrite: rewrite || document.activeElement !== stepper.input,
      });
    }
    const total = this.selectedCount();
    if (this.selectAll) {
      this.selectAll.disabled = this.rows.every((row) => (this.selection.get(row.monster.id) ?? 0) >= row.count);
    }
    if (this.clear) this.clear.disabled = total === 0;
    if (this.juiceButton) {
      const preview = this.preview();
      this.juiceButton.replaceChildren(
        total === 0 ? "Juice selected" : `Juice ${formatAmount(total)} · `,
        ...(total === 0 ? [] : [resourceAmount("r4", formatAmount(preview.goo))]),
      );
    }
    this.syncPending();
  }

  private change(id: string, value: number): void {
    const have = this.rows.find((row) => row.monster.id === id)?.count ?? 0;
    this.setSelected(id, value, have);
    this.sync();
  }

  private setSelected(id: string, value: number, max = value): void {
    const count = Math.max(0, Math.min(Math.floor(Number.isFinite(value) ? value : 0), max));
    if (count > 0) this.selection.set(id, count);
    else this.selection.delete(id);
  }

  private setConfirming(on: boolean): void {
    this.confirming = on && this.selectedCount() > 0;
    this.drawFooter();
    this.sync();
    if (this.confirming) this.confirmButton?.focus();
    else this.juiceButton?.focus();
  }

  private selectedCount(): number {
    let total = 0;
    for (const count of this.selection.values()) total += count;
    return total;
  }

  private preview() {
    const rate = this.status?.ok ? this.status.rate : 0;
    return juicePreview(
      this.store.save,
      Object.fromEntries(this.selection),
      rate,
      this.store.resources,
      this.store.caps,
    );
  }

  /* ── Action ─────────────────────────────────────────────────────────── */

  private async runJuice(): Promise<void> {
    const selection = Object.fromEntries(this.selection);
    const result = await this.actions.juice(selection);
    this.confirming = false;
    if (result.ok) {
      this.selection.clear();
      const { report } = result;
      const count = Object.values(report.juiced).reduce((sum, n) => sum + n, 0);
      const content: (Node | string)[] = [
        `Juiced ${formatAmount(count)} ${count === 1 ? "monster" : "monsters"}: `,
        resourceAmount("r4", formatAmount(report.goo)),
        " added.",
      ];
      if (report.lost > 0) {
        content.push(" Storage was full, so ", resourceAmount("r4", formatAmount(report.lost)), " was lost.");
      }
      this.onStatus({ tone: "good", content });
    } else {
      this.onStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.render();
  }
}

const button = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const element = document.createElement("button");
  element.type = "button";
  element.className = variant ? `btn ${variant}` : "btn";
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
