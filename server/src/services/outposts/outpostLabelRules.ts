import type { WordFilter } from "../chat/badWords.js";

/**
 * The rules of outpost names and pins (beta 7, owner 9 Nov 2026: "Allow
 * players to name / pin the outpost of their choice so it's easy for them to
 * navigate"), kept apart from the database so they are tested on their own.
 */

/** The longest outpost name, in characters: one line in the yard list. */
export const OUTPOST_NAME_MAX = 24;

/** The most outposts a player can pin to the top of the yard list. */
export const OUTPOST_PINS_MAX = 20;

/** Control characters, zero-width and direction marks. */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");

export type OutpostNameRefusal = "tooLong" | "badWords";

/**
 * An outpost name as stored: control characters gone, spaces squeezed,
 * trimmed. Empty means "no name" (the list shows the coordinates). Refused,
 * not starred out, when the word filter catches a word in it (as bios and
 * alliance names are), and when it is longer than {@link OUTPOST_NAME_MAX}.
 */
export const checkOutpostName = (
  raw: unknown,
  filter: WordFilter,
): { ok: true; name: string } | { ok: false; reason: OutpostNameRefusal } => {
  const text = typeof raw === "string" ? raw : "";
  const name = text.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim();
  if ([...name].length > OUTPOST_NAME_MAX) return { ok: false, reason: "tooLong" };
  if (name && filter.isProfane(name)) return { ok: false, reason: "badWords" };
  return { ok: true, name };
};

/** A yard `baseid` as sent: digits only, as every yard's is. Null otherwise. */
export const baseidOf = (raw: unknown): string | null => {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  return /^\d{1,20}$/.test(text) && text !== "0" ? text : null;
};

/** Why a pin is refused, or null when it may go ahead (pure, for the tests). */
export const outpostPinRefusal = (
  state: { readonly pinned: boolean; readonly pinnedCount: number },
  pin: boolean,
): "pinLimit" | null => (!pin || state.pinned || state.pinnedCount < OUTPOST_PINS_MAX ? null : "pinLimit");

/** The player's names and pins, as the game reads them. */
export interface OutpostLabels {
  /** `baseid` → name, only for outposts that have one. */
  readonly names: Record<string, string>;
  /** Pinned `baseid`s, in the order they were pinned. */
  readonly pins: string[];
}

export type OutpostLabelRefusal = OutpostNameRefusal | "pinLimit" | "notOwner" | "badRequest";

/** The words for each refusal, as the game shows them. */
export const OUTPOST_LABEL_REFUSAL_WORDS: Record<OutpostLabelRefusal, string> = {
  tooLong: `Names can be up to ${OUTPOST_NAME_MAX} letters.`,
  badWords: "That name has a word that is not allowed.",
  pinLimit: `You can pin up to ${OUTPOST_PINS_MAX} outposts.`,
  notOwner: "That outpost is not yours.",
  badRequest: "Something went wrong. Please try again.",
};
