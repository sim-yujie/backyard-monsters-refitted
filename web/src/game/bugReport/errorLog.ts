/**
 * The last few game errors, kept in memory for the bug report form
 * (`ui/bugReport/BugReportDialog.ts`): uncaught errors, unhandled promise
 * rejections and `console.error` calls, newest last. This list goes only
 * with a report the player sends. (Uncaught errors and rejections, without
 * the `console.error` lines, are also sent on their own for the owner's
 * dashboard: `errorReporter.ts`.)
 *
 * `installErrorLog` runs once, first thing in `main.ts`, so errors during
 * start-up are caught too.
 */

/** How many errors are kept (the server keeps the same number). */
export const ERROR_LOG_SIZE = 20;

/** How long one entry may be (the server cuts longer ones). */
export const ERROR_LINE_MAX = 1000;

/** Stack lines kept after an error's message. */
const STACK_LINES = 4;

const entries: string[] = [];

const clip = (text: string): string => (text.length > ERROR_LINE_MAX ? `${text.slice(0, ERROR_LINE_MAX - 1)}…` : text);

/** One value as readable text: an error's name, message and the top of its stack. */
export const describeError = (value: unknown): string => {
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    const stack = (value.stack ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("at ") || line.includes("@"))
      .slice(0, STACK_LINES);
    return [head, ...stack].join(" | ");
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Adds one entry, dropping the oldest past `ERROR_LOG_SIZE`. */
export const recordError = (kind: string, text: string, now: Date = new Date()): void => {
  const time = now.toISOString().slice(11, 19);
  entries.push(clip(`${time} ${kind}: ${text}`));
  if (entries.length > ERROR_LOG_SIZE) entries.splice(0, entries.length - ERROR_LOG_SIZE);
};

/** The errors kept, oldest first. */
export const recentErrors = (): string[] => [...entries];

/** Empties the list (tests). */
export const clearErrorLog = (): void => {
  entries.length = 0;
};

let uninstall: (() => void) | null = null;

/**
 * Starts listening. A second call does nothing; the returned function stops
 * listening and puts `console.error` back.
 */
export const installErrorLog = (target: Window = window, out: Console = console): (() => void) => {
  if (uninstall) return uninstall;

  const onError = (event: ErrorEvent): void => {
    const where = event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : "";
    recordError("error", `${event.error ? describeError(event.error) : event.message}${where}`);
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    recordError("unhandled rejection", describeError(event.reason));
  };

  const original = out.error;
  out.error = (...args: unknown[]): void => {
    try {
      recordError("console.error", args.map(describeError).join(" "));
    } catch {
      // The log must never break the game's own error reporting.
    }
    original.apply(out, args);
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  uninstall = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    out.error = original;
    uninstall = null;
  };
  return uninstall;
};
