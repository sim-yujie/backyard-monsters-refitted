import { LAB_KEYS, labActions, type LabActions } from "@/api/yardLab";
import type { YardRefusal } from "@/api/yard";
import {
  MAX_RANK,
  cancelRefund,
  effectLine,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  labRows,
  labSlot,
  monsterGate,
  researchGate,
  runningResearch,
  type LabGate,
  type LabRow,
  type LabSlot,
  type RunningResearch,
} from "@/game/monsters/lab";
import { labAbility, monsterEntry } from "@/game/monsters/monsterCatalogue";
import { progressFraction } from "@/game/yard/jobs";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { resourceAmount } from "@/ui/resourceIcon";
import "@/ui/styles/train.css";
import "@/ui/styles/lab.css";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { monsterPicture } from "./LockerTab";
import type { MonstersFocus, MonstersTab, MonstersTabContext } from "./monstersTab";

/**
 * The Lab tab: the Monster Lab (`docs/design/yard-buildings.md` §6 "Lab tab").
 *
 * Top to bottom: the Lab as one slot ("Monster Lab · level 2 · Idle", or the
 * running research with its countdown, Finish now and Cancel) — one Lab, one
 * research at a time; then the ten monsters with an ability, each with its
 * rank 0–3, the next rank's putty and time, what the ability does now and
 * next in plain words, and the reason it cannot be researched yet ("Needs Lab
 * level 2", "Needs Octo-ooze at level 3"); beside it (under it on a phone)
 * the selected monster's card with Research and Instant. The Train tab's
 * layout and pieces, so the two read as one screen.
 *
 * What is offered, why a button is disabled and every price come from
 * `game/monsters/lab.ts`; the requests go through the store's queue
 * (`labActions`, `api/yardLab.ts`). Shiny spends are {@link ShinyButton}s
 * (tap, then tap again); Cancel opens one inline confirmation stating the
 * refund, capped as the server caps it.
 */

const duration = (seconds: number): string => formatCountdown(seconds);

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** The running research's live parts, refreshed every second without a redraw. */
interface ResearchClock {
  readonly research: RunningResearch;
  readonly countdown: HTMLElement;
  readonly fill: HTMLElement;
  readonly bar: HTMLElement;
}

export class LabTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: LabActions;
  private readonly slot: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly status: HTMLElement;

  /** The monster whose card is shown. */
  private selected: string | null = null;
  /** Whether Cancel is asking for confirmation. */
  private confirmingCancel = false;
  private clock: ResearchClock | null = null;
  /** Row countdowns, refreshed once a second. */
  private rowClocks: { node: HTMLElement; endsAt: number }[] = [];
  /** Long-lived Shiny buttons, so an armed one survives the redraws. */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Plain buttons disabled while any Lab request runs. */
  private plainButtons: HTMLButtonElement[] = [];

  constructor(context: MonstersTabContext, actions?: LabActions) {
    this.context = context;
    this.actions = actions ?? labActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "train lab";

    this.slot = document.createElement("div");
    this.slot.className = "train__slots lab__slot";

    const split = document.createElement("div");
    split.className = "locker__split train__split";
    this.list = document.createElement("ul");
    this.list.className = "locker__list";
    this.list.setAttribute("aria-label", "Monster abilities");
    this.detail = document.createElement("section");
    this.detail.className = "locker__detail";
    this.detail.setAttribute("aria-live", "polite");
    split.append(this.list, this.detail);

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.element.append(this.slot, this.status, split);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    // The Lab opens on what it is researching; a named monster wins.
    const wanted = focus.monster ?? runningResearch(this.store)?.monster.id;
    if (wanted && labAbility(wanted)) this.select(wanted, false);
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
    if (this.clock) {
      this.drawClock(this.clock);
      this.shiny.get("finish")?.setPrice(finishPrice(this.clock.research, now));
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
    const rows = labRows(this.store);
    if (!this.selected || !rows.some((row) => row.monster.id === this.selected)) {
      this.selected = this.defaultSelection(rows);
    }
    const slot = labSlot(this.store);
    if (slot?.state.kind !== "researching") this.confirmingCancel = false;

    this.plainButtons = [];
    const used = new Set<string>();
    this.renderSlot(slot, used);
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

  /** The research running, else the first that can start, else the first the Lab could take, else the first. */
  private defaultSelection(rows: readonly LabRow[]): string | null {
    const store = this.store;
    return (
      rows.find((row) => row.research)?.monster.id ??
      rows.find((row) => researchGate(row.ability, store) === null)?.monster.id ??
      rows.find((row) => monsterGate(row.ability, store) === null)?.monster.id ??
      rows[0]?.monster.id ??
      null
    );
  }

  private renderSlot(slot: LabSlot | null, used: Set<string>): void {
    this.clock = null;
    if (!slot) {
      this.slot.replaceChildren();
      return;
    }
    if (slot.state.kind === "researching") {
      this.slot.replaceChildren(this.researchCard(slot, slot.state.research, used));
      return;
    }
    const card = document.createElement("section");
    card.className = `train-slot train-slot--${slot.state.kind}`;
    card.setAttribute("aria-label", "Monster Lab");
    const head = document.createElement("div");
    head.className = "train-slot__head";
    head.append(slotTitle(slot.level));
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
    head.append(" ", state);
    card.append(head);
    this.slot.replaceChildren(card);
  }

  private researchCard(slot: LabSlot, research: RunningResearch, used: Set<string>): HTMLElement {
    const { monster, ability } = research;
    const card = document.createElement("section");
    card.className = "train-slot train-slot--training";
    card.setAttribute("aria-label", `Monster Lab: researching ${ability.name} for ${monster.name}`);

    const head = document.createElement("div");
    head.className = "train-slot__head";
    const what = document.createElement("span");
    what.className = "train-slot__what";
    what.append(
      monsterPicture(monster, "small", "train-slot__picture"),
      `${monster.name}: ${ability.name} → rank ${research.rank}`,
    );
    const countdown = document.createElement("span");
    countdown.className = "train-slot__countdown";
    head.append(slotTitle(slot.level), " ", what, " ", countdown);

    const bar = document.createElement("div");
    bar.className = "monsters-bar train-slot__bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", `${ability.name} research progress`);
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    bar.append(fill);

    this.clock = { research, countdown, fill, bar };
    this.drawClock(this.clock);

    const row = document.createElement("div");
    row.className = "map-row map-row--wrap train-slot__buttons";
    used.add("finish");
    const price = finishPrice(research, this.store.now());
    const finish = this.shinyButton("finish", "Finish now", () => void this.runFinish());
    finish.setPrice(price);
    finish.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
    row.append(finish.element);

    card.append(head, bar);
    if (this.confirmingCancel) {
      card.append(row, this.cancelConfirm(research));
    } else {
      const cancel = plainButton("Cancel", () => {
        this.confirmingCancel = true;
        this.render();
        this.element.querySelector<HTMLButtonElement>(".locker-cancel__confirm")?.focus();
      });
      cancel.classList.add("btn--ghost", "train-slot__cancel");
      cancel.dataset["focusKey"] = "cancel";
      cancel.title = `Cancel researching ${ability.name}`;
      this.plainButtons.push(cancel);
      row.append(cancel);
      card.append(row);
    }
    return card;
  }

  private drawClock(clock: ResearchClock): void {
    const { research } = clock;
    const remaining = Math.max(0, research.endsAt - this.store.now());
    clock.countdown.textContent = duration(remaining);
    const total = Math.max(remaining, research.duration, 1);
    const done = progressFraction(remaining, total);
    const percent = Math.round(done * 100);
    clock.fill.style.width = `${done * 100}%`;
    clock.bar.setAttribute("aria-valuenow", String(percent));
    clock.bar.setAttribute("aria-valuetext", `${percent}%, ${duration(remaining)} left`);
  }

  private cancelConfirm(research: RunningResearch): HTMLElement {
    const { refund, lost } = cancelRefund(research, this.store);
    const wrap = document.createElement("div");
    wrap.className = "locker-cancel locker-cancel--confirming";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancel");
    const question = document.createElement("p");
    question.className = "locker-cancel__question";
    question.append(
      `Cancel researching ${research.ability.name} for ${research.monster.name} and get back `,
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
    const confirm = plainButton("Yes, cancel", () => {
      this.confirmingCancel = false;
      void this.runCancel();
    });
    confirm.classList.add("btn--danger", "locker-cancel__confirm");
    const keep = plainButton("Keep researching", () => {
      this.confirmingCancel = false;
      this.render();
    });
    this.plainButtons.push(confirm);
    row.append(confirm, keep);
    wrap.append(row);
    wrap.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.confirmingCancel = false;
      this.render();
    });
    return wrap;
  }

  private renderList(rows: readonly LabRow[]): void {
    this.rowClocks = [];
    const store = this.store;
    const items = rows.map((row) => {
      const gate = row.research ? null : monsterGate(row.ability, store);
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      const kind = row.research
        ? "training"
        : !row.step
          ? "max"
          : gate?.reason === "locked"
            ? "locked"
            : "ready";
      button.className = `locker-row train-row train-row--${kind} lab-row${kind === "locked" ? " locker-row--locked" : ""}`;
      button.dataset["monster"] = row.monster.id;
      button.dataset["focusKey"] = `row-${row.monster.id}`;
      button.setAttribute("aria-pressed", String(row.monster.id === this.selected));
      button.addEventListener("click", () => this.select(row.monster.id));

      const name = document.createElement("span");
      name.className = "locker-row__name";
      name.append(row.monster.name, " ");
      const rank = document.createElement("span");
      rank.className = "train-row__level";
      rank.textContent = `Rank ${row.rank}/${MAX_RANK}`;
      name.append(rank);

      const state = document.createElement("span");
      state.className = "locker-row__state";
      if (row.research) {
        const clock = document.createElement("span");
        clock.className = "locker-row__clock";
        clock.textContent = duration(row.research.endsAt - store.now());
        this.rowClocks.push({ node: clock, endsAt: row.research.endsAt });
        state.append(`Researching → ${row.research.rank} · `, clock);
      } else if (row.step) {
        state.append(`→ ${row.rank + 1}: `, resourceAmount("r3", row.step[0]), ` · ${duration(row.step[1])}`);
      } else {
        state.textContent = "Fully researched";
      }

      const effect = document.createElement("span");
      effect.className = "lab-row__effect";
      effect.textContent = effectLine(row.ability, row.rank);

      button.append(monsterPicture(row.monster, "small", "locker-row__picture"), name, " ", state, " ", effect);
      if (gate && gate.reason !== "maxRank") {
        const why = document.createElement("span");
        why.className = "lab-row__gate";
        why.textContent = gateText(gate);
        button.append(" ", why);
      }
      item.append(button);
      return item;
    });
    this.list.replaceChildren(...items);
  }

  private renderDetail(row: LabRow | null, used: Set<string>): void {
    if (!row) {
      this.detail.replaceChildren();
      return;
    }
    const { ability, monster, rank, step, research } = row;
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
    facts.textContent = `${ability.name} · rank ${rank} of ${MAX_RANK}`;
    const stats = document.createElement("p");
    stats.className = "locker-detail__stats";
    stats.textContent = effectLine(ability, rank);
    heading.append(name, facts, stats);
    head.append(heading);

    const action = document.createElement("div");
    action.className = "locker-detail__action";

    if (research) {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `Researching rank ${research.rank}: ready in ${duration(research.endsAt - store.now())}.`;
      action.append(note);
    } else if (!step) {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `${ability.name} is fully researched.`;
      action.append(note);
    } else {
      const gate = researchGate(ability, store);
      const lockedInstant = instantGate(ability, store);
      const cost = document.createElement("p");
      cost.className = "locker-detail__note";
      cost.append(`Rank ${rank + 1}: `, resourceAmount("r3", step[0]), ` · ${duration(step[1])}`);
      action.append(cost);
      if (gate) action.append(gateLine(gate));
      const buttons = document.createElement("div");
      buttons.className = "map-row map-row--wrap locker-detail__buttons";
      const start = plainButton(`Research rank ${rank + 1}`, () => void this.runStart(monster.id), "btn--primary");
      start.dataset["focusKey"] = "start";
      start.disabled = gate !== null;
      if (gate) start.title = `${gateText(gate)}.`;
      this.plainButtons.push(start);
      used.add("instant");
      const instant = this.shinyButton("instant", "Instant", () => void this.runInstant(monster.id));
      instant.setPrice(instantPrice(step));
      instant.setBlocked(lockedInstant ? `${gateText(lockedInstant)}.` : null);
      buttons.append(start, instant.element);
      action.append(buttons);
    }

    const blurb = document.createElement("p");
    blurb.className = "locker-detail__blurb";
    blurb.textContent = rank === 0 ? ability.description : ability.upgradeDescription;

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

  /** Every Lab button waits while any Lab request is in flight or queued. */
  private syncPending(): void {
    const store = this.store;
    const busy = LAB_KEYS.some((key) => store.isRunning(key));
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

  private async runStart(id: string): Promise<void> {
    const result = await this.actions.start(id);
    this.report(result, (report) => [
      `Researching ${abilityOf(report.monster)} rank ${report.rank} for ${nameOf(report.monster)}: `,
      resourceAmount("r3", report.cost.r3),
      " spent.",
    ]);
  }

  private async runInstant(id: string): Promise<void> {
    const result = await this.actions.instant(id);
    this.report(result, (report) => [
      `${nameOf(report.monster)} has ${abilityOf(report.monster)} rank ${report.rank}, for `,
      resourceAmount("shiny", report.credits),
      ".",
    ]);
  }

  private async runFinish(): Promise<void> {
    const result = await this.actions.finish();
    this.report(result, (report) => [
      `${nameOf(report.monster)} has ${abilityOf(report.monster)} rank ${report.rank}`,
      ...(report.credits > 0 ? [", for ", resourceAmount("shiny", report.credits)] : []),
      ".",
    ]);
  }

  private async runCancel(): Promise<void> {
    const result = await this.actions.cancel();
    this.report(result, (report) =>
      report.refund.r3 > 0
        ? ["Research cancelled. Got back ", resourceAmount("r3", report.refund.r3), "."]
        : ["Research cancelled."],
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
const abilityOf = (id: string): string => labAbility(id)?.name ?? "its ability";

/** "Monster Lab · level 2" as the slot's heading. */
const slotTitle = (level: number): HTMLElement => {
  const heading = document.createElement("h3");
  heading.className = "train-slot__title";
  heading.textContent = "Monster Lab";
  if (level > 0) {
    const small = document.createElement("span");
    small.className = "train-slot__level";
    small.textContent = ` · level ${level}`;
    heading.append(small);
  }
  return heading;
};

/** The one line that says why Research is disabled; a putty shortfall with its icon. */
const gateLine = (gate: LabGate): HTMLElement => {
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
