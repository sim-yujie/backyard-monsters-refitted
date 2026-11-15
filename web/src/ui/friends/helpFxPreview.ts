import type { HelpAllSummary } from "@/game/friends/helpAll";
import { savedText } from "@/game/friends/helpModel";
import { formatDelta } from "../Hud";
import { gameIcon } from "../gameIcon";
import { resourceIcon, type ResourceKey } from "../resourceIcon";
import type { HelpAllLine } from "./HelpAllBar";
import type { HelpAllFx, HelpAllFxMaker, HelpFxStage, HelpFxStep } from "./helpAllFx";
import { make } from "./rows";
import "./help-fx-preview.css";

/**
 * PREVIEW ONLY (beta 8, 15 Nov 2026): the three Help all effects from Codex
 * astra's review (archive/help-fx-astra), for the owner to pick from with
 * `?helpFx=a|b|c` in a dev build. Delete this file, its CSS and the switch in
 * `helpAllFx.ts` once one is chosen (the chosen one moves into its own file).
 *
 * - **A, help lands:** each wrench pops in turn where it stands, its "-2h 23m"
 *   rising off the building; then the four counters count up with one total
 *   each in a lane under them; the bar shows the tools, a tick and "3".
 * - **B, reward delivery:** each wrench flashes out in turn and its building
 *   throws the four painted resources up to their counters, which light and
 *   count up as each lands; one total each under them at the end.
 * - **C, receipt:** the wrenches fade as their helps land; the bar shows
 *   tools-tick-3, the hourglass and the time saved, the four resources and
 *   the amount, for 1.4 s; the counters count up with no floats.
 */

export type HelpFxChoice = "a" | "b" | "c";

/** `?helpFx=a|b|c`, or null. */
export const helpFxChoice = (search: string): HelpFxChoice | null => {
  const asked = new URLSearchParams(search).get("helpFx")?.trim().toLowerCase();
  return asked === "a" || asked === "b" || asked === "c" ? asked : null;
};

const KEYS = ["r1", "r2", "r3", "r4"] as const satisfies readonly ResourceKey[];

/** Time between one building's effect and the next, so each reads on its own. */
const STAGGER_MS: Readonly<Record<HelpFxChoice, number>> = { a: 240, b: 200, c: 110 };

/** The bar's line after: tools, a tick and the count; for A and B. */
const doneMark = (helped: number): HTMLElement => {
  const node = make("span", "help-fx-done");
  node.append(
    gameIcon("tools", { size: 24, decorative: true, className: "help-fx-done__tools" }),
    make("span", "help-fx-done__tick", "✔"),
    make("span", "help-fx-done__count", String(helped)),
  );
  return node;
};

/** C's receipt: tools-tick-3 · hourglass -8h 36m · the four resources +172.8K. */
const receipt = (summary: HelpAllSummary): HTMLElement => {
  const node = make("span", "help-fx-receipt");
  node.append(doneMark(summary.helped));
  if (summary.secondsSaved > 0) {
    const time = make("span", "help-fx-receipt__part");
    time.append(gameIcon("time", { size: 24, decorative: true }), make("span", "help-fx-receipt__time", `-${savedText(summary.secondsSaved)}`));
    node.append(time);
  }
  const amounts = KEYS.map((key) => [key, Math.max(0, Math.floor(summary.reward[key] ?? 0))] as const).filter(
    ([, amount]) => amount > 0,
  );
  if (amounts.length > 0) {
    const reward = make("span", "help-fx-receipt__part");
    const same = amounts.every(([, amount]) => amount === amounts[0]![1]);
    if (same) {
      const pile = make("span", "help-fx-receipt__pile");
      for (const [key] of amounts) pile.append(resourceIcon(key, { decorative: true }));
      reward.append(pile, make("span", "help-fx-receipt__gain", formatDelta(amounts[0]![1])));
    } else {
      for (const [key, amount] of amounts) {
        reward.append(resourceIcon(key, { decorative: true }), make("span", "help-fx-receipt__gain", formatDelta(amount)));
      }
    }
    node.append(reward);
  }
  return node;
};

class PreviewFx implements HelpAllFx {
  private total = 0;
  private played = 0;
  /** When the next building's effect may start (performance.now()). */
  private nextAt = 0;
  /** Each building's effect, chained so they play one after another. */
  private chain: Promise<void> = Promise.resolve();
  private cancelled = false;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly flyers = new Set<HTMLElement>();
  private readonly owed: Record<string, number> = {};
  private readonly totals: Record<string, number> = {};

  constructor(
    private readonly choice: HelpFxChoice,
    private readonly stage: HelpFxStage,
  ) {}

  start(ids: readonly number[]): void {
    this.total = ids.length;
    this.stage.marks.hold(ids);
    this.stage.bar.setProgress(0, this.total);
    this.nextAt = performance.now();
  }

  helped(step: HelpFxStep): void {
    for (const key of KEYS) {
      const amount = Math.max(0, step.reward[key] ?? 0);
      this.totals[key] = (this.totals[key] ?? 0) + amount;
    }
    this.queue(() => this.play(step));
  }

  missed(id: number): void {
    this.queue(() => {
      this.stage.marks.leave(id);
      this.count();
    });
  }

  async done(summary: HelpAllSummary, line: HelpAllLine): Promise<HelpAllLine | null> {
    await this.chain;
    if (this.cancelled) return null;
    const { stage } = this;
    if (this.choice === "a") {
      // The last pop reads first; then the counters.
      await this.after(280);
      this.deliverAll(420, true);
    } else if (this.choice === "b") {
      // The last flight lands; one total each under the counters.
      await this.after(stage.reducedMotion ? 0 : 760);
      for (const key of KEYS) if ((this.totals[key] ?? 0) > 0) stage.hud.floatBelow(key, Math.floor(this.totals[key]!));
    } else {
      this.deliverAll(420, false);
    }
    if (this.cancelled) return null;
    // A help the run never reached (a stop, or one passed over) keeps no wrench held.
    stage.marks.release();
    // A stop keeps its words: the scene's line, as before.
    if (summary.stoppedBy) return null;
    if (summary.helped === 0) return null;
    if (this.choice === "c") return { ...line, node: receipt(summary), ms: 1600 };
    return { ...line, node: doneMark(summary.helped), ms: 1100 };
  }

  cancel(): void {
    this.cancelled = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    for (const flyer of this.flyers) flyer.remove();
    this.flyers.clear();
    this.stage.hud.releaseHeld();
    this.stage.marks.release();
  }

  /** Runs `effect` once the one before has had its turn. */
  private queue(effect: () => void): void {
    this.chain = this.chain.then(async () => {
      if (this.cancelled) return;
      const gap = this.nextAt - performance.now();
      if (gap > 0) await this.after(gap);
      if (this.cancelled) return;
      effect();
      this.nextAt = performance.now() + STAGGER_MS[this.choice];
    });
  }

  private after(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.add(timer);
    });
  }

  private count(): void {
    this.played += 1;
    this.stage.bar.setProgress(this.played, this.total);
  }

  private play(step: HelpFxStep): void {
    const { stage } = this;
    this.count();
    if (this.choice === "a") {
      stage.marks.leave(step.id, "pop");
      this.owe(step);
      return;
    }
    if (this.choice === "c") {
      stage.marks.leave(step.id, "fade");
      this.owe(step);
      return;
    }
    // B: the wrench flashes out and the building throws its reward to the top bar.
    const from = stage.wrenchAt(step.id) ?? this.barTools();
    stage.marks.leave(step.id, "flash");
    KEYS.forEach((key, index) => {
      const amount = Math.max(0, step.reward[key] ?? 0);
      if (amount <= 0) return;
      if (stage.reducedMotion || !from) {
        stage.hud.deliver(key, amount, 250);
        stage.hud.pulse(key);
        return;
      }
      this.fly(key, from, index * 60, () => {
        stage.hud.deliver(key, amount, 250);
        stage.hud.pulse(key);
      });
    });
  }

  /** A help's reward waits to be counted in at the end (A and C). */
  private owe(step: HelpFxStep): void {
    for (const key of KEYS) this.owed[key] = (this.owed[key] ?? 0) + Math.max(0, step.reward[key] ?? 0);
  }

  /** Counts every owed reward in at once, over `ms`, with one total under each counter if `floats`. */
  private deliverAll(ms: number, floats: boolean): void {
    for (const key of KEYS) {
      const amount = this.owed[key] ?? 0;
      if (amount <= 0) continue;
      this.owed[key] = 0;
      this.stage.hud.deliver(key, amount, this.stage.reducedMotion ? 0 : ms);
      this.stage.hud.pulse(key);
      if (floats) this.stage.hud.floatBelow(key, Math.floor(amount));
    }
  }

  /** The bar's tools picture on the screen: where an off-screen building's reward starts. */
  private barTools(): { x: number; y: number } | null {
    const icon = this.stage.bar.element.querySelector(".help-all-bar__icon") ?? this.stage.bar.element;
    const box = icon.getBoundingClientRect();
    return box.width > 0 ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  }

  /**
   * One painted resource from `from` to its counter: it pops up off the
   * building (140 ms), then arcs to the counter (460 ms, speeding up), and
   * shrinks into it; `land` runs as it arrives.
   */
  private fly(key: ResourceKey, from: { x: number; y: number }, delay: number, land: () => void): void {
    const to = this.stage.hud.readoutBox(key);
    if (!to) {
      land();
      return;
    }
    const flyer = make("span", "help-fx-flyer");
    flyer.append(resourceIcon(key, { decorative: true }));
    flyer.style.left = `${from.x}px`;
    flyer.style.top = `${from.y}px`;
    flyer.style.opacity = "0";
    document.body.append(flyer);
    this.flyers.add(flyer);
    const dx = to.left + to.width / 2 - from.x;
    const dy = to.top + to.height / 2 - from.y;
    // A little spread so the four do not stack: each starts a touch to its own side.
    const spread = (KEYS.indexOf(key as (typeof KEYS)[number]) - 1.5) * 14;
    const animation = flyer.animate(
      [
        { transform: "translate(-50%, -50%) scale(0.3)", opacity: 0, offset: 0 },
        { transform: `translate(calc(-50% + ${spread}px), calc(-50% - 30px)) scale(1.15)`, opacity: 1, offset: 0.23 },
        {
          transform: `translate(calc(-50% + ${spread + dx * 0.35}px), calc(-50% + ${dy * 0.55 - 40}px)) scale(1)`,
          opacity: 1,
          offset: 0.6,
        },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.55)`, opacity: 0.9, offset: 1 },
      ],
      { duration: 600, delay, easing: "cubic-bezier(0.45, 0, 0.8, 0.6)", fill: "forwards" },
    );
    const finish = (): void => {
      if (!this.flyers.has(flyer)) return;
      this.flyers.delete(flyer);
      flyer.remove();
      if (!this.cancelled) land();
    };
    animation.addEventListener("finish", finish, { once: true });
    // A tab in the background runs no animations: land it anyway.
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      finish();
    }, delay + 900);
    this.timers.add(timer);
  }
}

/** The preview's effect for `?helpFx`, or null without it. */
export const previewFxMaker = (search: string): HelpAllFxMaker | null => {
  const choice = helpFxChoice(search);
  if (!choice) return null;
  return (stage) => new PreviewFx(choice, stage);
};
