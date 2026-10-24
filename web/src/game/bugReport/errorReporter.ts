import { getAuthToken } from "@/api/http";
import { sendClientErrors, type ClientErrorItem, type ClientErrorSendResult } from "@/api/clientErrors";
import { LATEST_RELEASE } from "@/data/changelog";
import { currentScreenName } from "./screenCapture";

/**
 * Sends the game's uncaught errors and unhandled promise rejections to the
 * server on its own, for the owner's dashboard (`api/clientErrors.ts`; the
 * Privacy Policy says so). Unlike the bug report's list (`errorLog.ts`) it
 * leaves out `console.error` lines, and it sends only the error's words,
 * where in the game's code it happened, the game version and the screen;
 * the server adds the account number when signed in and cleans out anything
 * personal before keeping it.
 *
 * Kept small on purpose:
 * - noise is skipped: browser extensions' errors, the browser's
 *   "Script error." for other sites' scripts, and ResizeObserver's warnings;
 * - the same error is counted, not sent again;
 * - a batch holds at most {@link BATCH_MAX} kinds and goes at most once per
 *   {@link SEND_GAP_MS}, a few seconds after the first error so a burst goes
 *   as one;
 * - after {@link BATCHES_MAX} batches, or once the server says to stop
 *   (too many, or not signed in any more), nothing more is sent until the
 *   page is loaded again.
 */

export const BATCH_MAX = 10;
export const SEND_GAP_MS = 30_000;
export const FIRST_SEND_DELAY_MS = 5_000;
export const BATCHES_MAX = 5;
/** Kinds waiting at once; more are dropped. */
const PENDING_MAX = 30;
const MESSAGE_MAX = 1000;
const PLACE_MAX = 400;
const STACK_MAX = 4000;
const STACK_LINES = 10;

const EXTENSION_URL = /\b(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;
const NOISE = [/^Script error\.?$/i, /ResizeObserver loop/i];

export interface ErrorReporterDeps {
  readonly send: (batch: Parameters<typeof sendClientErrors>[0], signedIn: boolean) => Promise<ClientErrorSendResult>;
  readonly signedIn: () => boolean;
  readonly context: () => { gameVersion: string; screen: string };
  readonly now: () => number;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

const defaultDeps: ErrorReporterDeps = {
  send: sendClientErrors,
  signedIn: () => getAuthToken() !== null,
  context: () => ({ gameVersion: LATEST_RELEASE?.version ?? "", screen: currentScreenName() }),
  now: () => Date.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
};

const clip = (text: string, max: number): string => (text.length > max ? text.slice(0, max) : text);

/** The top of an error's stack, or "" for something that is not an error. */
const stackOf = (value: unknown): string =>
  value instanceof Error && value.stack ? value.stack.split("\n").slice(0, STACK_LINES).join("\n") : "";

const messageOf = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** Whether an error is someone else's (an extension, another site) or a harmless browser warning. */
export const isNoise = (message: string, place: string, stack: string): boolean =>
  message.trim() === "" || NOISE.some((pattern) => pattern.test(message.trim())) || EXTENSION_URL.test(place) || EXTENSION_URL.test(stack);

let uninstall: (() => void) | null = null;

/**
 * Starts listening (once; a second call does nothing). Returns the function
 * that stops it, dropping anything not yet sent.
 */
export const installErrorReporter = (target: Window = window, overrides: Partial<ErrorReporterDeps> = {}): (() => void) => {
  if (uninstall) return uninstall;
  const deps = { ...defaultDeps, ...overrides };

  const pending = new Map<string, ClientErrorItem & { count: number }>();
  let batchesSent = 0;
  let stopped = false;
  let sending = false;
  let lastSentAt = -Infinity;
  let timer: unknown = null;

  const schedule = (): void => {
    if (timer !== null || sending || stopped || pending.size === 0) return;
    const wait = Math.max(FIRST_SEND_DELAY_MS, lastSentAt + SEND_GAP_MS - deps.now());
    timer = deps.setTimer(() => {
      timer = null;
      void flush();
    }, wait);
  };

  const flush = async (): Promise<void> => {
    if (stopped || sending || pending.size === 0) return;
    const keys = [...pending.keys()].slice(0, BATCH_MAX);
    const errors = keys.map((key) => ({ ...pending.get(key)! }));
    for (const key of keys) pending.delete(key);
    sending = true;
    lastSentAt = deps.now();
    batchesSent += 1;
    let result: ClientErrorSendResult = "failed";
    try {
      result = await deps.send({ errors, ...deps.context() }, deps.signedIn());
    } catch {
      result = "failed";
    }
    sending = false;
    if (result === "stop" || batchesSent >= BATCHES_MAX) {
      stopped = true;
      pending.clear();
      return;
    }
    schedule();
  };

  const add = (kind: ClientErrorItem["kind"], message: string, place: string, stack: string): void => {
    if (stopped) return;
    try {
      if (isNoise(message, place, stack)) return;
      const item = { kind, message: clip(message, MESSAGE_MAX), place: clip(place, PLACE_MAX), stack: clip(stack, STACK_MAX), count: 1 };
      const key = `${kind}\n${item.message}\n${item.place}`;
      const known = pending.get(key);
      if (known) known.count += 1;
      else if (pending.size < PENDING_MAX) pending.set(key, item);
      schedule();
    } catch {
      // Reporting an error must never become one.
    }
  };

  const onError = (event: ErrorEvent): void => {
    const place = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "";
    add("error", event.error ? messageOf(event.error) : event.message || "", place, stackOf(event.error));
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    add("rejection", messageOf(event.reason), "", stackOf(event.reason));
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);

  uninstall = () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    stopped = true;
    uninstall = null;
  };
  return uninstall;
};
