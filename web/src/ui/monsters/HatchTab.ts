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
  HATCHERY_TYPE,
  HCC_STACKS,
  hatcheryNumbers,
  hatchMonsters,
  housedSpace,
  housingWarning,
  lineSeconds,
  overdrivesOf,
  pendingSpace,
  previewAdd,
  previewFinish,
  priceOf,
  queuedCount,
  queueRefund,
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
import { monsterRealmOf, monsterWords, type MonsterRealm, type MonsterWords } from "@/game/monsters/realm";
import { buttonUrl } from "@/game/yard/buildButtonArt";
import { ArtState, resolveArt } from "@/game/yard/buildingArt";
import { maxLevel, quantityOf, townHallLevel, type YardKind } from "@/game/yard/buildingCosts";
import { NEED_MORE_SILOS, overCap } from "@/game/yard/storage";
import { YardChangeReason, type YardActionResult, type YardChange } from "@/game/yard/YardStore";
import { formatAmount, formatCountdown, formatShortPrice } from "@/ui/format";
import { holdPress } from "@/ui/holdPress";
import { QuantityStepper } from "@/ui/QuantityStepper";
import { gameIcon, iconAmount } from "@/ui/gameIcon";
import { resourceAmount, resourceIcon } from "@/ui/resourceIcon";
import { ShinyButton } from "@/ui/yard/ShinyButton";
import {
  hatcheryTabs,
  hatchTabKey,
  loadHatchTab,
  saveHatchTab,
  tabAfterKey,
  type HatcheryTab,
} from "./hatcheryTabs";
import { describe, monsterPicture } from "./LockerTab";
import {
  MonstersTabId,
  type MonstersFocus,
  type MonstersTab,
  type MonstersTabContext,
} from "./monstersTab";
import { weekendChip } from "@/ui/events/weekendUi";

/** Hatch Rush's "−30%" chip after a hatch time, or nothing. */
const hatchRushChip = (): (Node | string)[] => {
  const chip = weekendChip("hatch");
  return chip ? [" ", chip] : [];
};



/**
 * The Hatch tab: the Hatcheries and the Hatchery Control Centre, laid out as
 * the original's hatchery popup (issue #156; `client/scripts/HATCHERYPOPUP.as`,
 * `HATCHERYCCPOPUP.as`), in style B.
 *
 * Top to bottom:
 *
 * - **The tabs**, one per hatchery when there are several (owner, 28 Oct:
 *   the stacked lines were too long to scroll), numbered as the yard
 *   numbers them while the tab is open (#268: oldest is 1,
 *   `hatcheryNumbers`). Each shows the hatchery's picture, level, a light
 *   for what it is doing with the countdown when busy, and how many wait;
 *   a tap or an arrow key chooses one, and the choice is remembered per
 *   yard (`hatcheryTabs.ts`).
 * - **The line** of the chosen hatchery: the monster hatching now (picture, time
 *   left, progress; a tap cancels it for its goo at once, and holding it
 *   keeps cancelling the next one, one request at a time), then one
 *   slot per waiting stack with its ×N (a tap takes one out; holding counts
 *   more out and sends them in one request on release), as many slots
 *   as the hatchery's level allows (`1 + level`), and the next locked slot
 *   saying the upgrade that opens it. With an HCC, one row of each
 *   hatchery's monster in production and the shared queue's seven slots
 *   under it (`HATCHERYCCPOPUP.as:431-460`). Above the slots, Clear all
 *   (owner, 28 Oct: too many added by accident) asks "Clear 44?" with the
 *   goo back, then empties the waiting stacks in one request; the monster
 *   in production keeps hatching. Beside the line, how long it
 *   takes to empty and the one small "Finish now or speed up" link, which
 *   opens Finish now and the Overdrive.
 * - **The message**: what the hatchery is doing, in a sentence
 *   (`HATCHERYPOPUP.as:430-467`), and the housing bar with what is housed,
 *   what is on its way and what the chosen batch would add.
 * - **The grid** of every monster (nine across, as the original): a tap
 *   chooses one and adds nothing (#268: the original's tap-adds-one made it
 *   easy to add more than meant); a locked one is dimmed and, chosen, says
 *   why.
 * - **The info panel**: the chosen monster's portrait, level, blurb and six
 *   numbers, and the one way to add: "Adding to Hatchery 2 (Level 3)", the
 *   shared `QuantityStepper` (from 0, owner 12 Nov) with `+5`, `+10` and
 *   "Max (12)", and "Add 5 Pokeys to Hatchery 2". Before it is sent the
 *   slots show the batch dashed ("+5"), the line's waiting count reads
 *   before → after and the housing bar shows it in its own colour. On a
 *   phone the panel is a bar fixed to the bottom of the sheet.
 *
 * While the tab is open the yard numbers its hatcheries the same way and
 * outlines the chosen one (the scene's `markHatcheries`); `hide` and
 * `destroy` take the numbers down.
 *
 * Every number comes from `game/monsters/hatchPlan.ts`, which replays the
 * server's rules; the requests go through the store's queue
 * (`hatcheryActions`, `api/yardHatchery.ts`), one per batch or removal, and
 * the tab redraws from the answer. Shiny spends are {@link ShinyButton}s.
 */

type Status = { readonly tone: "good" | "bad"; readonly content: (Node | string)[] };

/** A live countdown, refreshed once a second without a redraw. */
/** One monster's tile in the grid, kept across draws (`renderGrid`). */
interface HatchTile {
  readonly item: HTMLLIElement;
  readonly button: HTMLButtonElement;
  readonly note: HTMLElement;
  /** What the note shows now, to rewrite it only when that changes. */
  noteKey: string;
}

/** Frames after a redraw in which a box that moved by itself is put back (`keepScroll`). */
const SETTLE_FRAMES = 3;
/** Milliseconds a flung list may still be gliding after the finger's last move: no late check then. */
const GLIDE_MS = 1500;

interface Clock {
  readonly node: HTMLElement;
  readonly endsAt: number;
  /** Its progress bar's fill, and the seconds a whole monster takes. */
  readonly fill?: HTMLElement;
  readonly total?: number;
  /** Words after the time: " left". */
  readonly suffix?: string;
}

/**
 * The first count offered when a monster is picked: none, so nothing is added
 * by accident (owner, 12 Nov 2026). Add stays off until `+` or Max is used.
 */
const DEFAULT_COUNT = 0;

/** The bigger steps beside `+` (#268, option E). */
const JUMPS = [5, 10] as const;

/** The most hatcheries a yard ever holds (`client/scripts/HATCHERYCCPOPUP.as:668`). */
const MAX_HATCHERIES = 5;
/** Letters past which a card's name is drawn smaller on a phone ("Slimeattikus" is 12). */
const LONG_NAME = 10;

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
const finishText = (block: FinishBlock, words: MonsterWords): string =>
  ({
    busy: "Still being built",
    damaged: "Repair it first",
    nothingToFinish: "Nothing to finish",
    housingFull: `${words.housing} full`,
  })[block];

/** A held `−` on a waiting stack: the stack, by its 1-based slot and monster, and how many are counted out. */
interface Taking {
  readonly target: HatchTarget;
  readonly slot: number;
  readonly monster: string;
  readonly count: number;
}

/** The waiting stacks of a hatchery, or the HCC's shared queue. */
const queueOf = (yard: HatchYard, target: HatchTarget): readonly QueueStack[] =>
  target === "hcc" ? yard.shared : (yard.hatcheries.find((one) => one.id === target)?.queue ?? []);

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
  /** The hatchery tabs, over the scroll box: they never scroll out of sight (owner, 6 Nov 2026). */
  private readonly tabsRow: HTMLElement;
  /** Everything under the tabs; only this scrolls. */
  private readonly scroll: HTMLElement;
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
  /** "Adding to Hatchery 2 (Level 3)". */
  private readonly toLine: HTMLElement;
  private readonly stepper: QuantityStepper;
  private readonly addButton: HTMLButtonElement;
  /** The button's words, kept from draw to draw: see `drawAddLabel`. */
  private readonly addWords: HTMLElement;
  private readonly warningLine: HTMLElement;
  private readonly gateLine: HTMLElement;

  /** The hatchery (or `hcc`) a batch goes to, and Finish now is for. */
  private target: HatchTarget | null = null;
  private selected: string | null = null;
  private count = DEFAULT_COUNT;
  /**
   * A held `−` on a waiting stack: how many it has counted out so far. The
   * slot shows them gone at once; one request takes them out on release.
   */
  private taking: Taking | null = null;
  /** The queue (a hatchery, or `hcc`) waiting on "Clear 44?". */
  private clearing: HatchTarget | null = null;
  /** Finish now and the Overdrive, opened by the small link. */
  private boostsOpen = false;
  /** On a phone, the bar's blurb and numbers. */
  private detailsOpen = false;
  /** The yard as last read, for the count-only redraw. */
  private yard: HatchYard | null = null;
  /** Each hatchery's number by id, as the lines and the yard show it. */
  private numbers: ReadonlyMap<number, number> = new Map();
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
  /**
   * The grid's tiles by monster, kept from draw to draw: a tap updates them
   * where they are rather than building the grid again under the finger.
   */
  private readonly tiles = new Map<string, HatchTile>();
  /** The monsters the grid shows, in order, as last drawn. */
  private gridOrder = "";
  /** The hatchery tabs as last drawn, kept while nothing on them changed (see `renderLines`). */
  private strip: { key: string; element: HTMLElement; clocks: Clock[] } | null = null;
  /** The frame that checks the box stayed put after a redraw (`settleScroll`). */
  private settling: number | null = null;
  /** When the player last scrolled the box by hand (`performance.now()`), so a late check leaves it be. */
  private scrolledAt = Number.NEGATIVE_INFINITY;

  constructor(context: MonstersTabContext, actions?: HatcheryActions) {
    this.context = context;
    this.actions = actions ?? hatcheryActions(context.binding.store);

    this.element = document.createElement("div");
    this.element.className = "hatch";

    this.status = document.createElement("p");
    this.status.className = "monsters-status";
    this.status.setAttribute("role", "status");
    this.status.hidden = true;

    this.tabsRow = document.createElement("div");
    this.tabsRow.className = "hatch__tabs-row";
    this.tabsRow.hidden = true;

    this.scroll = document.createElement("div");
    this.scroll.className = "tab-scroll hatch__scroll";
    // The player's own scrolling: a finger dragging, a wheel, a key, the
    // scrollbar. A redraw's late check (`settleScroll`) never undoes it.
    const scrolledByHand = (): void => {
      this.scrolledAt = performance.now();
    };
    for (const name of ["touchmove", "wheel", "keydown"] as const) {
      this.scroll.addEventListener(name, scrolledByHand, { passive: true });
    }
    this.scroll.addEventListener(
      "pointerdown",
      (event) => {
        if (event.target === this.scroll) scrolledByHand();
      },
      { passive: true },
    );

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
    pickHint.textContent = "Tap a monster to choose it";
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
    this.toLine = document.createElement("p");
    this.toLine.className = "hatch-add__to";
    this.stepper = new QuantityStepper({
      block: "hatch-add",
      inputLabel: "How many to add",
      fewerLabel: "One fewer",
      moreLabel: "One more",
      fillTitle: `As many as the queue and your ${monsterWords(monsterRealmOf(context.binding.store.kind)).goo} allow`,
      jumps: JUMPS,
      value: () => this.count,
      set: (value) => this.setCount(value),
      fill: () => this.fill(),
      commit: () => this.renderCount(true),
    });
    this.addButton = document.createElement("button");
    this.addButton.type = "button";
    this.addButton.className = "btn btn--primary hatch-add__add";
    this.addButton.addEventListener("click", () => void this.runAdd(this.count));
    this.addWords = document.createElement("span");
    this.addWords.className = "hatch-add__words";
    this.addButton.append(this.addWords);
    this.warningLine = document.createElement("p");
    this.warningLine.className = "hatch-add__warning";
    this.gateLine = document.createElement("p");
    this.gateLine.className = "monsters-gate hatch-add__gate";
    this.addBlock.append(
      this.toLine,
      this.stepper.element,
      this.addButton,
      this.gateLine,
      this.warningLine,
    );

    this.info.append(this.infoHead, this.infoEach, this.detailsButton, this.stats, this.addBlock);
    // The message sits in the split so the info panel can stand beside it on a wide screen.
    split.append(this.message, pick, this.info);
    this.scroll.append(this.status, this.lines, this.boosts, split);
    this.element.append(this.tabsRow, this.scroll);
  }

  private get store() {
    return this.context.binding.store;
  }

  /** The Inferno yard's Incubators hatch the Inferno monsters (WP 2.4). */
  private get realm(): MonsterRealm {
    return monsterRealmOf(this.store.kind);
  }

  private get words(): MonsterWords {
    return monsterWords(this.realm);
  }

  /** Where this yard's last hatchery tab is remembered. */
  private get tabKey(): string {
    return hatchTabKey(this.store.kind, this.store.baseid);
  }

  show(focus: MonstersFocus): void {
    const yard = readHatchYard(this.store.save, this.store.now());
    if (focus.buildingId !== undefined && yard.hcc) this.target = "hcc";
    else if (focus.buildingId !== undefined && yard.hatcheries.some((one) => one.id === focus.buildingId)) {
      // The hatchery tapped in the yard is the tab chosen, and the one remembered.
      this.target = focus.buildingId;
      saveHatchTab(this.tabKey, focus.buildingId);
    } else if (this.target === null) {
      this.target = loadHatchTab(this.tabKey);
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

  hide(): void {
    this.markYard(null);
  }

  destroy(): void {
    if (this.settling !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(this.settling);
    this.settling = null;
    this.taking = null;
    this.markYard(null);
    this.stepper.destroy();
    for (const button of this.shiny.values()) button.destroy();
    this.shiny.clear();
    this.element.remove();
  }

  /* ── Drawing ────────────────────────────────────────────────────────── */

  private render(): void {
    this.keepScroll(() => this.draw());
  }

  /**
   * Runs a redraw with the scroll box held where the player left it (owner,
   * 9 and 13 Nov: on a phone, choosing a monster, `+` or `+5` threw the list
   * back to the top). Every redraw comes through here, the whole one and the
   * count's alone. Only a hatchery tab's tap opens at the top, and it sets
   * that before it redraws.
   *
   * - The focus: a redraw that took away the node with the focus gives it to
   *   the new copy without a scroll. A plain focus() scrolls the box to it,
   *   and on a phone that is often up in the line.
   * - The box's height: a shorter info panel (D.A.V.E.'s after Crabatron's)
   *   made the box shorter while it was scrolled to the bottom, and the
   *   browser pulled the scroll up (tester, 9 Nov). The panel keeps the
   *   height it lost.
   * - Late moves: the browser lays the new nodes out, and decodes their
   *   pictures, after this returns. For the next frames, a box that moved
   *   without the player scrolling it goes back.
   */
  private keepScroll(draw: () => void): void {
    const box = this.scroll;
    const focused = document.activeElement as HTMLElement | null;
    const focusKey = focused?.dataset?.["focusKey"];
    const scrolled = box.scrollTop;
    const tall = box.scrollHeight;
    // The info panel's held height is let go; it is measured again.
    this.info.style.minHeight = "";
    draw();
    if (focusKey && focused && !focused.isConnected) {
      this.element.querySelector<HTMLElement>(`[data-focus-key="${focusKey}"]`)?.focus({ preventScroll: true });
    }
    this.holdScroll(scrolled, tall);
    this.settleScroll(scrolled, tall);
  }

  /** Puts the box back at `scrolled`, the info panel keeping any height the box lost. */
  private holdScroll(scrolled: number, tall: number): void {
    const box = this.scroll;
    if (box.scrollTop === scrolled) return;
    const lost = tall - box.scrollHeight;
    if (lost > 0) this.info.style.minHeight = `${this.info.offsetHeight + lost}px`;
    box.scrollTop = scrolled;
  }

  /** For the next frames, a box that moved on its own goes back (see `keepScroll`). */
  private settleScroll(scrolled: number, tall: number): void {
    if (typeof requestAnimationFrame !== "function") return;
    if (this.settling !== null) cancelAnimationFrame(this.settling);
    this.settling = null;
    const since = this.scrolledAt;
    // A list still gliding from a fling moves by itself: leave it be.
    if (performance.now() - since < GLIDE_MS) return;
    let frames = SETTLE_FRAMES;
    const check = (): void => {
      this.settling = null;
      // The player scrolled meanwhile: where they put it is where it stays.
      if (!this.scroll.isConnected || this.scrolledAt !== since) return;
      this.holdScroll(scrolled, tall);
      frames -= 1;
      if (frames > 0) this.settling = requestAnimationFrame(check);
    };
    this.settling = requestAnimationFrame(check);
  }

  private draw(): void {
    const store = this.store;
    const yard = readHatchYard(store.save, store.now());
    this.yard = yard;
    this.numbers = hatcheryNumbers(yard);
    this.target = pickTarget(yard, this.target);
    if (this.clearing !== null) {
      const queue =
        this.clearing === "hcc"
          ? yard.shared
          : yard.hatcheries.find((one) => one.id === this.clearing)?.queue;
      if (!queue?.length || (this.clearing === "hcc") !== (yard.hcc !== null)) this.clearing = null;
    }

    const monsters = hatchMonsters(store.save, this.realm);
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
    this.drawCount(document.activeElement !== this.stepper.input);
    this.markYard(yard.hcc || yard.hatcheries.length === 0 ? null : this.target);
  }

  /**
   * Numbers the hatcheries in the yard as the lines are numbered and outlines
   * `chosen`, or takes the numbers down with null. Not with an HCC, whose
   * one queue has no hatchery to choose.
   */
  private markYard(chosen: HatchTarget | null): void {
    const mark = this.context.binding.scene.markHatcheries;
    if (!mark) return;
    mark(typeof chosen === "number" ? { numbers: this.numbers, chosen } : null);
  }

  /** "Hatchery 2", by the number the line and the yard show. */
  private hatcheryName(id: number): string {
    return `${this.words.hatchery} ${this.numbers.get(id) ?? ""}`.trim();
  }

  /**
   * Everything that follows the count: the box, Max, Add, the lines under
   * them, the dashed slots and the housing bar. Runs on every step of a
   * hold, so the grid and the info panel are left alone. The line over the
   * grid is redrawn, so the box is held still (`keepScroll`).
   */
  private renderCount(rewrite: boolean): void {
    this.keepScroll(() => this.drawCount(rewrite));
  }

  private drawCount(rewrite: boolean): void {
    const yard = this.yard;
    const row = this.selectedRow();
    const target = this.target;
    const ready = row?.state.kind === "ready";
    const limits = yard && row && ready && target !== null ? fillLimits(yard, target, row.monster.id) : null;
    const max = limits ? limits.fill : 0;
    if (this.count > max) this.count = max;
    this.stepper.sync({ value: this.count, max, disabled: !ready || target === null, rewrite });
    this.stepper.fill.textContent = limits ? `Max (${formatAmount(limits.fill)})` : "Max";
    this.stepper.fill.setAttribute("aria-pressed", String(limits !== null && limits.fill > 0 && this.count === limits.fill));

    const gate = this.addGate(yard, row, limits);
    this.gateLine.replaceChildren(...gate);
    this.gateLine.hidden = gate.length === 0;
    this.addBlocked = gate.length > 0 || this.count < 1;
    this.addButton.disabled = this.addBlocked || this.hatcheryBusy();
    this.drawAddLabel(row);
    this.drawTo(yard);

    const preview =
      yard && row && ready && target !== null && this.count > 0
        ? previewAdd(yard, target, row.monster.id, this.count)
        : null;

    const warning =
      yard && row && ready && this.count > 0 ? housingWarning(yard, row.monster.id, this.count) : null;
    this.warningLine.textContent = warning ?? "";
    this.warningLine.hidden = warning === null;

    if (yard) {
      this.renderLines(yard, preview && row ? slotPreview(row.monster.id, preview) : null, preview);
      this.renderMessage(yard, preview && row ? preview.added * row.space : 0);
    }
    this.syncPending();
  }

  /** "Add 5 Pokeys to Hatchery 2": the last thing read before the tap says where they go (#268, C). */
  private drawAddLabel(row: HatchMonster | null): void {
    const target = this.target;
    const where = typeof target === "number" ? ` to ${this.hatcheryName(target)}` : "";
    const words =
      !row || this.count < 1
        ? "Add"
        : `Add ${formatAmount(this.count)} ${plural(row.monster.name, this.count)}${where}`;
    // The words are rewritten, never replaced: pressing Add straight after
    // typing a count blurs the box, which redraws here between the press and
    // the release, and a replaced node under the pointer cancels the click
    // (the first Add after typing did nothing, #268).
    if (this.addWords.textContent !== words) this.addWords.textContent = words;
  }

  /** "Adding to Hatchery 2 (Level 3)", or the HCC's shared queue. */
  private drawTo(yard: HatchYard | null): void {
    const target = this.target;
    const hatchery = typeof target === "number" ? yard?.hatcheries.find((one) => one.id === target) : null;
    this.toLine.hidden = target === null;
    if (target === "hcc") {
      this.toLine.replaceChildren("Adding to the ", strong("shared queue"));
      return;
    }
    if (!hatchery) {
      this.toLine.replaceChildren();
      return;
    }
    this.toLine.replaceChildren(
      "Adding to ",
      strong(this.hatcheryName(hatchery.id)),
      ` (Level ${hatchery.level})`,
    );
  }

  /* ── The line ───────────────────────────────────────────────────────── */

  private renderLines(yard: HatchYard, preview: SlotPreview | null, added: AddPreview | null): void {
    this.plainButtons = [];
    this.clocks = [];
    this.totals = [];
    if (yard.hatcheries.length === 0) {
      const note = document.createElement("p");
      note.className = "hatch__none";
      note.textContent = `Build ${article(this.words.hatchery)} to hatch monsters.`;
      this.showTabs(null);
      this.lines.replaceChildren(note);
      return;
    }
    if (yard.hcc) {
      this.showTabs(null);
      this.lines.replaceChildren(this.hccLine(yard, preview));
      return;
    }
    // Several hatcheries are tabs (owner, 28 Oct): only the chosen one's line is drawn.
    const tabs = hatcheryTabs(yard, this.numbers);
    const chosen = yard.hatcheries.find((one) => one.id === this.target) ?? yard.hatcheries[0]!;
    const line = this.hatcheryLine(yard, chosen, tabs.length > 0, preview, added);
    this.showTabs(tabs.length > 0 ? this.keptStrip(tabs, chosen.id) : null);
    this.lines.replaceChildren(line);
  }

  /**
   * The tab strip, built again only when a tab has something new to show.
   * A `+` or a monster chosen changes nothing on the tabs: the same strip
   * stays, so a row slid sideways to Hatchery 5 stays there and the row's
   * height never changes over the box (owner, 13 Nov).
   */
  private keptStrip(tabs: readonly HatcheryTab[], chosen: number): HTMLElement {
    const key = JSON.stringify([this.store.kind, this.words.hatchery, chosen, tabs]);
    if (this.strip?.key !== key) {
      const before = this.clocks.length;
      const element = this.tabStrip(tabs, chosen);
      this.strip = { key, element, clocks: this.clocks.slice(before) };
    } else {
      // Its countdowns keep ticking.
      this.clocks.push(...this.strip.clocks);
    }
    return this.strip.element;
  }

  /** The tab strip in its row over the scroll box, or no row at all. */
  private showTabs(strip: HTMLElement | null): void {
    if (strip === null) this.strip = null;
    if (this.tabsRow.firstElementChild !== strip || this.tabsRow.childElementCount !== (strip ? 1 : 0)) {
      this.tabsRow.replaceChildren(...(strip ? [strip] : []));
    }
    this.tabsRow.hidden = strip === null;
  }

  /**
   * One tab per hatchery: its picture and number, its level, a light for
   * what it is doing (the monster hatching and its countdown when busy) and
   * how many wait. A tap, or an arrow key, chooses it and shows its line.
   */
  private tabStrip(tabs: readonly HatcheryTab[], chosen: number): HTMLElement {
    const strip = document.createElement("div");
    strip.className = "tab-row hatch-tabs";
    strip.setAttribute("role", "tablist");
    strip.setAttribute("aria-label", `Choose ${article(this.words.hatchery)}`);
    const ids = tabs.map((tab) => tab.id);
    const now = this.store.now();
    for (const tab of tabs) {
      const isChosen = tab.id === chosen;
      const name = this.hatcheryName(tab.id);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `hatch-tab hatch-tab--${tab.light}`;
      button.id = `hatch-tab-${tab.id}`;
      button.dataset["hatchery"] = String(tab.id);
      button.dataset["focusKey"] = `tab-${tab.id}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(isChosen));
      button.setAttribute("aria-controls", "hatch-panel");
      button.tabIndex = isChosen ? 0 : -1;
      button.title = `${name} · Level ${tab.level}`;

      const picture = document.createElement("img");
      picture.className = "hatch-tab__picture";
      picture.src = hatcheryPicture(tab.level, this.store.kind);
      picture.alt = "";
      picture.decoding = "async";
      picture.draggable = false;
      const number = document.createElement("span");
      number.className = "hatch-tab__number";
      number.textContent = String(tab.number);
      const art = document.createElement("span");
      art.className = "hatch-tab__art";
      art.setAttribute("aria-hidden", "true");
      art.append(picture, number);

      const level = document.createElement("span");
      level.className = "hatch-tab__level";
      level.textContent = `Lv ${tab.level}`;
      const status = document.createElement("span");
      status.className = "hatch-tab__status";
      status.setAttribute("aria-hidden", "true");
      const light = document.createElement("span");
      light.className = "hatch-tab__light";
      status.append(light);
      const entry = tab.monster && tab.light === "busy" ? monsterEntry(tab.monster) : undefined;
      if (entry) status.append(monsterPicture(entry, "small", "hatch-tab__monster"));
      const state = document.createElement("span");
      state.className = "hatch-tab__state";
      if (tab.endsAt !== null) {
        state.textContent = duration(tab.endsAt - now);
        this.clocks.push({ node: state, endsAt: tab.endsAt });
      } else {
        state.textContent = TAB_STATE[tab.state];
      }
      status.append(state);
      const body = document.createElement("span");
      body.className = "hatch-tab__body";
      body.setAttribute("aria-hidden", "true");
      body.append(level, status);
      button.append(art, body);
      if (tab.waiting > 0) {
        const waiting = document.createElement("span");
        waiting.className = "hatch-tab__waiting";
        waiting.setAttribute("aria-hidden", "true");
        waiting.textContent = `×${formatAmount(tab.waiting)}`;
        button.append(waiting);
      }
      const doing = entry ? `${entry.name} hatching` : TAB_STATE[tab.state];
      button.setAttribute(
        "aria-label",
        `${name}, Level ${tab.level}: ${doing}, ${formatAmount(tab.waiting)} waiting`,
      );
      button.addEventListener("click", () => this.chooseHatchery(tab.id));
      button.addEventListener("keydown", (event) => {
        const next = tabAfterKey(ids, tab.id, event.key);
        if (next === null) return;
        event.preventDefault();
        this.chooseHatchery(next);
      });
      strip.append(button);
    }
    return strip;
  }

  /**
   * One hatchery's line: now, its stacks, the next locked slot, the totals.
   * Alone, it carries the hatchery's number and name; as a tab's panel the
   * tab above says those.
   */
  private hatcheryLine(
    yard: HatchYard,
    hatchery: HatcheryView,
    tabbed: boolean,
    preview: SlotPreview | null,
    added: AddPreview | null,
  ): HTMLElement {
    const line = document.createElement("div");
    line.className = `hatch-line${tabbed ? " hatch-line--tabbed" : ""}`;
    line.dataset["hatchery"] = String(hatchery.id);
    if (tabbed) {
      line.id = "hatch-panel";
      line.setAttribute("role", "tabpanel");
      line.setAttribute("aria-labelledby", `hatch-tab-${hatchery.id}`);
    }

    const head = document.createElement("div");
    head.className = "hatch-line__head";
    if (!tabbed) {
      const number = document.createElement("span");
      number.className = "hatch-line__number";
      number.setAttribute("aria-hidden", "true");
      number.textContent = String(this.numbers.get(hatchery.id) ?? "");
      const name = document.createElement("h3");
      name.className = "hatch-line__title";
      name.textContent = `${this.hatcheryName(hatchery.id)} · Level ${hatchery.level}`;
      head.append(number, name);
    }
    const waiting = document.createElement("span");
    waiting.className = "hatch-line__waiting";
    const before = queuedCount(hatchery.queue);
    // The batch's waiting count before → after (#268, G): those an idle hatchery starts at once never wait.
    const after = added && added.added > 0 ? before + added.added - added.started : before;
    const of = ` of ${formatAmount(hatchery.stackLimit * STACK_SIZE)}`;
    if (after !== before) {
      const next = document.createElement("strong");
      next.className = "hatch-line__after";
      next.textContent = formatAmount(after);
      waiting.append(`${formatAmount(before)} → `, next, ` waiting${of}`);
    } else {
      waiting.textContent = `${formatAmount(before)} waiting${of}`;
    }
    head.append(waiting);
    const clear = this.clearControl(hatchery.id, hatchery.queue);
    if (clear) head.append(clear);

    const slots = document.createElement("div");
    slots.className = "hatch-line__slots";
    slots.append(this.nowCard(yard, hatchery, false, preview), chevron());
    hatchery.queue.forEach((stack, at) => slots.append(this.stackSlot(hatchery.id, stack, at + 1, preview)));
    let free = hatchery.stackLimit - hatchery.queue.length;
    for (const count of preview?.fresh ?? []) {
      if (free <= 0) break;
      slots.append(previewSlot(preview!.monster, count));
      free -= 1;
    }
    for (; free > 0; free -= 1) slots.append(emptySlot());
    if (hatchery.level > 0 && hatchery.level < maxLevel(HATCHERY_TYPE, this.store.kind)) {
      slots.append(this.lockedSlot(hatchery));
    }
    slots.append(this.lineTotals(yard, hatchery.id, true));
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
    title.textContent = this.words.controlCentre;
    const waiting = document.createElement("span");
    waiting.className = "hatch-line__waiting";
    waiting.textContent = `${formatAmount(queuedCount(yard.shared))} waiting of ${formatAmount(HCC_STACKS * STACK_SIZE)}`;
    head.append(title, waiting);
    const clear = this.clearControl("hcc", yard.shared);
    if (clear) head.append(clear);

    const now = document.createElement("div");
    now.className = "hatch-line__now";
    now.setAttribute("role", "group");
    now.setAttribute("aria-label", "Hatching now");
    for (const hatchery of yard.hatcheries) now.append(this.nowCard(yard, hatchery, true, preview));
    const hall = townHallLevel(this.store.yard);
    const allowed = Math.min(MAX_HATCHERIES, quantityOf(HATCHERY_TYPE, hall, this.store.kind));
    if (yard.hatcheries.length < allowed) {
      const more = document.createElement("div");
      more.className = "hatch-now hatch-now--more";
      more.textContent = `Build another ${this.words.hatchery} to hatch more at once`;
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
   * The monster hatching now: a tap cancels it for its goo
   * (`HATCHERYPOPUP.as:320-323`), with no question first (owner, 12 Nov
   * 2026: "remove the prompt"), and holding it keeps cancelling whichever
   * monster starts next. Idle, it shows the batch that would start at once,
   * dashed.
   */
  private nowCard(
    yard: HatchYard,
    hatchery: HatcheryView,
    compact: boolean,
    preview: SlotPreview | null,
  ): HTMLElement {
    const where = compact ? this.hatcheryName(hatchery.id) : "";
    const monster = hatchery.monster;
    const state = hatchery.state;

    const card = document.createElement(monster ? "button" : "div");
    card.className = `hatch-now hatch-now--${state}${compact ? " hatch-now--compact" : ""}`;
    card.dataset["hatchery"] = String(hatchery.id);

    const label = document.createElement("span");
    label.className = "hatch-now__label";
    const number = compact ? this.numbers.get(hatchery.id) : undefined;
    if (compact && number !== undefined) {
      // Word and number apart, so a phone can drop the word and keep the
      // number readable ("Hatch…" hid which hatchery it was; 6 Nov UI check).
      const word = document.createElement("span");
      word.className = "hatch-now__label-word";
      word.textContent = this.words.hatchery;
      const count = document.createElement("span");
      count.className = "hatch-now__label-number";
      count.textContent = String(number);
      label.append(word, " ", count);
    } else {
      label.textContent = compact ? where : "Hatching now";
    }
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
      `${compact ? `${where}: ` : ""}${nameOf(monster)} hatching now. Cancel it and get the ${this.words.goo} back`,
    );
    button.title = `Cancel ${nameOf(monster)} (hold for more)`;
    // Nothing on the press itself: a cancel reaches the server at once, and a
    // finger that only meant to scroll the row must not cost a monster.
    holdPress(
      button,
      { step: () => this.cancelStep(hatchery.id), end: () => undefined },
      { stepOnPress: false },
    );
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
      time.textContent = (state === "stalled" && this.realm === "inferno" ? "Waiting for room" : BUSY_TEXT[state]) ?? "";
    }
    return card;
  }

  /**
   * Clear all for a queue with anything waiting: a tap asks "Clear 44?" with
   * the goo back, and Clear empties every waiting stack in one request
   * (`hatchery/clear`); Keep, or a tap elsewhere that redraws, leaves it be.
   */
  private clearControl(target: HatchTarget, queue: readonly QueueStack[]): HTMLElement | null {
    const waiting = queuedCount(queue);
    if (waiting === 0) return null;
    const key = String(target);

    if (this.clearing === target) {
      const box = document.createElement("span");
      box.className = "hatch-clear hatch-clear--confirm";
      box.setAttribute("role", "group");
      box.setAttribute("aria-label", `Clear all ${formatAmount(waiting)} waiting?`);
      const question = document.createElement("span");
      question.className = "hatch-clear__question";
      question.textContent = `Clear ${formatAmount(waiting)}?`;
      const back = document.createElement("span");
      back.className = "hatch-clear__refund";
      back.append(resourceAmount("r4", queueRefund(queue)), " back");
      const yes = document.createElement("button");
      yes.type = "button";
      yes.className = "btn btn--danger hatch-clear__yes";
      yes.textContent = "Clear";
      yes.dataset["focusKey"] = `clear-yes-${key}`;
      yes.addEventListener("click", () => {
        this.clearing = null;
        void this.runClear(target);
      });
      this.plainButtons.push(yes);
      const no = document.createElement("button");
      no.type = "button";
      no.className = "btn btn--ghost hatch-clear__no";
      no.textContent = "Keep";
      no.dataset["focusKey"] = `clear-no-${key}`;
      no.addEventListener("click", () => {
        this.clearing = null;
        this.render();
        this.element.querySelector<HTMLElement>(`[data-focus-key="clear-${key}"]`)?.focus();
      });
      box.append(question, " ", back, " ", yes, " ", no);
      return box;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--ghost hatch-clear";
    button.dataset["focusKey"] = `clear-${key}`;
    button.setAttribute(
      "aria-label",
      `Clear all ${formatAmount(waiting)} waiting and get the ${this.words.goo} back`,
    );
    const cross = document.createElement("span");
    cross.className = "hatch-clear__cross";
    cross.setAttribute("aria-hidden", "true");
    cross.textContent = "×";
    button.append(cross, "Clear all");
    button.addEventListener("click", () => {
      this.clearing = target;
      this.render();
      this.element.querySelector<HTMLElement>(`[data-focus-key="clear-no-${key}"]`)?.focus();
    });
    this.plainButtons.push(button);
    return button;
  }

  /**
   * A waiting stack: ×N, the monster, and a tap takes one out
   * (`HATCHERYPOPUP.as:300-319`); holding it counts more out, faster the
   * longer it is held, and the release sends them in one request (owner,
   * 12 Nov 2026).
   */
  private stackSlot(
    target: HatchTarget,
    stack: QueueStack,
    slot: number,
    preview: SlotPreview | null,
  ): HTMLElement {
    const [id, waiting] = stack;
    const taking = this.taking;
    const taken =
      taking && taking.target === target && taking.slot === slot && taking.monster === id ? taking.count : 0;
    const count = Math.max(0, waiting - taken);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hatch-slot${taken > 0 ? " hatch-slot--taking" : ""}`;
    button.dataset["slot"] = String(slot);
    button.dataset["focusKey"] = `slot-${String(target)}-${slot}`;
    const name = nameOf(id);
    button.setAttribute("aria-label", `${name}, ${count} waiting. Take one out and get its ${this.words.goo} back`);
    button.title = `Take ${plural(name, 2)} out (hold for more)`;
    holdPress(button, {
      step: () => this.takeStep(target, slot, id),
      end: (cancelled) => void this.takeEnd(cancelled),
    });
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
    words.textContent = `Upgrade the ${this.words.hatchery} for a ${ordinal(hatchery.stackLimit + 1)} slot`;
    const upgrade = document.createElement("button");
    upgrade.type = "button";
    upgrade.className = "btn btn--outline hatch-slot__upgrade";
    upgrade.textContent = "Upgrade";
    upgrade.dataset["focusKey"] = `upgrade-${hatchery.id}`;
    upgrade.setAttribute("aria-label", `Upgrade the ${this.words.hatchery} for a ${ordinal(hatchery.stackLimit + 1)} slot`);
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

  /**
   * The housing bar, with a line beside it only when something is wrong
   * (damaged, housing full, paused). The everyday "Hatching Bolts. Choose a
   * monster and how many, then press Add." line and its goo icon are gone
   * (owner, 12 Nov 2026: "I dont need this").
   */
  private renderMessage(yard: HatchYard, adding: number): void {
    const { title, tone } = lineSentence(yard, this.target, this.selectedRow(), this.words);
    const parts: HTMLElement[] = [];
    if (tone === "warning") {
      const words = document.createElement("div");
      words.className = "hatch-message__words";
      const main = document.createElement("span");
      main.className = "hatch-message__title hatch-message__title--warning";
      main.textContent = title;
      words.append(main);
      parts.push(words);
    }

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
    label.textContent = `${this.words.housing} after this ${adding > 0 ? "add" : "line"}`;
    const value = document.createElement("span");
    value.className = "hatch-housing__value";
    value.textContent = `${formatAmount(after)} / ${formatAmount(yard.capacity)}`;

    top.append(label, value);
    const bar = document.createElement("div");
    bar.className = "hatch-housing__bar";
    bar.setAttribute("role", "meter");
    bar.setAttribute("aria-label", label.textContent);
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
    // What each colour is (#268, G): the batch in its own.
    const key = document.createElement("span");
    key.className = "hatch-housing__key";
    key.setAttribute("aria-hidden", "true");
    for (const [part, words, amount] of [
      ["housed", "Housed", housed],
      ["pending", "On the way", pending],
      ["adding", "This add", adding],
    ] as const) {
      if (part === "adding" && amount <= 0) continue;
      const item = document.createElement("span");
      item.className = `hatch-housing__item hatch-housing__item--${part}`;
      item.textContent = `${words} ${formatAmount(amount)}`;
      key.append(item);
    }
    housing.append(top, bar, key);
    // Past the capacity is allowed (#169); say what happens to the rest.
    if (after > yard.capacity) {
      const over = document.createElement("span");
      over.className = "hatch-housing__over";
      over.textContent = `Over by ${formatAmount(after - yard.capacity)}: the rest hatch and wait in the ${this.words.hatchery} for room.`;
      housing.append(over);
    }

    this.message.replaceChildren(...parts, housing);
  }

  /* ── The grid ───────────────────────────────────────────────────────── */

  /**
   * The monsters to choose from. Each tile is built once and then updated
   * where it is (owner, 13 Nov: on a phone a tap threw the list back to the
   * top): a tap changes which tile is pressed and the counts, never the
   * nodes, so the button under the finger, its focus and the grid's height
   * all stay. The grid is rebuilt only when the monsters in it change.
   */
  private renderGrid(monsters: readonly HatchMonster[]): void {
    const order = monsters.map((row) => row.monster.id).join(",");
    if (order !== this.gridOrder) {
      this.gridOrder = order;
      const ids = new Set(monsters.map((row) => row.monster.id));
      for (const id of [...this.tiles.keys()]) if (!ids.has(id)) this.tiles.delete(id);
      this.grid.replaceChildren(...monsters.map((row) => this.tile(row).item));
    }
    for (const row of monsters) {
      const tile = this.tile(row);
      const { button, note } = tile;
      const kind = `hatch-monster hatch-monster--${row.state.kind}`;
      if (button.className !== kind) button.className = kind;
      button.setAttribute("aria-pressed", String(row.monster.id === this.selected));
      // The tile says its price short ("468K", owner 9 Nov: easier to see), rounded up so it never looks cheaper;
      // the full figure stays on hover here and in the chosen monster's stats.
      button.title =
        row.state.kind === "ready"
          ? `Choose ${row.monster.name} · ${formatAmount(row.price)} each`
          : `${row.monster.name}: ${row.state.kind === "unlocking" ? "still unlocking" : "locked"}`;
      const noteKey = row.state.kind === "ready" ? `ready ${row.price}` : row.state.kind;
      if (tile.noteKey !== noteKey) {
        tile.noteKey = noteKey;
        if (row.state.kind === "ready") note.replaceChildren(resourceAmount("r4", formatShortPrice(row.price)));
        else note.textContent = row.state.kind === "unlocking" ? "Unlocking" : "Locked";
      }
    }

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
    text.textContent = `Grey monsters are locked. Unlock them at the ${this.words.locker}, then hatch them here.`;
    const go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn--outline hatch-pick__go";
    go.textContent = `Go to ${this.words.locker}`;
    go.addEventListener("click", () => this.context.showTab(MonstersTabId.UNLOCK, {}));
    this.lockedNote.replaceChildren(lock, text, go);
  }

  /** A monster's tile, built the first time the grid shows it; `renderGrid` fills in the rest. */
  private tile(row: HatchMonster): HatchTile {
    const id = row.monster.id;
    const kept = this.tiles.get(id);
    if (kept) return kept;
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset["monster"] = id;
    button.dataset["focusKey"] = `monster-${id}`;
    button.addEventListener("click", () => this.tapMonster(id));
    const name = document.createElement("span");
    // A long name ("Slimeattikus") gets smaller letters on a phone, so it
    // stays whole on one line rather than breaking mid-word.
    name.className =
      row.monster.name.length > LONG_NAME ? "hatch-monster__name hatch-monster__name--long" : "hatch-monster__name";
    name.textContent = row.monster.name;
    const note = document.createElement("span");
    note.className = "hatch-monster__note";
    button.append(monsterPicture(row.monster, "small", "hatch-monster__picture"), name, " ", note);
    item.append(button);
    const tile: HatchTile = { item, button, note, noteKey: "" };
    this.tiles.set(id, tile);
    return tile;
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

    // The phone bar's line: what one costs, takes and fills, as icons.
    this.infoEach.replaceChildren(
      resourceAmount("r4", row.price, { realm: this.realm }),
      " · ",
      iconAmount("time", duration(row.seconds), { label: "Time each" }),
      ...hatchRushChip(),
      " · ",
      iconAmount("housing", row.space, { label: this.realm === "inferno" ? "Space each" : "Housing each" }),
    );

    // Each number under its painted icon, the word kept for a screen reader
    // and on hover: [shoe] 16, [heart] 480, [claw] 30 (a healer's heart +60).
    const damage = monsterStat(monster.id, "damage", row.level);
    // A third entry is a second <dd> on its own line in the tile: Hatch
    // Rush's chip under the time, as a 98 px tile has no room beside it.
    const stats: [Node, Node | string, (Node | null)?][] = [
      [gameIcon("speed"), statNumber(monsterStat(monster.id, "speed", row.level))],
      [gameIcon("health"), statNumber(monsterStat(monster.id, "health", row.level))],
      damage < 0
        ? [gameIcon("health", { label: "Heals" }), `+${statNumber(-damage)}`]
        : [gameIcon("damage"), statNumber(damage)],
      [resourceIcon("r4", { realm: this.realm }), formatAmount(row.price)],
      [gameIcon("housing", { label: this.realm === "inferno" ? "Space each" : "Housing each" }), String(row.space)],
      [gameIcon("time", { label: "Time each" }), duration(row.seconds), weekendChip("hatch")],
    ];
    this.stats.replaceChildren(
      ...stats.map(([term, value, extra]) => {
        const item = document.createElement("div");
        item.className = "hatch-info__stat";
        const dt = document.createElement("dt");
        dt.append(term);
        const dd = document.createElement("dd");
        dd.append(value);
        item.append(dt, dd);
        if (extra) {
          const more = document.createElement("dd");
          more.className = "hatch-info__stat-extra";
          more.append(extra);
          item.append(more);
        }
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
    if (!yard || this.target === null) return [`Build ${article(this.words.hatchery)} first.`];
    if (!row) return [];
    if (row.state.kind !== "ready") {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "btn btn--outline hatch-add__unlock";
      go.textContent = `Go to ${this.words.locker}`;
      go.addEventListener("click", () =>
        this.context.showTab(MonstersTabId.UNLOCK, { monster: row.monster.id }),
      );
      const words =
        row.state.kind === "unlocking"
          ? `${row.monster.name} is still unlocking.`
          : `Unlock ${row.monster.name} in the ${this.words.locker} first.`;
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
      for (const { item, power, price } of overdrivesOf(this.realm)) {
        const key = `overdrive-${item}`;
        used.add(key);
        const button = this.shinyButton(key, `${power}x`, () => void this.runOverdrive(item));
        button.element.title = `Every ${this.words.hatchery.toLowerCase()} works ${power} times as fast for an hour.`;
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
      ? finishText(preview.blocked, this.words)
      : this.store.credits < preview.price
        ? "Not enough Shiny"
        : null;
    button.setBlocked(blocked ? `${blocked}.` : null);
    reason.textContent = blocked ?? (preview.finishedAll ? "" : `${housingNoun(this.words, true)} fits only part of it`);
    reason.hidden = reason.textContent === "";
  }

  private drawOverdriveClock(line?: HTMLElement): void {
    const node = line ?? this.boosts.querySelector<HTMLElement>(".hatch-boosts__running");
    if (!node) return;
    const now = this.store.now();
    const running = activeOverdrive(this.store.save.storedata, now);
    node.textContent = running
      ? `Overdrive ${running.power}x: every ${this.words.hatchery.toLowerCase()} works ${running.power} times as fast for ${duration(running.endsAt - now)}.`
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
    return hatchMonsters(this.store.save, this.realm).find((row) => row.monster.id === this.selected) ?? null;
  }

  private select(id: string, redraw = true): void {
    if (this.selected === id) return;
    this.selected = id;
    this.count = DEFAULT_COUNT;
    if (redraw) this.render();
  }

  /**
   * A grid tap only chooses the monster (#268, E). The original added one
   * per tap (`HATCHERYPOPUP.as:234-291`); with the count and Add beside it
   * that made two ways to add and surprise extras.
   */
  private tapMonster(id: string): void {
    this.select(id);
  }

  /** A tab's tap: its line shows, monsters go to it, the yard's outline moves to it, and it is remembered. */
  private chooseHatchery(id: number): void {
    if (this.target === id) return;
    this.target = id;
    saveHatchTab(this.tabKey, id);
    // The other hatchery opens at the top, its line under the tabs.
    this.scroll.scrollTop = 0;
    this.render();
    // The strip has just been redrawn: keep the focus on the tab chosen.
    this.element.querySelector<HTMLElement>(`[data-focus-key="tab-${id}"]`)?.focus();
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
      const price = priceOf(monster, yard?.levels[monster] ?? 1, yard?.pricePercent);
      this.setStatus({
        tone: "bad",
        content: [
          preview.stoppedBy === "goo"
            ? overCap(price, this.store.caps?.r4)
              ? NEED_MORE_SILOS
              : `Not enough ${this.words.goo} for a ${nameOf(monster)}.`
            : target === "hcc"
              ? "The shared queue is full."
              : `This ${this.words.hatchery}'s queue is full.`,
        ],
      });
      return;
    }
    const result = await this.actions.add(target, monster, count);
    this.report(result, (report) => {
      const name = plural(nameOf(report.monster), report.added);
      const cost = report.cost.r4 > 0 ? [": ", resourceAmount("r4", report.cost.r4), " spent."] : ["."];
      if (report.added === report.requested) return [`Added ${formatAmount(report.added)} ${name}`, ...cost];
      const why = report.stoppedBy === "goo" ? `out of ${this.words.goo}` : "the queue is full";
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

  /**
   * One step of a held (or tapped) waiting stack: one more counted out, drawn
   * on the slot in place so the held button stays under the finger. False
   * when the stack has no more to give, or the slot no longer holds it.
   */
  private takeStep(target: HatchTarget, slot: number, monster: string): boolean {
    const taking = this.taking;
    if (taking && (taking.target !== target || taking.slot !== slot)) return false;
    const stack = this.yard ? queueOf(this.yard, target)[slot - 1] : undefined;
    if (!stack || stack[0] !== monster) return false;
    const count = (taking?.count ?? 0) + 1;
    if (count > stack[1]) return false;
    this.taking = { target, slot, monster, count };
    const button = this.element.querySelector<HTMLElement>(`[data-focus-key="slot-${String(target)}-${slot}"]`);
    if (button) {
      button.classList.add("hatch-slot--taking");
      const badge = button.querySelector(".hatch-slot__count");
      if (badge) badge.textContent = `×${stack[1] - count}`;
    }
    return count < stack[1];
  }

  /**
   * The press is over: what was counted out goes in one request, or, when
   * the browser took the touch for a scroll, nothing does. The queue is read
   * again first: if the stack at the front went into a hatchery meanwhile,
   * every slot after it moved up one.
   */
  private async takeEnd(cancelled: boolean): Promise<void> {
    const taking = this.taking;
    if (!taking) return;
    this.taking = null;
    if (cancelled) {
      this.render();
      return;
    }
    const queue = queueOf(readHatchYard(this.store.save, this.store.now()), taking.target);
    let slot = taking.slot;
    if (queue[slot - 1]?.[0] !== taking.monster && queue[slot - 2]?.[0] === taking.monster) slot -= 1;
    const stack = queue[slot - 1];
    if (!stack || stack[0] !== taking.monster) {
      this.render();
      return;
    }
    // The slot keeps showing them gone until the answer redraws it.
    await this.runRemove(taking.target, slot, Math.min(taking.count, stack[1]));
  }

  /**
   * One step of a held (or tapped) monster hatching now: cancels it. While
   * the last cancel is still with the server the hold waits; each answer
   * starts the next monster, which the next step cancels.
   */
  private cancelStep(hatcheryId: number): boolean {
    if (this.hatcheryBusy()) return true;
    const hatchery = readHatchYard(this.store.save, this.store.now()).hatcheries.find(
      (one) => one.id === hatcheryId,
    );
    if (!hatchery?.monster) return false;
    void this.runRemove(hatcheryId, 0, 1);
    return true;
  }

  private async runClear(target: HatchTarget): Promise<void> {
    const result = await this.actions.clear(target);
    this.report(result, (report) => {
      const taken = Object.values(report.removed).reduce((total, n) => total + n, 0);
      return [
        `Cleared ${formatAmount(taken)} waiting`,
        ...(report.refund.r4 > 0 ? [": ", resourceAmount("r4", report.refund.r4), " back."] : ["."]),
      ];
    });
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
        report.finishedAll ? "." : `. ${housingNoun(this.words, true)} is full; the rest will wait.`,
      ];
    });
  }

  private async runOverdrive(item: OverdriveItem): Promise<void> {
    const power = overdrivesOf(this.realm).find((one) => one.item === item)?.power ?? 0;
    const result = await this.actions.overdrive(item);
    this.report(result, () => [
      `Overdrive on: every ${this.words.hatchery.toLowerCase()} works ${power} times as fast for an hour.`,
    ]);
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

/**
 * The hatchery as the yard draws it at this level (owner, 28 Oct): the Flash
 * art changes at each level and has no repaint, so Classic and Modern agree.
 * The build-menu picture stands in should the art table ever lack the type.
 */
const hatcheryPicture = (level: number, kind: YardKind): string => {
  const art = resolveArt(HATCHERY_TYPE, level, ArtState.DEFAULT, kind);
  return (art?.still ?? art?.top)?.url ?? buttonUrl(HATCHERY_TYPE, kind);
};

/** What a tab says beside its light when nothing counts down. */
const TAB_STATE: Readonly<Record<HatcheryView["state"], string>> = {
  producing: "Hatching",
  idle: "Idle",
  stalled: "Full",
  upgrading: "Upgrading",
  building: "Building",
  damaged: "Damaged",
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
  badge.textContent = `+${formatAmount(count)}`;
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

/** "an Incubator", "a Hatchery". */
const article = (noun: string): string => `${/^[AEIOU]/.test(noun) ? "an" : "a"} ${noun}`;

/** Housing as a sentence names it: "Housing", or "the Compound" ("The Compound" to start one). */
const housingNoun = (words: MonsterWords, start = false): string =>
  words.housing === "Housing" ? "Housing" : `${start ? "The" : "the"} ${words.housing}`;

/** Words in bold, for "Adding to **Hatchery 2**". */
const strong = (text: string): HTMLElement => {
  const node = document.createElement("strong");
  node.textContent = text;
  return node;
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
 * What the chosen line is doing, in one sentence (`HATCHERYPOPUP.as:430-467`):
 * nothing, hatching which monsters, waiting for housing, damaged, paused;
 * then that the queue is full. Only the `warning` ones are drawn.
 */
export const lineSentence = (
  yard: HatchYard,
  target: HatchTarget | null,
  row: HatchMonster | null,
  words: MonsterWords = monsterWords("surface"),
): { title: string; tone: "plain" | "warning" } => {
  const build = { title: `Build ${article(words.hatchery)} to hatch monsters.`, tone: "plain" } as const;
  if (target === null) return build;
  const full = row?.state.kind === "ready" && fillLimits(yard, target, row.monster.id).queue === 0;
  const tail = full ? " The queue is full." : "";
  const names = (ids: readonly string[]): string => {
    const each = [...new Set(ids)].map((id) => plural(nameOf(id), 2));
    return each.length <= 1 ? (each[0] ?? "") : `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
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
        title: `${housingNoun(words, true)} is full: ${stalled.length === 1 ? "a hatched monster waits" : `${formatAmount(stalled.length)} hatched monsters wait`} in the ${words.hatcheries} for room.`,
        tone: "warning",
      };
    }
    if (producing.length > 0) return { title: `Hatching ${names(producing.map((one) => one.monster!))}.${tail}`, tone: "plain" };
    if (yard.shared.length > 0) return { title: `Waiting for a free ${words.hatchery}.${tail}`, tone: "plain" };
    return { title: "Nothing is hatching.", tone: "plain" };
  }

  const hatchery = yard.hatcheries.find((one) => one.id === target);
  if (!hatchery) return build;
  switch (hatchery.state) {
    case "building":
      return { title: `This ${words.hatchery} is still being built: it starts hatching when it is done.`, tone: "warning" };
    case "damaged":
      return { title: `This ${words.hatchery} is damaged: repair it to hatch again.`, tone: "warning" };
    case "stalled":
      return {
        title: `${housingNoun(words, true)} is full: the hatched ${nameOf(hatchery.monster ?? "")} waits in this ${words.hatchery} for room.`,
        tone: "warning",
      };
    case "upgrading":
      return { title: `Paused while the ${words.hatchery} upgrades.${tail}`, tone: "warning" };
    case "producing":
      return { title: `Hatching ${names([hatchery.monster ?? ""])}.${tail}`, tone: "plain" };
    default:
      return { title: "Nothing is hatching.", tone: "plain" };
  }
};

const refusalText = (refusal: YardRefusal): string =>
  refusal.reason === "network"
    ? "Could not reach the server. Try again."
    : refusal.message || "That did not work.";
