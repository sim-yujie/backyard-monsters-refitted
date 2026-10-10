import { ACADEMY_KEYS, academyActions, type AcademyActions } from "@/api/yardAcademy";
import type { YardRefusal } from "@/api/yard";
import { monsterStat } from "@/game/combat/rules";
import { hatchCost, housingSpace, monsterEntry } from "@/game/monsters/monsterCatalogue";
import {
  academyFor,
  academySlots,
  cancelRefund,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  orphanTrainings,
  runningTraining,
  trainGate,
  trainRows,
  type AcademySlot,
  type RunningTraining,
  type TrainGate,
  type TrainRow,
} from "@/game/monsters/training";
import { progressFraction } from "@/game/yard/jobs";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { hatchTimeText, speedText } from "./monsterNumbers";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/train.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { describe, monsterPicture } from "./LockerTab";
import type { MonstersFocus, MonstersTab, MonstersTabContext } from "./monstersTab";

/**
 * The Train tab: the Monster Academy (`docs/design/yard-buildings.md` §6
 * "Train tab").
 *
 * Top to bottom: the academies as slots ("Academy 1 · Octo-ooze → 4 ·
 * 9:59:12 · Finish now · Cancel", "Academy 2 · Idle") — two academies are two
 * slots; then one scrolling list of every unlocked monster with its level and
 * the next step's putty and time — no one-monster carousel, so reaching
 * Teratorn is one scroll, not 13 clicks of Next; beside it (under it on a
 * phone) the selected monster's card with what the next level changes, Train
 * and Instant. Train a monster: the Academy, its row, Train — three clicks.
 *
 * What is offered, why a button is disabled and every price come from
 * `game/monsters/training.ts`; the requests go through the store's queue
 * (`academyActions`, `api/yardAcademy.ts`). Shiny spends are
 * {@link ShinyButton}s (tap, then tap again); Cancel opens one inline
 * confirmation stating the refund, capped as the server caps it.
 */

const duration = (seconds: number): string => formatCountdown(seconds);

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** One running training's live parts, refreshed every second without a redraw. */
interface SlotClock {
  readonly training: RunningTraining;
  readonly countdown: HTMLElement;
  readonly fill: HTMLElement;
  readonly bar: HTMLElement;
}

export class TrainTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: AcademyActions;
  private readonly slots: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly status: HTMLElement;

  /** The monster whose card is shown. */
  private selected: string | null = null;
  /** The monster whose Cancel is asking for confirmation. */
  private confirmingCancel: string | null = null;
  private slotClocks: SlotClock[] = [];
  /** Row countdowns, refreshed once a second. */
  private rowClocks: { node: HTMLElement; endsAt: number }[] = [];
  /** Long-lived Shiny buttons, so an armed one survives the redraws. */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Plain buttons disabled while any academy request runs. */
  private plainButtons: HTMLButtonElement[] = [];

  constructor(context: MonstersTabContext, actions?: AcademyActions) {
    this.context = context;
    this.actions = actions ?? academyActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "train";

    this.slots = document.createElement("div");
    this.slots.className = "train__slots";
    this.slots.setAttribute("role", "list");
    this.slots.setAttribute("aria-label", "Monster Academies");

    const split = document.createElement("div");
    split.className = "locker__split train__split";
    this.list = document.createElement("ul");
    this.list.className = "locker__list";
    this.list.setAttribute("aria-label", "Unlocked monsters");
    this.detail = document.createElement("section");
    this.detail.className = "locker__detail";
    this.detail.setAttribute("aria-live", "polite");
    split.append(this.list, this.detail);

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.element.append(this.slots, this.status, split);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    // A clicked academy that is training opens on that monster.
    const upg =
      focus.buildingId !== undefined ? this.store.building(focus.buildingId)?.raw["upg"] : undefined;
    const wanted = focus.monster ?? (typeof upg === "string" ? upg : undefined);
    if (wanted && runningTraining(this.store, wanted) !== null) this.select(wanted, false);
    else if (focus.monster && monsterEntry(focus.monster)?.blocked === false) {
      this.select(focus.monster, false);
    }
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
    for (const clock of this.rowClocks) clock.node.textContent = duration(clock.endsAt - now);
    for (const clock of this.slotClocks) {
      this.drawClock(clock);
      this.shiny.get(`finish:${clock.training.monster.id}`)?.setPrice(finishPrice(clock.training, now));
    }
    this.syncPending();
  }

  destroy(): void {
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.["focusKey"];
    const rows = trainRows(this.store);
    if (!this.selected || !rows.some((row) => row.monster.id === this.selected)) {
      this.selected = defaultSelection(rows);
    }
    if (this.confirmingCancel && !runningTraining(this.store, this.confirmingCancel)) {
      this.confirmingCancel = null;
    }

    this.plainButtons = [];
    const used = new Set<string>();
    this.renderSlots(used);
    this.renderList(rows);
    this.renderDetail(rows.find((row) => row.monster.id === this.selected) ?? null, used);

    for (const [key, button] of this.shiny) {
      if (!used.has(key)) {
        button.destroy();
        this.shiny.delete(key);
      }
    }
    this.syncPending();
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  private renderSlots(used: Set<string>): void {
    this.slotClocks = [];
    const slots = academySlots(this.store);
    const cards = slots.map((slot) => this.slotCard(slot, used));
    for (const training of orphanTrainings(this.store)) {
      cards.push(this.trainingCard("Training", training, used));
    }
    this.slots.replaceChildren(...cards);
  }

  private slotCard(slot: AcademySlot, used: Set<string>): HTMLElement {
    const title = `Academy ${slot.number}`;
    if (slot.state.kind === "training") return this.trainingCard(title, slot.state.training, used, slot);

    const card = document.createElement("section");
    card.className = `train-slot train-slot--${slot.state.kind}`;
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", title);
    const head = document.createElement("div");
    head.className = "train-slot__head";
    head.append(slotTitle(title, slot.level));
    const state = document.createElement("span");
    state.className = "train-slot__state";
    state.textContent =
      slot.state.kind === "idle"
        ? "Idle"
        : slot.state.kind === "damaged"
          ? "Needs repair"
          : slot.level < 1
            ? "Being built"
            : "Upgrading";
    // The space keeps title and state two words for a screen reader; the flex row ignores it.
    head.append(" ", state);
    card.append(head);
    return card;
  }

  private trainingCard(
    title: string,
    training: RunningTraining,
    used: Set<string>,
    slot?: AcademySlot,
  ): HTMLElement {
    const { monster } = training;
    const card = document.createElement("section");
    card.className = "train-slot train-slot--training";
    card.setAttribute("role", "listitem");
    card.setAttribute("aria-label", `${title}: training ${monster.name}`);

    const head = document.createElement("div");
    head.className = "train-slot__head";
    const what = document.createElement("span");
    what.className = "train-slot__what";
    what.append(monsterPicture(monster, "small", "train-slot__picture"), `${monster.name} → ${training.to}`);
    const countdown = document.createElement("span");
    countdown.className = "train-slot__countdown";
    head.append(slotTitle(title, slot?.level ?? null), " ", what, " ", countdown);

    const bar = document.createElement("div");
    bar.className = "monsters-bar train-slot__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${monster.name} training progress`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    bar.append(fill);

    const clock: SlotClock = { training, countdown, fill, bar };
    this.slotClocks.push(clock);
    this.drawClock(clock);

    const row = document.createElement("div");
    row.className = "map-row map-row--wrap train-slot__buttons";
    const key = `finish:${monster.id}`;
    used.add(key);
    const price = finishPrice(training, this.store.now());
    const finish = this.shinyButton(key, "Finish now", () => void this.runFinish(monster.id));
    finish.setPrice(price);
    finish.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
    row.append(finish.element);

    card.append(head, bar);
    if (this.confirmingCancel === monster.id) {
      card.append(row, this.cancelConfirm(training));
    } else {
      const cancel = plainButton("Cancel", () => {
        this.confirmingCancel = monster.id;
        this.render();
        this.element.querySelector<HTMLButtonElement>(".locker-cancel__confirm")?.focus();
      });
      cancel.classList.add("btn--ghost", "train-slot__cancel");
      cancel.dataset["focusKey"] = `cancel-${monster.id}`;
      cancel.title = `Cancel training ${monster.name}`;
      this.plainButtons.push(cancel);
      row.append(cancel);
      card.append(row);
    }
    return card;
  }

  private drawClock(clock: SlotClock): void {
    const { training } = clock;
    const remaining = Math.max(0, training.endsAt - this.store.now());
    clock.countdown.textContent = duration(remaining);
    const total = Math.max(remaining, training.duration ?? remaining, 1);
    const done = progressFraction(remaining, total);
    const percent = Math.round(done * 100);
    clock.fill.style.width = `${done * 100}%`;
    clock.bar.setAttribute("aria-valuenow", String(percent));
    clock.bar.setAttribute("aria-valuetext", `${percent}%, ${duration(remaining)} left`);
  }

  private cancelConfirm(training: RunningTraining): HTMLElement {
    const { refund, lost } = cancelRefund(training, this.store);
    const wrap = document.createElement("div");
    wrap.className = "locker-cancel locker-cancel--confirming";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancel");
    const question = document.createElement("p");
    question.className = "locker-cancel__question";
    question.append(
      `Cancel training ${training.monster.name} and get back `,
      refund > 0 ? resourceAmount("r3", refund) : "nothing",
      "? Progress is lost.",
    );
    wrap.append(question);
    if (lost > 0) {
      const warning = document.createElement("p");
      warning.className = "locker-cancel__lost";
      warning.append("Your storage is full: ", resourceAmount("r3", lost), " will not fit and is lost.");
      wrap.append(warning);
    }
    const row = document.createElement("div");
    row.className = "map-row";
    const monster = training.monster.id;
    const confirm = plainButton("Yes, cancel", () => {
      this.confirmingCancel = null;
      void this.runCancel(monster);
    });
    confirm.classList.add("btn--danger", "locker-cancel__confirm");
    const keep = plainButton("Keep training", () => {
      this.confirmingCancel = null;
      this.render();
    });
    this.plainButtons.push(confirm);
    row.append(confirm, keep);
    wrap.append(row);
    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.confirmingCancel = null;
      this.render();
    });
    return wrap;
  }

  private renderList(rows: readonly TrainRow[]): void {
    this.rowClocks = [];
    if (rows.length === 0) {
      const empty = document.createElement("li");
      empty.className = "train__empty";
      empty.textContent = "No monsters unlocked yet. Unlock one in the Monster Locker first.";
      this.list.replaceChildren(empty);
      return;
    }
    const items = rows.map((row) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const kind = row.training ? "training" : row.step ? "ready" : "max";
      button.className = `locker-row train-row train-row--${kind}`;
      button.dataset["monster"] = row.monster.id;
      button.dataset["focusKey"] = `row-${row.monster.id}`;
      button.setAttribute("aria-pressed", String(row.monster.id === this.selected));
      button.addEventListener("click", () => this.select(row.monster.id));

      const name = document.createElement("span");
      name.className = "locker-row__name";
      name.append(row.monster.name, " ");
      const level = document.createElement("span");
      level.className = "train-row__level";
      level.textContent = `Level ${row.level}/${row.max}`;
      name.append(level);

      const state = document.createElement("span");
      state.className = "locker-row__state";
      if (row.training) {
        const clock = document.createElement("span");
        clock.className = "locker-row__clock";
        clock.textContent = duration(row.training.endsAt - this.store.now());
        this.rowClocks.push({ node: clock, endsAt: row.training.endsAt });
        state.append(`Training → ${row.training.to} · `, clock);
      } else if (row.step) {
        state.append(`→ ${row.level + 1}: `, resourceAmount("r3", row.step[0]), ` · ${duration(row.step[1])}`);
      } else {
        state.textContent = "Fully trained";
      }
      button.append(monsterPicture(row.monster, "small", "locker-row__picture"), name, " ", state);
      item.append(button);
      return item;
    });
    this.list.replaceChildren(...items);
  }

  private renderDetail(row: TrainRow | null, used: Set<string>): void {
    if (!row) {
      this.detail.replaceChildren();
      return;
    }
    const { monster, level, max, step, training } = row;
    const store = this.store;

    const head = document.createElement("div");
    head.className = "locker-detail__head";
    head.append(monsterPicture(monster, "portrait", "locker-detail__portrait"));
    const heading = document.createElement("div");
    heading.className = "locker-detail__heading";
    const name = document.createElement("h3");
    name.className = "locker-detail__name";
    name.textContent = monster.name;
    const facts = document.createElement("p");
    facts.className = "locker-detail__facts";
    facts.textContent = `Level ${level} of ${max}`;
    const stats = document.createElement("p");
    stats.className = "locker-detail__stats";
    stats.textContent = statLine(monster.id, level, step ? level + 1 : null);
    heading.append(name, facts, stats);
    head.append(heading);

    const action = document.createElement("div");
    action.className = "locker-detail__action";

    if (training) {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `Training to level ${training.to}: ready in ${duration(training.endsAt - store.now())}.`;
      action.append(note);
    } else if (!step) {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `${monster.name} is fully trained.`;
      action.append(note);
    } else {
      const gate = trainGate(monster, store);
      const lockedInstant = instantGate(monster, store);
      const facts = document.createElement("p");
      facts.className = "locker-detail__note";
      const at = academyFor(store, level);
      facts.append(
        `Level ${level + 1}: `,
        resourceAmount("r3", step[0]),
        ` · ${duration(step[1])}`,
        ...(gate === null && at ? [` · at Academy ${at.number}`] : []),
      );
      action.append(facts);
      // Training is a player-wide level, not one monster's (issue #180).
      const scope = document.createElement("p");
      scope.className = "locker-detail__note";
      scope.textContent = `Training upgrades every ${monster.name}, now and in future.`;
      action.append(scope);
      if (gate) action.append(gateLine(gate));
      const buttons = document.createElement("div");
      buttons.className = "map-row map-row--wrap locker-detail__buttons";
      const train = plainButton(`Train to level ${level + 1}`, () => void this.runTrain(monster.id), "btn--primary");
      train.dataset["focusKey"] = "train";
      train.disabled = gate !== null;
      if (gate) train.title = `${gateText(gate)}.`;
      this.plainButtons.push(train);
      used.add("instant");
      const instant = this.shinyButton("instant", "Instant", () => void this.runInstant(monster.id));
      instant.setPrice(instantPrice(step));
      instant.setBlocked(lockedInstant ? `${gateText(lockedInstant)}.` : null);
      buttons.append(train, instant.element);
      action.append(buttons);
    }

    const blurb = document.createElement("p");
    blurb.className = "locker-detail__blurb";
    blurb.append(...describe(monster.description));

    this.detail.replaceChildren(head, action, blurb);
  }

  private select(id: string, redraw = true): void {
    if (this.selected === id) return;
    this.selected = id;
    // Another monster's Instant is a different price: never carry an armed one across.
    this.shiny.get("instant")?.destroy();
    this.shiny.delete("instant");
    if (redraw) this.render();
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

  /** Every academy button waits while any academy request is in flight or queued. */
  private syncPending(): void {
    const store = this.store;
    const busy = ACADEMY_KEYS.some((key) => store.isRunning(key));
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
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runTrain(id: string): Promise<void> {
    const result = await this.actions.train(id);
    this.report(result, (report) => [
      `Training ${nameOf(report.monster)} to level ${report.to}: `,
      resourceAmount("r3", report.cost.r3),
      " spent.",
    ]);
  }

  private async runInstant(id: string): Promise<void> {
    const result = await this.actions.instant(id);
    this.report(result, (report) => [
      `${nameOf(report.monster)} is level ${report.level}, for `,
      resourceAmount("shiny", report.credits),
      ".",
    ]);
  }

  private async runFinish(id: string): Promise<void> {
    const result = await this.actions.finish(id);
    this.report(result, (report) => [
      `${nameOf(report.monster)} is level ${report.level}`,
      ...(report.credits > 0 ? [", for ", resourceAmount("shiny", report.credits)] : []),
      ".",
    ]);
  }

  private async runCancel(id: string): Promise<void> {
    const result = await this.actions.cancel(id);
    this.report(result, (report) =>
      report.refund.r3 > 0
        ? ["Training cancelled. Got back ", resourceAmount("r3", report.refund.r3), "."]
        : ["Training cancelled."],
    );
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

const nameOf = (id: string): string => monsterEntry(id)?.name ?? id;

/** The card a list opens on: the first monster that can go up a level, else the first. */
const defaultSelection = (rows: readonly TrainRow[]): string | null =>
  rows.find((row) => row.step !== null && row.training === null)?.monster.id ??
  rows[0]?.monster.id ??
  null;

/** "Academy 1 · level 3" as the slot's heading. */
const slotTitle = (title: string, level: number | null): HTMLElement => {
  const heading = document.createElement("h3");
  heading.className = "train-slot__title";
  heading.textContent = title;
  if (level !== null && level > 0) {
    const small = document.createElement("span");
    small.className = "train-slot__level";
    small.textContent = ` · level ${level}`;
    heading.append(small);
  }
  return heading;
};

/**
 * What the next level changes: "Health 400 → 480 · Damage 30 → 36 · Space 1".
 * A negative damage is a healer's (Vorg). Hatch cost is included when it moves.
 */
export const statLine = (id: string, level: number, next: number | null): string => {
  const pair = (now: number, then: number | null): string =>
    then === null || then === now ? formatAmount(now) : `${formatAmount(now)} → ${formatAmount(then)}`;
  const health = pair(monsterStat(id, "health", level), next && monsterStat(id, "health", next));
  const damageNow = monsterStat(id, "damage", level);
  const damageNext = next && monsterStat(id, "damage", next);
  const damage =
    damageNow < 0
      ? `Heals ${pair(-damageNow, damageNext === null ? null : -damageNext)}`
      : `Damage ${pair(damageNow, damageNext)}`;
  const speedNow = monsterStat(id, "speed", level);
  const speedNext = next && monsterStat(id, "speed", next);
  const speed =
    speedNext === null || speedNext === speedNow
      ? speedText(id, level)
      : `${speedText(id, level)} → ${speedText(id, next ?? level)}`;
  const space = pair(housingSpace(id, level) ?? 0, next && (housingSpace(id, next) ?? 0));
  const goo = pair(hatchCost(id, level) ?? 0, next && (hatchCost(id, next) ?? 0));
  const time =
    next === null || hatchTimeText(id, next) === hatchTimeText(id, level)
      ? hatchTimeText(id, level)
      : `${hatchTimeText(id, level)} → ${hatchTimeText(id, next)}`;
  return [`Health ${health}`, damage, `Speed ${speed}`, `Space ${space}`, `Hatch ${goo} goo`, `Hatch time ${time}`].join(" · ");
};

/** The one line that says why Train is disabled; a putty shortfall with its icon. */
const gateLine = (gate: TrainGate): HTMLElement => {
  const line = document.createElement("p");
  line.className = "monsters-gate";
  if (gate.reason === "shortfall" && !gate.overCap) {
    line.append("Need ", resourceAmount("r3", gate.need), " more");
  } else line.textContent = gateText(gate);
  return line;
};

const plainButton = (label: string, onClick: () => void, variant?: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = variant ? `btn ${variant}` : "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
