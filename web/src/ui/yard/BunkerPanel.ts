import type { YardRefusal } from "@/api/yard";
import { BunkerKey, bunkerActions, type BunkerActions } from "@/api/yardBunker";
import {
  bunkerState,
  fillCost,
  fillRows,
  rowMax,
  spaceEach,
  type BunkerSource,
  type BunkerState,
  type FillRow,
} from "@/game/monsters/bunker";
import { juiceGoo, juicerProblemText, juicerStatus, type JuicerStatus } from "@/game/monsters/juice";
import { compareListOrder, monsterEntry } from "@/game/monsters/monsterCatalogue";
import type { YardStore } from "@/game/yard/YardStore";
import { formatAmount } from "@/ui/format";
import { monsterPicture } from "@/ui/monsters/LockerTab";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/bunker.css";
import { ShinyButton } from "./ShinyButton";

/**
 * The Monster Bunker's controls, inside its building panel
 * (`docs/design/yard-buildings.md` §7.1, decision D11; issue #121).
 *
 * Opened by the panel's **Open bunker**. Top to bottom: the space used against
 * the bunker's room; **Put monsters in**, a From housing / Buy switch over one
 * row per monster with a {@link QuantityStepper} (Fill takes as many as are
 * housed and fit), and one **Move to bunker** (putty) or **Buy** (Shiny, two
 * taps) for the whole selection; then **In the bunker**, one row per monster
 * held with a stepper and **Juice** (a working Juicer) or **Remove** (none),
 * each confirmed inline because it cannot be undone.
 *
 * The Map Room 2 rule (D11): what goes in never comes back to housing, and
 * taking it out destroys it — for goo when a Juicer works. The panel says so
 * where the player decides.
 *
 * Steppers are kept while the player steps, so a held `+` keeps its button:
 * a step redraws only the figures and the buttons. {@link show} (every yard
 * change) rebuilds the rows with the selection clamped to what is left.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

export interface BunkerPanelOptions {
  readonly store: YardStore;
  readonly bunkerId: number;
  /** The routes; `bunkerActions(store)` unless a test swaps them. */
  readonly actions?: BunkerActions;
}

export class BunkerPanel {
  readonly element: HTMLElement;
  readonly bunkerId: number;

  private readonly store: YardStore;
  private readonly actions: BunkerActions;
  private readonly figures: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly fillBar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly switchButtons = new Map<BunkerSource, HTMLButtonElement>();
  private readonly fillNote: HTMLElement;
  private readonly fillList: HTMLElement;
  private readonly fillFooter: HTMLElement;
  private readonly outNote: HTMLElement;
  private readonly outList: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly moveGate: HTMLElement;
  private readonly buyButton: ShinyButton;

  private source: BunkerSource = "housing";
  private readonly selection = new Map<string, number>();
  private readonly outSelection = new Map<string, number>();
  private readonly steppers = new Map<string, QuantityStepper>();
  private readonly outSteppers = new Map<string, QuantityStepper>();
  private readonly outButtons = new Map<string, HTMLButtonElement>();
  private rows: FillRow[] = [];
  private state: BunkerState | null = null;
  private juicer: JuicerStatus | null = null;
  /** The monster whose Juice/Remove confirmation is open. */
  private confirmingOut: string | null = null;
  private confirmButton: HTMLButtonElement | null = null;

  constructor(options: BunkerPanelOptions) {
    this.store = options.store;
    this.bunkerId = options.bunkerId;
    this.actions = options.actions ?? bunkerActions(options.store);

    this.element = document.createElement("section");
    this.element.className = "bunker";
    this.element.setAttribute("aria-label", "Monster Bunker");

    const room = document.createElement("div");
    room.className = "bunker__room";
    this.figures = document.createElement("p");
    this.figures.className = "bunker__figures";
    this.bar = document.createElement("div");
    this.bar.className = "monsters-bar bunker__bar";
    this.bar.setAttribute("role", "meter");
    this.bar.setAttribute("aria-label", "Bunker space used");
    this.bar.setAttribute("aria-valuemin", "0");
    this.fillBar = document.createElement("div");
    this.fillBar.className = "monsters-bar__fill";
    this.bar.append(this.fillBar);
    room.append(this.figures, this.bar);

    this.status = document.createElement("p");
    this.status.className = "bunker__status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    // ── Put monsters in ──
    const fill = document.createElement("div");
    fill.className = "bunker__part bunker__part--in";
    const fillTitle = heading("Put monsters in");
    const toggle = document.createElement("div");
    toggle.className = "bunker-switch";
    toggle.setAttribute("role", "radiogroup");
    toggle.setAttribute("aria-label", "Where they come from");
    for (const [source, label] of [
      ["housing", "From housing"],
      ["buy", "Buy with Shiny"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bunker-switch__option";
      button.setAttribute("role", "radio");
      button.textContent = label;
      button.addEventListener("click", () => this.setSource(source));
      this.switchButtons.set(source, button);
      toggle.append(button);
    }
    this.fillNote = document.createElement("p");
    this.fillNote.className = "bunker__note";
    this.fillList = document.createElement("ul");
    this.fillList.className = "bunker__list";
    this.fillList.setAttribute("aria-label", "Monsters to put in");

    this.moveButton = document.createElement("button");
    this.moveButton.type = "button";
    this.moveButton.className = "btn btn--primary bunker__move";
    this.moveButton.addEventListener("click", () => void this.runFill());
    this.buyButton = new ShinyButton({
      label: "Buy",
      spell: formatAmount,
      onSpend: () => void this.runFill(),
      className: "bunker__buy",
    });
    this.moveGate = document.createElement("p");
    this.moveGate.className = "bunker__gate";
    this.fillFooter = document.createElement("div");
    this.fillFooter.className = "bunker__footer";
    fill.append(fillTitle, toggle, this.fillNote, this.fillList, this.fillFooter, this.moveGate);

    // ── In the bunker ──
    const out = document.createElement("div");
    out.className = "bunker__part bunker__part--out";
    this.outNote = document.createElement("p");
    this.outNote.className = "bunker__note";
    this.outList = document.createElement("ul");
    this.outList.className = "bunker__list";
    this.outList.setAttribute("aria-label", "Monsters in the bunker");
    out.append(heading("In the bunker"), this.outNote, this.outList);

    this.element.append(room, this.status, fill, out);
  }

  /** Redraws from the store: called on open and on every yard change. */
  show(): void {
    const save = this.store.save;
    this.state = bunkerState(save, this.bunkerId);
    this.juicer = juicerStatus(save);
    const state = this.state;
    if (!state) {
      this.element.replaceChildren(note("This Monster Bunker is gone."));
      return;
    }

    const fraction = state.capacity > 0 ? Math.min(1, state.used / state.capacity) : 0;
    this.drawFigures(0);
    this.bar.setAttribute("aria-valuemax", String(Math.max(state.capacity, 1)));
    this.bar.setAttribute("aria-valuenow", String(Math.min(state.used, Math.max(state.capacity, 1))));
    this.bar.setAttribute("aria-valuetext", `${formatAmount(state.used)} of ${formatAmount(state.capacity)}`);
    this.bar.classList.toggle("monsters-bar--full", state.capacity > 0 && state.used >= state.capacity);
    this.fillBar.style.width = `${+(fraction * 100).toFixed(2)}%`;

    this.renderFill();
    this.renderOut();
  }

  /** The room line: used of capacity, and the space the selection would take. */
  private drawFigures(selected: number): void {
    const state = this.state;
    if (!state) return;
    this.figures.replaceChildren(
      strong(`${formatAmount(state.used)} / ${formatAmount(state.capacity)}`),
      state.building
        ? " space · still being built, holds nothing yet"
        : selected > 0
          ? ` space used · ${formatAmount(selected)} selected`
          : " space used",
    );
  }

  /** Disables the buttons while one of this bunker's requests runs. */
  syncPending(): void {
    const filling = this.store.isRunning(BunkerKey.fill(this.bunkerId));
    const removing = this.store.isRunning(BunkerKey.remove(this.bunkerId));
    this.buyButton.setBusy(filling);
    if (filling) this.moveButton.disabled = true;
    else this.syncMove();
    if (this.confirmButton) this.confirmButton.disabled = removing;
  }

  destroy(): void {
    for (const stepper of [...this.steppers.values(), ...this.outSteppers.values()]) stepper.destroy();
    this.steppers.clear();
    this.outSteppers.clear();
    this.buyButton.destroy();
    this.element.remove();
  }

  /* ── Put monsters in ────────────────────────────────────────────────── */

  private setSource(source: BunkerSource): void {
    if (source === this.source) return;
    this.source = source;
    this.selection.clear();
    this.renderFill();
    this.switchButtons.get(source)?.focus();
  }

  private renderFill(): void {
    const save = this.store.save;
    const state = this.state!;
    for (const [source, button] of this.switchButtons) {
      const on = source === this.source;
      button.setAttribute("aria-checked", String(on));
      button.classList.toggle("bunker-switch__option--on", on);
      button.tabIndex = on ? 0 : -1;
    }
    this.fillNote.textContent =
      this.source === "housing"
        ? "Moving a monster costs half its hatch cost in putty. Monsters in a bunker never go back to housing."
        : "Bought monsters go straight into the bunker. Only monsters you have unlocked can be bought.";

    this.rows = fillRows(save, this.source);
    const free = state.capacity - state.used;
    for (const [id, count] of this.selection) {
      const row = this.rows.find((one) => one.monster.id === id);
      const max = row ? rowMax(save, row, Object.fromEntries(this.selection), free) : 0;
      if (count > max) this.setCount(this.selection, id, max);
    }
    for (const stepper of this.steppers.values()) stepper.destroy();
    this.steppers.clear();

    if (state.building) {
      this.fillList.replaceChildren();
      this.fillList.hidden = true;
      this.fillFooter.replaceChildren();
      this.moveGate.textContent = "The bunker takes monsters once it is built.";
      this.moveGate.hidden = false;
      return;
    }
    if (this.rows.length === 0) {
      this.fillList.replaceChildren();
      this.fillList.hidden = true;
      this.fillFooter.replaceChildren();
      this.moveGate.textContent = "None of your housed monsters can go in a bunker. Hatch some first.";
      this.moveGate.hidden = false;
      return;
    }
    this.fillList.hidden = false;
    this.fillList.replaceChildren(...this.rows.map((row) => this.fillItem(row)));
    this.fillFooter.replaceChildren(this.source === "housing" ? this.moveButton : this.buyButton.element);
    this.syncFill(true);
  }

  private fillItem(row: FillRow): HTMLElement {
    const { monster } = row;
    const item = document.createElement("li");
    item.className = "bunker__row";
    item.dataset["monster"] = monster.id;
    const sub =
      this.source === "housing"
        ? `${formatAmount(row.available ?? 0)} housed · ${formatAmount(row.each)} space`
        : row.locked
          ? "Locked: unlock it in the Monster Locker"
          : `${formatAmount(row.price)} Shiny each · ${formatAmount(row.each)} space`;
    item.append(nameBlock(monster.id, sub));
    if (row.locked) {
      item.classList.add("bunker__row--locked");
      return item;
    }
    const stepper = new QuantityStepper({
      block: "bunker",
      inputLabel: `${monster.name} to put in`,
      fewerLabel: `Fewer ${monster.name}`,
      moreLabel: `More ${monster.name}`,
      fillTitle: "As many as you have and the bunker has room for",
      value: () => this.selection.get(monster.id) ?? 0,
      set: (value) => this.changeFill(row, value),
      fill: () => this.changeFill(row, Number.MAX_SAFE_INTEGER),
      commit: () => this.syncFill(true),
    });
    this.steppers.set(monster.id, stepper);
    item.append(stepper.element);
    return item;
  }

  private changeFill(row: FillRow, value: number): void {
    const state = this.state;
    if (!state) return;
    const max = rowMax(this.store.save, row, Object.fromEntries(this.selection), state.capacity - state.used);
    this.setCount(this.selection, row.monster.id, Math.min(value, max));
    this.syncFill();
  }

  /** Redraws the fill steppers' limits, the summary and the button after a change. */
  private syncFill(rewrite = false): void {
    const state = this.state;
    if (!state) return;
    const save = this.store.save;
    const free = state.capacity - state.used;
    const selection = Object.fromEntries(this.selection);
    for (const row of this.rows) {
      const stepper = this.steppers.get(row.monster.id);
      if (!stepper) continue;
      const value = this.selection.get(row.monster.id) ?? 0;
      stepper.sync({
        value,
        max: Math.max(value, rowMax(save, row, selection, free)),
        disabled: false,
        rewrite: rewrite || document.activeElement !== stepper.input,
      });
    }
    const cost = fillCost(save, selection, this.source);
    this.drawFigures(cost.space);
    this.moveButton.replaceChildren(
      cost.count === 0 ? "Move to bunker" : `Move ${formatAmount(cost.count)} · `,
      ...(cost.count === 0 ? [] : [resourceAmount("r3", formatAmount(cost.putty))]),
    );
    this.buyButton.setPrice(cost.shiny);
    this.buyButton.setBlocked(
      cost.count === 0 ? "Pick monsters first." : this.store.credits < cost.shiny ? "Not enough Shiny." : null,
    );
    this.syncMove();
  }

  /** The Move button's state and its one gate line. */
  private syncMove(): void {
    if (this.state?.building || this.rows.length === 0) return;
    const cost = fillCost(this.store.save, Object.fromEntries(this.selection), this.source);
    const putty = Number(this.store.resources.r3);
    let gate: string | null = null;
    if (this.source === "housing" && cost.count > 0 && cost.putty > (Number.isFinite(putty) ? putty : 0)) {
      gate = "Not enough putty.";
    } else if (this.source === "buy" && cost.count > 0 && this.store.credits < cost.shiny) {
      gate = "Not enough Shiny.";
    }
    this.moveButton.disabled =
      cost.count === 0 || gate !== null || this.store.isRunning(BunkerKey.fill(this.bunkerId));
    this.moveGate.hidden = gate === null;
    this.moveGate.textContent = gate ?? "";
  }

  private async runFill(): Promise<void> {
    const selection = Object.fromEntries(this.selection);
    const source = this.source;
    const result = await this.actions.fill(this.bunkerId, selection, source);
    if (result.ok) {
      this.selection.clear();
      const { report } = result;
      const words = namesOf(report.added);
      this.setStatus({
        tone: "good",
        content:
          source === "buy"
            ? [`Bought ${words} for `, resourceAmount("shiny", formatAmount(report.credits)), "."]
            : [`Moved ${words} into the bunker for `, resourceAmount("r3", formatAmount(report.cost.r3)), "."],
      });
    } else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.show();
  }

  /* ── In the bunker ──────────────────────────────────────────────────── */

  private renderOut(): void {
    const state = this.state!;
    const juicer = this.juicer!;
    for (const stepper of this.outSteppers.values()) stepper.destroy();
    this.outSteppers.clear();
    this.outButtons.clear();
    this.confirmButton = null;

    const ids = Object.keys(state.contents)
      .filter((id) => monsterEntry(id))
      .sort((a, b) => compareListOrder(monsterEntry(a)!, monsterEntry(b)!));
    for (const [id, count] of this.outSelection) {
      const have = state.contents[id] ?? 0;
      if (count > have) this.setCount(this.outSelection, id, have);
    }
    if (this.confirmingOut && !(this.outSelection.get(this.confirmingOut)! > 0)) this.confirmingOut = null;

    if (ids.length === 0) {
      this.outNote.textContent = "The bunker is empty.";
      this.outList.replaceChildren();
      this.outList.hidden = true;
      return;
    }
    this.outNote.textContent = juicer.ok
      ? "Taking a monster out juices it for goo. It does not go back to housing."
      : juicer.problem === "noJuicer"
        ? "Taking a monster out deletes it: it does not go back to housing, and nothing is refunded. Build a Monster Juicer to get goo back instead."
        : `Taking a monster out deletes it: nothing is refunded. ${juicerProblemText(juicer.problem)}`;
    this.outList.hidden = false;
    this.outList.replaceChildren(...ids.map((id) => this.outItem(id, state.contents[id]!)));
    this.syncOut(true);
  }

  private outItem(id: string, count: number): HTMLElement {
    const monster = monsterEntry(id)!;
    const juicer = this.juicer!;
    const item = document.createElement("li");
    item.className = "bunker__row";
    item.dataset["monster"] = id;
    item.append(
      nameBlock(id, `${formatAmount(count)} inside · ${formatAmount(spaceEach(this.store.save, id) * count)} space`),
    );

    const stepper = new QuantityStepper({
      block: "bunker",
      inputLabel: `${monster.name} to take out`,
      fewerLabel: `Fewer ${monster.name}`,
      moreLabel: `More ${monster.name}`,
      fillTitle: `Every ${monster.name} in the bunker`,
      value: () => this.outSelection.get(id) ?? 0,
      set: (value) => {
        this.setCount(this.outSelection, id, Math.min(value, count));
        this.syncOut();
      },
      fill: () => {
        this.setCount(this.outSelection, id, count);
        this.syncOut();
      },
      commit: () => this.syncOut(true),
    });
    stepper.fill.textContent = "All";
    this.outSteppers.set(id, stepper);

    const take = document.createElement("button");
    take.type = "button";
    take.className = "btn bunker__take";
    take.textContent = juicer.ok ? "Juice" : "Remove";
    take.addEventListener("click", () => {
      this.confirmingOut = id;
      this.renderOut();
      this.confirmButton?.focus();
    });
    this.outButtons.set(id, take);

    const controls = document.createElement("div");
    controls.className = "bunker__out-controls";
    controls.append(stepper.element, take);
    item.append(controls);

    if (this.confirmingOut === id) item.append(this.outConfirm(id));
    return item;
  }

  private outConfirm(id: string): HTMLElement {
    const monster = monsterEntry(id)!;
    const juicer = this.juicer!;
    const count = this.outSelection.get(id) ?? 0;
    const wrap = document.createElement("div");
    wrap.className = "bunker__confirm";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", juicer.ok ? "Confirm juice" : "Confirm remove");
    const question = document.createElement("p");
    question.className = "bunker__question";
    const what = `${formatAmount(count)} ${monster.name}`;
    if (juicer.ok) {
      const goo = juiceGoo(this.store.save, id, count, juicer.rate);
      question.append(`Juice ${what} for `, resourceAmount("r4", formatAmount(goo)), "? They are gone for good.");
    } else {
      question.append(`Remove ${what}? They are deleted and nothing is refunded.`);
    }
    const row = document.createElement("div");
    row.className = "map-row";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.className = "btn btn--danger bunker__yes";
    yes.textContent = juicer.ok ? "Yes, juice" : "Yes, remove";
    yes.addEventListener("click", () => void this.runRemove(id, count));
    const keep = document.createElement("button");
    keep.type = "button";
    keep.className = "btn";
    keep.textContent = "Keep them";
    keep.addEventListener("click", () => {
      this.confirmingOut = null;
      this.renderOut();
      this.outButtons.get(id)?.focus();
    });
    this.confirmButton = yes;
    row.append(yes, keep);
    wrap.append(question, row);
    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.confirmingOut = null;
      this.renderOut();
    });
    return wrap;
  }

  private syncOut(rewrite = false): void {
    const state = this.state;
    if (!state) return;
    for (const [id, stepper] of this.outSteppers) {
      stepper.sync({
        value: this.outSelection.get(id) ?? 0,
        max: state.contents[id] ?? 0,
        disabled: this.confirmingOut !== null,
        rewrite: rewrite || document.activeElement !== stepper.input,
      });
      const button = this.outButtons.get(id);
      if (button) button.disabled = this.confirmingOut !== null || !((this.outSelection.get(id) ?? 0) > 0);
    }
    this.syncPending();
  }

  private async runRemove(id: string, count: number): Promise<void> {
    const result = await this.actions.remove(this.bunkerId, id, count);
    this.confirmingOut = null;
    if (result.ok) {
      this.outSelection.delete(id);
      const { report } = result;
      const what = `${formatAmount(report.removed)} ${monsterEntry(report.monster)?.name ?? report.monster}`;
      const content: (Node | string)[] = report.juiced
        ? [`Juiced ${what}: `, resourceAmount("r4", formatAmount(report.goo)), " added."]
        : [`Removed ${what}.`];
      if (report.lost > 0) {
        content.push(" Storage was full, so ", resourceAmount("r4", formatAmount(report.lost)), " was lost.");
      }
      this.setStatus({ tone: "good", content });
    } else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
    }
    this.show();
  }

  /* ── Pieces ─────────────────────────────────────────────────────────── */

  private setCount(map: Map<string, number>, id: string, value: number): void {
    const count = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
    if (count > 0) map.set(id, count);
    else map.delete(id);
  }

  private setStatus(status: Status): void {
    this.status.hidden = false;
    this.status.className = `bunker__status bunker__status--${status.tone}`;
    this.status.replaceChildren(...status.content);
  }
}

const heading = (text: string): HTMLElement => {
  const element = document.createElement("h4");
  element.className = "bunker__heading";
  element.textContent = text;
  return element;
};

const note = (text: string): HTMLElement => {
  const element = document.createElement("p");
  element.className = "bunker__note";
  element.textContent = text;
  return element;
};

const strong = (text: string): HTMLElement => {
  const element = document.createElement("strong");
  element.textContent = text;
  return element;
};

/** A monster's picture, name and one line under it. */
const nameBlock = (id: string, sub: string): HTMLElement => {
  const monster = monsterEntry(id)!;
  const block = document.createElement("span");
  block.className = "bunker__name";
  const words = document.createElement("span");
  words.className = "bunker__words";
  const name = document.createElement("strong");
  name.textContent = monster.name;
  const line = document.createElement("span");
  line.className = "bunker__sub";
  line.textContent = sub;
  words.append(name, line);
  block.append(monsterPicture(monster, "small", "bunker__picture"), words);
  return block;
};

/** "10 Pokey and 5 Octo-ooze". */
const namesOf = (counts: Readonly<Record<string, number>>): string => {
  const parts = Object.entries(counts).map(
    ([id, n]) => `${formatAmount(n)} ${monsterEntry(id)?.name ?? id}`,
  );
  return parts.length <= 1 ? (parts[0] ?? "nothing") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
