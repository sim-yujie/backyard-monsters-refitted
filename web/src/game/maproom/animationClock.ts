/**
 * The map's one animation clock (MR2 plan step 10). The water, the border pulse, the painted fog's
 * drift and the live layer (cloud shadows, gulls) each step at their own rate, and each step makes a
 * tilted map redraw its whole picture (`TiltView`). Stepping on their own clocks, a still map on High
 * redrew about 50 times a second; stepping on whole ticks of one shared clock, every timer's step
 * falls on a tick another timer also uses, so a still map redraws at most once a tick (30 a second
 * with gulls and cloud shadows in sight, 10 with only water, pulse and fog).
 *
 * Steps are counted in whole ticks from the page's time origin, never from a layer's own start, so
 * two timers stepping every 3 ticks always step on the same frame.
 */

/** The clock's ticks a second; every timer steps every whole number of ticks. */
export const TICKS_PER_SECOND = 30;

/** The tick `nowMs` (performance.now()) falls in. */
export const tickAt = (nowMs: number): number => Math.floor((nowMs * TICKS_PER_SECOND) / 1000);

/** The step `nowMs` falls in, for a timer stepping every `every` ticks. */
export const stepAt = (nowMs: number, every: number): number => Math.floor(tickAt(nowMs) / every);

/**
 * Seconds from `startMs` to `nowMs`, both rounded down to the timer's whole steps on the shared
 * clock: the value changes only on a step, and on the same frame for every timer with that step.
 */
export const steppedSeconds = (nowMs: number, startMs: number, every: number): number =>
  ((stepAt(nowMs, every) - stepAt(startMs, every)) * every) / TICKS_PER_SECOND;
