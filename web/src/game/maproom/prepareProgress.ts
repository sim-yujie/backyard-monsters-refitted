import type { Quality } from "@/game/quality";
import type { ProgramSource } from "./painted/shaderWarmup";

/**
 * The "Preparing map" loading screen's numbers (owner, 7 Nov 2026: Firefox's first open takes ~17 s to the
 * full painted look, since it cannot compile the shaders ahead in the yard; "a progress bar can come
 * later"). The map shows its plain tiles meanwhile, so the bar only tells the player that the look is
 * still coming, and how far along it is.
 *
 * Progress is the share of the look's programs that have compiled, each weighted by how long it
 * usually takes (the ground's High program is most of the wait), and the one compiling now counts
 * part-way by how long it has run. Only programs still to compile when the map opened count, so a
 * map whose programs are all ready (Chrome after the yard's warm-up, a second open) has nothing to
 * show. Pure: the map passes in its warmer (`shaderWarmup.ts`) and the clock.
 */

/** What the bar reads from the warmer (`ProgramWarmer`). */
export interface WarmerView {
  ready(source: ProgramSource): boolean;
  failed(source: ProgramSource): boolean;
  startedAt(source: ProgramSource): number | null;
}

/** One program the full look needs. */
export interface NeededProgram {
  /** A short stable name ("ground-high", "borders"): the sources are ~60 kB of text. */
  readonly key: string;
  readonly source: ProgramSource;
  /** About how long it takes to compile where it is slow (Firefox, Windows), in ms. */
  readonly expectMs: number;
}

/**
 * About how long each program takes to compile in Firefox on Windows (owner's RTX 3070, 4-7 Nov 2026:
 * ground Low ~4 s, High 12-23 s; the small ones well under a second). Only the proportions matter.
 */
export const EXPECT_MS = {
  ground: { low: 4_000, medium: 8_000, high: 12_000 } satisfies Record<Quality, number>,
  small: 400,
} as const;

/** A program part-way through counts at most this share of itself, so the bar never sits at 100%. */
export const RUNNING_CAP = 0.95;

/** The share of one program done: 1 once settled, else part-way by how long it has compiled. */
export const programShare = (view: WarmerView, program: NeededProgram, now: number): number => {
  if (view.ready(program.source) || view.failed(program.source)) return 1;
  const started = view.startedAt(program.source);
  if (started === null) return 0;
  const run = Math.max(0, now - started) / Math.max(1, program.expectMs);
  // Fast at first, then slower and slower, never reaching the cap: compile times vary a lot.
  return RUNNING_CAP * (1 - Math.exp(-1.5 * run));
};

/**
 * Follows one map open's programs. The first {@link update} takes the needed programs that are not
 * ready yet; later ones add any new one (a Quality changed meanwhile). The percent never goes back.
 */
export class PrepareTracker {
  private readonly programs = new Map<string, NeededProgram>();
  private started = false;
  private best = 0;

  constructor(private readonly view: WarmerView) {}

  /** Looks at what the full look needs now. */
  update(needed: readonly NeededProgram[]): void {
    for (const program of needed) {
      if (this.programs.has(program.key)) continue;
      if (this.view.ready(program.source) || this.view.failed(program.source)) continue;
      this.programs.set(program.key, program);
    }
    this.started = true;
  }

  /** Whether {@link update} has run (the look's code has arrived). */
  get tracking(): boolean {
    return this.started;
  }

  /** Whether anything was still to compile: if not, the bar never shows. */
  get hadWork(): boolean {
    return this.programs.size > 0;
  }

  /** How far along, 0-100, whole numbers, never lower than before. */
  percent(now: number): number {
    let total = 0;
    let done = 0;
    for (const program of this.programs.values()) {
      total += program.expectMs;
      done += program.expectMs * programShare(this.view, program, now);
    }
    const share = total > 0 ? done / total : 1;
    this.best = Math.max(this.best, Math.min(100, Math.floor(share * 100)));
    return this.best;
  }
}

/* ── When it shows ───────────────────────────────────────────────────────── */

/**
 * The map's loading screen ("Preparing map", owner chose design A, 8 Nov 2026) covers the map from
 * the open until the full look is in, so the plain tiles are never seen on a first open.
 */
export interface PrepareFacts {
  readonly classic: boolean;
  /** The painted look is switched on for this map (the server's flag, not Classic). */
  readonly paintedWanted: boolean;
  /** The look could not be prepared here (no WebGL2, the code did not arrive, a shader failed). */
  readonly failed: boolean;
  /** The ground draws the player's own Quality: the full look is in. */
  readonly fullLook: boolean;
  /** {@link PrepareTracker.hadWork}. */
  readonly hadWork: boolean;
}

/** Whether the loading screen shows now, once the look's code has arrived and its programs are known. */
export const prepareShows = (facts: PrepareFacts): boolean =>
  !facts.classic && facts.paintedWanted && !facts.failed && !facts.fullLook && facts.hadWork;

/** Before the look's code has arrived: what decides whether to cover the map already. */
export interface PendingFacts {
  readonly classic: boolean;
  readonly paintedWanted: boolean;
  readonly failed: boolean;
  /** The renderer can draw the painted look at all (WebGL2). */
  readonly webGL2: boolean;
  /** The full look came in earlier on this page ({@link preparedThisPage}): its programs are kept. */
  readonly preparedBefore: boolean;
  /** The yard's warm-up compiled everything already (`mr2Prewarm.ts`, Chrome and Edge). */
  readonly warmedUp: boolean;
  /** Since the map first asked (its open), in ms. */
  readonly waitedMs: number;
}

/**
 * The cover waits this long for the look's code before showing: where it is already loaded (a later
 * open, Chrome's warm-up) the answer comes sooner, so the screen never flickers; the map's own tiles
 * need longer than this to arrive, so a first open still never shows them.
 */
export const PENDING_DELAY_MS = 150;

/**
 * While the look's code is still on its way: cover the map (0%) unless it is surely ready already,
 * so a first open never shows the plain tiles.
 */
export const pendingShows = (facts: PendingFacts): boolean =>
  !facts.classic &&
  facts.paintedWanted &&
  !facts.failed &&
  facts.webGL2 &&
  !facts.preparedBefore &&
  !facts.warmedUp &&
  facts.waitedMs >= PENDING_DELAY_MS;

/* ── Never stuck ─────────────────────────────────────────────────────────── */

/** With no progress for this long, the loading screen gives up and fades; the map works on as it can. */
export const STALL_MS = 30_000;

/**
 * Watches the shown percent and says when it has stood still for {@link STALL_MS} (a compile that
 * never ends, code that never arrives). Once stalled it stays stalled for this open.
 */
export class StallGuard {
  private best = -1;
  private since: number | null = null;
  private stalled = false;

  constructor(private readonly limitMs: number = STALL_MS) {}

  /** Notes the state shown at `now`; true once it has stalled. */
  check(state: PrepareState, now: number): boolean {
    if (this.stalled) return true;
    if (!state.show) {
      this.since = null;
      return false;
    }
    if (this.since === null || state.percent > this.best) {
      this.best = Math.max(this.best, state.percent);
      this.since = now;
      return false;
    }
    this.stalled = now - this.since >= this.limitMs;
    return this.stalled;
  }
}

/* ── Once a page ─────────────────────────────────────────────────────────── */

let prepared = false;

/** Whether the full look came in on this page: its programs stay compiled, so a later open needs no screen. */
export const preparedThisPage = (): boolean => prepared;

/** Notes that the full look came in on this page. */
export const markPreparedThisPage = (): void => {
  prepared = true;
};

/** Forgets it (tests). */
export const resetPreparedThisPage = (): void => {
  prepared = false;
};

/** What the map tells its loading screen each frame. */
export interface PrepareState {
  readonly show: boolean;
  readonly percent: number;
}

export const HIDDEN: PrepareState = { show: false, percent: 0 };
