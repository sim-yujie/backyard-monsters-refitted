/**
 * A champion's learned brain (issue #219): a few bounded weights over the
 * features a Mode scores (`stance.ts`), shaped by the champion's own attacks.
 * Two players' champions of the same type and level end up choosing their
 * targets differently because each one learned from what happened to it.
 *
 * It is not experience: no stat moves. The brain is the **base** that
 * `stanceWeights` adds the Mode's tilt to, so it only re-orders the targets
 * Flash's own lists offer, as a Mode does.
 *
 * ## Where it lives and when it is read
 *
 * On the champion's save entry, `b` (the weights, {@link BrainWeights}) and
 * `bs` (what it has learned from, {@link BrainStats}). The server copies `b`
 * into the attack session at launch and stamps it on the fling log's champion
 * event; the battle reads it from the log and nowhere else, so the client's
 * battle and the server's replay use the same numbers whatever the save holds
 * by then. A log without `b` fights with a zero brain, which is today's
 * champion.
 *
 * ## How it learns ({@link learnFromLesson})
 *
 * After an attack lands, the server's replay hands each attacking champion a
 * {@link ChampionLesson}: what set its picks apart from the alternatives it
 * had, and how the attack went for it by its Mode's goal ({@link lessonScore}):
 * Offensive by the damage it dealt, Defensive by the health it kept, Hybrid by
 * both. Against its usual score in that Mode (a running baseline):
 *
 *     advantage = score - baseline
 *     step      = BRAIN_RATE × advantage × credit,   held within ±BRAIN_STEP
 *     weight   += step,                              clamped to ±BRAIN_BOUND
 *     baseline += BASELINE_RATE × (score - baseline)
 *
 * where `credit` is, per feature, the mean over its picks of the chosen
 * building's feature less the mean of the candidates' (threat flipped, being a
 * penalty). An attack that went better than usual makes it lean further
 * toward what it did; one that went worse, away. The first attack in a Mode
 * only sets the baseline.
 *
 * Determinism: the update runs on the server alone, once per landed attack,
 * with only `+ - * /`, `Math.round`, `Math.min` and `Math.max`.
 */

import { ZERO_WEIGHTS } from "./stance.js";
import type { ChampionStance, StanceWeights } from "./stance.js";

/** The features a brain learns, in the one order every loop takes them. */
export const BRAIN_KEYS = ["tower", "loot", "finish", "focus", "threat"] as const;

export type BrainKey = (typeof BRAIN_KEYS)[number];

/** A brain's weights, whole distance units, each within ±{@link BRAIN_BOUND}. */
export type BrainWeights = Readonly<Record<BrainKey, number>>;

/** No weight goes past this either way: half an Offensive tower tilt, give or take. */
export const BRAIN_BOUND = 200;

/**
 * Distance units per unit of advantage × credit. Tuned with
 * `tools/champion-brain.mjs`: a champion whose results keep improving names a
 * tendency after ten to twenty attacks, and one whose results only wobble
 * stays "still learning".
 */
export const BRAIN_RATE = 1000;

/** No weight moves more than this in one attack, so none reaches its bound in under seven. */
export const BRAIN_STEP = 30;

/** How fast the baseline follows the scores: a quarter of the way each attack. */
export const BASELINE_RATE = 0.25;

export const ZERO_BRAIN: BrainWeights = { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 };

const clampWeight = (value: number): number =>
  Math.min(Math.max(Math.round(value), -BRAIN_BOUND), BRAIN_BOUND);

/**
 * A brain as stored or as a log carries it, made safe: each known weight a
 * finite number, rounded and clamped; anything missing or malformed is 0.
 */
export const parseBrain = (raw: unknown): BrainWeights => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ZERO_BRAIN;
  const record = raw as Record<string, unknown>;
  const out: Record<BrainKey, number> = { ...ZERO_BRAIN };
  for (const key of BRAIN_KEYS) {
    const value = record[key];
    out[key] = typeof value === "number" && Number.isFinite(value) ? clampWeight(value) : 0;
  }
  return out;
};

export const isZeroBrain = (brain: BrainWeights): boolean =>
  BRAIN_KEYS.every((key) => brain[key] === 0);

/** A brain as the base `stanceWeights` adds a Mode's tilt to. */
export const brainBase = (raw: unknown): StanceWeights => {
  const brain = parseBrain(raw);
  return { ...ZERO_WEIGHTS, ...brain };
};

/* ── What it has learned from ─────────────────────────────────────────────── */

/** The baselines, one per Mode, since each Mode judges by its own goal. */
type BaselineKey = "off" | "hyb" | "def";

const BASELINE_OF: Readonly<Record<ChampionStance, BaselineKey>> = {
  offensive: "off",
  hybrid: "hyb",
  defensive: "def",
};

/** `bs` on the save entry: attacks learned from, and each Mode's usual score. */
export interface BrainStats {
  readonly n: number;
  readonly off?: number;
  readonly hyb?: number;
  readonly def?: number;
}

const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

/** `bs` made safe: a whole count of 0 or more, each baseline a score of 0 to 1 or absent. */
export const parseBrainStats = (raw: unknown): BrainStats => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { n: 0 };
  const record = raw as Record<string, unknown>;
  const count = record.n;
  const n = typeof count === "number" && Number.isSafeInteger(count) && count > 0 ? count : 0;
  const out: { n: number; off?: number; hyb?: number; def?: number } = { n };
  for (const key of ["off", "hyb", "def"] as const) {
    const value = record[key];
    if (isScore(value)) out[key] = value;
  }
  return out;
};

/* ── A lesson ─────────────────────────────────────────────────────────────── */

/**
 * What one attack taught one attacking champion, recorded by the engine when
 * the server's replay runs with `learn` (`BattleOptions.learn`).
 */
export interface ChampionLesson {
  /** The champion type, `t`. */
  readonly t: number;
  /** Looks that had two or more candidates to choose between. */
  readonly picks: number;
  /** Per feature, the sum over those looks of chosen less the candidates' mean. */
  readonly credit: BrainWeights;
  /** Health it took off buildings, after fortification. */
  readonly dealt: number;
  /**
   * What it could have taken off if it had swung at full rate from its fling
   * until the battle ended or it was called back: damage per tick × ticks.
   */
  readonly potential: number;
  /** Its health when flung, and when the battle ended (0 for a death). */
  readonly startHp: number;
  readonly endHp: number;
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;

/**
 * How the attack went for the champion by its Mode's goal, 0 to 1: Offensive
 * the share of its potential damage it dealt, Defensive the share of its
 * health it kept, Hybrid the mean of the two.
 */
export const lessonScore = (lesson: ChampionLesson, stance: ChampionStance): number => {
  const damage = lesson.potential > 0 ? clamp01(lesson.dealt / lesson.potential) : 0;
  const health = lesson.startHp > 0 ? clamp01(lesson.endHp / lesson.startHp) : 0;
  if (stance === "offensive") return damage;
  if (stance === "defensive") return health;
  return (damage + health) / 2;
};

/**
 * The brain and stats after one landed attack (see the file comment).
 *
 * @param brain - The champion's `b`, as stored.
 * @param stats - The champion's `bs`, as stored.
 * @param lesson - What the server's replay recorded for it.
 * @param stance - The Mode it fought in.
 */
export const learnFromLesson = (
  brain: unknown,
  stats: unknown,
  lesson: ChampionLesson,
  stance: ChampionStance,
  rate: number = BRAIN_RATE,
): { brain: BrainWeights; stats: BrainStats } => {
  const before = parseBrain(brain);
  const known = parseBrainStats(stats);
  const key = BASELINE_OF[stance];
  const score = lessonScore(lesson, stance);
  const baseline = known[key];

  const next: Record<BrainKey, number> = { ...before };
  if (baseline !== undefined && lesson.picks > 0) {
    const advantage = score - baseline;
    for (const feature of BRAIN_KEYS) {
      const mean = lesson.credit[feature] / lesson.picks;
      // Threat is taken off a score, so leaning toward a threatening pick is a lower weight.
      const credit = feature === "threat" ? -mean : mean;
      const step = Math.min(Math.max(rate * advantage * credit, -BRAIN_STEP), BRAIN_STEP);
      next[feature] = clampWeight(before[feature] + step);
    }
  }
  const nextBaseline =
    baseline === undefined ? score : baseline + BASELINE_RATE * (score - baseline);
  return {
    brain: next,
    stats: { ...known, n: known.n + 1, [key]: nextBaseline },
  };
};
