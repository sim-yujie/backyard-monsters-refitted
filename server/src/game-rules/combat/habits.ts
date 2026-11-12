/**
 * Champion modes, round 2: **instincts and habits** (owner's option B,
 * 10 Nov 2026; design note `review-desk/drafts/champion-modes-fable.md`).
 *
 * Each Mode has fixed **instincts**, its tilt in `stance.ts`
 * (`STANCE_TILTS`), and its own learned **habits**, kept apart per Mode. A
 * habit is a weight on one of the features a pick is scored on, and only the
 * habits in its champion type's row ({@link CHAMPION_HABITS}) exist for it:
 * the engine never reads, and the server never learns, any other.
 *
 * Learning cannot lock in, by four rules ({@link learnHabits}):
 *
 * 1. Each Mode has its own habits; Offensive's are never read in Defensive.
 * 2. A habit tops out at {@link HABIT_CAP} (Hybrid, which has no instincts,
 *    {@link HYBRID_HABIT_CAP}), below every instinct, so a Mode always shows.
 * 3. Each attack in a Mode first fades that Mode's habits by
 *    {@link HABIT_FADE}, then learns: a habit with no fresh proof halves in
 *    about seven attacks.
 * 4. Every {@link CURIOUS_EVERY}th look the champion picks by its instincts
 *    alone, so it keeps seeing the other choice. Counted, never drawn, so the
 *    server's replay sees the same looks.
 *
 * The usual score a lesson is judged against is kept per Mode and per kind
 * of yard ({@link HabitStats}).
 *
 * ## Replay safety
 *
 * The habits travel in the fling log as `h` with a version `hv`, frozen at
 * launch as the old brain `b` is (`flungMind`). A log without `hv` takes the
 * old path (`b`, `brain.ts`) unchanged, so old replays and attacks launched
 * before this rule replay as they did. With no habit above 0 nothing is
 * stamped, and the battle is exactly today's.
 *
 * Krallen has no habits for now (owner, 10 Nov): she keeps today's brain.
 *
 * Determinism: the engine side only reads; learning runs on the server alone.
 */

import {
  BASELINE_RATE,
  BRAIN_RATE,
  isZeroBrain,
  lessonScore,
  parseBrain,
  type BrainWeights,
  type ChampionLesson,
} from "./brain.js";
import { DRULL_ID, FOMOR_ID, GORGO_ID, KORATH_ID } from "./champions.js";
import { DEFAULT_STANCE, ZERO_WEIGHTS, stanceWeights } from "./stance.js";
import type { ChampionStance, HabitKey, StanceWeights } from "./stance.js";
import { championByType } from "./stats.js";
import type { CombatTargetKind } from "./types.js";

/** The habits' version, stamped on a log as `hv`. */
export const HABITS_VERSION = 1;

/** No habit goes past this either way in Offensive or Defensive: half their least instinct. */
export const HABIT_CAP = 100;

/** Hybrid has no instincts, so its habits may grow a little stronger. */
export const HYBRID_HABIT_CAP = 150;

/** The share of each habit an attack in its Mode takes away before it learns. */
export const HABIT_FADE = 0.1;

/** No habit moves more than this in one attack. */
export const HABIT_STEP = 15;

/** Every this-many-th look picks by instinct alone. */
export const CURIOUS_EVERY = 5;

/** Habits that can lean either way: the panel names the side they lean to. */
export const TWO_ENDED_HABITS: readonly HabitKey[] = ["tower", "loot", "gun", "big", "crowd"];

type HabitRow = Readonly<Record<ChampionStance, readonly HabitKey[]>>;

/**
 * Each champion type's habits per Mode, in the order the panel lists them.
 * Only what the champion can really carry out in the battle code:
 *
 * - Gorgo, Drull and Korath choose buildings; none can hit a flier, so their
 *   "Aerial Defense first" is the building that shoots the attacker's fliers.
 * - Korath's "Quakes the crowd" (wave 2) wakes only once he has his quake.
 * - Fomor picks its own building only when none of the attacker's monsters is
 *   hurt; its other habits (wave 2) choose which hurt monster it backs:
 *   "big" (the biggest, or the smallest) and, in Hybrid, "crowd" (the one
 *   with most monsters round it, or the one alone). They are read only when
 *   not 0, so with none Fomor follows the nearest hurt monster, as in Flash.
 * - Krallen has none (owner, 10 Nov).
 */
export const CHAMPION_HABITS: Readonly<Record<string, HabitRow>> = {
  [GORGO_ID]: {
    offensive: ["guard", "aerial", "gun"],
    defensive: ["guard", "near"],
    hybrid: ["tower", "loot", "hall", "near"],
  },
  [DRULL_ID]: {
    offensive: ["gun", "guard", "aerial"],
    defensive: ["careful", "guard"],
    hybrid: ["tower", "loot", "hall", "careful"],
  },
  [KORATH_ID]: {
    offensive: ["quake", "gun", "aerial"],
    defensive: ["guard", "quake"],
    hybrid: ["tower", "loot", "hall", "quake"],
  },
  [FOMOR_ID]: {
    offensive: ["big", "aerial"],
    defensive: ["big", "aerial"],
    hybrid: ["crowd", "big", "aerial"],
  },
};

/** Whether a champion type has habits at all; one without keeps the old brain. */
export const hasHabits = (monsterId: string | undefined): boolean =>
  monsterId !== undefined && Object.prototype.hasOwnProperty.call(CHAMPION_HABITS, monsterId);

/** A champion type's habits in a Mode; none for a type without habits. */
export const habitsOf = (
  monsterId: string | undefined,
  stance: ChampionStance,
): readonly HabitKey[] =>
  (monsterId !== undefined && hasHabits(monsterId)
    ? CHAMPION_HABITS[monsterId]?.[stance]
    : undefined) ?? [];

export const habitCap = (stance: ChampionStance): number =>
  stance === "hybrid" ? HYBRID_HABIT_CAP : HABIT_CAP;

/** What a habit may come to: either way for a two-ended one, else 0 to the cap. */
export const habitBounds = (
  key: HabitKey,
  stance: ChampionStance,
): readonly [number, number] => {
  const cap = habitCap(stance);
  return TWO_ENDED_HABITS.includes(key) ? [-cap, cap] : [0, cap];
};

/** One Mode's habits: only the non-zero ones are kept. */
export type HabitWeights = Readonly<Partial<Record<HabitKey, number>>>;

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * A Mode's habits made safe for one champion type: only the habits in its
 * row, each a whole number within its bounds; zeros and anything else left out.
 */
export const parseHabits = (
  raw: unknown,
  monsterId: string | undefined,
  stance: ChampionStance,
): HabitWeights => {
  if (!isRecord(raw)) return {};
  const out: Partial<Record<HabitKey, number>> = {};
  for (const key of habitsOf(monsterId, stance)) {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const [low, high] = habitBounds(key, stance);
    const whole = Math.min(Math.max(Math.round(value), low), high);
    if (whole !== 0) out[key] = whole;
  }
  return out;
};

/** A Mode's short name on the save and in a frozen book. */
export type StanceShort = "off" | "hyb" | "def";

export const STANCE_SHORT: Readonly<Record<ChampionStance, StanceShort>> = {
  offensive: "off",
  hybrid: "hyb",
  defensive: "def",
};

/** `h` on a champion's save entry: its habits, per Mode. */
export interface HabitBook {
  readonly off?: HabitWeights;
  readonly hyb?: HabitWeights;
  readonly def?: HabitWeights;
}

const MODES: readonly ChampionStance[] = ["offensive", "hybrid", "defensive"];

/** A book made safe for one champion type; a Mode with no habit is left out. */
export const parseHabitBook = (raw: unknown, monsterId: string | undefined): HabitBook => {
  if (!isRecord(raw)) return {};
  const out: { off?: HabitWeights; hyb?: HabitWeights; def?: HabitWeights } = {};
  for (const stance of MODES) {
    const short = STANCE_SHORT[stance];
    const habits = parseHabits(raw[short], monsterId, stance);
    if (Object.keys(habits).length > 0) out[short] = habits;
  }
  return out;
};

export const isEmptyBook = (book: HabitBook): boolean =>
  book.off === undefined && book.hyb === undefined && book.def === undefined;

/**
 * A book as an attack session freezes it at launch and the attack load
 * serves it: with its version, which tells it apart from an old brain.
 */
export interface FrozenHabits extends HabitBook {
  readonly v: number;
}

export const isFrozenHabits = (raw: unknown): raw is FrozenHabits =>
  isRecord(raw) && typeof raw["v"] === "number";

/** A champion's frozen book; null when it has none to freeze. */
export const frozenHabits = (
  raw: unknown,
  monsterId: string | undefined,
): FrozenHabits | null => {
  const book = parseHabitBook(raw, monsterId);
  return isEmptyBook(book) ? null : { v: HABITS_VERSION, ...book };
};

/** What a flung champion's log entry carries of its mind. */
export interface FlungMind {
  /** The old brain (Krallen, and attacks launched before habits). */
  readonly b?: BrainWeights;
  /** The habits' version; present only with `h`. */
  readonly hv?: number;
  /** The habits of the Mode it is flung in. */
  readonly h?: HabitWeights;
}

/**
 * What goes on a flung champion's log entry from what its attack froze at
 * launch: a frozen book gives that Mode's habits with the version; an old
 * brain gives `b`; nothing above 0 gives nothing, which is today's champion.
 * The client stamps this, and the server's replay stamps it again over
 * whatever the client sent.
 *
 * @param frozen - The session's entry for this champion type, if any.
 * @param t - The champion type.
 * @param stance - The Mode it is flung in; none is Hybrid.
 */
export const flungMind = (
  frozen: unknown,
  t: number,
  stance: ChampionStance | undefined,
): FlungMind => {
  if (isFrozenHabits(frozen)) {
    const id = championByType(t);
    const habits = parseHabits(
      frozen[STANCE_SHORT[stance ?? DEFAULT_STANCE]],
      id,
      stance ?? DEFAULT_STANCE,
    );
    return Object.keys(habits).length > 0 ? { hv: HABITS_VERSION, h: habits } : {};
  }
  const brain = parseBrain(frozen);
  return isZeroBrain(brain) ? {} : { b: brain };
};

/** How a champion flung with habits picks: with them, and on a curious look without. */
export interface HabitMind {
  /** Its Mode's instincts plus its habits; null for the Flash champion. */
  readonly weights: StanceWeights | null;
  /** Its Mode's instincts alone, for a curious look; null for the Flash champion. */
  readonly instinct: StanceWeights | null;
  /** Whether it has any habit; without one every look is the same. */
  readonly habits: boolean;
}

/**
 * The weights a champion flung with habits fights with: its Mode's tilt plus
 * only the habits in its row, each clamped as `stanceWeights` clamps.
 *
 * @param monsterId - The champion id.
 * @param stance - The Mode it was flung in; none is Hybrid.
 * @param raw - The log's `h`.
 */
export const habitMind = (
  monsterId: string,
  stance: ChampionStance | undefined,
  raw: unknown,
): HabitMind => {
  const mode = stance ?? DEFAULT_STANCE;
  const habits = parseHabits(raw, monsterId, mode);
  const any = Object.keys(habits).length > 0;
  const instinct = stanceWeights(mode);
  return {
    weights: any ? stanceWeights(mode, { ...ZERO_WEIGHTS, ...habits }) : instinct,
    instinct,
    habits: any,
  };
};

/* ── What it has learned from ─────────────────────────────────────────────── */

/** One Mode's record: attacks fought in it, and its usual score per kind of yard. */
export interface ModeRecord {
  readonly n: number;
  readonly u: Readonly<Partial<Record<CombatTargetKind, number>>>;
}

/** `hs` on a champion's save entry: every attack it learned from, and each Mode's record. */
export interface HabitStats {
  readonly n: number;
  readonly off?: ModeRecord;
  readonly hyb?: ModeRecord;
  readonly def?: ModeRecord;
}

const YARD_KINDS: readonly CombatTargetKind[] = ["main", "outpost", "wild", "tribe", "inferno"];

const wholeCount = (raw: unknown): number =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : 0;

const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

const parseModeRecord = (raw: unknown): ModeRecord | undefined => {
  if (!isRecord(raw)) return undefined;
  const u: Partial<Record<CombatTargetKind, number>> = {};
  if (isRecord(raw["u"])) {
    for (const kind of YARD_KINDS) {
      const value = raw["u"][kind];
      if (isScore(value)) u[kind] = value;
    }
  }
  return { n: wholeCount(raw["n"]), u };
};

/**
 * `hs` made safe. A champion with none yet keeps the attack count of its old
 * brain's `bs` (the migration: habits start fresh, the count stays).
 *
 * @param raw - The entry's `hs`.
 * @param legacy - The entry's old `bs`, read only when there is no `hs`.
 */
export const parseHabitStats = (raw: unknown, legacy?: unknown): HabitStats => {
  if (!isRecord(raw)) {
    return { n: isRecord(legacy) ? wholeCount(legacy["n"]) : 0 };
  }
  const out: { n: number; off?: ModeRecord; hyb?: ModeRecord; def?: ModeRecord } = {
    n: wholeCount(raw["n"]),
  };
  for (const short of ["off", "hyb", "def"] as const) {
    const record = parseModeRecord(raw[short]);
    if (record) out[short] = record;
  }
  return out;
};

/**
 * The book and stats after one landed attack in `stance` (see the file
 * comment). Only the habits in the champion's row for that Mode move; the
 * other Modes are untouched, and do not fade.
 *
 *     habit    = trunc(habit × (1 - HABIT_FADE))
 *     habit   += RATE × (score - usual) × credit,   held within ±HABIT_STEP
 *     habit    = round, within its bounds
 *     usual   += BASELINE_RATE × (score - usual)   (the first attack only sets it)
 *
 * where `usual` is the Mode's usual score on this kind of yard and `credit`
 * the habit's mean over the picks of chosen less the candidates' mean.
 *
 * @param book - The entry's `h`, as stored.
 * @param stats - The entry's `hs`, as stored.
 * @param lesson - What the server's replay recorded for it.
 * @param stance - The Mode it fought in.
 * @param legacy - The entry's old `bs`, for its attack count.
 */
export const learnHabits = (
  book: unknown,
  stats: unknown,
  lesson: ChampionLesson,
  stance: ChampionStance,
  legacy?: unknown,
  rate: number = BRAIN_RATE,
): { book: HabitBook; stats: HabitStats } => {
  const id = championByType(lesson.t);
  const all = parseHabitBook(book, id);
  const known = parseHabitStats(stats, legacy);
  const short = STANCE_SHORT[stance];
  const record = known[short] ?? { n: 0, u: {} };
  const kind = lesson.k ?? "main";
  const score = lessonScore(lesson, stance);
  const usual = record.u[kind];

  const before = all[short] ?? {};
  const after: Partial<Record<HabitKey, number>> = {};
  for (const habit of habitsOf(id, stance)) {
    let weight = Math.trunc((before[habit] ?? 0) * (1 - HABIT_FADE));
    if (usual !== undefined && lesson.picks > 0) {
      const credit = (lesson.credit[habit] ?? 0) / lesson.picks;
      weight += Math.min(Math.max(rate * (score - usual) * credit, -HABIT_STEP), HABIT_STEP);
    }
    const [low, high] = habitBounds(habit, stance);
    const whole = Math.min(Math.max(Math.round(weight), low), high);
    if (whole !== 0) after[habit] = whole;
  }

  const nextBook: { off?: HabitWeights; hyb?: HabitWeights; def?: HabitWeights } = { ...all };
  if (Object.keys(after).length > 0) nextBook[short] = after;
  else delete nextBook[short];

  const nextUsual = usual === undefined ? score : usual + BASELINE_RATE * (score - usual);
  return {
    book: nextBook,
    stats: {
      ...known,
      n: known.n + 1,
      [short]: { n: record.n + 1, u: { ...record.u, [kind]: nextUsual } },
    },
  };
};

/** The book with one Mode's habits wiped (the panel's Forget); its record is kept. */
export const forgetHabits = (
  book: unknown,
  monsterId: string | undefined,
  stance: ChampionStance,
): HabitBook => {
  const all: { off?: HabitWeights; hyb?: HabitWeights; def?: HabitWeights } = {
    ...parseHabitBook(book, monsterId),
  };
  delete all[STANCE_SHORT[stance]];
  return all;
};

/** How many of the panel's three pips a habit fills: a quarter of its cap each. */
export const habitPips = (weight: number, stance: ChampionStance): number =>
  Math.min(3, Math.floor((Math.abs(weight) * 4) / habitCap(stance)));
