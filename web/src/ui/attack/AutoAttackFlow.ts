import {
  getAutoAttackPlan,
  getAutoAttackReplay,
  runAutoAttack,
  type AutoAttackPlanResponse,
  type AutoAttackReplayResponse,
  type AutoAttackResponse,
  type PlanShortfall,
  type PlanSummary,
  type YardLabel,
} from "@/api/autoAttack";
import { ApiError } from "@/api/http";
import { declineTakeover, getTakeoverQuote, takeOverCell, type TakeoverPayment } from "@/api/maproom";
import type { TakeoverQuoteResponse } from "@/api/types";
import type { WatchRun } from "@/game/autoAttack/watchRun";
import type { OffsetCell } from "@/game/HexGrid";
import { monsterPortrait, showPortrait } from "@/game/portraits";
import { EndTakeoverOffer } from "@/ui/attack/EndTakeoverOffer";
import { icon } from "@/ui/maproom1/icons";
import { watchMoreBelow } from "@/ui/moreBelow";
import { Panel } from "@/ui/Panel";
import {
  MOVES_CHANGED,
  MOVE_AND_ATTACK,
  NO_ROOM_TEXT,
  ROOM_NEED_TEXT,
  autoAttackErrorText,
  repeatRefusal,
  shortfallText,
  yardName,
  yardPlace,
} from "./autoAttackText";
import { armyParts, campHead, movesPart, roomParts, shortageList, watchMoreRows } from "./repeatPrompt";
import { resultView } from "./autoAttackResultView";
import { RepeatBar } from "./RepeatBar";
import { REAL_TIMERS, REPEAT_BAR_MIN_MS, atLeast, type BarTimers } from "./repeatBarTiming";
import "@/ui/styles/autoattack.css";

/**
 * Auto-attack's screens (issue #221): the confirm sheet, the working bar,
 * the result, and from it Watch. One flow, opened from the map's camp
 * panel (Repeat attack). The end-of-attack panel's Attack again that also
 * opened it is gone (owner, 18 Nov 2026).
 *
 * The owner's rules, as the screens carry them: the sheet is always shown,
 * since monsters are spent, and lists the champion and bombs the attack
 * brings ("Includes Gorgo L5 and 3 bombs"); anything missing greys Attack now
 * out and is listed; one attack per press; the result shows the loot, the
 * losses, the damage this attack added and the camp's total, and
 * "Conquered!" at the takeover threshold, with the takeover offer an attack
 * by hand gets.
 */

/** The routes the flow calls; the real ones by default. */
export interface AutoAttackCalls {
  readonly plan: (baseid: string) => Promise<AutoAttackPlanResponse>;
  /** `movesKey`: the moves the player agreed to (Smart Repeat attack). */
  readonly run: (baseid: string, movesKey?: string | null) => Promise<AutoAttackResponse>;
  readonly replay: () => Promise<AutoAttackReplayResponse>;
  readonly quote: (baseid: string) => Promise<TakeoverQuoteResponse>;
  readonly takeOver: (baseid: string, payment: TakeoverPayment) => Promise<unknown>;
}

const CALLS: AutoAttackCalls = {
  plan: getAutoAttackPlan,
  run: runAutoAttack,
  replay: getAutoAttackReplay,
  quote: getTakeoverQuote,
  takeOver: takeOverCell,
};

export interface AutoAttackFlowOptions {
  /** The camp. */
  readonly baseid: string;
  readonly cell?: OffsetCell;
  /** Where the sheets open: the overlay's modal layer. */
  readonly modal: HTMLElement;
  /** Opens the watch scene on the battle. */
  readonly onWatch: (run: WatchRun) => void;
  /** An auto-attack landed: the map refreshes the camp, the HUD the pool. */
  readonly onAttacked?: (result: AutoAttackResponse) => void;
  /** The camp was taken over from the result screen. */
  readonly onTaken?: (payment: TakeoverPayment) => void;
  /** The flow's last screen closed. */
  readonly onClose?: () => void;
  readonly calls?: AutoAttackCalls;
  /** Local unix seconds; `Date.now` by default. */
  readonly now?: () => number;
  /**
   * Show the working bar while the attack runs (owner, 15 Nov 2026): the
   * map's Repeat attack asks for it. Without it, the plain "Your monsters
   * are attacking…" line.
   */
  readonly progressBar?: boolean;
  /** The bar's clock and timer; the real ones by default. */
  readonly barTimers?: BarTimers;
  /** Reduced motion for the bar; the player's setting by default. */
  readonly barReducedMotion?: boolean;
}

/** A modal sheet: a scrim and a panel that Escape and the scrim do not close. */
const sheet = (title: string, className: string): { backdrop: HTMLElement; panel: Panel } => {
  const backdrop = document.createElement("div");
  // The working bar's sheet, and the confirm and refusal sheets, are compact
  // cards on a phone upright, not the whole screen (attack.css, autoattack.css;
  // the confirm and refusal ones since the lead's vetting, 16 Nov 2026).
  backdrop.className = `popup-backdrop attack-end__backdrop${
    className.includes("auto-attack--bar") ? " auto-attack__backdrop--bar" : ""
  }${/auto-attack--(confirm|failed|result)/.test(className) ? " auto-attack__backdrop--card" : ""}`;
  const panel = new Panel({ title, closable: false, className: `map-panel attack-end auto-attack ${className}` });
  panel.element.setAttribute("role", "dialog");
  panel.element.setAttribute("aria-modal", "true");
  backdrop.append(panel.element);
  return { backdrop, panel };
};

const paragraph = (text: string, className = ""): HTMLElement => {
  const node = document.createElement("p");
  if (className) node.className = className;
  node.textContent = text;
  return node;
};

const buttonOf = (label: string, className: string, onClick: () => void): HTMLButtonElement => {
  const node = document.createElement("button");
  node.type = "button";
  node.className = className;
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
};

/** The missing things as a list. */
export const missingList = (missing: readonly PlanShortfall[]): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "auto-attack__missing";
  list.setAttribute("aria-label", "What is missing");
  for (const item of missing) {
    const row = document.createElement("li");
    if (item.kind === "monster") {
      row.className = "auto-attack__missing-monster";
      row.append(portraitOf(item.id), document.createTextNode(shortfallText(item)));
    } else {
      row.textContent = shortfallText(item);
    }
    list.append(row);
  }
  return list;
};

/* ── Smart Repeat attack (owner, 16 Nov 2026) ─────────────────────────── */

/** A monster's small painted portrait. */
const portraitOf = (id: string): HTMLImageElement => {
  const picture = document.createElement("img");
  picture.className = "auto-attack__portrait";
  showPortrait(picture, monsterPortrait(id, "icon"));
  picture.alt = "";
  picture.decoding = "async";
  return picture;
};

/** A yard as a move names it: "Outpost" over "244, 208". */
const yardChip = (label: YardLabel | undefined, end: "from" | "to" | "room"): HTMLElement => {
  const chip = document.createElement("span");
  chip.className = `auto-attack__yard auto-attack__yard--${end}${label?.main ? " auto-attack__yard--main" : ""}`;
  const name = document.createElement("span");
  name.className = "auto-attack__yard-name";
  if (label?.main) name.append(icon("home", 14, "auto-attack__yard-icon"));
  name.append(document.createTextNode(yardName(label)));
  const place = document.createElement("span");
  place.className = "auto-attack__yard-place";
  place.textContent = yardPlace(label);
  chip.append(name, place);
  return chip;
};

/** No room in range: what the moves need, and the room each yard in range has. */
export const roomList = (answer: AutoAttackPlanResponse): HTMLElement[] => {
  const noRoom = answer.noRoom;
  if (!noRoom) return [];
  const need = paragraph(ROOM_NEED_TEXT(noRoom.need), "auto-attack__room-need");
  const list = document.createElement("ul");
  list.className = "auto-attack__room";
  list.setAttribute("aria-label", "Free housing in range");
  for (const one of noRoom.free) {
    const row = document.createElement("li");
    row.className = "auto-attack__room-yard";
    const free = document.createElement("span");
    free.className = "auto-attack__room-free";
    free.textContent = `${one.free.toLocaleString("en-US")} space free`;
    row.append(yardChip(answer.yards?.[one.baseid], "room"), free);
    list.append(row);
  }
  return noRoom.free.length > 0
    ? [need, paragraph("Receiving yards in range", "auto-attack__room-label"), list]
    : [need];
};

/**
 * Why the sheet cannot run. With rows (what is short, the room in range) it
 * is a column of its own, beside the army from 621 px wide; a reason alone
 * goes under the camp, where it is always in sight.
 */
const refusalPart = (reason: string, rows: readonly HTMLElement[], army: HTMLElement): HTMLElement | null => {
  const line = paragraph(reason, "auto-attack__refusal");
  if (rows.length === 0) {
    army.querySelector(".repeat-prompt__camp")?.after(line);
    return null;
  }
  const part = document.createElement("section");
  part.className = "repeat-prompt__refusal-part";
  part.append(line, ...rows);
  return part;
};

/** The army and what goes beside it (the moves, or what is short). */
const columnsOf = (army: HTMLElement, side: HTMLElement, banner: HTMLElement | null = null): HTMLElement => {
  const columns = document.createElement("div");
  columns.className = `repeat-prompt__columns${banner ? " repeat-prompt__columns--banner" : ""}`;
  // The banner leads in one column, and tops the moves' column in two.
  if (banner) columns.append(banner);
  columns.append(army, side);
  return columns;
};

/** The `reason` of the server's refusal, if it is one. */
const refusalReason = (caught: unknown): string | null => {
  if (!(caught instanceof ApiError)) return null;
  const reason = (caught.details?.data as { reason?: unknown } | undefined)?.reason;
  return typeof reason === "string" ? reason : null;
};

export class AutoAttackFlow {
  private readonly options: AutoAttackFlowOptions;
  private readonly calls: AutoAttackCalls;
  private open: { backdrop: HTMLElement; panel: Panel } | null = null;
  private offer: EndTakeoverOffer | null = null;
  private busy = false;
  private closed = false;
  /** The plan the confirm sheet showed: who the bar's army is. */
  private plan: AutoAttackPlanResponse["plan"] = null;
  /** The camp's damage the confirm sheet showed. */
  private damage = 0;
  /** The key of the moves the confirm sheet showed, sent with "Move and attack". */
  private movesKey: string | null = null;
  private bar: RepeatBar | null = null;

  constructor(options: AutoAttackFlowOptions) {
    this.options = options;
    this.calls = options.calls ?? CALLS;
  }

  /**
   * Opens the confirm sheet, asking the server for the plan first unless the
   * caller already has its answer.
   */
  async start(answer?: AutoAttackPlanResponse): Promise<void> {
    this.closed = false;
    if (answer) {
      this.confirm(answer);
      return;
    }
    this.show("Repeat attack", "auto-attack--confirm", [paragraph("Checking your army…", "u-muted")], []);
    try {
      const fresh = await this.calls.plan(this.options.baseid);
      if (!this.closed) this.confirm(fresh);
    } catch (caught) {
      if (!this.closed) this.failed(caught);
    }
  }

  /** Shows a result the caller already has (the layout check's preview). */
  showResult(result: AutoAttackResponse): void {
    this.closed = false;
    this.result(result);
  }

  /** Closes whatever is open. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.bar?.destroy();
    this.bar = null;
    this.offer?.destroy();
    this.offer = null;
    for (const stop of this.stopCues) stop();
    this.stopCues = [];
    this.open?.panel.close();
    this.open?.backdrop.remove();
    this.open = null;
    this.options.onClose?.();
  }

  /** Stops the open sheet's scroll cues. */
  private stopCues: (() => void)[] = [];

  /**
   * The sheet's scrolling list never rests on a half-cut row, and fades at the
   * bottom while more rows are below (lead's vetting, 16 Nov 2026).
   */
  private cueLists(root: HTMLElement): void {
    for (const stop of this.stopCues) stop();
    this.stopCues = [];
    // What scrolls fades at the bottom while more is below: the result's
    // loot, the sheet's words (a very short screen).
    for (const middle of root.querySelectorAll<HTMLElement>(".arv-middle, .auto-attack__scroll, .repeat-prompt__army")) {
      this.stopCues.push(watchMoreBelow(middle, "auto-attack__list--more"));
    }
    // The moves, what is short, the room in range: a painted arrow and how
    // many more are below (a touch screen draws no scroll bar, and a fade
    // alone was easy to miss).
    for (const list of root.querySelectorAll<HTMLElement>(".repeat-prompt__moves, .repeat-prompt__shorts, .repeat-prompt__room")) {
      this.stopCues.push(watchMoreRows(list));
    }
  }

  /** The sheet on screen, for the tests. */
  get element(): HTMLElement | null {
    return this.open?.backdrop ?? null;
  }

  private now(): number {
    return (this.options.now ?? (() => Date.now() / 1000))();
  }

  private show(title: string, className: string, body: HTMLElement[], actions: HTMLButtonElement[]): void {
    this.offer?.destroy();
    this.offer = null;
    this.open?.panel.close();
    this.open?.backdrop.remove();
    const view = sheet(title, className);
    // No buttons (the working sheets), no empty row under the words.
    if (actions.length > 0) {
      const row = document.createElement("div");
      row.className = "attack-end__actions";
      row.append(...actions);
      if (className.includes("auto-attack--result")) {
        // The result (owner, 16 Nov 2026): the camp on top, then the loot,
        // which alone scrolls on a screen too short for it; the take-over
        // offer and Watch and Close always in sight under it.
        const [top, loot, ...rest] = body;
        const words = document.createElement("div");
        words.className = "auto-attack__scroll arv-middle";
        if (loot) words.append(loot);
        view.panel.setContent(...(top ? [top] : []), words, ...rest, row);
      } else if (className.includes("auto-attack--confirm") || className.includes("auto-attack--failed")) {
        // On a short screen the words scroll and the buttons stay in sight
        // under them (layout-rules); with moves on a wide screen, the army
        // and the moves each scroll in their own column (autoattack.css).
        const words = document.createElement("div");
        words.className = "auto-attack__scroll";
        words.append(...body);
        view.panel.setContent(words, row);
      } else {
        view.panel.setContent(...body, row);
      }
    } else {
      view.panel.setContent(...body);
    }
    this.options.modal.append(view.backdrop);
    this.open = view;
    this.cueLists(view.panel.element);
    (actions.find((one) => one.classList.contains("btn--primary") && !one.disabled) ?? actions[0])?.focus();
  }

  private confirm(answer: AutoAttackPlanResponse, changed = false): void {
    const plan = answer.plan;
    this.plan = plan;
    this.damage = answer.damage;
    this.movesKey = null;
    if (!plan) {
      this.show("Repeat attack", "auto-attack--confirm", [paragraph("You have no attack to repeat on this camp yet.")], [
        buttonOf("Close", "btn btn--primary", () => this.close()),
      ]);
      return;
    }

    // Look A, "like the Attack window" (owner, 20 Nov 2026): the camp, the
    // army as tiles, then the moves, or why it cannot run and what is short.
    const refusal = repeatRefusal(answer);
    const moves = refusal === null ? (answer.moves ?? []) : [];
    const body: HTMLElement[] = [];
    const banner = changed ? paragraph(MOVES_CHANGED, "auto-attack__changed") : null;
    const army = this.armyColumn(plan, answer.damage);
    let side: HTMLElement | null = null;
    if (refusal) {
      const rows =
        answer.missing.length > 0
          ? [shortageList(answer.missing, plan.champions)]
          : answer.noRoom
            ? roomParts(answer.noRoom, answer.yards ?? {})
            : [];
      side = refusalPart(refusal, rows, army);
    } else if (moves.length > 0) {
      // Smart Repeat attack: the yards in range lack monsters other yards hold.
      this.movesKey = answer.movesKey ?? null;
      side = movesPart(moves, answer.yards ?? {});
    }
    if (side) body.push(columnsOf(army, side, banner));
    else body.push(...(banner ? [banner] : []), army);

    const attack = buttonOf(
      moves.length > 0 ? MOVE_AND_ATTACK : "Attack now",
      "btn btn--primary auto-attack__go",
      () => void this.run(),
    );
    attack.disabled = refusal !== null;
    this.show(
      "Repeat attack",
      `auto-attack--confirm auto-attack--prompt${side ? " auto-attack--prompt-two" : ""}${
        moves.length > 0 ? " auto-attack--prompt-moves" : ""
      }${refusal ? " auto-attack--refused" : ""}`,
      body,
      [buttonOf("Cancel", "btn btn--outline auto-attack__cancel", () => this.close()), attack],
    );
  }

  /** The camp, the champions and monsters, and the bombs: the column the sheet starts with. */
  private armyColumn(plan: PlanSummary, damage: number): HTMLElement {
    const army = document.createElement("div");
    army.className = "repeat-prompt__army";
    army.append(campHead(plan, damage), ...armyParts(plan));
    return army;
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (!this.options.progressBar) {
      this.show("Repeat attack", "auto-attack--running", [paragraph("Your monsters are attacking…", "u-muted")], []);
      try {
        const result = await this.calls.run(this.options.baseid, this.movesKey);
        this.options.onAttacked?.(result);
        if (!this.closed) this.result(result);
      } catch (caught) {
        if (!this.closed) this.failed(caught);
      } finally {
        this.busy = false;
      }
      return;
    }
    await this.runWithBar();
  }

  /**
   * Repeat attack with the working bar: it runs at least
   * {@link REPEAT_BAR_MIN_MS}; once the answer is in and that time has passed
   * it jumps to full, holds a moment, and the result shows. An error stops it
   * at once. The map hears of the landed attack when the bar lands, so the
   * camp behind the sheet does not change before the bar is done.
   */
  private async runWithBar(): Promise<void> {
    const timers = this.options.barTimers ?? REAL_TIMERS;
    const bar = new RepeatBar({
      plan: this.plan,
      timers,
      ...(this.options.barReducedMotion === undefined ? {} : { reducedMotion: this.options.barReducedMotion }),
    });
    this.bar = bar;
    const words = paragraph("Attacking…", "u-muted auto-attack__working");
    words.setAttribute("aria-live", "polite");
    this.show("Repeat attack", "auto-attack--running auto-attack--bar", [bar.element, words], []);
    bar.start();
    try {
      const result = await atLeast(this.calls.run(this.options.baseid, this.movesKey), REPEAT_BAR_MIN_MS, timers, bar.started);
      // Before the closed check: a landed attack is always reported.
      this.options.onAttacked?.(result);
      if (this.closed) return;
      bar.complete();
      await timers.wait(bar.holdMs);
      if (!this.closed) this.result(result);
    } catch (caught) {
      bar.stop();
      if (!this.closed) this.failed(caught);
    } finally {
      bar.destroy();
      if (this.bar === bar) this.bar = null;
      this.busy = false;
    }
  }

  private failed(caught: unknown): void {
    // The moves the player agreed to are not the ones needed now: ask again
    // and show the new plan, never move what the player did not see.
    const reason = refusalReason(caught);
    if (reason === "movesChanged") {
      void this.replan();
      return;
    }
    const { message, missing } = autoAttackErrorText(caught);
    const data = caught instanceof ApiError ? (caught.details?.data as Partial<AutoAttackPlanResponse> | undefined) : undefined;
    // Refused for what is short or for room after "Move and attack" (owner,
    // 20 Nov 2026): the same camp and army as the sheet, then the reason and
    // each shortage with its picture. Anything else (no server, ten a
    // minute, Watch's replay gone) is its one line.
    const plan = this.plan;
    if (plan && (reason === "missing" || reason === "noRoom")) {
      const body: HTMLElement[] = [];
      if (this.movesKey) body.push(paragraph("Your yards changed.", "auto-attack__changed auto-attack__failure-context"));
      const army = this.armyColumn(plan, this.damage);
      const rows: HTMLElement[] = [];
      if (missing.length > 0) rows.push(shortageList(missing, plan.champions));
      if (reason === "noRoom" && data?.noRoom) rows.push(...roomParts(data.noRoom, data.yards ?? {}));
      const side = refusalPart(reason === "noRoom" ? NO_ROOM_TEXT : message, rows, army);
      body.push(side ? columnsOf(army, side) : army);
      this.show("Repeat attack", `auto-attack--failed auto-attack--prompt${side ? " auto-attack--prompt-two" : ""} auto-attack--refused`, body, [
        buttonOf("Close", "btn btn--primary", () => this.close()),
      ]);
      return;
    }
    const body = [paragraph(message, "auto-attack__refusal")];
    if (missing.length > 0) body.push(missingList(missing));
    if (reason === "noRoom" && data?.noRoom) body.push(...roomList(data as AutoAttackPlanResponse));
    this.show("Repeat attack", "auto-attack--failed", body, [
      buttonOf("Close", "btn btn--primary", () => this.close()),
    ]);
  }

  /** The plan again, after the server said the moves changed. */
  private async replan(): Promise<void> {
    this.show("Repeat attack", "auto-attack--confirm", [paragraph("Checking your army…", "u-muted")], []);
    try {
      const fresh = await this.calls.plan(this.options.baseid);
      if (!this.closed) this.confirm(fresh, true);
    } catch (caught) {
      if (!this.closed) this.failed(caught);
    }
  }

  private result(result: AutoAttackResponse): void {
    const view = resultView(result);
    // Only Watch and Close (owner, 15 Nov 2026): no Repeat again here.
    const watch = buttonOf("Watch", "btn auto-attack__watch", () => void this.watch());
    const close = buttonOf("Close", "btn auto-attack__close", () => this.close());
    // The layout check (and a screen reader) find the way out by its name.
    close.setAttribute("aria-label", "Close");
    // Take over is the main action when it is offered; Close otherwise.
    if (!view.offerHost) close.classList.add("btn--primary");
    this.show(
      "Attack result",
      `auto-attack--result${result.conquered ? " attack-end--win" : ""}`,
      [view.head, view.loot, ...(view.offerHost ? [view.offerHost] : [])],
      [watch, close],
    );
    if (view.offerHost && this.open) {
      this.offer = new EndTakeoverOffer({
        kind: "camp",
        baseid: this.options.baseid,
        name: result.tribe,
        grant: null,
        quote: this.calls.quote,
        takeOver: this.calls.takeOver,
        decline: (baseid, options) => declineTakeover(baseid, options),
        modal: this.options.modal,
        onTaken: (payment) => {
          this.close();
          this.options.onTaken?.(payment);
        },
        now: () => this.now(),
        compact: true,
      });
      view.offerHost.append(this.offer.element);
    }
  }

  private async watch(): Promise<void> {
    try {
      const { replay } = await this.calls.replay();
      if (!replay) {
        this.failed(new Error("The replay is no longer kept."));
        return;
      }
      this.close();
      this.options.onWatch({ replay, ...(this.options.cell ? { cell: this.options.cell } : {}) });
    } catch (caught) {
      this.failed(caught);
    }
  }
}
