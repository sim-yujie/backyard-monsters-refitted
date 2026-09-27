import { LOCKER_KEYS, lockerActions, type LockerActions } from "@/api/yardMonsters";
import type { YardRefusal } from "@/api/yard";
import { monsterStat } from "@/game/combat/rules";
import { academyLevel } from "@/game/monsters/housingSummary";
import {
  cancelRefund,
  finishPrice,
  gateText,
  instantGate,
  instantPrice,
  LOCKER_OVERDRIVE,
  lockerRows,
  overdriveBlocked,
  overdriveEndsAt,
  runningUnlock,
  startGate,
  type LockerRow,
  type RunningUnlock,
  type UnlockGate,
} from "@/game/monsters/lockerModel";
import { housingSpace, monsterEntry, type MonsterEntry } from "@/game/monsters/monsterCatalogue";
import { progressFraction } from "@/game/yard/jobs";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { resourceAmount } from "@/ui/resourceIcon";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { MonstersTabId, type MonstersFocus, type MonstersTab, type MonstersTabContext } from "./monstersTab";

/**
 * The Unlock tab: the Monster Locker (`docs/design/yard-buildings.md` §4.3).
 *
 * Top to bottom: the unlock running now, if any, with its countdown, Finish
 * now, the Locker Overdrive and Cancel; then one scrolling list of every
 * obtainable monster in list order — no four-per-page paging — each row saying
 * where it stands (unlocked, unlocking with its countdown, its price and time,
 * or the locker level it waits for); beside it (under it on a phone) the
 * selected monster's card with Start unlocking and Instant.
 *
 * What is offered, why a button is disabled and every price come from
 * `game/monsters/lockerModel.ts`; the requests go through the store's queue
 * (`lockerActions`, `api/yardMonsters.ts`). Shiny spends are
 * {@link ShinyButton}s (tap, then tap again); Cancel opens one inline
 * confirmation stating the refund, capped as the server caps it.
 */

/** Seconds as the list and the card spell a duration: "2d 4h", "10m 0s". */
const duration = (seconds: number): string => formatCountdown(seconds);

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** The live parts of the running block, refreshed every second without a redraw. */
interface RunningRefs {
  readonly countdown: HTMLElement;
  readonly fill: HTMLElement;
  readonly bar: HTMLElement;
  readonly overdrive: HTMLElement;
}

export class LockerTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: LockerActions;
  private readonly running: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly status: HTMLElement;

  /** The monster whose card is shown. */
  private selected: string | null = null;
  private confirmingCancel = false;
  private runningRefs: RunningRefs | null = null;
  /** Row countdowns, refreshed once a second. */
  private rowClocks: { node: HTMLElement; endsAt: number }[] = [];
  /** Long-lived Shiny buttons, so an armed one survives the redraws. */
  private readonly shiny = new Map<string, ShinyButton>();
  /** Plain buttons disabled while any locker request runs. */
  private plainButtons: HTMLButtonElement[] = [];

  constructor(context: MonstersTabContext, actions?: LockerActions) {
    this.context = context;
    this.actions = actions ?? lockerActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "locker";

    this.running = document.createElement("div");
    this.running.className = "locker__running-slot";

    const split = document.createElement("div");
    split.className = "locker__split";
    this.list = document.createElement("ul");
    this.list.className = "locker__list";
    this.list.setAttribute("aria-label", "Monsters");
    this.detail = document.createElement("section");
    this.detail.className = "locker__detail";
    this.detail.setAttribute("aria-live", "polite");
    split.append(this.list, this.detail);

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.element.append(this.running, this.status, split);
  }

  private get store() {
    return this.context.binding.store;
  }

  show(focus: MonstersFocus): void {
    if (focus.monster && monsterEntry(focus.monster)?.blocked === false) {
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
    const running = runningUnlock(this.store);
    if (running && this.runningRefs) this.drawRunningClock(running, this.runningRefs);
    const finish = this.shiny.get("finish");
    if (running && finish) finish.setPrice(finishPrice(running, now));
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
    const rows = lockerRows(this.store);
    const running = runningUnlock(this.store);
    if (!this.selected || !rows.some((row) => row.monster.id === this.selected)) {
      this.selected = defaultSelection(rows, running);
    }
    if (!running) this.confirmingCancel = false;

    this.plainButtons = [];
    const used = new Set<string>();
    this.renderRunning(running, used);
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

  private renderRunning(running: RunningUnlock | null, used: Set<string>): void {
    this.runningRefs = null;
    if (!running) {
      this.running.replaceChildren();
      this.running.hidden = true;
      return;
    }
    this.running.hidden = false;
    const block = document.createElement("section");
    block.className = "locker-running";
    block.setAttribute("aria-label", `Unlocking ${running.monster.name}`);

    const head = document.createElement("div");
    head.className = "locker-running__head";
    head.append(monsterPicture(running.monster, "small", "locker-running__picture"));
    const title = document.createElement("h3");
    title.className = "locker-running__title";
    title.textContent = `Unlocking ${running.monster.name}`;
    const countdown = document.createElement("span");
    countdown.className = "locker-running__countdown";
    head.append(title, countdown);

    const bar = document.createElement("div");
    bar.className = "monsters-bar";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "Unlock progress");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", "100");
    const fill = document.createElement("div");
    fill.className = "monsters-bar__fill";
    bar.append(fill);

    const overdrive = document.createElement("p");
    overdrive.className = "locker-running__overdrive";

    const refs: RunningRefs = { countdown, fill, bar, overdrive };
    this.runningRefs = refs;
    this.drawRunningClock(running, refs);

    const row = document.createElement("div");
    row.className = "map-row map-row--wrap locker-running__buttons";
    const now = this.store.now();
    const price = finishPrice(running, now);
    used.add("finish");
    const finish = this.shinyButton("finish", "Finish now", () => void this.runFinish());
    finish.setPrice(price);
    finish.setBlocked(this.store.credits < price ? "Not enough Shiny." : null);
    row.append(finish.element);

    used.add("overdrive");
    const boost = this.shinyButton("overdrive", "Overdrive 4 h", () => void this.runOverdrive());
    boost.element.title = "Unlocks five times as fast for four hours.";
    boost.setPrice(LOCKER_OVERDRIVE.price);
    boost.setBlocked(overdriveBlocked(this.store));
    row.append(boost.element);

    block.append(head, bar, overdrive, row, this.cancelControl(running));
    this.running.replaceChildren(block);
  }

  private drawRunningClock(running: RunningUnlock, refs: RunningRefs): void {
    const now = this.store.now();
    const remaining = Math.max(0, running.endsAt - now);
    refs.countdown.textContent = duration(remaining);
    const total =
      running.startedAt !== null
        ? Math.max(remaining, running.endsAt - running.startedAt)
        : running.monster.time;
    const done = progressFraction(remaining, Math.max(total, 1));
    const percent = Math.round(done * 100);
    refs.fill.style.width = `${done * 100}%`;
    refs.bar.setAttribute("aria-valuenow", String(percent));
    refs.bar.setAttribute("aria-valuetext", `${percent}%, ${duration(remaining)} left`);
    const boosted = overdriveEndsAt(this.store);
    refs.overdrive.hidden = boosted === null;
    refs.overdrive.textContent =
      boosted === null ? "" : `Overdrive: five times as fast for ${duration(boosted - now)}.`;
  }

  private cancelControl(running: RunningUnlock): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "locker-cancel";
    if (!this.confirmingCancel) {
      const button = plainButton("Cancel unlock", () => {
        this.confirmingCancel = true;
        this.render();
        this.element.querySelector<HTMLButtonElement>(".locker-cancel__confirm")?.focus();
      });
      button.classList.add("btn--ghost", "locker-cancel__open");
      button.dataset["focusKey"] = "cancel";
      this.plainButtons.push(button);
      wrap.append(button);
      return wrap;
    }

    const { refund, lost } = cancelRefund(running, this.store);
    wrap.classList.add("locker-cancel--confirming");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Confirm cancel");
    const question = document.createElement("p");
    question.className = "locker-cancel__question";
    question.append(
      "Cancel and get back ",
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
    const keep = plainButton("Keep unlocking", () => {
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

  private renderList(rows: readonly LockerRow[]): void {
    this.rowClocks = [];
    const items = rows.map((row) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `locker-row locker-row--${row.state.kind}`;
      button.dataset["monster"] = row.monster.id;
      button.dataset["focusKey"] = `row-${row.monster.id}`;
      const selected = row.monster.id === this.selected;
      button.setAttribute("aria-pressed", String(selected));
      button.addEventListener("click", () => this.select(row.monster.id));

      const name = document.createElement("span");
      name.className = "locker-row__name";
      name.textContent = row.monster.name;
      const state = document.createElement("span");
      state.className = "locker-row__state";
      switch (row.state.kind) {
        case "unlocked":
          state.textContent = "Unlocked";
          break;
        case "unlocking": {
          const clock = document.createElement("span");
          clock.className = "locker-row__clock";
          clock.textContent = duration(row.state.endsAt - this.store.now());
          this.rowClocks.push({ node: clock, endsAt: row.state.endsAt });
          state.append("Unlocking · ", clock);
          break;
        }
        case "available":
          state.append(
            resourceAmount("r3", row.monster.resource),
            ` · ${duration(row.monster.time)}`,
          );
          break;
        case "locked":
          state.textContent = `Needs Locker ${row.state.need}`;
          break;
      }
      // The space keeps name and state two words for a screen reader; the grid ignores it.
      button.append(monsterPicture(row.monster, "small", "locker-row__picture"), name, " ", state);
      item.append(button);
      return item;
    });
    this.list.replaceChildren(...items);
  }

  private renderDetail(row: LockerRow | null, used: Set<string>): void {
    if (!row) {
      this.detail.replaceChildren();
      return;
    }
    const { monster, state } = row;
    const store = this.store;
    const level = academyLevel(store.save.academy, monster.id);

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
    facts.append(
      `Locker level ${monster.level} · `,
      resourceAmount("r3", monster.resource),
      ` · ${duration(monster.time)}`,
    );
    const stats = document.createElement("p");
    stats.className = "locker-detail__stats";
    // A negative damage is a healer's: Vorg mends the monsters around it.
    const damage = monsterStat(monster.id, "damage", level);
    stats.textContent = [
      `Health ${formatAmount(monsterStat(monster.id, "health", level))}`,
      damage < 0 ? `Heals ${formatAmount(-damage)}` : `Damage ${formatAmount(damage)}`,
      `Space ${housingSpace(monster.id, level) ?? 0}`,
    ].join(" · ");
    heading.append(name, facts, stats);
    head.append(heading);

    const blurb = document.createElement("p");
    blurb.className = "locker-detail__blurb";
    blurb.append(...describe(monster.description));

    const action = document.createElement("div");
    action.className = "locker-detail__action";

    if (state.kind === "unlocked") {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `${monster.name} is unlocked.`;
      const hatch = plainButton("Hatch", () =>
        this.context.showTab(MonstersTabId.HATCH, { monster: monster.id }),
      );
      action.append(note, hatch);
    } else if (state.kind === "unlocking") {
      const note = document.createElement("p");
      note.className = "locker-detail__note";
      note.textContent = `Unlocking now: ready in ${duration(state.endsAt - store.now())}.`;
      action.append(note);
    } else {
      const gate = startGate(monster, store);
      const lockedInstant = instantGate(monster, store);
      if (gate) action.append(gateLine(gate));
      const row = document.createElement("div");
      row.className = "map-row map-row--wrap locker-detail__buttons";
      const start = plainButton("Start unlocking", () => void this.runStart(monster.id), "btn--primary");
      start.dataset["focusKey"] = "start";
      start.disabled = gate !== null;
      if (gate) start.title = `${gateText(gate)}.`;
      this.plainButtons.push(start);
      used.add("instant");
      const instant = this.shinyButton("instant", "Instant", () => void this.runInstant(monster.id));
      instant.setPrice(instantPrice(monster));
      instant.setBlocked(lockedInstant ? `${gateText(lockedInstant)}.` : null);
      row.append(start, instant.element);
      action.append(row);
    }

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

  /** Every locker button waits while any locker request is in flight or queued. */
  private syncPending(): void {
    const store = this.store;
    const busy = LOCKER_KEYS.some((key) => store.isRunning(key));
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
      `Unlocking ${monsterEntry(report.monster)?.name ?? report.monster}: `,
      resourceAmount("r3", report.cost.r3),
      " spent.",
    ]);
  }

  private async runInstant(id: string): Promise<void> {
    const result = await this.actions.instant(id);
    this.report(result, (report) => [
      `${monsterEntry(report.monster)?.name ?? report.monster} unlocked for `,
      resourceAmount("shiny", report.credits),
      ".",
    ]);
  }

  private async runFinish(): Promise<void> {
    const result = await this.actions.finish();
    this.report(result, (report) => [
      `${monsterEntry(report.monster)?.name ?? report.monster} unlocked`,
      ...(report.credits > 0 ? [" for ", resourceAmount("shiny", report.credits)] : []),
      ".",
    ]);
  }

  private async runCancel(): Promise<void> {
    const result = await this.actions.cancel();
    this.report(result, (report) =>
      report.refund.r3 > 0
        ? ["Unlock cancelled. Got back ", resourceAmount("r3", report.refund.r3), "."]
        : ["Unlock cancelled."],
    );
  }

  private async runOverdrive(): Promise<void> {
    const result = await this.actions.overdrive();
    this.report(result, () => ["Overdrive on: the unlock runs five times as fast for four hours."]);
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
 * The card a list opens on: the one named, else the one unlocking, else the
 * first the player could start, else the first.
 */
const defaultSelection = (rows: readonly LockerRow[], running: RunningUnlock | null): string | null =>
  running?.monster.id ??
  rows.find((row) => row.state.kind === "available")?.monster.id ??
  rows[0]?.monster.id ??
  null;

/**
 * A monster's picture: `-portrait.jpg` for the card, `-small.png` for a row
 * (`server/public/assets/monsters/`; both exist for every listed monster).
 * Decorative: the name is always beside it.
 */
export const monsterPicture = (
  monster: MonsterEntry,
  size: "portrait" | "small",
  className: string,
): HTMLImageElement => {
  const image = document.createElement("img");
  image.className = className;
  image.src = `/assets/monsters/${monster.id}-${size === "portrait" ? "portrait.jpg" : "small.png"}`;
  image.alt = "";
  image.loading = "lazy";
  image.decoding = "async";
  return image;
};

/**
 * The game's blurb as nodes: its only markup is `<br>` and `<b>…</b>`
 * (`monsterCatalogue.ts`), drawn as a line break and bold. Everything else is
 * text, never parsed as HTML.
 */
export const describe = (markup: string): Node[] => {
  const nodes: Node[] = [];
  let bold: HTMLElement | null = null;
  for (const part of markup.split(/(<br\s*\/?>|<b>|<\/b>)/i)) {
    const tag = part.toLowerCase();
    if (tag.startsWith("<br")) nodes.push(document.createElement("br"));
    else if (tag === "<b>") bold = document.createElement("strong");
    else if (tag === "</b>") {
      if (bold) nodes.push(bold);
      bold = null;
    } else if (part) {
      if (bold) bold.append(part);
      else nodes.push(document.createTextNode(part));
    }
  }
  if (bold) nodes.push(bold);
  return nodes;
};

/** The one line that says why Start is disabled; a putty shortfall with its icon. */
const gateLine = (gate: UnlockGate): HTMLElement => {
  const line = document.createElement("p");
  line.className = "monsters-gate";
  if (gate.reason === "shortfall" && !gate.overCap) {
    line.append("Need ", resourceAmount("r3", gate.need), " more");
  }
  else line.textContent = gateText(gate);
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
