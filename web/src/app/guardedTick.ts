/**
 * Keeps the game's clock running when a scene's `update()` throws.
 *
 * Pixi's ticker asks the browser for the next frame only after every
 * listener has returned (`Ticker._tick`), so one uncaught error in the yard,
 * attack or map update would stop all frames for good: a frozen game until
 * the player reloads (audit 2026-10-29, W1). The guard catches the error,
 * reports it and lets the next frame come.
 *
 * Reporting goes through the browser's own `reportError`, which fires the
 * window "error" event the game already listens to: the bug report's list
 * (`game/bugReport/errorLog.ts`) and the owner's dashboard
 * (`game/bugReport/errorReporter.ts`), and the console. A scene that throws
 * every frame would otherwise report 60 times a second, so each distinct
 * message is reported once, and at most {@link GUARD_REPORT_MAX} of them.
 */

/** Distinct errors reported per page load; later ones are only counted. */
export const GUARD_REPORT_MAX = 10;

export interface TickGuard {
  /** The tick to hand to the ticker: runs `tick`, never throws. */
  readonly run: (deltaSeconds: number) => void;
  /** Errors caught so far, reported or not. */
  readonly caught: () => number;
}

/** The browser's `reportError`, or a rethrow on a fresh task where it is missing; both reach the window "error" listeners. */
export const reportToWindow = (error: unknown): void => {
  const report = (globalThis as { reportError?: (error: unknown) => void }).reportError;
  if (typeof report === "function") {
    report(error);
    return;
  }
  setTimeout(() => {
    throw error;
  }, 0);
};

const keyOf = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return String(error);
  } catch {
    return "unknown error";
  }
};

export const guardTick = (tick: (deltaSeconds: number) => void, report: (error: unknown) => void = reportToWindow): TickGuard => {
  const reported = new Set<string>();
  let caught = 0;
  return {
    run: (deltaSeconds) => {
      try {
        tick(deltaSeconds);
      } catch (error) {
        caught += 1;
        const key = keyOf(error);
        if (reported.has(key) || reported.size >= GUARD_REPORT_MAX) return;
        reported.add(key);
        try {
          report(error);
        } catch {
          // Reporting an error must never stop the clock.
        }
      }
    },
    caught: () => caught,
  };
};
