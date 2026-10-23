import { createHash } from "node:crypto";

/**
 * How an error's words are cleaned before they are kept, and how errors of
 * the same kind are told apart (`errorStore.ts`). No imports beyond Node, so
 * the logger's capture sink (`utils/errorCapture.ts`) can use it.
 */

/** Size caps on what is kept of one error. */
export const ERROR_TEXT_LIMITS = {
  messageMax: 500,
  placeMax: 200,
  stackMax: 2000,
} as const;

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The text with anything that could name a person or unlock an account
 * replaced: email addresses, IP addresses, tokens (JWTs, `Bearer ...`) and
 * long hex strings (keys, hashes).
 */
export const scrubText = (text: string): string =>
  text
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [token]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip]")
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, "[ip]")
    .replace(/\b[0-9a-f]{24,}\b/gi, "[hex]");

/** One line: line breaks and runs of spaces become one space. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** A kept message: scrubbed, on one line, cut to size. */
export const cleanMessage = (text: string): string => clip(flat(scrubText(text)), ERROR_TEXT_LIMITS.messageMax) || "(no message)";

/**
 * A kept place: where the error happened (a script and line, or a route),
 * scrubbed, with the page's own address taken off a script's: so
 * `https://play.example.com/static/index-Dh3HKT6K.js:1:2345` keeps
 * `/static/index-Dh3HKT6K.js:1:2345`.
 */
export const cleanPlace = (text: string): string =>
  clip(flat(scrubText(text.replace(/^https?:\/\/[^/\s]+/i, ""))), ERROR_TEXT_LIMITS.placeMax);

/** A kept stack: scrubbed, at most a few lines' worth. */
export const cleanStack = (text: string): string => clip(scrubText(text).trim(), ERROR_TEXT_LIMITS.stackMax);

/**
 * The text with what changes between two errors of the same kind made
 * alike: numbers (ids, counts, lines and columns), and a build's file hash
 * (`index-Dh3HKT6K.js` → `index.js`), so one bug is one row whatever the
 * player, the build or the line it was minified onto.
 */
export const errorShape = (text: string): string =>
  text
    .replace(/-[A-Za-z0-9_]{8}\.(js|mjs|css)\b/g, ".$1")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\d+(\.\d+)?/g, "#")
    .toLowerCase();

/** The key of one kind of error: its source, message and place, made alike ({@link errorShape}). */
export const errorFingerprint = (source: string, message: string, place: string): string =>
  createHash("sha1").update(`${source}\n${errorShape(message)}\n${errorShape(place)}`).digest("hex");
