/**
 * A champion's Mode when it attacks (issue #220): Offensive, Hybrid or
 * Defensive. The code calls it a **stance**, because `championMode()` in
 * `stats.ts` already names the champion's movement and attack strings.
 *
 * A stance is behaviour only: it changes which building the champion picks,
 * never its health, damage, speed or range, so the damage audit
 * (`potential.ts`) holds unchanged. Defending champions have no stance.
 *
 * ## How a pick is scored
 *
 * The champion still chooses from Flash's own lists (`targeting.ts`
 * `findChampionTarget`, Krallen's stages included). Within a list, instead of
 * the closest building it takes the lowest
 *
 *     distance - bonus,   bonus = trunc(Σ weight × feature)
 *
 * with ties kept in list order, which is id order. Weights are in distance
 * units: a tower weight of 200 means "I will walk 200 further to hit a tower".
 * The features ({@link TargetFeatures}) are read off the yard and the field at
 * the moment the champion looks, on its usual 100-frame look.
 *
 * One gate sits beside the score: with a {@link StanceWeights.margin} above 0
 * the champion leaves out a tower it {@link cannotBeat}. A stage the gate
 * empties falls through to the next, and when the gate leaves nothing at all
 * the champion takes its pick without it, so it never stands still.
 *
 * ## Weights, tilts and the brain
 *
 * The weights a champion fights with are its **base** weights plus its
 * stance's **tilt**, each clamped to {@link WEIGHT_BOUNDS}. The base is the
 * champion's learned brain (issue #219, `brain.ts`), frozen into the attack's
 * log at launch; a log without one is a zero base.
 * Hybrid's tilt is zero, so with a zero base a Hybrid champion is exactly the
 * Flash champion, and so is one flung by a log that names no stance: every
 * fixture recorded before stances replays unchanged.
 *
 * ## Determinism
 *
 * Only `+ - * /`, `Math.min`, `Math.max` and `Math.trunc`, each written in one
 * fixed order; the engine sums the features over towers and creeps in id
 * order. Nothing here draws from the random stream.
 */

export type ChampionStance = "offensive" | "hybrid" | "defensive";

/** The three, in the order the army panel lists them. */
export const CHAMPION_STANCES: readonly ChampionStance[] = ["offensive", "hybrid", "defensive"];

/** What a new champion, and a log or save that names none, fights as. */
export const DEFAULT_STANCE: ChampionStance = "hybrid";

export const isChampionStance = (value: unknown): value is ChampionStance =>
  value === "offensive" || value === "hybrid" || value === "defensive";

/** The weight of each feature, in distance units, plus the can't-beat gate. */
export interface StanceWeights {
  /** For a live tower. */
  readonly tower: number;
  /** For a lootable building with loot left ({@link TargetFeatures.loot}). */
  readonly loot: number;
  /** Per share of its health already gone. */
  readonly finish: number;
  /** Per share of {@link FOCUS_CAP} allies already on it. */
  readonly focus: number;
  /** Taken off per unit of {@link threatFeature}: a penalty, not a bonus. */
  readonly threat: number;
  /** For the building it is already on, so a near tie does not flip it. */
  readonly stay: number;
  /** The {@link cannotBeat} margin; 0 switches the gate off. */
  readonly margin: number;
}

export const ZERO_WEIGHTS: StanceWeights = {
  tower: 0,
  loot: 0,
  finish: 0,
  focus: 0,
  threat: 0,
  stay: 0,
  margin: 0,
};

/**
 * Each stance's tilt. PLACEHOLDER figures, tuned against the balance matrix
 * (`stance.test.ts`); tuning is an edit here and `npm run sync:combat`.
 *
 * - Offensive goes for the towers that are killing its wave and finishes what
 *   is already hurt, and pays no heed to what shoots at it.
 * - Hybrid is the Flash champion.
 * - Defensive keeps out from under tower fire, walks to what its monsters are
 *   already hitting (the towers are locked on to them by then), and leaves
 *   alone a tower that would kill it first. It only re-orders its targets: it
 *   never holds back or stops (owner's decision, 2026-10-01), so on a yard it
 *   must clear anyway it often keeps no more health than Offensive, which
 *   kills the towers sooner.
 */
export const STANCE_TILTS: Readonly<Record<ChampionStance, StanceWeights>> = {
  offensive: { tower: 200, loot: 50, finish: 150, focus: 0, threat: 0, stay: 60, margin: 0 },
  hybrid: ZERO_WEIGHTS,
  defensive: { tower: 0, loot: 0, finish: 50, focus: 200, threat: 600, stay: 60, margin: 1.5 },
};

/**
 * What any weight may come to, base plus tilt, so no base the brain learns can
 * make a champion ignore distance altogether.
 */
export const WEIGHT_BOUNDS: Readonly<Record<keyof StanceWeights, readonly [number, number]>> = {
  tower: [-400, 400],
  loot: [-400, 400],
  finish: [-400, 400],
  focus: [-400, 400],
  threat: [0, 800],
  stay: [0, 200],
  margin: [0, 3],
};

const WEIGHT_KEYS: readonly (keyof StanceWeights)[] = [
  "tower",
  "loot",
  "finish",
  "focus",
  "threat",
  "stay",
  "margin",
];

/**
 * The weights a champion fights with: `base` plus its stance's tilt, clamped.
 * Null when every weight is 0, which is the Flash champion, so the engine can
 * keep the plain closest-building path. An absent stance is Hybrid.
 */
export const stanceWeights = (
  stance: ChampionStance | undefined,
  base: StanceWeights = ZERO_WEIGHTS,
): StanceWeights | null => {
  const tilt = STANCE_TILTS[stance ?? DEFAULT_STANCE];
  const resolved: Record<keyof StanceWeights, number> = { ...ZERO_WEIGHTS };
  let any = false;
  for (const key of WEIGHT_KEYS) {
    const [low, high] = WEIGHT_BOUNDS[key];
    const value = Math.min(Math.max(base[key] + tilt[key], low), high);
    resolved[key] = value;
    if (value !== 0) any = true;
  }
  return any ? resolved : null;
};

/* ── Features ─────────────────────────────────────────────────────────────── */

/** What the score reads off one candidate building. */
export interface TargetFeatures {
  /** 1 for a live tower that is not under a Jar, else 0. */
  readonly tower: number;
  /** 1 for a lootable building with loot left (`unlootedForKrallen`), else 0. */
  readonly loot: number;
  /** `1 - hp / maxHp`, 0 to 1. */
  readonly finish: number;
  /** {@link focusFeature}, 0 to 1. */
  readonly focus: number;
  /** {@link threatFeature}, 0 to {@link THREAT_CAP}. */
  readonly threat: number;
  /** 1 for the building the champion is already on, else 0. */
  readonly stay: number;
}

/** Allies on a building past this many add nothing more. */
export const FOCUS_CAP = 5;

/** The attacker's other creeps already on the building, as a share of the cap. */
export const focusFeature = (allies: number): number => Math.min(allies, FOCUS_CAP) / FOCUS_CAP;

/** Threat counts up to twice the champion's health; past that, all are hopeless alike. */
export const THREAT_CAP = 2;

/**
 * The share of its health the champion would lose taking a building down: the
 * damage per tick of the towers covering it, times the ticks the building
 * takes to fall, over the health the champion has left. Uncapped; the score
 * reads it through {@link threatFeature} and the gate through
 * {@link cannotBeat}. A wounded champion sees the same towers as a bigger
 * cost, which is its caution.
 *
 * @param takenPerTick - The summed damage per tick of the towers that cover it and can hit
 *   the champion.
 * @param buildingHp - The building's health now.
 * @param dealtPerTick - The champion's damage per tick to it, after fortification.
 * @param health - The champion's health now.
 */
export const exposure = (
  takenPerTick: number,
  buildingHp: number,
  dealtPerTick: number,
  health: number,
): number => {
  if (takenPerTick <= 0) return 0;
  if (health <= 0 || dealtPerTick <= 0) return Number.POSITIVE_INFINITY;
  return (takenPerTick * (buildingHp / dealtPerTick)) / health;
};

/** {@link exposure} as the score reads it, 0 to {@link THREAT_CAP}. */
export const threatFeature = (share: number): number => Math.min(share, THREAT_CAP);

/** A tower's damage per tick: one shot every `rate × rearm` ticks (`BTOWER.as:184-220`). */
export const towerPerTick = (damage: number, rate: number, rearm: number): number =>
  rate > 0 && damage > 0 ? damage / (rate * rearm) : 0;

/** `trunc(Σ weight × feature)`, summed in one fixed order. */
export const stanceBonus = (weights: StanceWeights, features: TargetFeatures): number =>
  Math.trunc(
    weights.tower * features.tower +
      weights.loot * features.loot +
      weights.finish * features.finish +
      weights.focus * features.focus -
      weights.threat * features.threat +
      weights.stay * features.stay,
  );

/**
 * The gate: a tower the champion would not outlast. Taking it down costs
 * `share` of its health ({@link exposure}); it is left alone when that share,
 * times `margin`, is more than the champion has, so a margin of 1.5 leaves
 * alone any tower that would cost two thirds of what is left.
 *
 * @param share - {@link exposure} at the tower.
 * @param margin - {@link StanceWeights.margin}; 0 or less never skips.
 */
export const cannotBeat = (share: number, margin: number): boolean =>
  margin > 0 && share * margin > 1;
