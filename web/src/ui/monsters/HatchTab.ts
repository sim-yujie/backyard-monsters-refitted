import {
  HATCHERY_KEYS,
  hatcheryActions,
  type HatcheryActions,
} from "@/api/yardHatchery";
import type { YardRefusal } from "@/api/yard";
import { monsterStat } from "@/game/combat/rules";
import {
  activeOverdrive,
  fillLimits,
  HATCHERY_OVERDRIVES,
  HATCHERY_TYPE,
  HCC_STACKS,
  hatchMonsters,
  housedSpace,
  housingWarning,
  lineSeconds,
  pendingSpace,
  previewAdd,
  previewFinish,
  priceOf,
  queuedCount,
  readHatchYard,
  secondsOf,
  STACK_SIZE,
  type AddPreview,
  type FillLimits,
  type FinishBlock,
  type HatcheryView,
  type HatchMonster,
  type HatchTarget,
  type HatchYard,
  type OverdriveItem,
  type QueueStack,
} from "@/game/monsters/hatchPlan";
import { monsterEntry } from "@/game/monsters/monsterCatalogue";
import { maxLevel, quantityOf, townHallLevel } from "@/game/yard/buildingCosts";
import { NEED_MORE_SILOS, overCap } from "@/game/yard/storage";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown } from "@/ui/format";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import { describe, monsterPicture } from "./LockerTab";
import {
  MonstersTabId,
  type MonstersFocus,
  type MonstersTab,
  type MonstersTabContext,
} from "./monstersTab";

/**
 * The Hatch tab: the Hatcheries and the Hatchery Control Centre, laid out as
 * the original's hatchery popup (issue #156; `client/scripts/HATCHERYPOPUP.as`,
 * `HATCHERYCCPOPUP.as`), in style B.
 *
 * Top to bottom:
 *
 * - **The line**, one per hatchery: the monster hatching now (picture, time
 *   left, progress; a tap cancels it for its goo, after a confirm), then one
 *   slot per waiting stack with its ×N (a tap takes one out), as many slots
 *   as the hatchery's level allows (`1 + level`), and the next locked slot
 *   saying the upgrade that opens it. With an HCC, one row of each
 *   hatchery's monster in production and the shared queue's seven slots
 *   under it (`HATCHERYCCPOPUP.as:431-460`). Beside the line, how long it
 *   takes to empty and the one small "Finish now or speed up" link, which
 *   opens Finish now and the Overdrive.
 * - **The message**: what the hatchery is doing, in a sentence
 *   (`HATCHERYPOPUP.as:430-467`), and the housing bar with what is housed,
 *   what is on its way and what the chosen batch would add.
 * - **The grid** of every monster (nine across, as the original): a tap on
 *   an unlocked one adds one at once; a locked one is dimmed and, chosen,
 *   says why.
 * - **The info panel**: the chosen monster's portrait, level, blurb and six
 *   numbers, and the one thing the original lacked, a batch add: the shared
 *   `QuantityStepper` with Max, and "Add 4 Bolts · 1,400". The slots show the
 *   batch dashed where it would go before it is sent. On a phone the panel
 *   is a bar fixed to the bottom of the sheet.
 *
 * Every number comes from `game/monsters/hatchPlan.ts`, which replays the
 * server's rules; the requests go through the store's queue
 * (`hatcheryActions`, `api/yardHatchery.ts`), one per batch or removal, and
 * the tab redraws from the answer. Shiny spends are {@link ShinyButton}s.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** A live countdown, refreshed once a second without a redraw. */
interface Clock {
  readonly node: HTMLElement;
  readonly endsAt: number;
  /** Its progress bar's fill, and the seconds a whole monster takes. */
  readonly fill?: HTMLElement;
  readonly total?: number;
  /** Words after the time: " left". */
  readonly suffix?: string;
}

/** The first count offered when a monster is picked. */
const DEFAULT_COUNT = 1;

/** The most hatcheries a yard ever holds (`client/scripts/HATCHERYCCPOPUP.as:668`). */
const MAX_HATCHERIES = 5;

/** Seconds as a countdown: "12s", "4m 10s". */
const duration = (seconds: number): string => formatCountdown(Math.ceil(seconds));

/** A monster's display name, or its id. */
const nameOf = (id: string): string => monsterEntry(id)?.name ?? id;

/** "Bolts" for more than one; names ending in s, x or a full stop stay as they are. */
export const plural = (name: string, count: number): string =>
  count === 1 || /[sx.]$/i.test(name) ? name : `${name}s`;

/** "2nd", "3rd", "4th". */
const ordinal = (n: number): string =>
  `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

/** A stat as the info panel prints it: whole numbers grouped, speeds to two places. */
const statNumber = (value: number): string =>
  Number.isInteger(value) ? formatAmount(value) : String(Number(value.toFixed(2)));

/** Why Finish now cannot be pressed, as its visible line. */
const FINISH_TEXT: Readonly<Record<FinishBlock, string>> = {
  busy: "Still being built",
  damaged: "Repair it first",
  nothingToFinish: "Nothing to finish",
  housingFull: "Housing full",
};

/** Where the chosen batch would land, as the slots draw it. */
interface SlotPreview {
  readonly monster: string;
  /** Monsters topping up an existing stack, by 1-based slot. */
  readonly topUps: ReadonlyMap<number, number>;
  /** Each new stack's count, in queue order. */
  readonly fresh: readonly number[];
  /** Hatcheries (by id) the batch would start at once, and the monster each takes. */
  readonly starts: ReadonlyMap<number, string>;
}

export class HatchTab implements MonstersTab {
  readonly element: HTMLElement;

  private readonly context: MonstersTabContext;
  private readonly actions: HatcheryActions;
  private readonly status: HTMLElement;
  private readonly lines: HTMLElement;
  private readonly boosts: HTMLElement;
  private readonly message: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly lockedNote: HTMLElement;
  private readonly info: HTMLElement;
  private readonly infoHead: HTMLElement;
  private readonly infoEach: HTMLElement;
  private readonly detailsButton: HTMLButtonElement;
  private readonly stats: HTMLElement;
  private readonly addBlock: HTMLElement;
  private readonly stepper: QuantityStepper;
  private readonly addButton: HTMLButtonElement;
  private readonly noteLine: HTMLElement;
  private readonly warningLine: HTMLElement;
  private readonly gateLine: HTMLElement;

  /** The hatchery (or `hcc`) a batch goes to, and Finish now is for. */
  private target: HatchTarget | null = null;
  private selected: string | null = null;
  private count = DEFAULT_COUNT;
  /** The hatchery whose monster in production is waiting on "Cancel it?". */
  private confirming: number | null = null;
  /** Finish now and the Overdrive, opened by the small link. */
  private boostsOpen = false;
  /** On a phone, the bar's blurb and numbers. */
  private detailsOpen = false;
  /** The yard as last read, for the count-only redraw. */
  private yard: HatchYard | null = null;
  private clocks: Clock[] = [];
  /** "All done in" per line, recomputed each second. */
  private totals: { node: HTMLElement; target: HatchTarget }[] = [];
  /** Countdowns already asked about, `id@endsAt`, so each asks the server once. */
  private readonly asked = new Set<string>();
  private readonly shiny = new Map<string, ShinyButton>();
  /** The slot buttons, disabled while any hatchery request runs: a slot's number moves under a queued removal. */
  private plainButtons: HTMLButtonElement[] = [];
  /** Add has a reason not to be pressed, or nothing to add. */
  private addBlocked = true;

  constructor(context: MonstersTabContext, actions?: HatcheryActions) {
    this.context = context;
    this.actions = actions ?? hatcheryActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "hatch";

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.lines = document.createElement("section");
    this.lines.className = "hatch-lines";
    this.lines.setAttribute("aria-label", "Hatching line");

    this.boosts = document.createElement("div");
    this.boosts.className = "hatch-boosts";
    this.boosts.id = "hatch-boosts";
    this.boosts.hidden = true;

    this.message = document.createElement("div");
    this.message.className = "hatch-message";

    const split = document.createElement("div");
    split.className = "hatch__split";

    const pick = document.createElement("section");
    pick.className = "hatch-pick";
    pick.setAttribute("aria-label", "Monsters");
    const pickHead = document.createElement("div");
    pickHead.className = "hatch-pick__head";
    const pickTitle = document.createElement("h3");
    pickTitle.className = "hatch-pick__title";
    pickTitle.textContent = "Monsters";
    const pickHint = document.createElement("span");
    pickHint.className = "hatch-pick__hint";
    pickHint.textContent = "Tap adds 1 · each costs goo";
    pickHead.append(pickTitle, pickHint);
    this.grid = document.createElement("ul");
    this.grid.className = "hatch__grid";
    this.grid.setAttribute("aria-label", "Monsters to hatch");
    this.lockedNote = document.createElement("div");
    this.lockedNote.className = "hatch-pick__locked";
    pick.append(pickHead, this.grid, this.lockedNote);

    this.info = document.createElement("section");
    this.info.className = "hatch-info";
    this.infoHead = document.createElement("div");
    this.infoHead.className = "hatch-info__head";
    this.infoEach = document.createElement("span");
    this.infoEach.className = "hatch-info__each";
    this.detailsButton = document.createElement("button");
    this.detailsButton.type = "button";
    this.detailsButton.className = "btn btn--ghost hatch-info__details";
    this.detailsButton.addEventListener("click", () => {
      this.detailsOpen = !this.detailsOpen;
      this.drawDetails();
    });
    this.stats = document.createElement("dl");
    this.stats.className = "hatch-info__stats";

    this.addBlock = document.createElement("div");
    this.addBlock.className = "hatch-add";
    const label = document.createElement("span");
    label.className = "hatch-add__label";
    label.textContent = "How many to add";
    this.stepper = new QuantityStepper({
      block: "hatch-add",
      inputLabel: "How many to add",
      fewerLabel: "One fewer",
      moreLabel: "One more",
      fillTitle: "As many as the queue and your goo allow",
      value: () => this.count,
      set: (value) => this.setCount(value),
      fill: () => this.fill(),
      commit: () => this.renderCount(true),
    });
    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "btn btn--primary hatch-add__add";
    this.addButton.addEventListener("click", () => void this.runAdd(this.count));
    this.noteLine = document.createElement("p");
    this.noteLine.className = "hatch-add__note";
    this.noteLine.setAttribute("aria-live", "polite");
    this.warningLine = document.createElement("p");
    this.warningLine.className = "hatch-add__warning";
    this.gateLine = document.createElement("p");
    this.gateLine.className = "monsters-gate hatch-add__gate";
    this.addBlock.append(
      label,
      this.stepper.element,
      this.addButton,
      this.gateLine,
      this.warningLine,
      this.noteLine,
    );

    this.info.append(this.infoHead, this.infoEach, this.detailsButton, this.stats, this.addBlock);
    // The message sits in the split so the info panel can stand beside it on a wide screen.
    split.append(this.message, pick, this.info);
    this.element.append(this.status, this.lines, this.boosts, split);
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
    for (const clock of this.clocks) {
      clock.node.textContent = `${duration(clock.endsAt - now)}${clock.suffix ?? ""}`;
      if (clock.fill && clock.total) clock.fill.style.width = progressWidth(clock.endsAt - now, clock.total);
    }
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
      for (const { node, target } of this.totals) node.textContent = this.doneIn(yard, target);
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
    if (this.confirming !== null) {
      const still = yard.hatcheries.find((one) => one.id === this.confirming);
      if (!still?.monster) this.confirming = null;
    }

    const monsters = hatchMonsters(store.save);
    if (!this.selected || !monsters.some((row) => row.monster.id === this.selected)) {
      this.selected =
        monsters.find((row) => row.state.kind === "ready")?.monster.id ?? monsters[0]?.monster.id ?? null;
    }

    const used = new Set<string>();
    this.renderGrid(monsters);
    this.renderInfo(monsters.find((row) => row.monster.id === this.selected) ?? null);
    this.renderBoosts(yard, used);
    for (const [key, button] of this.shiny) {
      if (!used.has(key)) {
        button.destroy();
        this.shiny.delete(key);
      }
    }
    this.renderCount(document.activeElement !== this.stepper.input);
    if (focusKey) this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus();
  }

  /**
   * Everything that follows the count: the box, Max, Add, the lines under
   * them, the dashed slots and the housing bar. Runs on every step of a
   * hold, so the grid and the info panel are left alone.
   */
  private renderCount(rewrite: boolean): void {
    const yard = this.yard;
    const row = this.selectedRow();
    const target = this.target;
    const ready = row?.state.kind === "ready";
    const limits = yard && row && ready && target !== null ? fillLimits(yard, target, row.monster.id) : null;
    const max = limits ? limits.fill : 0;
    if (this.count > max) this.count = max;
    this.stepper.sync({ value: this.count, max, disabled: !ready || target === null, rewrite });
    this.stepper.fill.textContent = limits ? `Max ${formatAmount(limits.fill)}` : "Max";
    this.stepper.fill.setAttribute("aria-pressed", String(limits !== null && limits.fill > 0 && this.count === limits.fill));

    const gate = this.addGate(yard, row, limits);
    this.gateLine.replaceChildren(...gate);
    this.gateLine.hidden = gate.length === 0;
    this.addBlocked = gate.length > 0 || this.count < 1;
    this.addButton.disabled = this.addBlocked || this.hatcheryBusy();
    this.drawAddLabel(row);

    const preview =
      yard && row && ready && target !== null && this.count > 0
        ? previewAdd(yard, target, row.monster.id, this.count)
        : null;

    const warning =
      yard && row && ready && this.count > 0 ? housingWarning(yard, row.monster.id, this.count) : null;
    this.warningLine.textContent = warning ?? "";
    this.warningLine.hidden = warning === null;
    const note = limits && row ? maxNote(limits, row, target) : null;
    this.noteLine.textContent = note ?? "";
    this.noteLine.hidden = note === null || !ready;

    if (yard) {
      this.renderLines(yard, preview && row ? slotPreview(row.monster.id, preview) : null);
      this.renderMessage(yard, preview && row ? preview.added * row.space : 0);
    }
    this.syncPending();
  }

  private drawAddLabel(row: HatchMonster | null): void {
    const words = document.createElement("span");
    words.className = "hatch-add__words";
    if (!row || this.count < 1) {
      words.textContent = "Add";
      this.addButton.replaceChildren(words);
      return;
    }
    words.textContent = `Add ${formatAmount(this.count)} ${plural(row.monster.name, this.count)}`;
    const cost = resourceAmount("r4", row.price * this.count);
    cost.classList.add("hatch-add__cost");
    this.addButton.replaceChildren(words, cost);
  }

  /* ── The line ───────────────────────────────────────────────────────── */

  private renderLines(yard: HatchYard, preview: SlotPreview | null): void {
    this.plainButtons = [];
    this.clocks = [];
    this.totals = [];
    // Several lines stack: each is drawn a little shorter so the grid stays near.
    const several = !yard.hcc && yard.hatcheries.length > 1;
    this.lines.classList.toggle("hatch-lines--several", several);
    if (yard.hatcheries.length === 0) {
      const note = document.createElement("p");
      note.className = "hatch__none";
      note.textContent = "Build a Hatchery to hatch monsters.";
      this.lines.replaceChildren(note);
      return;
    }
    if (yard.hcc) {
      this.lines.replaceChildren(this.hccLine(yard, preview));
      return;
    }
    this.lines.replaceChildren(
      ...yard.hatcheries.map((hatchery, index) =>
        this.hatcheryLine(yard, hatchery, index, several, hatchery.id === this.target ? preview : null),
      ),
    );
  }

  /** One hatchery's line: now, its stacks, the next locked slot, the totals. */
  private hatcheryLine(
    yard: HatchYard,
    hatchery: HatcheryView,
    index: number,
    several: boolean,
    preview: SlotPreview | null,
  ): HTMLElement {
    const line = document.createElement("div");
    const isTarget = hatchery.id === this.target;
    line.className = `hatch-line${isTarget && several ? " hatch-line--target" : ""}`;
    line.dataset["hatchery"] = String(hatchery.id);

    const head = document.createElement("div");
    head.className = "hatch-line__head";
    const title = `Hatchery ${several ? `${index + 1} ` : ""}· Level ${hatchery.level}`;
    if (several) {
      const pick = document.createElement("button");
      pick.type = "button";
      pick.className = "hatch-line__pick";
      pick.dataset["focusKey"] = `pick-${hatchery.id}`;
      pick.setAttribute("aria-pressed", String(isTarget));
      pick.textContent = title;
      pick.title = "Add monsters to this Hatchery";
      pick.addEventListener("click", () => {
        this.target = hatchery.id;
        this.render();
      });
      head.append(pick);
    } else {
      const name = document.createElement("h3");
      name.className = "hatch-line__title";
      name.textContent = title;
      head.append(name);
    }
    const waiting = document.createElement("span");
    waiting.className = "hatch-line__waiting";
    waiting.textContent = `${formatAmount(queuedCount(hatchery.queue))} waiting of ${formatAmount(hatchery.stackLimit * STACK_SIZE)}`;
    head.append(waiting);

    const slots = document.createElement("div");
    slots.className = "hatch-line__slots";
    slots.append(this.nowCard(yard, hatchery, index, false, preview), chevron());
    hatchery.queue.forEach((stack, at) => slots.append(this.stackSlot(hatchery.id, stack, at + 1, preview)));
    let free = hatchery.stackLimit - hatchery.queue.length;
    for (const count of preview?.fresh ?? []) {
      if (free <= 0) break;
      slots.append(previewSlot(preview!.monster, count));
      free -= 1;
    }
    for (; free > 0; free -= 1) slots.append(emptySlot());
    if (hatchery.level > 0 && hatchery.level < maxLevel(HATCHERY_TYPE)) {
      slots.append(this.lockedSlot(hatchery));
    }
    slots.append(this.lineTotals(yard, hatchery.id, isTarget));
    line.append(head, slots);
    return line;
  }

  /** The HCC: each hatchery's monster in production, then the shared queue. */
  private hccLine(yard: HatchYard, preview: SlotPreview | null): HTMLElement {
    const line = document.createElement("div");
    line.className = "hatch-line hatch-line--hcc";

    const head = document.createElement("div");
    head.className = "hatch-line__head";
    const title = document.createElement("h3");
    title.className = "hatch-line__title";
    title.textContent = "Hatchery Control Centre";
    const waiting = document.createElement("span");
    waiting.className = "hatch-line__waiting";
    waiting.textContent = `${formatAmount(queuedCount(yard.shared))} waiting of ${formatAmount(HCC_STACKS * STACK_SIZE)}`;
    head.append(title, waiting);

    const now = document.createElement("div");
    now.className = "hatch-line__now";
    now.setAttribute("role", "group");
    now.setAttribute("aria-label", "Hatching now");
    yard.hatcheries.forEach((hatchery, index) => now.append(this.nowCard(yard, hatchery, index, true, preview)));
    const allowed = Math.min(MAX_HATCHERIES, quantityOf(HATCHERY_TYPE, townHallLevel(this.store.yard)));
    if (yard.hatcheries.length < allowed) {
      const more = document.createElement("div");
      more.className = "hatch-now hatch-now--more";
      more.textContent = "Build another Hatchery to hatch more at once";
      now.append(more);
    }

    const slots = document.createElement("div");
    slots.className = "hatch-line__slots";
    slots.setAttribute("role", "group");
    slots.setAttribute("aria-label", "Waiting");
    yard.shared.forEach((stack, at) => slots.append(this.stackSlot("hcc", stack, at + 1, preview)));
    let free = HCC_STACKS - yard.shared.length;
    for (const count of preview?.fresh ?? []) {
      if (free <= 0) break;
      slots.append(previewSlot(preview!.monster, count));
      free -= 1;
    }
    for (; free > 0; free -= 1) slots.append(emptySlot());
    slots.append(this.lineTotals(yard, "hcc", true));

    line.append(head, now, slots);
    return line;
  }

  /**
   * The monster hatching now: a tap asks "Cancel it?" and the answer takes
   * it out for its goo (`HATCHERYPOPUP.as:320-323`). Idle, it shows the
   * batch that would start at once, dashed.
   */
  private nowCard(
    yard: HatchYard,
    hatchery: HatcheryView,
    index: number,
    compact: boolean,
    preview: SlotPreview | null,
  ): HTMLElement {
    const where = compact ? `Hatchery ${index + 1}` : "";
    const monster = hatchery.monster;
    const state = hatchery.state;

    if (monster && this.confirming === hatchery.id) {
      const card = document.createElement("div");
      card.className = `hatch-now hatch-now--confirm${compact ? " hatch-now--compact" : ""}`;
      card.dataset["hatchery"] = String(hatchery.id);
      const question = document.createElement("span");
      question.className = "hatch-now__question";
      question.textContent = `Cancel this ${nameOf(monster)}?`;
      const back = document.createElement("span");
      back.className = "hatch-now__refund";
      back.append(resourceAmount("r4", priceOf(monster, hatchery.paidLevel)), " back");
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn btn--danger hatch-now__yes";
      yes.textContent = "Cancel it";
      yes.dataset["focusKey"] = `cancel-yes-${hatchery.id}`;
      yes.addEventListener("click", () => {
        this.confirming = null;
        void this.runRemove(hatchery.id, 0, 1);
      });
      this.plainButtons.push(yes);
      const no = document.createElement("button");
      no.type = "button";
      no.className = "btn btn--ghost hatch-now__no";
      no.textContent = "Keep";
      no.dataset["focusKey"] = `cancel-no-${hatchery.id}`;
      no.addEventListener("click", () => {
        this.confirming = null;
        this.render();
      });
      const buttons = document.createElement("span");
      buttons.className = "hatch-now__buttons";
      buttons.append(yes, " ", no);
      card.append(question, " ", back, " ", buttons);
      return card;
    }

    const card = document.createElement(monster ? "button" : "div");
    card.className = `hatch-now hatch-now--${state}${compact ? " hatch-now--compact" : ""}`;
    card.dataset["hatchery"] = String(hatchery.id);

    const label = document.createElement("span");
    label.className = "hatch-now__label";
    label.textContent = compact ? where : "Hatching now";
    card.append(label);

    if (!monster) {
      const starting = preview?.starts.get(hatchery.id) ?? null;
      if (starting) {
        card.classList.add("hatch-now--preview");
        const entry = monsterEntry(starting);
        if (entry) card.append(monsterPicture(entry, "small", "hatch-now__picture"));
        const text = document.createElement("span");
        text.className = "hatch-now__state";
        text.textContent = "Starts now";
        card.append(" ", text);
      } else {
        const text = document.createElement("span");
        text.className = "hatch-now__state";
        text.textContent = IDLE_TEXT[state] ?? "Nothing hatching";
        card.append(" ", text);
      }
      return card;
    }

    const button = card as HTMLButtonElement;
    button.type = "button";
    button.dataset["focusKey"] = `now-${hatchery.id}`;
    button.setAttribute(
      "aria-label",
      `${compact ? `${where}: ` : ""}${nameOf(monster)} hatching now. Cancel it and get the goo back`,
    );
    button.addEventListener("click", () => {
      this.confirming = hatchery.id;
      this.render();
      this.element.querySelector<HTMLElement>(`[data-focus-key="cancel-no-${hatchery.id}"]`)?.focus();
    });
    this.plainButtons.push(button);

    const entry = monsterEntry(monster);
    const body = document.createElement("span");
    body.className = "hatch-now__body";
    if (entry) body.append(monsterPicture(entry, "small", "hatch-now__picture"));
    const words = document.createElement("span");
    words.className = "hatch-now__words";
    const name = document.createElement("span");
    name.className = "hatch-now__name";
    name.textContent = nameOf(monster);
    const time = document.createElement("span");
    time.className = "hatch-now__state";
    words.append(name, " ", time);
    body.append(words);
    const cross = document.createElement("span");
    cross.className = "hatch-now__cancel";
    cross.setAttribute("aria-hidden", "true");
    cross.textContent = "×";
    card.append(" ", body, cross);

    if (state === "producing" && hatchery.endsAt !== null) {
      const now = this.store.now();
      time.classList.add("hatch-clock");
      time.textContent = `${duration(hatchery.endsAt - now)}${compact ? "" : " left"}`;
      const bar = document.createElement("span");
      bar.className = "hatch-now__bar";
      const fill = document.createElement("span");
      fill.className = "hatch-now__fill";
      const total = secondsOf(monster, yard.levels[monster] ?? 1);
      fill.style.width = progressWidth(hatchery.endsAt - now, total);
      bar.append(fill);
      card.append(bar);
      this.clocks.push({ node: time, endsAt: hatchery.endsAt, fill, total, suffix: compact ? "" : " left" });
    } else {
      time.textContent = BUSY_TEXT[state] ?? "";
    }
    return card;
  }

  /** A waiting stack: ×N, the monster, and a tap takes one out (`HATCHERYPOPUP.as:300-319`). */
  private stackSlot(
    target: HatchTarget,
    stack: QueueStack,
    slot: number,
    preview: SlotPreview | null,
  ): HTMLElement {
    const [id, count] = stack;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hatch-slot";
    button.dataset["slot"] = String(slot);
    button.dataset["focusKey"] = `slot-${String(target)}-${slot}`;
    const name = nameOf(id);
    button.setAttribute("aria-label", `${name}, ${count} waiting. Take one out and get its goo back`);
    button.title = `Take one ${name} out`;
    button.addEventListener("click", () => void this.runRemove(target, slot, 1));
    this.plainButtons.push(button);

    const badge = document.createElement("span");
    badge.className = "hatch-slot__count";
    badge.textContent = `×${count}`;
    const minus = document.createElement("span");
    minus.className = "hatch-slot__minus";
    minus.setAttribute("aria-hidden", "true");
    minus.textContent = "−";
    button.append(badge, minus);
    const entry = monsterEntry(id);
    if (entry) button.append(monsterPicture(entry, "small", "hatch-slot__picture"));
    const label = document.createElement("span");
    label.className = "hatch-slot__name";
    label.textContent = name;
    const time = document.createElement("span");
    time.className = "hatch-slot__note";
    time.textContent = `${duration(secondsOf(id, this.yard?.levels[id] ?? 1))} each`;
    button.append(label, time);

    const topUp = preview?.topUps.get(slot);
    if (topUp) {
      button.classList.add("hatch-slot--topup");
      const more = document.createElement("span");
      more.className = "hatch-slot__adding";
      more.textContent = `+${formatAmount(topUp)}`;
      button.append(more);
    }
    return button;
  }

  /** The slot the next Hatchery level opens (`HATCHERYPOPUP.as:347-354`). */
  private lockedSlot(hatchery: HatcheryView): HTMLElement {
    const slot = document.createElement("div");
    slot.className = "hatch-slot hatch-slot--locked";
    const lock = document.createElement("span");
    lock.className = "hatch-slot__lock";
    lock.setAttribute("aria-hidden", "true");
    const words = document.createElement("span");
    words.className = "hatch-slot__why";
    words.textContent = `Upgrade the Hatchery for a ${ordinal(hatchery.stackLimit + 1)} slot`;
    const upgrade = document.createElement("button");
    upgrade.type = "button";
    upgrade.className = "btn btn--outline hatch-slot__upgrade";
    upgrade.textContent = "Upgrade";
    upgrade.dataset["focusKey"] = `upgrade-${hatchery.id}`;
    upgrade.setAttribute("aria-label", `Upgrade the Hatchery for a ${ordinal(hatchery.stackLimit + 1)} slot`);
    upgrade.addEventListener("click", () => this.context.binding.scene.selectBuilding(hatchery.id));
    slot.append(lock, words, upgrade);
    return slot;
  }

  /** How long the line takes, the Overdrive running, and the small link to Finish now. */
  private lineTotals(yard: HatchYard, target: HatchTarget, withLink: boolean): HTMLElement {
    const totals = document.createElement("div");
    totals.className = "hatch-line__totals";
    const label = document.createElement("span");
    label.className = "hatch-line__done-label";
    label.textContent = "All done in";
    const time = document.createElement("span");
    time.className = "hatch-line__done";
    time.textContent = this.doneIn(yard, target);
    this.totals.push({ node: time, target });
    totals.append(label, time);
    const running = activeOverdrive(this.store.save.storedata, this.store.now());
    if (running) {
      const boost = document.createElement("span");
      boost.className = "hatch-line__overdrive";
      boost.textContent = `Overdrive ${running.power}x`;
      totals.append(boost);
    }
    if (withLink) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "hatch-line__boost-link";
      link.dataset["focusKey"] = "boost-link";
      link.setAttribute("aria-expanded", String(this.boostsOpen));
      link.setAttribute("aria-controls", "hatch-boosts");
      const words = document.createElement("span");
      words.className = "hatch-line__boost-words";
      words.textContent = "Finish now or speed up";
      link.append(resourceIcon("shiny", { decorative: true }), words);
      link.addEventListener("click", () => {
        this.boostsOpen = !this.boostsOpen;
        this.boosts.hidden = !this.boostsOpen;
        link.setAttribute("aria-expanded", String(this.boostsOpen));
      });
      totals.append(link);
    }
    return totals;
  }

  private doneIn(yard: HatchYard, target: HatchTarget): string {
    const seconds = lineSeconds(yard, target, this.store.save.storedata, this.store.now());
    return seconds === null ? "—" : duration(seconds);
  }

  /* ── The message and the housing bar ────────────────────────────────── */

  private renderMessage(yard: HatchYard, adding: number): void {
    const { title, tone } = lineSentence(yard, this.target, this.selectedRow());
    const words = document.createElement("div");
    words.className = "hatch-message__words";
    const main = document.createElement("span");
    main.className = `hatch-message__title hatch-message__title--${tone}`;
    main.textContent = title;
    const detail = document.createElement("span");
    detail.className = "hatch-message__detail";
    detail.textContent =
      "Each monster moves into Housing the moment it hatches. With Housing full it still hatches, then waits in its Hatchery until there is room.";
    words.append(main, detail);

    const housed = housedSpace(yard);
    const pending = pendingSpace(yard);
    const after = housed + pending + adding;
    const scale = Math.max(yard.capacity, after, 1);
    const housing = document.createElement("div");
    housing.className = `hatch-housing${after > yard.capacity ? " hatch-housing--over" : ""}`;
    const top = document.createElement("div");
    top.className = "hatch-housing__top";
    const label = document.createElement("span");
    label.className = "hatch-housing__label";
    label.textContent = "Housing after this line";
    const value = document.createElement("span");
    value.className = "hatch-housing__value";
    value.textContent = `${formatAmount(after)} / ${formatAmount(yard.capacity)}`;

    top.append(label, value);
    const bar = document.createElement("div");
    bar.className = "hatch-housing__bar";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", "Housing after this line");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(Math.max(yard.capacity, 1)));
    bar.setAttribute("aria-valuenow", String(Math.min(after, Math.max(yard.capacity, 1))));
    bar.setAttribute(
      "aria-valuetext",
      `${formatAmount(housed)} housed, ${formatAmount(pending)} on the way, ${formatAmount(adding)} adding, of ${formatAmount(yard.capacity)}`,
    );
    for (const [part, amount] of [
      ["housed", housed],
      ["pending", pending],
      ["adding", adding],
    ] as const) {
      if (amount <= 0) continue;
      const segment = document.createElement("span");
      segment.className = `hatch-housing__part hatch-housing__part--${part}`;
      segment.style.width = `${+((amount / scale) * 100).toFixed(2)}%`;
      bar.append(segment);
    }
    housing.append(top, bar);
    // Past the capacity is allowed (#169); say what happens to the rest.
    if (after > yard.capacity) {
      const over = document.createElement("span");
      over.className = "hatch-housing__over";
      over.textContent = `Over by ${formatAmount(after - yard.capacity)}: the rest hatch and wait in the Hatchery for room.`;
      housing.append(over);
    }

    const icon = resourceIcon("r4", { decorative: true });
    icon.classList.add("hatch-message__icon");
    this.message.replaceChildren(icon, words, housing);
  }

  /* ── The grid ───────────────────────────────────────────────────────── */

  private renderGrid(monsters: readonly HatchMonster[]): void {
    const items = monsters.map((row) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hatch-monster hatch-monster--${row.state.kind}`;
      button.dataset["monster"] = row.monster.id;
      button.dataset["focusKey"] = `monster-${row.monster.id}`;
      button.setAttribute("aria-pressed", String(row.monster.id === this.selected));
      button.title =
        row.state.kind === "ready"
          ? `Add one ${row.monster.name}`
          : `${row.monster.name}: ${row.state.kind === "unlocking" ? "still unlocking" : "locked"}`;
      button.addEventListener("click", () => this.tapMonster(row));
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

    const locked = monsters.some((row) => row.state.kind !== "ready");
    this.lockedNote.hidden = !locked;
    if (!locked) {
      this.lockedNote.replaceChildren();
      return;
    }
    const lock = document.createElement("span");
    lock.className = "hatch-pick__lock";
    lock.setAttribute("aria-hidden", "true");
    const text = document.createElement("p");
    text.className = "hatch-pick__locked-text";
    text.textContent = "Grey monsters are locked. Unlock them at the Monster Locker, then hatch them here.";
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--outline hatch-pick__go";
    go.textContent = "Go to Monster Locker";
    go.addEventListener("click", () => this.context.showTab(MonstersTabId.UNLOCK, {}));
    this.lockedNote.replaceChildren(lock, text, go);
  }

  /* ── The info panel ─────────────────────────────────────────────────── */

  private renderInfo(row: HatchMonster | null): void {
    if (!row) {
      this.info.hidden = true;
      return;
    }
    this.info.hidden = false;
    const { monster } = row;
    this.info.setAttribute("aria-label", monster.name);

    const portrait = document.createElement("span");
    portrait.className = "hatch-info__portrait";
    portrait.append(monsterPicture(monster, "portrait", "hatch-info__picture"));
    const heading = document.createElement("div");
    heading.className = "hatch-info__heading";
    const level = document.createElement("span");
    level.className = "hatch-info__level";
    level.textContent = `Level ${row.level}`;
    const name = document.createElement("h3");
    name.className = "hatch-info__name";
    name.textContent = monster.name;
    const blurb = document.createElement("p");
    blurb.className = "hatch-info__blurb";
    blurb.append(...describe(monster.description));
    blurb.title = blurb.textContent ?? "";
    heading.append(level, name, blurb);
    this.infoHead.replaceChildren(portrait, heading);

    this.infoEach.replaceChildren(
      "Each: ",
      resourceAmount("r4", row.price),
      ` · ${duration(row.seconds)} · ${row.space} housing`,
    );

    const damage = monsterStat(monster.id, "damage", row.level);
    const stats: [string, Node | string][] = [
      ["Speed", statNumber(monsterStat(monster.id, "speed", row.level))],
      ["Health", statNumber(monsterStat(monster.id, "health", row.level))],
      damage < 0 ? ["Heals", statNumber(-damage)] : ["Damage", statNumber(damage)],
      ["Goo each", resourceAmount("r4", row.price)],
      ["Housing each", String(row.space)],
      ["Time each", duration(row.seconds)],
    ];
    this.stats.replaceChildren(
      ...stats.map(([term, value]) => {
        const item = document.createElement("div");
        item.className = "hatch-info__stat";
        const dt = document.createElement("dt");
        dt.textContent = term;
        const dd = document.createElement("dd");
        dd.append(value);
        item.append(dt, dd);
        return item;
      }),
    );
    this.drawDetails();
  }

  private drawDetails(): void {
    this.info.classList.toggle("hatch-info--details", this.detailsOpen);
    this.detailsButton.textContent = this.detailsOpen ? "Less" : "Details";
    this.detailsButton.setAttribute("aria-expanded", String(this.detailsOpen));
  }

  /** Why Add cannot be pressed, as nodes, or none. */
  private addGate(yard: HatchYard | null, row: HatchMonster | null, limits: FillLimits | null): (Node | string)[] {
    if (!yard || this.target === null) return ["Build a Hatchery first."];
    if (!row) return [];
    if (row.state.kind !== "ready") {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn btn--outline hatch-add__unlock";
      go.textContent = "Go to Monster Locker";
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
    if (limits.queue === 0) return [this.target === "hcc" ? "The shared queue is full." : "The queue is full."];
    if (limits.goo === 0) {
      return overCap(row.price, this.store.caps?.r4)
        ? [NEED_MORE_SILOS]
        : ["Need ", resourceAmount("r4", row.price - yard.goo), " more"];
    }
    return [];
  }

  /* ── Finish now and the Overdrive ───────────────────────────────────── */

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
    this.boosts.hidden = !this.boostsOpen;
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

  private shinyButton(key: string, label: string, onSpend: () => void): ShinyButton {
    let button = this.shiny.get(key);
    if (!button) {
      button = new ShinyButton({ label, spell: formatAmount, onSpend });
      button.element.dataset["focusKey"] = key;
      this.shiny.set(key, button);
    }
    return button;
  }

  /** Every slot button waits while any hatchery request is in flight or queued. */
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
    if (redraw) this.render();
  }

  /** A grid tap: chooses the monster and, when it can be hatched, adds one at once (`HATCHERYPOPUP.as:234-291`). */
  private tapMonster(row: HatchMonster): void {
    this.select(row.monster.id);
    if (row.state.kind !== "ready") return;
    void this.runAdd(1);
  }

  private setCount(value: number): void {
    this.count = Math.max(0, Math.floor(value));
    this.renderCount(document.activeElement !== this.stepper.input);
  }

  private fill(): void {
    const yard = this.yard;
    const row = this.selectedRow();
    if (!yard || !row || this.target === null) return;
    const limits = fillLimits(yard, this.target, row.monster.id);
    this.count = limits.fill;
    this.renderCount(true);
  }

  /* ── Actions ────────────────────────────────────────────────────────── */

  private async runAdd(count: number): Promise<void> {
    const target = this.target;
    const monster = this.selected;
    if (target === null || !monster || count < 1) return;
    // A tap on a full queue or with too little goo says so here rather than
    // sending a request that can only come back empty.
    const yard = this.yard;
    const preview = yard ? previewAdd(yard, target, monster, count) : null;
    if (preview && preview.added === 0) {
      const price = priceOf(monster, yard?.levels[monster] ?? 1);
      this.setStatus({
        tone: "bad",
        content: [
          preview.stoppedBy === "goo"
            ? overCap(price, this.store.caps?.r4)
              ? NEED_MORE_SILOS
              : `Not enough goo for a ${nameOf(monster)}.`
            : target === "hcc"
              ? "The shared queue is full."
              : "This Hatchery's queue is full.",
        ],
      });
      return;
    }
    const result = await this.actions.add(target, monster, count);
    this.report(result, (report) => {
      const name = plural(nameOf(report.monster), report.added);
      const cost = report.cost.r4 > 0 ? [": ", resourceAmount("r4", report.cost.r4), " spent."] : ["."];
      if (report.added === report.requested) return [`Added ${formatAmount(report.added)} ${name}`, ...cost];
      const why = report.stoppedBy === "goo" ? "out of goo" : "the queue is full";
      return [
        `Added ${formatAmount(report.added)} of ${formatAmount(report.requested)} ${plural(nameOf(report.monster), report.requested)} — ${why}`,
        ...cost,
      ];
    });
  }

  private async runRemove(target: HatchTarget, slot: number, count: number | "all"): Promise<void> {
    const result = await this.actions.remove(target, slot, count);
    this.report(result, (report) => [
      `${slot === 0 ? "Cancelled" : "Took out"} ${formatAmount(report.removed)} ${plural(nameOf(report.monster), report.removed)}`,
      ...(report.refund.r4 > 0 ? [": ", resourceAmount("r4", report.refund.r4), " back."] : ["."]),
    ]);
  }

  private async runFinish(): Promise<void> {
    const target = this.target;
    if (target === null) return;
    const result = await this.actions.finish(target);
    this.report(result, (report) => {
      const housed = Object.entries(report.housed)
        .map(([id, n]) => `${formatAmount(n)} ${plural(nameOf(id), n)}`)
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

/** What an empty "hatching now" card says. */
const IDLE_TEXT: Partial<Record<HatcheryView["state"], string>> = {
  building: "Being built",
  damaged: "Damaged: repair it",
  idle: "Nothing hatching",
};

/** What a card with a monster says when it is not counting down. */
const BUSY_TEXT: Partial<Record<HatcheryView["state"], string>> = {
  stalled: "Waiting for housing",
  upgrading: "Paused: upgrading",
  damaged: "Damaged: repair it",
  building: "Being built",
};

/**
 * The target to show: `hcc` whenever a finished HCC runs the queue; else the
 * one chosen if it is still there, else the first hatchery; null without one.
 */
const pickTarget = (yard: HatchYard, current: HatchTarget | null): HatchTarget | null => {
  if (yard.hcc) return "hcc";
  if (typeof current === "number" && yard.hatcheries.some((one) => one.id === current)) return current;
  return yard.hatcheries[0]?.id ?? null;
};

/** A progress bar's width: how much of `total` seconds is done with `left` to go. */
const progressWidth = (left: number, total: number): string =>
  `${+(Math.min(1, Math.max(0, 1 - left / Math.max(total, 1))) * 100).toFixed(1)}%`;

/** Where an add preview puts its monsters, for the slots. */
const slotPreview = (monster: string, preview: AddPreview): SlotPreview => ({
  monster,
  topUps: new Map(preview.merged.map(({ slot, count }) => [slot, count])),
  fresh: preview.fresh,
  starts: new Map(preview.starts.map((start) => [start.hatchery, start.monster])),
});

/** An empty slot the queue may still fill. */
const emptySlot = (): HTMLElement => {
  const slot = document.createElement("div");
  slot.className = "hatch-slot hatch-slot--empty";
  const words = document.createElement("span");
  words.className = "hatch-slot__note";
  words.textContent = "Empty";
  slot.append(words);
  return slot;
};

/** A new stack the chosen batch would open, dashed. */
const previewSlot = (monster: string, count: number): HTMLElement => {
  const slot = document.createElement("div");
  slot.className = "hatch-slot hatch-slot--preview";
  const badge = document.createElement("span");
  badge.className = "hatch-slot__count";
  badge.textContent = `×${formatAmount(count)}`;
  slot.append(badge);
  const entry = monsterEntry(monster);
  if (entry) slot.append(monsterPicture(entry, "small", "hatch-slot__picture"));
  const name = document.createElement("span");
  name.className = "hatch-slot__name";
  name.textContent = nameOf(monster);
  const note = document.createElement("span");
  note.className = "hatch-slot__note";
  note.textContent = "Adding";
  slot.append(name, note);
  return slot;
};

/** The arrow between "hatching now" and what waits: the line moves left. */
const chevron = (): HTMLElement => {
  const arrow = document.createElement("span");
  arrow.className = "hatch-line__arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "‹";
  return arrow;
};

/**
 * The line under Max: why it stops where it does, in the words of the
 * limit that stopped it.
 */
const maxNote = (limits: FillLimits, row: HatchMonster, target: HatchTarget | null): string | null => {
  const fill = limits.fill;
  if (fill === 0) return null;
  const many = `${formatAmount(fill)} more ${plural(row.monster.name, fill)}`;
  return limits.limitedBy === "goo"
    ? `Max is ${formatAmount(fill)}: your goo pays for ${many}.`
    : `Max is ${formatAmount(fill)}: ${target === "hcc" ? "the shared queue" : "the queue"} has room for ${many}.`;
};

/**
 * What the chosen line is doing, in one sentence (`HATCHERYPOPUP.as:430-467`):
 * nothing, hatching which monsters, waiting for housing, damaged, paused;
 * then what a tap does, or that the queue is full.
 */
export const lineSentence = (
  yard: HatchYard,
  target: HatchTarget | null,
  row: HatchMonster | null,
): { title: string; tone: "plain" | "warning" } => {
  const tip = " Tap a monster to add one, or choose how many.";
  if (target === null) return { title: "Build a Hatchery to hatch monsters.", tone: "plain" };
  const full = row?.state.kind === "ready" && fillLimits(yard, target, row.monster.id).queue === 0;
  const tail = full ? " The queue is full." : tip;
  const names = (ids: readonly string[]): string => {
    const words = [...new Set(ids)].map((id) => plural(nameOf(id), 2));
    return words.length <= 1 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
  };

  if (target === "hcc") {
    if (!yard.hcc?.works) {
      return {
        title: "The Control Centre is damaged: it hands out nothing until it is repaired.",
        tone: "warning",
      };
    }
    const producing = yard.hatcheries.filter((one) => one.monster && one.stage === 1);
    const stalled = yard.hatcheries.filter((one) => one.stage === 2);
    // Waiting monsters first: they are what a player cannot otherwise see (#169).
    if (stalled.length > 0) {
      return {
        title: `Housing is full: ${stalled.length === 1 ? "a hatched monster waits" : `${formatAmount(stalled.length)} hatched monsters wait`} in the Hatcheries for room.`,
        tone: "warning",
      };
    }
    if (producing.length > 0) return { title: `Hatching ${names(producing.map((one) => one.monster!))}.${tail}`, tone: "plain" };
    if (yard.shared.length > 0) return { title: `Waiting for a free Hatchery.${tail}`, tone: "plain" };
    return { title: `Nothing is hatching.${tip}`, tone: "plain" };
  }

  const hatchery = yard.hatcheries.find((one) => one.id === target);
  if (!hatchery) return { title: "Build a Hatchery to hatch monsters.", tone: "plain" };
  switch (hatchery.state) {
    case "building":
      return { title: "This Hatchery is still being built: it starts hatching when it is done.", tone: "warning" };
    case "damaged":
      return { title: "This Hatchery is damaged: repair it to hatch again.", tone: "warning" };
    case "stalled":
      return {
        title: `Housing is full: the hatched ${nameOf(hatchery.monster ?? "")} waits in this Hatchery for room.`,
        tone: "warning",
      };
    case "upgrading":
      return { title: `Paused while the Hatchery upgrades.${tail}`, tone: "warning" };
    case "producing":
      return { title: `Hatching ${names([hatchery.monster ?? ""])}.${tail}`, tone: "plain" };
    default:
      return { title: `Nothing is hatching.${tip}`, tone: "plain" };
  }
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
