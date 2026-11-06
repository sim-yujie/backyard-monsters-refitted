import { AsyncLocalStorage } from "node:async_hooks";
import type { LogRecord } from "@logtape/logtape";

import { cleanMessage, cleanPlace, cleanStack, errorFingerprint } from "../services/errors/errorText.js";

/**
 * The logger's error catcher (`utils/logger.ts`): every `error` or `fatal`
 * record is kept in memory, one entry per kind ({@link errorFingerprint}),
 * until the server's flush (`services/errors/errorStore.ts`) moves them into
 * `bym.app_error` for the dashboard. Nothing here touches the database, so a
 * failing database cannot make logging fail, and the flush's own complaints
 * are warnings, which this never catches.
 *
 * At most {@link PENDING_MAX} kinds wait at once; past that, further kinds
 * are only counted ({@link takeCapturedErrors}'s `dropped`).
 *
 * An error logged while a request is handled also keeps who sent it
 * ({@link errorRequestScope}): the signed-in account read from the request's
 * login token (`middleware/auth.ts` sets `ctx.authUser`) and the address
 * `middleware/clientIp.ts` trusts, never anything from the request's body.
 */

export const PENDING_MAX = 200;

/** Senders kept per kind of error, most recent first. */
export const REPORTERS_KEPT = 5;

/** Who hit an error: their account when signed in, and their address. */
export interface ErrorReporter {
  readonly userid: number | null;
  readonly username: string;
  readonly ip: string;
  readonly at: Date;
}

/** What a captured error reads from its request; the request's own Koa context fits. */
export interface RequestWho {
  readonly ip?: string;
  readonly authUser?: { readonly userid: number; readonly username: string } | null;
}

/** The request being handled, so an error caught during it can name its sender. */
const requests = new AsyncLocalStorage<RequestWho>();

/**
 * Koa middleware (`server.ts`, right after `clientIp`): an error logged while
 * the rest of the request runs finds the request here. It keeps the context
 * itself, so the account `verifyUserAuth` sets later is seen too.
 */
export const errorRequestScope = <T>(ctx: RequestWho, next: () => Promise<T>): Promise<T> => requests.run(ctx, next);

/** The sender of the request being handled, or null outside a request or with nothing known. */
export const currentReporter = (at: Date): ErrorReporter | null => {
  const who = requests.getStore();
  if (!who) return null;
  const user = who.authUser ?? null;
  const ip = typeof who.ip === "string" ? who.ip : "";
  if (!user && !ip) return null;
  return { userid: user ? user.userid : null, username: user ? user.username : "", ip, at };
};

/**
 * The senders with `reporter` added first: one per account and address, the
 * most recent {@link REPORTERS_KEPT}.
 */
export const withReporter = (reporters: readonly ErrorReporter[], reporter: ErrorReporter | null): ErrorReporter[] => {
  if (!reporter) return [...reporters];
  const others = reporters.filter((r) => r.userid !== reporter.userid || r.ip !== reporter.ip);
  return [reporter, ...others].slice(0, REPORTERS_KEPT);
};

export interface CapturedError {
  readonly fingerprint: string;
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  count: number;
  /** When it was last seen, in ms. */
  at: number;
  /** Who hit it, most recent first ({@link REPORTERS_KEPT} at most). */
  reporters: ErrorReporter[];
}

const pending = new Map<string, CapturedError>();
let dropped = 0;

const describe = (value: unknown): string => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** The record's message with its values filled in. */
const rendered = (record: LogRecord): string =>
  record.message.map((part, index) => (index % 2 === 0 ? String(part) : describe(part))).join("");

const firstStack = (record: LogRecord): string => {
  for (const value of [...record.message, ...Object.values(record.properties)]) {
    if (value instanceof Error && value.stack) return value.stack;
  }
  return "";
};

const placeOf = (record: LogRecord): string => {
  const { method, path } = record.properties as { method?: unknown; path?: unknown };
  if (typeof path === "string") return typeof method === "string" ? `${method} ${path}` : path;
  return record.category.join(".");
};

/** The sink itself: keeps error and fatal records, ignores the rest. Never throws. */
export const errorCaptureSink = (record: LogRecord): void => {
  if (record.level !== "error" && record.level !== "fatal") return;
  try {
    const message = cleanMessage(rendered(record));
    const place = cleanPlace(placeOf(record));
    const fingerprint = errorFingerprint("server", message, place);
    const reporter = currentReporter(new Date(record.timestamp));
    const known = pending.get(fingerprint);
    if (known) {
      known.count += 1;
      known.at = record.timestamp;
      known.reporters = withReporter(known.reporters, reporter);
      return;
    }
    if (pending.size >= PENDING_MAX) {
      dropped += 1;
      return;
    }
    pending.set(fingerprint, {
      fingerprint,
      message,
      place,
      stack: cleanStack(firstStack(record)),
      count: 1,
      at: record.timestamp,
      reporters: withReporter([], reporter),
    });
  } catch {
    // Catching an error must never become one.
  }
};

/** Everything caught since the last call, and how many were dropped for room; both start again empty. */
export const takeCapturedErrors = (): { entries: CapturedError[]; dropped: number } => {
  const entries = [...pending.values()];
  const lost = dropped;
  pending.clear();
  dropped = 0;
  return { entries, dropped: lost };
};
