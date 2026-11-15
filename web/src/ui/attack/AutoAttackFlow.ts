import {
  getAutoAttackPlan,
  getAutoAttackReplay,
  runAutoAttack,
  type AutoAttackPlanResponse,
  type AutoAttackReplayResponse,
  type AutoAttackResponse,
  type PlanShortfall,
} from "@/api/autoAttack";
import { declineTakeover, getTakeoverQuote, takeOverCell, type TakeoverPayment } from "@/api/maproom";
import type { TakeoverQuoteResponse } from "@/api/types";
import type { WatchRun } from "@/game/autoAttack/watchRun";
import type { OffsetCell } from "@/game/HexGrid";
import { championName } from "@/ui/attack/ArmyPanel";
import { EndTakeoverOffer } from "@/ui/attack/EndTakeoverOffer";
import { formatAmount } from "@/ui/format";
import { Panel } from "@/ui/Panel";
import { RESOURCE_KEYS, RESOURCE_NAMES, resourceAmount } from "@/ui/resourceIcon";
import {
  SIEGE_NOT_REPEATED,
  autoAttackErrorText,
  campText,
  includesText,
  monstersText,
  planSourceText,
  repeatRefusal,
  shortfallText,
} from "./autoAttackText";
import { RepeatBar } from "./RepeatBar";
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
  readonly run: (baseid: string) => Promise<AutoAttackResponse>;
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
  // The working bar's sheet is small on a phone too (attack.css), not the whole screen.
  backdrop.className = `popup-backdrop attack-end__backdrop${
    className.includes("auto-attack--bar") ? " auto-attack__backdrop--bar" : ""
  }`;
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
const missingList = (missing: readonly PlanShortfall[]): HTMLElement => {
  const list = document.createElement("ul");
  list.className = "auto-attack__missing";
  list.setAttribute("aria-label", "What is missing");
  for (const item of missing) {
    const row = document.createElement("li");
    row.textContent = shortfallText(item);
    list.append(row);
  }
  return list;
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
    this.open?.panel.close();
    this.open?.backdrop.remove();
    this.open = null;
    this.options.onClose?.();
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
      view.panel.setContent(...body, row);
    } else {
      view.panel.setContent(...body);
    }
    this.options.modal.append(view.backdrop);
    this.open = view;
    (actions.find((one) => one.classList.contains("btn--primary") && !one.disabled) ?? actions[0])?.focus();
  }

  private confirm(answer: AutoAttackPlanResponse): void {
    const plan = answer.plan;
    this.plan = plan;
    if (!plan) {
      this.show("Repeat attack", "auto-attack--confirm", [paragraph("You have no attack to repeat on this camp yet.")], [
        buttonOf("Close", "btn btn--primary", () => this.close()),
      ]);
      return;
    }

    const refusal = repeatRefusal(answer);
    const body: HTMLElement[] = [
      paragraph(`${campText(plan)} · camp damage now ${Math.floor(answer.damage)}%`, "attack-end__outcome"),
      paragraph(planSourceText(plan, this.options.baseid, this.now()), "u-muted"),
      paragraph(monstersText(plan.monsters), "auto-attack__army"),
    ];
    const includes = includesText(plan);
    if (includes) body.push(paragraph(includes, "auto-attack__includes"));
    if (plan.siege) body.push(paragraph(SIEGE_NOT_REPEATED, "u-muted auto-attack__siege"));
    if (refusal) {
      body.push(paragraph(refusal, "auto-attack__refusal"));
      if (answer.missing.length > 0) body.push(missingList(answer.missing));
    } else {
      body.push(paragraph("The monsters are spent, as in an attack by hand. The result comes in a few seconds.", "u-muted"));
    }

    const attack = buttonOf("Attack now", "btn btn--primary auto-attack__go", () => void this.run());
    attack.disabled = refusal !== null;
    this.show("Repeat attack", "auto-attack--confirm", body, [
      buttonOf("Cancel", "btn btn--ghost auto-attack__cancel", () => this.close()),
      attack,
    ]);
  }

  private async run(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    if (!this.options.progressBar) {
      this.show("Repeat attack", "auto-attack--running", [paragraph("Your monsters are attacking…", "u-muted")], []);
      try {
        const result = await this.calls.run(this.options.baseid);
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
      const result = await atLeast(this.calls.run(this.options.baseid), REPEAT_BAR_MIN_MS, timers, bar.started);
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
    const { message, missing } = autoAttackErrorText(caught);
    const body = [paragraph(message, "auto-attack__refusal")];
    if (missing.length > 0) body.push(missingList(missing));
    this.show("Repeat attack", "auto-attack--failed", body, [
      buttonOf("Close", "btn btn--primary", () => this.close()),
    ]);
  }

  private result(result: AutoAttackResponse): void {
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
