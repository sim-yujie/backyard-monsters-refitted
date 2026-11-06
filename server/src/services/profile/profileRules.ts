import type { WordFilter } from "../chat/badWords.js";

/**
 * The rules of player profiles (beta 7, owner 6 Nov 2026, grill Q27-28),
 * kept apart from the database so they are tested on their own.
 */

/** The longest bio, in characters (ASSUMED: about two lines on a phone). */
export const BIO_MAX = 150;

/** The most lines a bio keeps; more line breaks become spaces. */
export const BIO_MAX_LINES = 3;

/** The level a player needs before they can upload a photo. */
export const PHOTO_MIN_LEVEL = 10;

/** One photo change a day: the time from one upload to the next. */
export const PHOTO_CHANGE_MS = 24 * 60 * 60 * 1000;

/** Reports from this many different players hide a photo until the owner looks. */
export const AUTO_HIDE_REPORTS = 3;

/** Control characters other than the line break, zero-width and direction marks. */
const CONTROL_CHARACTERS = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");

export type BioRefusal = "tooLong" | "badWords";

/**
 * A bio as stored: control characters gone, spaces squeezed, at most
 * {@link BIO_MAX_LINES} lines, trimmed. Refused, not starred out, when the
 * word filter catches a word in it (like alliance names, grill Q25), and
 * when it is longer than {@link BIO_MAX}.
 */
export const checkBio = (
  raw: unknown,
  filter: WordFilter,
): { ok: true; bio: string } | { ok: false; reason: BioRefusal } => {
  const text = typeof raw === "string" ? raw : "";
  const lines = text
    .replace(/\r\n?/g, "\n")
    // Control characters other than the line break, and zero-width ones.
    .replace(CONTROL_CHARACTERS, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  const kept = lines.slice(0, BIO_MAX_LINES - 1);
  const last = lines.slice(BIO_MAX_LINES - 1).join(" ");
  const bio = (last ? [...kept, last] : kept).join("\n");
  if (bio.length > BIO_MAX) return { ok: false, reason: "tooLong" };
  if (bio && filter.isProfane(bio)) return { ok: false, reason: "badWords" };
  return { ok: true, bio };
};

export interface UploadFacts {
  level: number;
  blocked: boolean;
  /** The photo is hidden by reports and waits for the owner. */
  underReview: boolean;
  /** The last upload, or null for none. */
  lastAt: Date | null;
  now: Date;
}

export type UploadRefusal = "lowLevel" | "blocked" | "underReview" | "tooSoon";

export type UploadGate = { ok: true } | { ok: false; reason: UploadRefusal; nextAt?: Date };

/**
 * Whether a player may upload a photo now: level {@link PHOTO_MIN_LEVEL}
 * or more, not blocked by the owner, no photo of theirs waiting for review
 * (so a reported photo cannot be swapped before the owner sees it), and a
 * day since the last upload.
 */
export const uploadGate = (facts: UploadFacts): UploadGate => {
  if (facts.blocked) return { ok: false, reason: "blocked" };
  if (facts.level < PHOTO_MIN_LEVEL) return { ok: false, reason: "lowLevel" };
  if (facts.underReview) return { ok: false, reason: "underReview" };
  if (facts.lastAt) {
    const nextAt = new Date(facts.lastAt.getTime() + PHOTO_CHANGE_MS);
    if (nextAt > facts.now) return { ok: false, reason: "tooSoon", nextAt };
  }
  return { ok: true };
};

/** The words for each refusal, as the game shows them. */
export const PROFILE_REFUSAL_WORDS = {
  tooLong: `Bios can be up to ${BIO_MAX} letters.`,
  badWords: "That bio has a word that is not allowed.",
  lowLevel: `Photos unlock at level ${PHOTO_MIN_LEVEL}.`,
  blocked: "Photo uploads are switched off for your account.",
  underReview: "Your photo is being checked. Try again later.",
  tooSoon: "You can change your photo once a day.",
  notImage: "That file is not a picture we can use. Try a JPEG or PNG photo.",
  tooBig: "That picture is too big.",
  tooSmall: "That picture is too small.",
  notFound: "That player could not be found.",
  noPhoto: "That player has no photo.",
  self: "You cannot report your own photo.",
} as const;

export type ProfileRefusal = keyof typeof PROFILE_REFUSAL_WORDS;
