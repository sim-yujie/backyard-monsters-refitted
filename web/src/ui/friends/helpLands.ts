import type { HelpAllSummary } from "@/game/friends/helpAll";
import { gameIcon } from "../gameIcon";
import type { ResourceKey } from "../resourceIcon";
import type { HelpAllLine } from "./HelpAllBar";
import type { HelpAllFx, HelpFxStage, HelpFxStep } from "./helpAllFx";
import { make } from "./rows";
import { rewardNode, VISIT_REWARD_MS } from "./visitReward";

/**
 * Help all's effect, "help lands" (beta 8; Codex astra's option A, chosen by
 * the owner on Review Desk 7, 15 Nov 2026):
 *
 * - each helped wrench pops in turn where it stands, its "-2h 23m" rising off
 *   the building, and the bar counts 1/3 .. 3/3 as each one pops;
 * - then the four counters in the top bar count up, with one total each in a
 *   lane under them;
 * - the bar shows the tools, a tick and "3" for {@link HELP_LANDS_DONE_MS},
 *   then goes back to the friend's name.
 *
 * A stop (signed out, a refusal that ends the run) keeps the scene's own
 * words. Reduced motion: the wrenches fade and the counters jump.
 */

const KEYS = ["r1", "r2", "r3", "r4"] as const satisfies readonly ResourceKey[];

/** Time between one wrench's pop and the next, so each reads on its own. */
export const HELP_LANDS_STAGGER_MS = 240;
/** After the last pop, before the counters count up: the last tag reads first. */
export const HELP_LANDS_SETTLE_MS = 280;
/** How long the counters take to count up. */
export const HELP_LANDS_COUNT_MS = 420;
/** How long the bar shows the tools, the tick and the count. */
export const HELP_LANDS_DONE_MS = 1100;

/** The bar's line after: the tools, a green tick and the count. */
export const helpLandsMark = (helped: number): HTMLElement => {
  const node = make("span", "help-all-done");
  node.append(
    gameIcon("tools", { size: 24, decorative: true, className: "help-all-done__tools" }),
    make("span", "help-all-done__tick", "✔"),
    make("span", "help-all-done__count", String(helped)),
  );
  return node;
};

export class HelpLandsFx implements HelpAllFx {
  private total = 0;
  private played = 0;
  /** When the next wrench may pop (performance.now()). */
  private nextAt = 0;
  /** Each wrench's pop, chained so they play one after another. */
  private chain: Promise<void> = Promise.resolve();
  private cancelled = false;
  /** Each wait under way, with what ends it early (a cancel). */
  private readonly timers = new Map<ReturnType<typeof setTimeout>, () => void>();
  /** What the helps so far brought, held back until the counters count up. */
  private readonly owed: Partial<Record<ResourceKey, number>> = {};

  constructor(private readonly stage: HelpFxStage) {}

  start(ids: readonly number[]): void {
    this.total = ids.length;
    this.stage.marks.hold(ids);
    this.stage.bar.setProgress(0, this.total);
    this.nextAt = performance.now();
  }

  helped(step: HelpFxStep): void {
    for (const key of KEYS) this.owed[key] = (this.owed[key] ?? 0) + Math.max(0, step.reward[key] ?? 0);
    this.queue(() => {
      this.count();
      this.stage.marks.leave(step.id, "pop");
    });
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
    // The last pop reads first; then the counters.
    await this.after(HELP_LANDS_SETTLE_MS);
    if (this.cancelled) return null;
    const { reward, reducedMotion } = this.stage;
    const total = this.countIn();
    // A help the run never reached (a stop, or one passed over) keeps no wrench held.
    this.stage.marks.release();
    const countMs = reducedMotion ? 0 : HELP_LANDS_COUNT_MS;
    // A stop keeps its words: the scene's line, as before.
    if (summary.stoppedBy || summary.helped === 0) return null;
    const node = helpLandsMark(summary.helped);
    if (reward !== "bar") return { ...line, node, ms: HELP_LANDS_DONE_MS };
    // No readouts on this yard: the totals show in the bar's own line, after the tools, the tick and the count.
    const earned = rewardNode(total, { countMs });
    if (earned) node.append(earned);
    return { ...line, node, ms: countMs + VISIT_REWARD_MS };
  }

  cancel(): void {
    this.cancelled = true;
    // Every wait ends now, so `done` resolves (with null) rather than hang.
    for (const [timer, resolve] of this.timers) {
      clearTimeout(timer);
      resolve();
    }
    this.timers.clear();
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
      this.nextAt = performance.now() + HELP_LANDS_STAGGER_MS;
    });
  }

  private after(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.timers.delete(timer);
        resolve();
      }, ms);
      this.timers.set(timer, resolve);
    });
  }

  private count(): void {
    this.played += 1;
    this.stage.bar.setProgress(this.played, this.total);
  }

  /**
   * Every held reward counts up in its counter at once, with one total under
   * each; on a yard without readouts they are only added. Gives the totals.
   */
  private countIn(): Partial<Record<ResourceKey, number>> {
    const { hud, reducedMotion, reward } = this.stage;
    const total: Partial<Record<ResourceKey, number>> = {};
    for (const key of KEYS) {
      const amount = this.owed[key] ?? 0;
      if (amount <= 0) continue;
      this.owed[key] = 0;
      total[key] = Math.floor(amount);
      if (reward) {
        hud.deliver(key, amount, 0);
        continue;
      }
      hud.deliver(key, amount, reducedMotion ? 0 : HELP_LANDS_COUNT_MS);
      hud.pulse(key);
      hud.floatBelow(key, Math.floor(amount));
    }
    return total;
  }
}
