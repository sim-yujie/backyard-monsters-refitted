import type { DefenceBonus } from "./engine.js";

/**
 * Map Room 2 land features: design A of `docs/mr2-civ-study.md`, approved by
 * the owner ("Go with A", 3 Nov 2026).
 *
 * Every land cell keeps its height and today's height rule (tower range and
 * income, `towerRange` and the server's `harvesterIncome`), and gets ONE
 * feature on top. The server picks it from a second noise on the world seed
 * (`server/src/services/maproom/v2/landFeature.ts`), so there is no new
 * database column and every cell of every world has one for good. It sends
 * the id to the map as a cell's `lf` and freezes it into an attack's defence
 * as `land` (`defence.ts`), so the player's game and the server's re-check
 * fight the same battle.
 *
 * What each feature does, in whole percent:
 *
 * | Feature              | Health | Tower damage | Tower range | Income               |
 * |----------------------|--------|--------------|-------------|----------------------|
 * | Open (grass, sand)   | 0      | 0            | 0           | 0                    |
 * | Forest               | +20    | 0            | -10         | Twigs +50            |
 * | Rocks                | +10    | +10          | 0           | Pebbles +50          |
 * | Marsh                | -10    | 0            | 0           | Putty +25, Goo +50   |
 * | Twig/Pebble/Putty/Goo node | 0 | 0           | 0           | that resource +100   |
 *
 * How it stacks:
 * - Tower range: the height rule first (`int(h * range / 125)` on an outpost),
 *   then the feature: `int(range * (100 + pct) / 100)`.
 * - Income: the height rule first (`max(int(produce * 125 / h), 1)`), then the
 *   feature the same way, never below 1.
 * - Health and tower damage: multiplied with the neighbour bonus
 *   (`combineDefenceBonus`): a forest cell with one friendly neighbour has
 *   1.20 x 1.05 = 1.26 times the building toughness.
 *
 * It applies to a player's outpost and to a wild monster camp (both players
 * and tribes, as the neighbour bonus), not to a player's main yard, which the
 * study's table leaves out as the height rule does.
 */

/** The feature ids the server sends (`lf`) and stores in a defence (`land`). */
export const LandFeature = {
  OPEN: 0,
  FOREST: 1,
  ROCKS: 2,
  MARSH: 3,
  TWIG_NODE: 4,
  PEBBLE_NODE: 5,
  PUTTY_NODE: 6,
  GOO_NODE: 7,
} as const;

export type LandFeatureId = (typeof LandFeature)[keyof typeof LandFeature];

/** What one feature does, in whole percent. */
export interface LandFeatureEffect {
  /** Building health: each hit does 100 / (100 + hp) of what it would. */
  readonly hp: number;
  /** Tower damage. */
  readonly damage: number;
  /** Tower range. */
  readonly range: number;
  /** Outpost income per resource: twigs, pebbles, putty, goo (`r1`..`r4`). */
  readonly income: readonly [number, number, number, number];
}

const NOTHING: LandFeatureEffect = { hp: 0, damage: 0, range: 0, income: [0, 0, 0, 0] };

/** The design A table (`docs/mr2-civ-study.md` section 3). */
export const LAND_FEATURE_EFFECTS: Readonly<Record<LandFeatureId, LandFeatureEffect>> = {
  [LandFeature.OPEN]: NOTHING,
  [LandFeature.FOREST]: { hp: 20, damage: 0, range: -10, income: [50, 0, 0, 0] },
  [LandFeature.ROCKS]: { hp: 10, damage: 10, range: 0, income: [0, 50, 0, 0] },
  [LandFeature.MARSH]: { hp: -10, damage: 0, range: 0, income: [0, 0, 25, 50] },
  [LandFeature.TWIG_NODE]: { ...NOTHING, income: [100, 0, 0, 0] },
  [LandFeature.PEBBLE_NODE]: { ...NOTHING, income: [0, 100, 0, 0] },
  [LandFeature.PUTTY_NODE]: { ...NOTHING, income: [0, 0, 100, 0] },
  [LandFeature.GOO_NODE]: { ...NOTHING, income: [0, 0, 0, 100] },
};

/** A feature id read from the wire or a stored defence; open for anything else. */
export const landFeatureOf = (raw: unknown): LandFeatureId =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 && raw <= 7
    ? (raw as LandFeatureId)
    : LandFeature.OPEN;

/** What a feature does ({@link LAND_FEATURE_EFFECTS}); nothing for an unknown one. */
export const landFeatureEffect = (raw: unknown): LandFeatureEffect =>
  LAND_FEATURE_EFFECTS[landFeatureOf(raw)];

/** Whether a feature is a resource node (one resource doubled). */
export const isResourceNode = (raw: unknown): boolean =>
  landFeatureOf(raw) >= LandFeature.TWIG_NODE;

/** `value` changed by `pct` whole percent, truncated: `int(value * (100 + pct) / 100)`. */
export const scaleByPercent = (value: number, pct: number): number =>
  pct === 0 ? value : Math.trunc((value * (100 + pct)) / 100);

/**
 * One harvester's income per tick after its cell's feature: the height rule's
 * figure scaled by the feature's share for that resource, never below 1.
 *
 * @param perTick - The figure after the height rule.
 * @param feature - The cell's feature id.
 * @param resource - 1 twigs, 2 pebbles, 3 putty, 4 goo.
 */
export const landIncome = (perTick: number, feature: unknown, resource: number): number => {
  const pct = landFeatureEffect(feature).income[resource - 1] ?? 0;
  return pct === 0 ? perTick : Math.max(scaleByPercent(perTick, pct), 1);
};

/** A feature's battle bonus as fractions, or none for one that changes no fight. */
export const landDefenceBonus = (feature: unknown): DefenceBonus | undefined => {
  const { hp, damage, range } = landFeatureEffect(feature);
  if (hp === 0 && damage === 0 && range === 0) return undefined;
  return {
    hp: hp / 100,
    damage: damage / 100,
    ...(range !== 0 && { range: range / 100 }),
  };
};

/**
 * Two bonuses as one: health and damage multiply (`(1 + a) x (1 + b) - 1`),
 * range adds (only a feature has one). None when neither is given.
 */
export const combineDefenceBonus = (
  a: DefenceBonus | undefined,
  b: DefenceBonus | undefined,
): DefenceBonus | undefined => {
  if (!a) return b;
  if (!b) return a;
  const times = (x = 0, y = 0): number => (1 + x) * (1 + y) - 1;
  const range = (a.range ?? 0) + (b.range ?? 0);
  return {
    hp: times(a.hp, b.hp),
    damage: times(a.damage, b.damage),
    ...(range !== 0 && { range }),
  };
};

/** A bonus's range part as whole percent, for `towerRange`. */
export const rangePercentOf = (bonus: DefenceBonus | undefined): number =>
  Math.round((bonus?.range ?? 0) * 100);
