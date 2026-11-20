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
 * Habits are learned by the owner's pick B (19 Nov 2026, {@link learnHabits}):
 * each is Active at one fixed weight or Unproven at 0, never in between.
 * Learning cannot lock in:
 *
 * 1. Each Mode has its own habits; Offensive's are never read in Defensive.
 * 2. An Active habit's weight ({@link HABIT_RULES}) is half its Mode's cap
 *    ({@link HABIT_CAP}, Hybrid {@link HYBRID_HABIT_CAP}), below every
 *    instinct, so a Mode always shows.
 * 3. An Active habit that keeps failing its checks turns Unproven again.
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
  isZeroBrain,
  lessonScore,
  parseBrain,
  type BrainWeights,
  type ChampionLesson,
} from "./brain.js";
import { DRULL_ID, FOMOR_ID, GORGO_ID, KORATH_ID } from "./champions.js";
import { DEFAULT_STANCE, MONSTER_HABIT_KEYS, ZERO_WEIGHTS, stanceWeights } from "./stance.js";
import type { ChampionStance, HabitKey, StanceWeights } from "./stance.js";
import { championByType } from "./stats.js";
import type { CombatTargetKind } from "./types.js";

/** The habits' version, stamped on a log as `hv`. */
export const HABITS_VERSION = 1;

/** No habit goes past this either way in Offensive or Defensive: half their least instinct. */
export const HABIT_CAP = 100;

/** Hybrid has no instincts, so its habits may grow a little stronger. */
export const HYBRID_HABIT_CAP = 150;

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
  /**
   * Which way its attacks are judged: {@link FOMOR_JUDGE} once a Fomor has
   * been judged by the monsters it backs. Its usual scores from before were
   * on another scale, so they restart then ({@link learnHabits}).
   */
  readonly j?: number;
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
  const out: { n: number; j?: number; off?: ModeRecord; hyb?: ModeRecord; def?: ModeRecord } = {
    n: wholeCount(raw["n"]),
  };
  const judge = wholeCount(raw["j"]);
  if (judge > 0) out.j = judge;
  for (const short of ["off", "hyb", "def"] as const) {
    const record = parseModeRecord(raw[short]);
    if (record) out[short] = record;
  }
  return out;
};

/** {@link HabitStats.j} for a Fomor judged by the monsters it backs. */
export const FOMOR_JUDGE = 1;

/** Whether a lesson carries Fomor's own figures (`ChampionLesson.army` and on). */
const judgedByMonsters = (lesson: ChampionLesson): boolean =>
  lesson.army !== undefined || lesson.backed !== undefined;

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;

/**
 * The score, 0 to 1, a champion's habits learn from: `lessonScore` for every
 * champion but Fomor. Fomor is judged by the monsters it backs, not by its
 * own few points of damage or its nearly always full health (design note
 * round 2): Offensive the share of your other monsters' damage to buildings
 * dealt from inside its rage ring while it fought, Defensive the share of the
 * hurt monsters it backed that lived, Hybrid the mean of the two. null when
 * the attack gave nothing to judge it by (no monster damage, none backed):
 * that attack then teaches nothing and leaves the usual score alone.
 */
export const habitScore = (lesson: ChampionLesson, stance: ChampionStance): number | null => {
  if (!judgedByMonsters(lesson)) return lessonScore(lesson, stance);
  const ring =
    lesson.army !== undefined && lesson.army > 0 ? clamp01((lesson.ring ?? 0) / lesson.army) : null;
  const lived =
    lesson.backed !== undefined && lesson.backed > 0
      ? clamp01((lesson.backedLived ?? 0) / lesson.backed)
      : null;
  if (stance === "offensive") return ring;
  if (stance === "defensive") return lived;
  return ring !== null && lived !== null ? (ring + lived) / 2 : null;
};

/** The stats with every Mode's usual scores restarted, counts kept, under {@link FOMOR_JUDGE}. */
const restartUsual = (stats: HabitStats): HabitStats => {
  const out: { n: number; j: number; off?: ModeRecord; hyb?: ModeRecord; def?: ModeRecord } = {
    n: stats.n,
    j: FOMOR_JUDGE,
  };
  for (const short of ["off", "hyb", "def"] as const) {
    const record = stats[short];
    if (record) out[short] = { n: record.n, u: {} };
  }
  return out;
};

const isMonsterHabit = (key: HabitKey): boolean =>
  (MONSTER_HABIT_KEYS as readonly HabitKey[]).includes(key);


/* ── Active or Unproven (owner's pick B, 19 Nov 2026) ─────────────────────── */

/**
 * How a habit is learned since the owner's pick B (desk, 19 Nov 2026): a
 * habit is either **Active**, at one fixed weight, or **Unproven**, at 0.
 * There are no strengths in between, so the Champion Cage shows no pips.
 *
 * Per habit and Mode the save keeps a {@link HabitTrack}:
 *
 * 1. An attack is a *useful observation* for a habit when it has a score
 *    ({@link habitScore}), the Mode already has a usual score on that kind of
 *    yard, the champion had looks to choose between, and the habit's credit
 *    (chosen less the candidates' mean) is not 0. Its *way* is the sign of
 *    `(score - usual) × credit`: + when picking more of the feature went with
 *    a better than usual attack (or less of it with a worse one), - otherwise.
 * 2. The first {@link HabitRules.gate} useful observations only count: they
 *    are the evidence gate. Every useful observation after them is a *check*.
 * 3. Unproven: {@link HabitRules.support} checks in a row the same way make
 *    the habit Active that way (a one-ended habit only on the + side).
 * 4. Active: {@link HabitRules.doubt} checks in a row against its way make it
 *    Unproven again; one check for it starts the count over. Turning round
 *    then takes fresh checks the other way.
 *
 * An attack with nothing useful for a habit leaves its track as it was:
 * B has no fade. Each attack that turned a habit on or off leaves a
 * {@link HabitReceipt} for the cage's "Last attack" line.
 *
 * The weights the engine reads are still the book `h` ({@link HabitBook}),
 * now only ever 0 or ± the fixed weight, so the battle code, the fling log's
 * `h`/`hv` and every replay are as they were.
 */
export interface HabitRules {
  /** Useful observations before any check counts. */
  readonly gate: number;
  /** Checks in a row one way that make an Unproven habit Active. */
  readonly support: number;
  /** Checks in a row against an Active habit that make it Unproven. */
  readonly doubt: number;
  /** An Active habit's weight in Offensive and Defensive. */
  readonly weight: number;
  /** An Active habit's weight in Hybrid, which has no instincts. */
  readonly hybridWeight: number;
}

export const HABIT_RULES: HabitRules = {
  gate: 8,
  support: 3,
  doubt: 8,
  weight: 50,
  hybridWeight: 75,
};

/** The weight an Active habit fights with in a Mode. */
export const activeWeight = (stance: ChampionStance, rules: HabitRules = HABIT_RULES): number =>
  stance === "hybrid" ? rules.hybridWeight : rules.weight;

/** Which way a habit leans: + is its "on" name, - its "off" name (two-ended habits only). */
export type HabitWay = 1 | -1;

/** One habit's learning in one Mode (`hl` on the save). */
export interface HabitTrack {
  /** Useful observations seen, up to the gate. */
  readonly o: number;
  /** Active, and which way; absent while Unproven. */
  readonly d?: HabitWay;
  /** Unproven: the way its last checks agreed on, and how many in a row. */
  readonly c?: HabitWay;
  readonly s?: number;
  /** Active: checks in a row against it. */
  readonly f?: number;
}

export type ModeTracks = Readonly<Partial<Record<HabitKey, HabitTrack>>>;

/** What one attack did to a habit, for the cage's "Last attack" line. */
export type HabitEvent = "learned" | "faded";

/** The habits the champion's last learning attack turned on or off. */
export interface HabitReceipt {
  /** The Mode it fought in. */
  readonly m: StanceShort;
  /** `hs.n` after that attack: a receipt older than the last attack is not shown. */
  readonly n: number;
  readonly e: Readonly<Partial<Record<HabitKey, HabitEvent>>>;
}

/** The version of `hl`; a save without it is migrated ({@link migrateHabits}). */
export const HABIT_LEARNING_VERSION = 1;

/** `hl` on a champion's save entry: each Mode's tracks and the last receipt. */
export interface HabitLearning {
  readonly v: number;
  readonly off?: ModeTracks;
  readonly hyb?: ModeTracks;
  readonly def?: ModeTracks;
  readonly r?: HabitReceipt;
}

const SHORTS: readonly StanceShort[] = ["off", "hyb", "def"];

const STANCE_OF: Readonly<Record<StanceShort, ChampionStance>> = {
  off: "offensive",
  hyb: "hybrid",
  def: "defensive",
};

const isOneEnded = (key: HabitKey): boolean => !TWO_ENDED_HABITS.includes(key);

const wayOf = (raw: unknown, key: HabitKey): HabitWay | undefined =>
  raw === 1 ? 1 : raw === -1 && !isOneEnded(key) ? -1 : undefined;

const parseTrack = (raw: unknown, key: HabitKey): HabitTrack | undefined => {
  if (!isRecord(raw)) return undefined;
  const o = wholeCount(raw["o"]);
  const d = wayOf(raw["d"], key);
  const track: { o: number; d?: HabitWay; c?: HabitWay; s?: number; f?: number } = { o };
  if (d !== undefined) {
    track.d = d;
    const f = wholeCount(raw["f"]);
    if (f > 0) track.f = f;
  } else {
    const c = wayOf(raw["c"], key);
    const s = wholeCount(raw["s"]);
    if (c !== undefined && s > 0) {
      track.c = c;
      track.s = s;
    }
  }
  return track.o > 0 || track.d !== undefined ? track : undefined;
};

const parseModeTracks = (raw: unknown, monsterId: string | undefined, stance: ChampionStance) => {
  const out: Partial<Record<HabitKey, HabitTrack>> = {};
  if (!isRecord(raw)) return out;
  for (const key of habitsOf(monsterId, stance)) {
    const track = parseTrack(raw[key], key);
    if (track) out[key] = track;
  }
  return out;
};

const parseReceipt = (raw: unknown, monsterId: string | undefined): HabitReceipt | undefined => {
  if (!isRecord(raw) || !isRecord(raw["e"])) return undefined;
  const m = raw["m"];
  if (m !== "off" && m !== "hyb" && m !== "def") return undefined;
  const e: Partial<Record<HabitKey, HabitEvent>> = {};
  for (const key of habitsOf(monsterId, STANCE_OF[m])) {
    const event = raw["e"][key];
    if (event === "learned" || event === "faded") e[key] = event;
  }
  const n = wholeCount(raw["n"]);
  return Object.keys(e).length > 0 && n > 0 ? { m, n, e } : undefined;
};

type MutableLearning = {
  v: number;
  off?: ModeTracks;
  hyb?: ModeTracks;
  def?: ModeTracks;
  r?: HabitReceipt;
};

/** `hl` made safe for one champion type; null when there is none of this version yet. */
export const parseHabitLearning = (
  raw: unknown,
  monsterId: string | undefined,
): HabitLearning | null => {
  if (!isRecord(raw) || raw["v"] !== HABIT_LEARNING_VERSION) return null;
  const out: MutableLearning = { v: HABIT_LEARNING_VERSION };
  for (const short of SHORTS) {
    const tracks = parseModeTracks(raw[short], monsterId, STANCE_OF[short]);
    if (Object.keys(tracks).length > 0) out[short] = tracks;
  }
  const receipt = parseReceipt(raw["r"], monsterId);
  if (receipt) out.r = receipt;
  return out;
};

/**
 * The migration to B, for a champion whose save has no `hl` yet: a habit
 * whose old weight is at least B's fixed weight (2 or 3 pips) starts Active
 * that way with its evidence gate passed; every other habit starts Unproven
 * at 0, its Mode's attacks so far counted towards the gate (at most the gate).
 * Nothing else is given or taken: no loot, no back pay.
 *
 * @param book - The entry's `h`, as stored before B.
 * @param stats - The entry's `hs`.
 * @param monsterId - The champion id.
 */
export const migrateHabits = (
  book: unknown,
  stats: unknown,
  monsterId: string | undefined,
  rules: HabitRules = HABIT_RULES,
): HabitLearning => {
  const all = parseHabitBook(book, monsterId);
  const known = parseHabitStats(stats);
  const out: MutableLearning = { v: HABIT_LEARNING_VERSION };
  for (const short of SHORTS) {
    const stance = STANCE_OF[short];
    const weights = all[short] ?? {};
    const seen = Math.min(known[short]?.n ?? 0, rules.gate);
    const tracks: Partial<Record<HabitKey, HabitTrack>> = {};
    for (const key of habitsOf(monsterId, stance)) {
      const weight = weights[key] ?? 0;
      if (Math.abs(weight) >= activeWeight(stance, rules)) {
        tracks[key] = { o: rules.gate, d: weight > 0 ? 1 : -1 };
      } else if (seen > 0) {
        tracks[key] = { o: seen };
      }
    }
    if (Object.keys(tracks).length > 0) out[short] = tracks;
  }
  return out;
};

/**
 * A champion's learning as B reads it: its `hl`, or, before its first attack
 * or Forget since B, its old `h` migrated. The freeze at launch, the cage
 * and the learning all read it through here, so they never disagree.
 */
export const habitLearningOf = (
  entry: { readonly h?: unknown; readonly hs?: unknown; readonly hl?: unknown },
  monsterId: string | undefined,
  rules: HabitRules = HABIT_RULES,
): HabitLearning =>
  parseHabitLearning(entry.hl, monsterId) ?? migrateHabits(entry.h, entry.hs, monsterId, rules);

/** The book the engine fights with: each Active habit at its Mode's fixed weight, its way. */
export const bookOfLearning = (
  learning: HabitLearning,
  monsterId: string | undefined,
  rules: HabitRules = HABIT_RULES,
): HabitBook => {
  const out: { off?: HabitWeights; hyb?: HabitWeights; def?: HabitWeights } = {};
  for (const short of SHORTS) {
    const stance = STANCE_OF[short];
    const weights: Partial<Record<HabitKey, number>> = {};
    for (const key of habitsOf(monsterId, stance)) {
      const way = learning[short]?.[key]?.d;
      if (way !== undefined) weights[key] = way * activeWeight(stance, rules);
    }
    if (Object.keys(weights).length > 0) out[short] = weights;
  }
  return out;
};

/** A champion's book as B has it, for the freeze at launch. */
export const habitBookOf = (
  entry: { readonly h?: unknown; readonly hs?: unknown; readonly hl?: unknown },
  monsterId: string | undefined,
): HabitBook => bookOfLearning(habitLearningOf(entry, monsterId), monsterId);

/**
 * One habit's track after one attack (rules 2 to 4 of the B comment).
 *
 * @param track - Its track before.
 * @param way - The attack's way for it; 0 when the attack was no useful observation.
 * @param key - The habit, for whether it can lean the - way.
 */
export const checkHabit = (
  track: HabitTrack,
  way: HabitWay | 0,
  key: HabitKey,
  rules: HabitRules = HABIT_RULES,
): { track: HabitTrack; event?: HabitEvent } => {
  if (way === 0) return { track };
  const o = track.o;
  if (o < rules.gate) return { track: { ...track, o: o + 1 } };
  if (track.d !== undefined) {
    if (way === track.d) return { track: { o, d: track.d } };
    const f = (track.f ?? 0) + 1;
    if (f >= rules.doubt) return { track: { o }, event: "faded" };
    return { track: { o, d: track.d, f } };
  }
  if (way === -1 && isOneEnded(key)) return { track: { o } };
  const s = track.c === way ? (track.s ?? 0) + 1 : 1;
  if (s >= rules.support) return { track: { o, d: way }, event: "learned" };
  return { track: { o, c: way, s } };
};

/** Below this, a credit or a score difference is rounding, not evidence. */
const NO_EVIDENCE = 1e-9;

/**
 * The book, stats and learning after one landed attack in `stance` (B; see
 * {@link HabitRules}). Only the habits in the champion's row for that Mode
 * move; other Modes keep their tracks. The usual score per kind of yard moves
 * as before:
 *
 *     usual += BASELINE_RATE × (score - usual)   (the first attack only sets it)
 *
 * @param book - The entry's `h`, as stored (read only to migrate).
 * @param stats - The entry's `hs`, as stored.
 * @param lesson - What the server's replay recorded for it.
 * @param stance - The Mode it fought in.
 * @param legacy - The entry's old `bs`, for its attack count.
 * @param learning - The entry's `hl`; none migrates `book`.
 * @param rules - The thresholds (the evaluation tool tries others).
 */
export const learnHabits = (
  book: unknown,
  stats: unknown,
  lesson: ChampionLesson,
  stance: ChampionStance,
  legacy?: unknown,
  learning?: unknown,
  rules: HabitRules = HABIT_RULES,
): { book: HabitBook; stats: HabitStats; learning: HabitLearning } => {
  const id = championByType(lesson.t);
  const parsed = parseHabitStats(stats, legacy);
  const current = habitLearningOf({ h: book, hs: parsed, hl: learning }, id, rules);
  // A Fomor's first attack judged by its monsters starts its usual scores afresh.
  const known =
    judgedByMonsters(lesson) && parsed.j !== FOMOR_JUDGE ? restartUsual(parsed) : parsed;
  const short = STANCE_SHORT[stance];
  const record = known[short] ?? { n: 0, u: {} };
  const kind = lesson.k ?? "main";
  const score = habitScore(lesson, stance);
  const usual = record.u[kind];

  const before = current[short] ?? {};
  const tracks: Partial<Record<HabitKey, HabitTrack>> = {};
  const events: Partial<Record<HabitKey, HabitEvent>> = {};
  for (const habit of habitsOf(id, stance)) {
    // Fomor's monster habits are credited on its looks at hurt monsters, the
    // rest on building looks.
    const looks = isMonsterHabit(habit) ? (lesson.allyPicks ?? lesson.picks) : lesson.picks;
    let way: HabitWay | 0 = 0;
    if (score !== null && usual !== undefined && looks > 0) {
      const signal = (score - usual) * ((lesson.credit[habit] ?? 0) / looks);
      if (Math.abs(signal) > NO_EVIDENCE) way = signal > 0 ? 1 : -1;
    }
    const step = checkHabit(before[habit] ?? { o: 0 }, way, habit, rules);
    if (step.track.o > 0 || step.track.d !== undefined) tracks[habit] = step.track;
    if (step.event) events[habit] = step.event;
  }

  const n = known.n + 1;
  const next: MutableLearning = { ...current };
  if (Object.keys(tracks).length > 0) next[short] = tracks;
  else delete next[short];
  if (Object.keys(events).length > 0) next.r = { m: short, n, e: events };
  else delete next.r;

  // Nothing to judge it by: the attack counts, the usual score stays.
  const nextUsual =
    score === null ? usual : usual === undefined ? score : usual + BASELINE_RATE * (score - usual);
  const u = nextUsual === undefined ? record.u : { ...record.u, [kind]: nextUsual };
  return {
    book: bookOfLearning(next, id, rules),
    stats: {
      ...known,
      n,
      [short]: { n: record.n + 1, u },
    },
    learning: next,
  };
};

/**
 * The book and learning with one Mode wiped (the panel's Forget): its habits
 * Unproven with no evidence, and its "Last attack" line gone. Its attack
 * count and usual scores (`hs`) stay.
 */
export const forgetHabits = (
  entry: { readonly h?: unknown; readonly hs?: unknown; readonly hl?: unknown },
  monsterId: string | undefined,
  stance: ChampionStance,
): { book: HabitBook; learning: HabitLearning } => {
  const short = STANCE_SHORT[stance];
  const next: MutableLearning = { ...habitLearningOf(entry, monsterId) };
  delete next[short];
  if (next.r?.m === short) delete next.r;
  return { book: bookOfLearning(next, monsterId), learning: next };
};

/** Whether a Mode has anything to forget: an Active habit or any evidence. */
export const hasLearned = (learning: HabitLearning, stance: ChampionStance): boolean =>
  Object.keys(learning[STANCE_SHORT[stance]] ?? {}).length > 0;
