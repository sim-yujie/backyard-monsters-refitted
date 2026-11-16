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
  type YardMove,
} from "@/api/autoAttack";
import { ApiError } from "@/api/http";
import { declineTakeover, getTakeoverQuote, takeOverCell, type TakeoverPayment } from "@/api/maproom";
import type { TakeoverQuoteResponse } from "@/api/types";
import type { WatchRun } from "@/game/autoAttack/watchRun";
import type { OffsetCell } from "@/game/HexGrid";
import { championByType } from "@/game/combat/rules";
import { championPortrait, monsterPortrait, showPortrait } from "@/game/portraits";
import { championName, monsterName } from "@/ui/attack/ArmyPanel";
import { EndTakeoverOffer } from "@/ui/attack/EndTakeoverOffer";
import { formatAmount } from "@/ui/format";
import { icon } from "@/ui/maproom1/icons";
import { fitWholeRows, watchMoreBelow } from "@/ui/moreBelow";
import { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";
import {
  MOVES_CHANGED,
  MOVES_LEAD,
  MOVE_AND_ATTACK,
  ROOM_NEED_TEXT,
  SIEGE_NOT_REPEATED,
  autoAttackErrorText,
  campText,
  includesText,
  monstersText,
  planSourceText,
  repeatRefusal,
  shortfallText,
  yardName,
  yardPlace,
} from "./autoAttackText";
import { resultView } from "./autoAttackResultView";
import { RepeatBar } from "./RepeatBar";
import { resultLayout, type ResultLayout } from "./resultLayout";
import { REAL_TIMERS, REPEAT_BAR_MIN_MS, atLeast, type BarTimers } from "./repeatBarTiming";
import "@/ui/styles/autoattack.css";

/**
 * Auto-attack's screens (issue #221): the confirm sheet, the working bar,
 * the result, and from it Watch. One flow, opened from the map's camp
 * panel (Repeat attack) and from the end-of-attack panel (Attack again).
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
   * map's Repeat attack and the end panel's Attack again. Without it, the
   * plain "Your monsters are attacking…" line.
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
  }${/auto-attack--(confirm|failed|rv)/.test(className) ? " auto-attack__backdrop--card" : ""}`;
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

// Smart Repeat attack (astra): the total army and the transfers use the same painted counts.
const armyUnits = (monsters: Readonly<Record<string, number>>): HTMLElement[] => {
  return Object.entries(monsters)
    .filter(([, count]) => count > 0)
    .sort((one, other) => other[1] - one[1] || one[0].localeCompare(other[0]))
    .map(([id, count]) => {
      const unit = document.createElement("span");
      unit.className = "auto-attack__unit";
      unit.title = `${count.toLocaleString("en-US")} ${monsterName(id)}`;
      unit.setAttribute("aria-label", unit.title);
      const number = document.createElement("span");
      number.className = "auto-attack__unit-count";
      number.textContent = `×${count.toLocaleString("en-US")}`;
      unit.append(portraitOf(id), number);
      return unit;
    });
};

/**
 * Smart Repeat attack (lead's vetting, 16 Nov): the champions and bombs the
 * attack brings on their own line with each champion's portrait, so they do
 * not read as part of the "Already in range" strip.
 */
const championStrip = (plan: PlanSummary): HTMLElement | null => {
  if (plan.champions.length === 0 && plan.bombs.length === 0) return null;
  const strip = document.createElement("div");
  strip.className = "auto-attack__champion-strip";
  strip.append(document.createTextNode("Includes"));
  for (const champion of plan.champions) {
    const unit = document.createElement("span");
    unit.className = "auto-attack__unit auto-attack__champion";
    const picture = document.createElement("img");
    picture.className = "auto-attack__portrait";
    showPortrait(picture, championPortrait(championByType(champion.t) ?? `G${champion.t}`, champion.l, "icon"));
    picture.alt = "";
    picture.decoding = "async";
    const words = document.createElement("span");
    words.textContent = `${championName(champion.t)} L${champion.l}` + (champion.pl ? ` (power ${champion.pl})` : "");
    unit.append(picture, words);
    strip.append(unit);
  }
  if (plan.bombs.length > 0) {
    const bombs = document.createElement("span");
    bombs.className = "auto-attack__unit";
    bombs.textContent = plan.bombs.length === 1 ? "1 bomb" : `${plan.bombs.length} bombs`;
    strip.append(bombs);
  }
  return strip;
};

const attackArmy = (monsters: Readonly<Record<string, number>>): HTMLElement => {
  const strip = document.createElement("div");
  strip.className = "auto-attack__army-strip";
  strip.append(document.createTextNode("Attack army"), ...armyUnits(monsters));
  return strip;
};

const movesHeading = (count: number): HTMLElement => {
  const heading = paragraph("", "auto-attack__moves-lead");
  for (const label of ["From", MOVES_LEAD(count), "To · in range"]) {
    const part = document.createElement("span");
    part.textContent = label;
    heading.append(part);
  }
  return heading;
};

/**
 * The moves, one row each: the yard they leave on the LEFT, what moves, and
 * the yard in range they go to on the RIGHT (owner: "source yard on left, and
 * destination yard on right").
 */
const movesList = (moves: readonly YardMove[], yards: Readonly<Record<string, YardLabel>>): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "auto-attack__moves";
  list.setAttribute("aria-label", "Monsters that move first");
  for (const move of moves) {
    const row = document.createElement("li");
    row.className = "auto-attack__move";
    const cargo = document.createElement("span");
    cargo.className = "auto-attack__cargo";
    cargo.append(...armyUnits(move.monsters));
    const arrow = icon("chevronRight", 18, "auto-attack__arrow");
    const from = yards[move.from];
    const to = yards[move.to];
    row.setAttribute(
      "aria-label",
      `${monstersText(move.monsters)}: from ${yardName(from)} ${yardPlace(from)} to ${yardName(to)} ${yardPlace(to)}`,
    );
    row.append(yardChip(from, "from"), cargo, arrow, yardChip(to, "to"));
    list.append(row);
  }
  return list;
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
    // astra's result looks: the middle fades at the bottom while more is below (a phone on its side).
    for (const middle of root.querySelectorAll<HTMLElement>(".arv-middle")) {
      this.stopCues.push(watchMoreBelow(middle, "auto-attack__list--more"));
    }
    for (const list of root.querySelectorAll<HTMLElement>(".auto-attack__moves, .auto-attack__missing, .auto-attack__room")) {
      this.stopCues.push(watchMoreBelow(list, "auto-attack__list--more"));
      // Measured once laid out, and again whenever something that sizes the
      // sheet arrives late: a portrait, the fonts, a new screen size.
      const refit = () => {
        fitWholeRows(list);
        list.dispatchEvent(new Event("scroll"));
      };
      requestAnimationFrame(refit);
      for (const image of root.querySelectorAll("img")) image.addEventListener("load", refit, { once: true });
      void document.fonts?.ready.then(() => requestAnimationFrame(refit));
      window.addEventListener("resize", refit);
      this.stopCues.push(() => window.removeEventListener("resize", refit));
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
      if (className.includes("auto-attack--rv")) {
        // astra's result looks (16 Nov 2026): the camp and the damage on top,
        // the middle scrolls, Watch and Close always in sight under it.
        const [top, ...rest] = body;
        const words = document.createElement("div");
        words.className = "auto-attack__scroll arv-middle";
        words.append(...rest);
        view.panel.setContent(...(top ? [top] : []), words, row);
      } else if (className.includes("auto-attack--confirm") || className.includes("auto-attack--failed")) {
        // On a short screen the list (moves, what is short, the room) scrolls
        // and the words and buttons stay in sight (layout-rules; Smart Repeat
        // attack's moves make the sheet tall).
        const words = document.createElement("div");
        words.className = "auto-attack__scroll";
        words.append(...body);
        if (className.includes("auto-attack--moves")) {
          // Smart Repeat attack (astra): the cost stays above the buttons, outside the list.
          const footer = document.createElement("div");
          footer.className = "auto-attack__footer";
          footer.append(paragraph("Moving is free. The attack uses up these monsters.", "u-muted auto-attack__spent"), row);
          view.panel.setContent(words, footer);
        } else {
          view.panel.setContent(words, row);
        }
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
    this.movesKey = null;
    if (!plan) {
      this.show("Repeat attack", "auto-attack--confirm", [paragraph("You have no attack to repeat on this camp yet.")], [
        buttonOf("Close", "btn btn--primary", () => this.close()),
      ]);
      return;
    }

    const refusal = repeatRefusal(answer);
    const moves = refusal === null ? (answer.moves ?? []) : [];
    const body: HTMLElement[] = [];
    if (changed) body.push(paragraph(MOVES_CHANGED, "auto-attack__changed"));
    body.push(
      paragraph(
        moves.length > 0
          ? `${plan.tribe} camp · Level ${plan.level} · ${Math.floor(answer.damage)}% damaged`
          : `${campText(plan)} · camp damage now ${Math.floor(answer.damage)}%`,
        "attack-end__outcome",
      ),
      paragraph(planSourceText(plan, this.options.baseid, this.now()), "u-muted auto-attack__source"),
      moves.length > 0 ? attackArmy(plan.monsters) : paragraph(monstersText(plan.monsters), "auto-attack__army"),
    );
    const details: HTMLElement[] = [];
    // Smart Repeat attack (astra): the rest of the saved army is already in range.
    if (moves.length > 0) {
      const inRange = { ...plan.monsters };
      for (const move of moves)
        for (const [id, count] of Object.entries(move.monsters)) inRange[id] = (inRange[id] ?? 0) - count;
      const units = armyUnits(inRange);
      if (units.length > 0) {
        const ready = document.createElement("div");
        ready.className = "auto-attack__in-range";
        ready.append(document.createTextNode("Already in range:"), ...units);
        details.push(ready);
      }
    }
    const includes = includesText(plan);
    const champions = moves.length > 0 ? championStrip(plan) : null;
    if (champions) details.push(champions);
    else if (includes) details.push(paragraph(includes, "auto-attack__includes"));
    if (plan.siege) details.push(paragraph(SIEGE_NOT_REPEATED, "u-muted auto-attack__siege"));
    if (moves.length > 0 && details.length > 0) {
      // Smart Repeat attack (astra): short secondary lines share a row when they fit.
      const summary = document.createElement("div");
      summary.className = "auto-attack__details";
      summary.append(...details);
      body.push(summary);
    } else body.push(...details);
    if (refusal) {
      body.push(paragraph(refusal, "auto-attack__refusal"));
      if (answer.missing.length > 0) body.push(missingList(answer.missing));
      else body.push(...roomList(answer));
    } else if (moves.length > 0) {
      // Smart Repeat attack: the yards in range lack monsters other yards hold.
      this.movesKey = answer.movesKey ?? null;
      body.push(movesHeading(moves.length), movesList(moves, answer.yards ?? {}));
    } else {
      body.push(paragraph("The monsters are spent, as in an attack by hand. The result comes in a few seconds.", "u-muted"));
    }

    const attack = buttonOf(
      moves.length > 0 ? MOVE_AND_ATTACK : "Attack now",
      "btn btn--primary auto-attack__go",
      () => void this.run(),
    );
    attack.disabled = refusal !== null;
    this.show(
      "Repeat attack",
      `auto-attack--confirm${moves.length > 0 ? " auto-attack--moves" : ""}`,
      body,
      [buttonOf("Cancel", "btn btn--ghost auto-attack__cancel", () => this.close()), attack],
    );
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
    if (refusalReason(caught) === "movesChanged") {
      void this.replan();
      return;
    }
    const { message, missing } = autoAttackErrorText(caught);
    const body = [paragraph(message, "auto-attack__refusal")];
    // Smart Repeat attack (astra): explain a stale move offer, without guessing for network errors.
    if (this.movesKey && ["missing", "noRoom"].includes(refusalReason(caught) ?? "")) {
      body.unshift(paragraph("Your yards changed.", "u-muted auto-attack__failure-context"));
    }
    if (missing.length > 0) body.push(missingList(missing));
    // No room in range: the space needed and each yard's room, as the confirm sheet shows them.
    const data = caught instanceof ApiError ? (caught.details?.data as Partial<AutoAttackPlanResponse> | undefined) : undefined;
    if (refusalReason(caught) === "noRoom" && data?.noRoom) body.push(...roomList(data as AutoAttackPlanResponse));
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
    const layout = resultLayout();
    if (layout !== "today") {
      this.resultAs(layout, result);
      return;
    }
    const body: HTMLElement[] = [];
    body.push(
      paragraph(
        result.conquered ? "Conquered!" : `${result.tribe} camp at ${Math.floor(result.damageAfter)}% damage`,
        `attack-end__outcome${result.conquered ? " auto-attack__conquered" : ""}`,
      ),
    );

    const stats = document.createElement("dl");
    stats.className = "attack-end__stats";
    const stat = (label: string, value: string, className = ""): void => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      if (className) dd.className = className;
      stats.append(dt, dd);
    };
    stat(
      "Damage added",
      `+${Math.floor(result.damageAdded)}% (${Math.floor(result.damageBefore)}% → ${Math.floor(result.damageAfter)}%)`,
      "auto-attack__added",
    );
    stat("Camp damage", `${Math.floor(result.damageAfter)}%`);
    stat("Monsters spent", monstersText(result.flung) || "none");
    // Smart Repeat attack: what moved into the yards in range first.
    const moved: Record<string, number> = {};
    for (const move of result.moved ?? [])
      for (const [id, count] of Object.entries(move.monsters)) moved[id] = (moved[id] ?? 0) + count;
    if (Object.keys(moved).length > 0) stat("Moved in first", monstersText(moved));
    for (const champion of result.champions) {
      stat(
        championName(champion.t),
        champion.hp > 0 ? `${formatAmount(Math.floor(champion.hp))} health left` : "fell in the battle",
      );
    }
    if (result.bombs.length > 0) stat("Bombs fired", String(result.bombs.length));
    body.push(stats);

    const loot = document.createElement("ul");
    loot.className = "attack-end__loot";
    loot.setAttribute("aria-label", "Loot kept");
    let spilled = false;
    for (const key of RESOURCE_KEYS) {
      const item = document.createElement("li");
      const amount = result.loot[key];
      item.className = `attack-end__loot-item${amount > 0 ? "" : " attack-end__loot-item--none"}`;
      // Won, so green with a plus, "+1,500" (owner, 28 Oct).
      item.append(resourceAmount(key, amount, { change: "gain", tooltip: false }));
      item.title = `${RESOURCE_NAMES[key]}: ${Math.floor(amount).toLocaleString("en-US")}${amount >= 1 ? " gained" : ""}`;
      if (result.lootLeft[key] > 0) spilled = true;
      loot.append(item);
    }
    body.push(loot);
    if (spilled) body.push(paragraph("Your storage was full, so some loot was left behind.", "u-muted attack-end__storage"));
    if (result.damageAdded < 2 && !result.conquered) {
      body.push(
        paragraph(
          "This attack has stopped working here. Attack by hand to try new drop points.",
          "auto-attack__stalled",
        ),
      );
    }

    // Only Watch and Close (owner, 15 Nov 2026): no Repeat again here.
    const watch = buttonOf("Watch", "btn btn--ghost auto-attack__watch", () => void this.watch());
    const close = buttonOf("Close", "btn btn--primary auto-attack__close", () => this.close());
    this.show("Auto-attack result", `auto-attack--result${result.conquered ? " attack-end--win" : ""}`, body, [
      watch,
      close,
    ]);

    if (result.conquered && this.open) {
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
      });
      this.open.panel.body.querySelector(".attack-end__actions")?.before(this.offer.element);
    }
  }

  /** One of astra's proposals for the result (owner picks on the Review Desk). */
  private resultAs(layout: Exclude<ResultLayout, "today">, result: AutoAttackResponse): void {
    const view = resultView(layout, result);
    const watch = buttonOf("Watch", "btn auto-attack__watch", () => void this.watch());
    const close = buttonOf("Close", "btn btn--primary auto-attack__close", () => this.close());
    this.show(
      "Attack result",
      `auto-attack--result auto-attack--rv auto-attack--rv-${layout}${view.wide ? " auto-attack--rv-wide" : ""}${
        result.conquered ? " attack-end--win" : ""
      }`,
      [view.head, ...view.middle],
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
