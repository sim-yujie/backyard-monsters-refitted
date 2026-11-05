/**
 * Drives a battle the player fights from the wall clock, so the attack does
 * not pause when the tab is hidden (owner, 4 Nov 2026).
 *
 * The scene used to hand the session Pixi's frame delta. Pixi runs on
 * `requestAnimationFrame`, which browsers stop in a hidden tab, and it caps
 * one frame's delta at 100 ms (`Ticker._maxElapsedMS`), so the battle stood
 * still for as long as the tab was in the background and crawled whenever
 * the page dropped under ten frames a second. Neither the original game nor
 * the server works that way:
 *
 * - Flash ran its creeps from `getTimer()`: each frame banked 80 ticks a
 *   second of wall time and ran up to 800 of them, keeping the rest for the
 *   next frame (`client/scripts/GLOBAL.as:1229-1238`), and its countdown
 *   came from a wall-clock `Timer` (`com/computus/model/Timekeeper.as`). A
 *   background tab's slow frames caught up; the attack went on.
 * - The server gives an attack seven minutes of wall time from its start
 *   (`server/src/services/base/attackSession.ts`, `isAttackActive.ts`).
 *   A battle that stood still while hidden ran past that window: its final
 *   save was refused as expired and the server finished it from the last
 *   checkpoint, dropping everything after.
 *
 * So the battle is owed the wall time since it was last run. A frame runs it
 * with a small budget ({@link FRAME_BUDGET_MS}); when frames stop — a hidden
 * tab, a minimised window — a timer runs it instead ({@link pump}), with a
 * larger budget since nothing is drawn. Browsers slow such timers to once a
 * second, and after a few minutes hidden to once a minute; the session keeps
 * whatever a budget leaves and runs it on the next call
 * (`AttackSession.catchUp`), so nothing is lost and the page never freezes.
 *
 * Playbacks (replays, raids) are not driven from here: a replay that waits
 * while the tab is hidden is what a video does, and nothing on the server
 * depends on how long it takes to watch.
 */

/** Engine time one drawn frame may spend catching the battle up, in ms. */
export const FRAME_BUDGET_MS = 8;

/** Engine time one background run may spend, in ms; nothing is drawn meanwhile. */
export const BACKGROUND_BUDGET_MS = 100;

/** How often the background timer looks for stalled frames, in ms. */
export const PUMP_INTERVAL_MS = 1000;

/**
 * Frames further apart than this count as stopped, and the timer runs the
 * battle. Well above a frame, so the timer never competes with drawing.
 */
export const STALL_MS = 250;

/** What the clock runs: `AttackSession.advance`, given real seconds and an engine budget. */
export type AdvanceBattle = (seconds: number, budgetMs: number) => void;

export interface BattleWallClockOptions {
  /** The wall clock, in ms. */
  readonly now?: () => number;
  /** Starts a repeating timer and returns its stop; `window.setInterval` by default. */
  readonly every?: (run: () => void, ms: number) => () => void;
}

const browserEvery = (run: () => void, ms: number): (() => void) => {
  const id = window.setInterval(run, ms);
  return () => window.clearInterval(id);
};

export class BattleWallClock {
  private readonly advance: AdvanceBattle;
  private readonly now: () => number;
  private readonly every: (run: () => void, ms: number) => () => void;
  /** When the battle was last handed its time; null before the first call. */
  private last: number | null = null;
  private stopTimer: (() => void) | null = null;

  constructor(advance: AdvanceBattle, options: BattleWallClockOptions = {}) {
    this.advance = advance;
    this.now = options.now ?? (() => performance.now());
    this.every = options.every ?? browserEvery;
  }

  /** A drawn frame: the battle gets the wall time since it was last run. */
  frame(): void {
    this.advance(this.take(), FRAME_BUDGET_MS);
  }

  /**
   * The background timer's turn: runs the battle only when frames have
   * stopped for {@link STALL_MS}, so a visible tab is driven by its frames alone.
   */
  pump(): void {
    if (this.last !== null && this.now() - this.last < STALL_MS) return;
    this.advance(this.take(), BACKGROUND_BUDGET_MS);
  }

  /** Starts the background timer; a second call does nothing. */
  start(): void {
    if (this.stopTimer) return;
    this.stopTimer = this.every(() => this.pump(), PUMP_INTERVAL_MS);
  }

  /** Stops the background timer and forgets the last reading. */
  stop(): void {
    this.stopTimer?.();
    this.stopTimer = null;
    this.last = null;
  }

  /** Seconds since the last reading, 0 for the first; never negative. */
  private take(): number {
    const now = this.now();
    const seconds = this.last === null ? 0 : Math.max(0, now - this.last) / 1000;
    this.last = now;
    return seconds;
  }
}
