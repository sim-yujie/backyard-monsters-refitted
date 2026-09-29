import type { BaseLoadResponse } from "@/api/types";
import type { AttackTarget } from "@/game/attack/attackTarget";
import { defenderForcesOf } from "@/game/combat/rules";
import { academyLevels } from "@/game/monsters/hatchPlan";
import { housingSpace } from "@/game/monsters/monsterCatalogue";

/**
 * The Wild Monster Baiter as a defence simulator (issue #126, yard WP6.1,
 * `docs/design/yard-buildings.md` §8.1, D18, Q5).
 *
 * In Flash the Baiter lured a real wild-monster attack onto the player's own
 * yard, and its damage was saved. Here it is a practice run: the player picks
 * a direction and an army, and the attack scene fights it out on a copy of
 * their yard. Nothing is sent to the server and nothing is saved.
 *
 * What a Baiter level means is what it meant in practice in Flash: the size of
 * the attack and how many directions it may come from. Musk, the resource the
 * original spent, is gone: it refilled to the level's capacity every tick
 * (`client/scripts/MONSTERBAITER.as:43-44`), so it never limited anything but
 * one attack's size.
 *
 * Everything here is pure; the handoff from the yard to the scene is the one
 * piece of state ({@link setBaiterRun}, {@link consumeBaiterRun}).
 */

/** The Wild Monster Baiter's type id (`client/scripts/MONSTERBAITER.as:7`). */
export const BAITER_TYPE = 19;

/**
 * The attack size budget per Baiter level, in housing space (`cStorage`):
 * the building's `capacity` (`client/scripts/YARD_PROPS.as:1962`), read as
 * the Musk limit at `MONSTERBAITER.as:142`.
 */
export const BAITER_BUDGET: readonly number[] = [600, 900, 1_200, 1_500, 2_100, 3_200, 4_800];

/**
 * The monsters a Baiter attack is made of, whatever the level: C1 to C14
 * (`client/scripts/MONSTERBAITERPOPUP.as:49-52`; the longer list at `:45` is
 * unused).
 */
export const BAITER_ROSTER: readonly string[] = Array.from({ length: 14 }, (_, index) => `C${index + 1}`);

/** One way the attack can come in. */
export interface BaiterDirection {
  /** Flash's arrow: `tl`, `tr`, `br`, `bl`, `t`, `r`, `b`, `l`. */
  readonly id: string;
  readonly label: string;
  /** Degrees, in the yard's own (cartesian) axes. */
  readonly angle: number;
}

/**
 * The eight directions in Flash's order (`MONSTERBAITERPOPUP.as:41`, `:61`
 * for the angles): the four corners first, which is all a Baiter below level
 * 3 offers, then the four sides. An angle of 0 is the yard's +x axis, which
 * the isometric view draws towards the bottom right.
 */
export const BAITER_DIRECTIONS: readonly BaiterDirection[] = [
  { id: "tl", label: "Top left", angle: 180 },
  { id: "tr", label: "Top right", angle: 270 },
  { id: "br", label: "Bottom right", angle: 0 },
  { id: "bl", label: "Bottom left", angle: 90 },
  { id: "t", label: "Top", angle: 225 },
  { id: "r", label: "Right", angle: 315 },
  { id: "b", label: "Bottom", angle: 45 },
  { id: "l", label: "Left", angle: 135 },
];

/**
 * How far out the attack lands, in yard units: `800 + 400 / 2`
 * (`client/scripts/WMATTACK.as:711`, the 400 of `MONSTERBAITERPOPUP.as:61`).
 */
export const BAITER_SPAWN_DISTANCE = 1_000;

/** The Baiter's level, clamped to the table; a foundation reads as level 1. */
const levelIndex = (level: number): number =>
  Math.min(Math.max(Math.floor(level) || 1, 1), BAITER_BUDGET.length) - 1;

/** The attack size budget of a Baiter at `level`. */
export const budgetOf = (level: number): number => BAITER_BUDGET[levelIndex(level)] ?? BAITER_BUDGET[0]!;

/** The directions a Baiter at `level` offers: 4 below level 3, 8 from it (`MONSTERBAITERPOPUP.as:61`). */
export const directionsOf = (level: number): readonly BaiterDirection[] =>
  levelIndex(level) + 1 >= 3 ? BAITER_DIRECTIONS : BAITER_DIRECTIONS.slice(0, 4);

/** Where the attack lands for a direction, in yard units. */
export const spawnPointOf = (direction: BaiterDirection): { x: number; y: number } => {
  const radians = (direction.angle * Math.PI) / 180;
  // `+ 0` turns a rounded -0 into 0.
  return {
    x: Math.round(Math.cos(radians) * BAITER_SPAWN_DISTANCE) + 0,
    y: Math.round(Math.sin(radians) * BAITER_SPAWN_DISTANCE) + 0,
  };
};

/** Which stats the attackers fight with (Q5, the player's choice). */
export type BaiterLevels = "wild" | "academy";

/**
 * Academy level per monster for the attackers: none (level 1, the original's
 * wild attack, `MONSTERBAITER.as:55-60`) or the player's own.
 */
export const levelsFor = (
  choice: BaiterLevels,
  save: Pick<BaseLoadResponse, "academy">,
): Record<string, number> => (choice === "academy" ? academyLevels(save) : {});

/** Housing space one monster takes at its level, as the budget counts it (`MonsterBaiterItem.as:37`). */
export const costOf = (id: string, levels: Readonly<Record<string, number>>): number =>
  housingSpace(id, levels[id] ?? 1) ?? 0;

/** How much of the budget an army takes. */
export const attackSize = (
  picks: Readonly<Record<string, number>>,
  levels: Readonly<Record<string, number>>,
): number =>
  Object.entries(picks).reduce((sum, [id, count]) => sum + costOf(id, levels) * Math.max(0, count), 0);

/** The most of `id` the army can hold, the other picks as they are. */
export const maxOf = (
  id: string,
  picks: Readonly<Record<string, number>>,
  budget: number,
  levels: Readonly<Record<string, number>>,
): number => {
  const each = costOf(id, levels);
  if (each <= 0) return 0;
  const others = attackSize({ ...picks, [id]: 0 }, levels);
  return Math.max(0, Math.floor((budget - others) / each));
};

/** The picks cut back to fit `budget` (a level switch can shrink what fits), roster order. */
export const clampPicks = (
  picks: Readonly<Record<string, number>>,
  budget: number,
  levels: Readonly<Record<string, number>>,
): Record<string, number> => {
  const kept: Record<string, number> = {};
  for (const id of BAITER_ROSTER) {
    const want = Math.max(0, Math.floor(picks[id] ?? 0));
    if (want === 0) continue;
    const fits = Math.min(want, maxOf(id, kept, budget, levels));
    if (fits > 0) kept[id] = fits;
  }
  return kept;
};

/** One practice attack, as the yard hands it to the scene. */
export interface BaiterRun {
  /** The player's own yard as it stands now: the load the scene fights on. */
  readonly save: BaseLoadResponse;
  readonly picks: Readonly<Record<string, number>>;
  readonly direction: BaiterDirection;
  readonly levels: BaiterLevels;
  /** The Baiter's level, for the summary. */
  readonly baiterLevel: number;
}

let pendingRun: BaiterRun | null = null;

/** Records the practice attack the Baiter scene should run next. */
export const setBaiterRun = (run: BaiterRun): void => {
  pendingRun = run;
};

/** Takes the pending practice attack, clearing it. */
export const consumeBaiterRun = (): BaiterRun | null => {
  const run = pendingRun;
  pendingRun = null;
  return run;
};

/**
 * The attack scene's target for a run: the own yard as the defender, handed
 * over already loaded so the scene asks the server for nothing, and the
 * picked army as the roster. No champion, no Catapult, no siege weapons, no
 * resources to buy bombs with: a Baiter attack is monsters only. The yard
 * defends itself as it would against a real attack (issue #195, Q16): its
 * bunkers' garrisons at its own academy levels, and its caged champion.
 */
export const baiterTarget = (run: BaiterRun): AttackTarget => ({
  baseid: String(run.save.baseid ?? ""),
  kind: "wild",
  name: "Wild monsters",
  load: {
    ...run.save,
    defenderforces: defenderForcesOf({
      buildingdata: run.save.buildingdata,
      academy: run.save.academy,
      champion: run.save.champion,
    }),
  },
  roster: {
    monsters: { ...run.picks },
    levels: levelsFor(run.levels, run.save),
    champions: [],
    flingerLevel: 0,
    catapultLevel: 0,
    sources: [],
    siege: null,
    resources: null,
  },
});
