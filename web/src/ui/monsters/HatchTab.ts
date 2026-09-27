import {
  HATCHERY_KEYS,
  hatcheryActions,
  type HatcheryActions,
} from "@/api/yardHatchery";
import type { YardRefusal } from "@/api/yard";
import {
  activeOverdrive,
  fillLimits,
  HATCHERY_OVERDRIVES,
  HCC_STACKS,
  hatchMonsters,
  housingWarning,
  previewAdd,
  previewFinish,
  queuedCount,
  queueOf,
  readHatchYard,
  STACK_SIZE,
  type AddPreview,
  type FinishBlock,
  type HatcheryView,
  type HatchMonster,
  type HatchTarget,
  type HatchYard,
  type OverdriveItem,
  type QueueStack,
} from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { resourceAmount } from "@/ui/resourceIcon";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { monsterPicture } from "./LockerTab";
import {
  MonstersTabId,
  type MonstersFocus,
  type MonstersTab,
  type MonstersTabContext,
} from "./monstersTab";

/**
 * The Hatch tab: the Hatcheries and the Hatchery Control Centre
 * (`docs/design/yard-buildings.md` §4.4, issue #31).
 *
 * Top to bottom: one chip per hatchery (level, what it is producing and its
 * countdown, queued/limit and its state), or with an HCC the shared queue's
 * header and a strip of each hatchery's monster in production with a × to
 * cancel it; then the monster grid (locked ones greyed with the reason)
 * beside the selected monster's line, the quantity control (the Army panel's,
 * `QuantityStepper`), what an Add would do, and Add; then the queue of the
 * selected target with −1 and × per stack; then Finish now and the Overdrive.
 *
 * Every number shown comes from `game/monsters/hatchPlan.ts`, which replays
 * the server's rules; the requests go through the store's queue
 * (`hatcheryActions`, `api/yardHatchery.ts`), one per batch or removal, and
 * the tab redraws from the answer. Shiny spends are {@link ShinyButton}s.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** A live countdown, refreshed once a second without a redraw. */
interface Clock {
  readonly node: HTMLElement;
  readonly endsAt: number;
}

/** The first count offered when a monster is picked. */
const DEFAULT_COUNT = 1;

/** Seconds as a countdown: "12s", "4m 10s". */
const duration = (seconds: number): string => formatCountdown(Math.ceil(seconds));

/** A monster's display name, or its id. */
const nameOf = (id: string): string => monsterEntry(id)?.name ?? id;

/** What a hatchery chip says it is doing. */
const STATE_TEXT: Readonly<Record<HatcheryView["state"], string>> = {
  building: "Being built",
  damaged: "Damaged — repair it",
  upgrading: "Paused — upgrading",
  stalled: "Stalled — housing full",
  producing: "Producing",
  idle: "Idle",
};

/** Why Finish now cannot be pressed, as its visible line. */
const FINISH_TEXT: Readonly<Record<FinishBlock, string>> = {
  busy: "Still being built",
  damaged: "Repair it first",
  nothingToFinish: "Nothing to finish",
  housingFull: "Housing full",
};

export class HatchTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: HatcheryActions;
  private readonly targets: HTMLElement;
  private readonly status: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly selectedLine: HTMLElement;
  private readonly stepper: QuantityStepper;
  private readonly addButton: HTMLButtonElement;
  private readonly previewLine: HTMLElement;
  private readonly warningLine: HTMLElement;
  private readonly gateLine: HTMLElement;
  private readonly queue: HTMLElement;
  private readonly boosts: HTMLElement;

  /** The hatchery (or `hcc`) the Add, the queue and Finish now are for. */
  private target: HatchTarget | null = null;
  private selected: string | null = null;
  private count = DEFAULT_COUNT;
  /** Why the last Fill came to nothing, until the count changes. */
  private fillNote: string | null = null;
  /** The yard as last read, for the count-only redraw. */
  private yard: HatchYard | null = null;
  private clocks: Clock[] = [];
  /** Countdowns already asked about, `id@endsAt`, so each asks the server once. */
  private readonly asked = new Set<string>();
  private readonly shiny = new Map<string, ShinyButton>();
  /** Plain buttons disabled while any hatchery request runs. */
  private plainButtons: HTMLButtonElement[] = [];
  /** Add has a reason not to be pressed, or nothing to add. */
  private addBlocked = true;

  constructor(context: MonstersTabContext, actions?: HatcheryActions) {
    this.context = context;
    this.actions = actions ?? hatcheryActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "hatch";

    this.targets = document.createElement("div");
    this.targets.className = "hatch__targets";

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    const split = document.createElement("div");
    split.className = "hatch__split";

    this.grid = document.createElement("ul");
    this.grid.className = "hatch__grid";
    this.grid.setAttribute("aria-label", "Monsters to hatch");

    const side = document.createElement("section");
    side.className = "hatch__side";

    const add = document.createElement("div");
    add.className = "hatch-add";
    this.selectedLine = document.createElement("p");
    this.selectedLine.className = "hatch-add__selected";

    this.stepper = new QuantityStepper({
      block: "hatch-add",
      inputLabel: "How many to hatch",
      fewerLabel: "One fewer",
      moreLabel: "One more",
      fillTitle: "As many as the queue, your goo and your housing allow",
      value: () => this.count,
      set: (value) => this.setCount(value),
      fill: () => this.fill(),
      commit: () => this.renderCount(true),
    });

    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "btn btn--primary hatch-add__add";
    this.addButton.textContent = "Add";
    this.addButton.addEventListener("click", () => void this.runAdd());

    const controls = document.createElement("div");
    controls.className = "hatch-add__row";
    controls.append(this.stepper.element, this.addButton);

    this.previewLine = document.createElement("p");
    this.previewLine.className = "hatch-add__preview";
    this.previewLine.setAttribute("aria-live", "polite");
    this.warningLine = document.createElement("p");
    this.warningLine.className = "hatch-add__warning";
    this.gateLine = document.createElement("p");
    this.gateLine.className = "monsters-gate";

    add.append(this.selectedLine, controls, this.previewLine, this.warningLine, this.gateLine);

    this.queue = document.createElement("section");
    this.queue.className = "hatch-queue";
    this.queue.setAttribute("aria-label", "Queue");

    this.boosts = document.createElement("div");
    this.boosts.className = "hatch-boosts";

    side.append(add, this.queue, this.boosts);
    split.append(this.grid, side);
    this.element.append(this.targets, this.status, split);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    const yard = readHatchYard(this.store.save, this.store.now());
    if (focus.buildingId !== undefined) {
      if (yard.hcc) this.target = "hcc";
      else if (yard.hatcheries.some((one) => one.id === focus.buildingId)) {
        this.target = focus.buildingId;
      }
    }
    if (focus.monster && monsterEntry(focus.monster)?.blocked === false) this.select(focus.monster, false);
    this.render();
  }

  update(change: YardChange): void {
    if (change.reason === YardChangeReason.PENDING) {
      this.syncPending();
      return;
    }
    this.render();
  }

  tick(): void {
    const now = this.store.now();
    for (const clock of this.clocks) clock.node.textContent = duration(clock.endsAt - now);
    const yard = this.yard;
    if (yard) {
      // A monster done while the tab is open: ask the server what came of it,
      // once per countdown, and in one call for every hatchery done this second.
      let due = false;
      for (const hatchery of yard.hatcheries) {
        if (hatchery.endsAt === null || hatchery.endsAt > now) continue;
        const key = `${hatchery.id}@${hatchery.endsAt}`;
        if (this.asked.has(key)) continue;
        this.asked.add(key);
        due = true;
      }
      if (due) void this.store.refresh();
      if (this.target !== null) this.drawFinishPrice(yard, this.target);
    }
    this.drawOverdriveClock();
    this.syncPending();
  }

  destroy(): void {
    this.stepper.destroy();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.["focusKey"];
    const store = this.store;
    const yard = readHatchYard(store.save, store.now());
    this.yard = yard;
    this.target = pickTarget(yard, this.target);

    const monsters = hatchMonsters(store.save);
    if (!this.selected || !monsters.some((row) => row.monster.id === this.selected)) {
      this.selected =
        monsters.find((row) => row.state.kind === "ready")?.monster.id ?? monsters[0]?.monster.id ?? null;
    }

    this.plainButtons = [];
    this.clocks = [];
    const used = new Set<string>();
    this.renderTargets(yard);
    this.renderGrid(monsters);
    this.renderSelected(monsters.find((row) => row.monster.id === this.selected) ?? null);
    this.renderQueue(yard);
    this.renderBoosts(yard, used);
    for (const [key, button] of this.shiny) {
      if (!used.has(key)) {
        button.destroy();
        this.shiny.delete(key);
      }
    }
    this.renderCount(document.activeElement !== this.stepper.input);
    this.syncPending();
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  private renderTargets(yard: HatchYard): void {
    if (yard.hatcheries.length === 0) {
      const note = document.createElement("p");
      note.className = "hatch__none";
      note.textContent = "Build a Hatchery to hatch monsters.";
      this.targets.replaceChildren(note);
      return;
    }
    if (yard.hcc) {
      this.targets.replaceChildren(this.hccHeader(yard), this.hccStrip(yard));
      return;
    }
    const chips = document.createElement("div");
    chips.className = "hatch-chips";
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", "Hatcheries");
    yard.hatcheries.forEach((hatchery, index) => chips.append(this.chip(hatchery, index)));
    this.targets.replaceChildren(chips);
  }

  private chip(hatchery: HatcheryView, index: number): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hatch-chip hatch-chip--${hatchery.state}`;
    button.dataset["hatchery"] = String(hatchery.id);
    button.dataset["focusKey"] = `chip-${hatchery.id}`;
    button.setAttribute("aria-pressed", String(this.target === hatchery.id));
    button.addEventListener("click", () => {
      this.target = hatchery.id;
      this.render();
    });

    const title = document.createElement("span");
    title.className = "hatch-chip__title";
    title.textContent = `#${index + 1} · L${hatchery.level}`;
    const state = document.createElement("span");
    state.className = "hatch-chip__state";
    state.append(...this.producingText(hatchery));
    const queued = document.createElement("span");
    queued.className = "hatch-chip__queued";
    queued.textContent = `${queuedCount(hatchery.queue)}/${hatchery.stackLimit * STACK_SIZE} queued`;
    // Spaces keep the three parts separate words for a screen reader.
    button.append(title, " ", state, " ", queued);
    return button;
  }

  /** "Bolt · 12s" while producing, else the state's words, the monster named when there is one. */
  private producingText(hatchery: HatcheryView): (Node | string)[] {
    if (hatchery.state === "producing" && hatchery.monster && hatchery.endsAt !== null) {
      const clock = document.createElement("span");
      clock.className = "hatch-clock";
      clock.textContent = duration(hatchery.endsAt - this.store.now());
      this.clocks.push({ node: clock, endsAt: hatchery.endsAt });
      return [`${nameOf(hatchery.monster)} · `, clock];
    }
    const words = STATE_TEXT[hatchery.state];
    return hatchery.monster && hatchery.state !== "idle"
      ? [`${nameOf(hatchery.monster)} · ${words}`]
      : [words];
  }

  private hccHeader(yard: HatchYard): HTMLElement {
    const header = document.createElement("div");
    header.className = "hatch-hcc";
    const title = document.createElement("h3");
    title.className = "hatch-hcc__title";
    title.textContent = "Hatchery Control Centre";
    const queued = document.createElement("span");
    queued.className = "hatch-hcc__queued";
    queued.textContent = `${queuedCount(yard.shared)}/${HCC_STACKS * STACK_SIZE} queued`;
    header.append(title, queued);
    if (!yard.hcc?.works) {
      const note = document.createElement("span");
      note.className = "hatch-hcc__note";
      note.textContent = "Damaged: it hands out nothing until it is repaired.";
      header.append(note);
    }
    return header;
  }

  /** Each hatchery's monster in production, with a × to cancel it. */
  private hccStrip(yard: HatchYard): HTMLElement {
    const strip = document.createElement("ul");
    strip.className = "hatch-strip";
    strip.setAttribute("aria-label", "Hatcheries");
    yard.hatcheries.forEach((hatchery, index) => {
      const item = document.createElement("li");
      item.className = `hatch-strip__item hatch-chip--${hatchery.state}`;
      item.dataset["hatchery"] = String(hatchery.id);
      const label = document.createElement("span");
      label.className = "hatch-strip__label";
      label.append(`#${index + 1} · `, ...this.producingText(hatchery));
      item.append(label);
      if (hatchery.monster) {
        const cancel = this.removeButton(
          "×",
          `Cancel the ${nameOf(hatchery.monster)} in hatchery ${index + 1}`,
          `cancel-${hatchery.id}`,
          () => void this.runRemove(hatchery.id, 0, 1),
        );
        item.append(cancel);
      }
      strip.append(item);
    });
    return strip;
  }

  private renderGrid(monsters: readonly HatchMonster[]): void {
    const items = monsters.map((row) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hatch-monster hatch-monster--${row.state.kind}`;
      button.dataset["monster"] = row.monster.id;
      button.dataset["focusKey"] = `monster-${row.monster.id}`;
      button.setAttribute("aria-pressed", String(row.monster.id === this.selected));
      button.addEventListener("click", () => this.select(row.monster.id));
      const name = document.createElement("span");
      name.className = "hatch-monster__name";
      name.textContent = row.monster.name;
      const note = document.createElement("span");
      note.className = "hatch-monster__note";
      if (row.state.kind === "ready") note.append(resourceAmount("r4", row.price));
      else note.textContent = row.state.kind === "unlocking" ? "Unlocking" : "Locked";
      button.append(monsterPicture(row.monster, "small", "hatch-monster__picture"), name, " ", note);
      item.append(button);
      return item;
    });
    this.grid.replaceChildren(...items);
  }

  private renderSelected(row: HatchMonster | null): void {
    if (!row) {
      this.selectedLine.replaceChildren();
      return;
    }
    const name = document.createElement("strong");
    name.textContent = row.monster.name;
    this.selectedLine.replaceChildren(
      name,
      ` L${row.level} · `,
      resourceAmount("r4", row.price),
      ` · ${duration(row.seconds)} · space ${row.space}`,
    );
  }

  /**
   * The parts that follow the count: the box, the preview, the housing line,
   * Add and its reason. Runs on every step of a hold, so nothing else is redrawn.
   */
  private renderCount(rewrite: boolean): void {
    const yard = this.yard;
    const row = this.selectedRow();
    const target = this.target;
    const limits = yard && row && target !== null ? fillLimits(yard, target, row.monster.id) : null;
    const ready = row?.state.kind === "ready";
    const max = ready && limits ? limits.max : 0;
    if (this.count > max) this.count = max;
    this.stepper.sync({ value: this.count, max, disabled: !ready || target === null, rewrite });

    const gate = this.addGate(yard, row, limits);
    this.gateLine.replaceChildren(...gate);
    this.gateLine.hidden = gate.length === 0;
    this.addBlocked = gate.length > 0 || this.count < 1;
    this.addButton.disabled = this.addBlocked || this.hatcheryBusy();
    this.addButton.textContent = this.count > 0 ? `Add ${formatAmount(this.count)}` : "Add";

    const preview = yard && row && ready && target !== null && this.count > 0
      ? previewAdd(yard, target, row.monster.id, this.count)
      : null;
    this.previewLine.replaceChildren(...(preview && row ? previewText(preview, row) : []));
    this.previewLine.hidden = !preview;

    const warning =
      yard && row && ready && this.count > 0
        ? housingWarning(yard, row.monster.id, this.count)
        : this.fillNote;
    this.warningLine.textContent = warning ?? "";
    this.warningLine.hidden = warning === null;
  }

  /** Why Add cannot be pressed, as nodes, or none. */
  private addGate(
    yard: HatchYard | null,
    row: HatchMonster | null,
    limits: ReturnType<typeof fillLimits> | null,
  ): (Node | string)[] {
    if (!yard || this.target === null) return ["Build a Hatchery first."];
    if (!row) return [];
    if (row.state.kind !== "ready") {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn btn--ghost hatch-add__unlock";
      go.textContent = "Go to Unlock";
      go.addEventListener("click", () =>
        this.context.showTab(MonstersTabId.UNLOCK, { monster: row.monster.id }),
      );
      const words =
        row.state.kind === "unlocking"
          ? `${row.monster.name} is still unlocking.`
          : `Unlock ${row.monster.name} in the Monster Locker first.`;
      return [words, " ", go];
    }
    if (!limits) return [];
    if (limits.queue === 0) return ["The queue is full."];
    if (limits.goo === 0) return ["Need ", resourceAmount("r4", row.price - yard.goo), " more"];
    return [];
  }

  private renderQueue(yard: HatchYard): void {
    const target = this.target;
    if (target === null) {
      this.queue.replaceChildren();
      this.queue.hidden = true;
      return;
    }
    this.queue.hidden = false;
    const heading = document.createElement("h3");
    heading.className = "hatch-queue__title";
    const list = document.createElement("ol");
    list.className = "hatch-queue__list";

    const hatchery = target === "hcc" ? null : (yard.hatcheries.find((one) => one.id === target) ?? null);
    const stacks = queueOf(yard, target) ?? [];
    const limit = target === "hcc" ? HCC_STACKS : (hatchery?.stackLimit ?? 0);
    heading.textContent =
      target === "hcc"
        ? "Shared queue"
        : `Queue · hatchery #${yard.hatcheries.findIndex((one) => one.id === target) + 1}`;

    if (hatchery?.monster) {
      const item = document.createElement("li");
      item.className = "hatch-queue__row hatch-queue__row--producing";
      const label = document.createElement("span");
      label.className = "hatch-queue__label";
      label.append("▶ ", ...this.producingText(hatchery));
      item.append(
        label,
        this.removeButton(
          "×",
          `Cancel the ${nameOf(hatchery.monster)} in production`,
          `cancel-${hatchery.id}`,
          () => void this.runRemove(hatchery.id, 0, 1),
        ),
      );
      list.append(item);
    }

    stacks.forEach((stack, index) => list.append(this.stackRow(target, stack, index + 1)));

    const free = Math.max(0, limit - stacks.length);
    const room = document.createElement("p");
    room.className = "hatch-queue__room";
    room.textContent =
      stacks.length === 0 && !hatchery?.monster
        ? `Empty · ${free} ${free === 1 ? "stack" : "stacks"} of ${STACK_SIZE}`
        : `${free} ${free === 1 ? "stack" : "stacks"} free`;
    this.queue.replaceChildren(heading, list, room);
  }

  private stackRow(target: HatchTarget, stack: QueueStack, slot: number): HTMLElement {
    const [id, count] = stack;
    const item = document.createElement("li");
    item.className = "hatch-queue__row";
    item.dataset["slot"] = String(slot);
    const label = document.createElement("span");
    label.className = "hatch-queue__label";
    label.textContent = `${nameOf(id)} ×${count}`;
    const less = this.removeButton(
      "−1",
      `One fewer ${nameOf(id)} in stack ${slot}`,
      `less-${slot}`,
      () => void this.runRemove(target, slot, 1),
    );
    const drop = this.removeButton(
      "×",
      `Remove all ${count} ${nameOf(id)} in stack ${slot}`,
      `drop-${slot}`,
      () => void this.runRemove(target, slot, "all"),
    );
    item.append(label, less, drop);
    return item;
  }

  private renderBoosts(yard: HatchYard, used: Set<string>): void {
    const target = this.target;
    const nodes: HTMLElement[] = [];

    if (target !== null) {
      const finish = document.createElement("div");
      finish.className = "hatch-boosts__finish";
      used.add("finish");
      const button = this.shinyButton("finish", "Finish now", () => void this.runFinish());
      const reason = document.createElement("span");
      reason.className = "monsters-gate hatch-boosts__reason";
      finish.append(button.element, reason);
      nodes.push(finish);
    }

    const overdrive = document.createElement("div");
    overdrive.className = "hatch-boosts__overdrive";
    const running = activeOverdrive(this.store.save.storedata, this.store.now());
    if (running) {
      const line = document.createElement("p");
      line.className = "hatch-boosts__running";
      line.dataset["overdrive"] = running.item;
      nodes.push(overdrive);
      overdrive.append(line);
      this.drawOverdriveClock(line);
    } else {
      const label = document.createElement("span");
      label.className = "hatch-boosts__label";
      label.textContent = "Overdrive, 1 hour:";
      overdrive.append(label);
      for (const { item, power, price } of HATCHERY_OVERDRIVES) {
        const key = `overdrive-${item}`;
        used.add(key);
        const button = this.shinyButton(key, `${power}x`, () => void this.runOverdrive(item));
        button.element.title = `Every hatchery works ${power} times as fast for an hour.`;
        button.setPrice(price);
        button.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
        overdrive.append(button.element);
      }
      nodes.push(overdrive);
    }
    this.boosts.replaceChildren(...nodes);
    if (target !== null) this.drawFinishPrice(yard, target);
  }

  private drawFinishPrice(yard: HatchYard, target: HatchTarget): void {
    const button = this.shiny.get("finish");
    const reason = this.boosts.querySelector<HTMLElement>(".hatch-boosts__reason");
    if (!button || !reason) return;
    const preview = previewFinish(yard, target, this.store.save, this.store.now());
    button.setPrice(preview.price);
    const blocked = preview.blocked
      ? FINISH_TEXT[preview.blocked]
      : this.store.credits < preview.price
        ? "Not enough Shiny"
        : null;
    button.setBlocked(blocked ? `${blocked}.` : null);
    reason.textContent = blocked ?? (preview.finishedAll ? "" : "Housing fits only part of it");
    reason.hidden = reason.textContent === "";
  }

  private drawOverdriveClock(line?: HTMLElement): void {
    const node = line ?? this.boosts.querySelector<HTMLElement>(".hatch-boosts__running");
    if (!node) return;
    const now = this.store.now();
    const running = activeOverdrive(this.store.save.storedata, now);
    node.textContent = running
      ? `Overdrive ${running.power}x: every hatchery works ${running.power} times as fast for ${duration(running.endsAt - now)}.`
      : "The Overdrive has run out.";
  }

  private removeButton(
    text: string,
    label: string,
    focusKey: string,
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--ghost hatch-queue__remove";
    button.textContent = text;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.dataset["focusKey"] = focusKey;
    button.addEventListener("click", onClick);
    this.plainButtons.push(button);
    return button;
  }

  private shinyButton(key: string, label: string, onSpend: () => void): ShinyButton {
    let button = this.shiny.get(key);
    if (!button) {
      button = new ShinyButton({ label, spell: formatAmount, onSpend });
      button.element.dataset["focusKey"] = key;
      this.shiny.set(key, button);
    }
    return button;
  }

  /** Every hatchery button waits while any hatchery request is in flight or queued. */
  private syncPending(): void {
    const busy = this.hatcheryBusy();
    for (const button of this.shiny.values()) button.setBusy(busy);
    for (const button of this.plainButtons) {
      if (busy) {
        if (!button.disabled) button.setAttribute("aria-busy", "true");
        button.disabled = true;
      } else if (button.getAttribute("aria-busy") === "true") {
        button.removeAttribute("aria-busy");
        button.disabled = false;
      }
    }
    this.addButton.disabled = busy || this.addBlocked;
  }

  private hatcheryBusy(): boolean {
    const store = this.store;
    return HATCHERY_KEYS.some((key) => store.isRunning(key));
  }

  /* ── Count and selection ────────────────────────────────────────────── */

  private selectedRow(): HatchMonster | null {
    return hatchMonsters(this.store.save).find((row) => row.monster.id === this.selected) ?? null;
  }

  private select(id: string, redraw = true): void {
    if (this.selected === id) return;
    this.selected = id;
    this.count = DEFAULT_COUNT;
    this.fillNote = null;
    if (redraw) this.render();
  }

  private setCount(value: number): void {
    this.count = Math.max(0, Math.floor(value));
    this.fillNote = null;
    this.renderCount(document.activeElement !== this.stepper.input);
  }

  private fill(): void {
    const yard = this.yard;
    const row = this.selectedRow();
    if (!yard || !row || this.target === null) return;
    const limits = fillLimits(yard, this.target, row.monster.id);
    this.count = limits.fill;
    this.fillNote =
      limits.fill === 0 && limits.limitedBy === "housing" && limits.max > 0
        ? "Housing is full, so Fill adds none. Type a number to queue them anyway."
        : null;
    this.renderCount(true);
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runAdd(): Promise<void> {
    const target = this.target;
    const monster = this.selected;
    const count = this.count;
    if (target === null || !monster || count < 1) return;
    const result = await this.actions.add(target, monster, count);
    this.report(result, (report) => {
      const name = nameOf(report.monster);
      const cost = report.cost.r4 > 0 ? [": ", resourceAmount("r4", report.cost.r4), " spent."] : ["."];
      if (report.added === report.requested) return [`Added ${formatAmount(report.added)} ${name}`, ...cost];
      const why = report.stoppedBy === "goo" ? "out of goo" : "the queue is full";
      return [
        `Added ${formatAmount(report.added)} of ${formatAmount(report.requested)} ${name} — ${why}`,
        ...cost,
      ];
    });
  }

  private async runRemove(target: HatchTarget, slot: number, count: number | "all"): Promise<void> {
    const result = await this.actions.remove(target, slot, count);
    this.report(result, (report) => [
      `Removed ${formatAmount(report.removed)} ${nameOf(report.monster)}`,
      ...(report.refund.r4 > 0 ? [": ", resourceAmount("r4", report.refund.r4), " back."] : ["."]),
    ]);
  }

  private async runFinish(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    const result = await this.actions.finish(target);
    this.report(result, (report) => {
      const housed = Object.entries(report.housed)
        .map(([id, n]) => `${formatAmount(n)} ${nameOf(id)}`)
        .join(", ");
      return [
        `Hatched ${housed}`,
        ...(report.credits > 0 ? [" for ", resourceAmount("shiny", report.credits)] : []),
        report.finishedAll ? "." : ". Housing is full; the rest will wait.",
      ];
    });
  }

  private async runOverdrive(item: OverdriveItem): Promise<void> {
    const power = HATCHERY_OVERDRIVES.find((one) => one.item === item)?.power ?? 0;
    const result = await this.actions.overdrive(item);
    this.report(result, () => [`Overdrive on: every hatchery works ${power} times as fast for an hour.`]);
  }

  private report<Report>(
    result: YardActionResult<Report>,
    success: (report: Report) => (Node | string)[],
  ): void {
    if (result.ok) this.setStatus({ tone: "good", content: success(result.report) });
    else {
      this.setStatus({ tone: "bad", content: [refusalText(result.refusal)] });
      this.render();
    }
  }

  private setStatus(status: Status | null): void {
    this.status.hidden = status === null;
    this.status.className = status ? `monsters-status monsters-status--${status.tone}` : "monsters-status";
    this.status.replaceChildren(...(status?.content ?? []));
  }
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

/**
 * The target to show: `hcc` whenever a finished HCC runs the queue; else the
 * one chosen if it is still there, else the first hatchery; null without one.
 */
const pickTarget = (yard: HatchYard, current: HatchTarget | null): HatchTarget | null => {
  if (yard.hcc) return "hcc";
  if (typeof current === "number" && yard.hatcheries.some((one) => one.id === current)) return current;
  return yard.hatcheries[0]?.id ?? null;
};

/**
 * "Adds 20 · [goo] 7,000 · 300 space — 1 starts now, 12 join stack 2, 7 in a
 * new stack", or what stops it short.
 */
const previewText = (preview: AddPreview, row: HatchMonster): (Node | string)[] => {
  if (preview.added === 0) {
    return [preview.stoppedBy === "goo" ? "Not enough goo for one." : "No room in the queue."];
  }
  const parts: string[] = [];
  if (preview.started > 0) parts.push(`${preview.started} ${preview.started === 1 ? "starts" : "start"} now`);
  for (const { slot, count } of preview.merged) parts.push(`${count} join stack ${slot}`);
  if (preview.newStacks > 0) {
    parts.push(
      `${preview.inNewStacks} in ${preview.newStacks === 1 ? "a new stack" : `${preview.newStacks} new stacks`}`,
    );
  }
  const short =
    preview.stoppedBy === "goo"
      ? ` Only ${formatAmount(preview.added)} fit your goo.`
      : preview.stoppedBy === "queue"
        ? ` Only ${formatAmount(preview.added)} fit the queue.`
        : "";
  return [
    `Adds ${formatAmount(preview.added)} · `,
    resourceAmount("r4", preview.cost),
    ` · ${formatAmount(preview.added * row.space)} space`,
    parts.length > 0 ? ` — ${parts.join(", ")}.` : ".",
    short,
  ];
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
