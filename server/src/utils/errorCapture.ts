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
 */

export const PENDING_MAX = 200;

export interface CapturedError {
  readonly fingerprint: string;
  readonly message: string;
  readonly place: string;
  readonly stack: string;
  count: number;
  /** When it was last seen, in ms. */
  at: number;
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
    const known = pending.get(fingerprint);
    if (known) {
      known.count += 1;
      known.at = record.timestamp;
      return;
    }
    if (pending.size >= PENDING_MAX) {
      dropped += 1;
      return;
    }
    pending.set(fingerprint, { fingerprint, message, place, stack: cleanStack(firstStack(record)), count: 1, at: record.timestamp });
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
