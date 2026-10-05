import type { BaseLoadResponse, ChampionSaveEntry } from "@/api/types";
import type { AttackRoster, AttackTarget } from "@/game/attack/attackTarget";
import { KRALLEN_TYPE } from "@/game/attack/AttackSession";
import { ownYardTarget } from "@/game/attack/ownYardTarget";
import {
  CHAMPION_MAX_POWER_LEVEL,
  KRALLEN_MAX_POWER_LEVEL,
  championByType,
  championStatWithPower,
  isChampionStance,
  type ChampionStance,
} from "@/game/combat/rules";
import { academyLevel, housedCount } from "@/game/monsters/housing";
import { LISTED_MONSTERS, housingSpace, maxTrainingLevel } from "@/game/monsters/monsterCatalogue";
import { championEntry } from "@/game/yard/championCatalogue";

/**
 * The Wild Monster Baiter as a defence simulator (issues #126 and #22,
 * `docs/design/baiter-simulator.md` §5.1, `docs/design/yard-buildings.md`
 * §8.1, D18).
 *
 * In Flash the Baiter lured a real wild-monster attack onto the player's own
 * yard, and its damage was saved. Here it is a free, unlimited test: the
 * player makes up a **test army** (any of the 18 surface monsters, each at any
 * academy level, unlocked or not, plus champions at any level) and the attack
 * scene fights it out on a copy of their yard. Nothing is sent to the server
 * and nothing is saved.
 *
 * What a Baiter level means is the one thing it meant in practice in Flash:
 * how big one attack may be (owner answer Q1). Musk, the resource the original
 * spent, is gone: it refilled to the level's capacity every tick
 * (`client/scripts/MONSTERBAITER.as:43-44`), so it never limited anything but
 * one attack's size.
 *
 * Everything here is pure; the handoff from the yard to the scene is the one
 * piece of state ({@link setBaiterRun}, {@link consumeBaiterRun}).
 */

/** The Wild Monster Baiter's type id (`client/scripts/MONSTERBAITER.as:7`). */
export const BAITER_TYPE = 19;

/**
 * The test army's cap per Baiter level, in housing space (`cStorage`): the
 * building's `capacity` (`client/scripts/YARD_PROPS.as:1962`), read as the
 * Musk limit at `MONSTERBAITER.as:142` (owner answer Q1).
 */
export const BAITER_CAP: readonly number[] = [600, 900, 1_200, 1_500, 2_100, 3_200, 4_800];

/**
 * The monsters a test army can hold, whatever the level: the 18 surface
 * monsters a player can hatch (C1-C17 and C19), in the hatchery's list order.
 * Not the Inferno monsters (owner answer Q2), and not C18, which only a dead
 * Slimeattikus leaves behind.
 */
export const TEST_ROSTER: readonly string[] = LISTED_MONSTERS.map((entry) => entry.id);

/** One roster row of a test army: how many, and at which academy level. */
export interface TestRow {
  readonly count: number;
  readonly level: number;
}

/** One made-up champion in a test army: type, evolution level, power level, Mode. */
export interface TestChampion {
  readonly t: number;
  readonly l: number;
  readonly pl: number;
  readonly s?: ChampionStance;
}

/**
 * A test army: a row for every {@link TEST_ROSTER} monster (a count of 0 is a
 * row the player has not filled, and keeps its level), and up to two
 * champions, one ordinary and Krallen.
 */
export interface TestArmy {
  readonly monsters: Readonly<Record<string, TestRow>>;
  readonly champions: readonly TestChampion[];
}

/** The Baiter's level, clamped to the table; a foundation reads as level 1. */
const levelIndex = (level: number): number =>
  Math.min(Math.max(Math.floor(level) || 1, 1), BAITER_CAP.length) - 1;

/** The test army's cap for a Baiter at `level`. */
export const capOf = (level: number): number => BAITER_CAP[levelIndex(level)] ?? BAITER_CAP[0]!;

/** `level` as a level `id` can have: a whole number from 1 to its highest academy level. */
export const clampLevel = (id: string, level: number): number =>
  Math.min(Math.max(Math.floor(level) || 1, 1), Math.max(1, maxTrainingLevel(id)));

/** The level a row starts at: the player's own academy level for `id`, 1 when never trained. */
export const defaultLevelOf = (save: Pick<BaseLoadResponse, "academy">, id: string): number =>
  clampLevel(id, academyLevel(save.academy, id));

/**
 * Whether the player has unlocked `id` (`lockerdata[id].t == 2`, the hatchery's
 * rule). A test offers locked monsters too (decision 13); this only tags them.
 */
export const isUnlocked = (save: Pick<BaseLoadResponse, "lockerdata">, id: string): boolean =>
  Number(save.lockerdata?.[id]?.t) === 2;

/** An army with no monsters and no champions, every row at the player's own level. */
export const emptyArmy = (save: Pick<BaseLoadResponse, "academy">): TestArmy => ({
  monsters: Object.fromEntries(TEST_ROSTER.map((id) => [id, { count: 0, level: defaultLevelOf(save, id) }])),
  champions: [],
});

/** The army with every row's level set by `levelOf`; counts and champions kept. */
const withLevels = (army: TestArmy, levelOf: (id: string) => number): TestArmy => ({
  monsters: Object.fromEntries(
    TEST_ROSTER.map((id) => [id, { count: army.monsters[id]?.count ?? 0, level: clampLevel(id, levelOf(id)) }]),
  ),
  champions: army.champions,
});

/** Shortcut **My levels**: every row at the player's own academy level. */
export const myLevels = (army: TestArmy, save: Pick<BaseLoadResponse, "academy">): TestArmy =>
  withLevels(army, (id) => defaultLevelOf(save, id));

/** Shortcut **All level 1**. */
export const allLevel1 = (army: TestArmy): TestArmy => withLevels(army, () => 1);

/** Shortcut **All max**: every row at its highest academy level. */
export const allMax = (army: TestArmy): TestArmy => withLevels(army, (id) => maxTrainingLevel(id));

/**
 * Shortcut **My army**: the monsters housed in the yard right now, at the
 * player's own levels, so "will my real army get through my own defences?" is
 * one click. The army's champions are kept: a test champion is always a
 * made-up one (owner answer Q6). Not cut to a cap; {@link clampArmy} does that.
 */
export const myArmy = (
  army: TestArmy,
  save: Pick<BaseLoadResponse, "academy" | "monsters">,
): TestArmy => ({
  monsters: Object.fromEntries(
    TEST_ROSTER.map((id) => [id, { count: housedCount(save, id), level: defaultLevelOf(save, id) }]),
  ),
  champions: army.champions,
});

/** Housing space one `id` takes at `level`, as the cap counts it (`MonsterBaiterItem.as:35`). */
export const spaceOf = (id: string, level: number): number => housingSpace(id, clampLevel(id, level)) ?? 0;

/** How much of the cap the army takes: each row at its own level. Champions take none. */
export const armySize = (army: TestArmy): number =>
  TEST_ROSTER.reduce((sum, id) => {
    const row = army.monsters[id];
    return row ? sum + spaceOf(id, row.level) * Math.max(0, Math.floor(row.count)) : sum;
  }, 0);

/** The most of `id` the army can hold at its row's level, the other rows as they are. */
export const maxOf = (army: TestArmy, id: string, cap: number): number => {
  const row = army.monsters[id];
  const each = spaceOf(id, row?.level ?? 1);
  if (each <= 0) return 0;
  const others = armySize({ ...army, monsters: { ...army.monsters, [id]: { count: 0, level: row?.level ?? 1 } } });
  return Math.max(0, Math.floor((cap - others) / each));
};

/** The highest evolution level of champion type `t`: 6, Krallen 5; 0 for an unknown type. */
export const championLevels = (t: number): number => championEntry(t)?.levels ?? 0;

/** The highest power level of champion type `t`: 3, Krallen 2. */
export const championPowerLevels = (t: number): number =>
  t === KRALLEN_TYPE ? KRALLEN_MAX_POWER_LEVEL : CHAMPION_MAX_POWER_LEVEL;

/** A champion pick made whole: its level and power level in range; null for an unknown type. */
const clampChampion = (champion: TestChampion): TestChampion | null => {
  const levels = championLevels(champion.t);
  if (levels <= 0 || !championByType(champion.t)) return null;
  return {
    t: champion.t,
    l: Math.min(Math.max(Math.floor(champion.l) || 1, 1), levels),
    pl: Math.min(Math.max(Math.floor(champion.pl) || 0, 0), championPowerLevels(champion.t)),
    ...(isChampionStance(champion.s) ? { s: champion.s } : {}),
  };
};

/**
 * The army with `champion` in it, by the attack's own rule
 * (`AttackSession.championBlock`): one ordinary champion plus Krallen. An
 * ordinary pick takes the ordinary slot, Krallen hers.
 */
export const withChampion = (army: TestArmy, champion: TestChampion): TestArmy => {
  const pick = clampChampion(champion);
  if (!pick) return army;
  const krallen = pick.t === KRALLEN_TYPE;
  const kept = army.champions.filter((one) => (one.t === KRALLEN_TYPE) !== krallen);
  return { ...army, champions: sortChampions([...kept, pick]) };
};

/** The army without champion type `t`. */
export const withoutChampion = (army: TestArmy, t: number): TestArmy => ({
  ...army,
  champions: army.champions.filter((one) => one.t !== t),
});

/** The ordinary champion first, then Krallen. */
const sortChampions = (champions: readonly TestChampion[]): TestChampion[] =>
  [...champions].sort((one, other) => Number(one.t === KRALLEN_TYPE) - Number(other.t === KRALLEN_TYPE));

/**
 * The army made whole and cut back to fit `cap`: a row for every roster
 * monster, levels in range, whole counts filled in roster order as far as the
 * cap allows, and at most one ordinary champion plus Krallen, each in range.
 * What a remembered army or a shortcut needs before it is shown or run.
 */
export const clampArmy = (army: TestArmy, cap: number): TestArmy => {
  const monsters: Record<string, TestRow> = {};
  for (const id of TEST_ROSTER) monsters[id] = { count: 0, level: clampLevel(id, army.monsters[id]?.level ?? 1) };
  let kept: TestArmy = { monsters, champions: [] };
  for (const id of TEST_ROSTER) {
    const want = Math.max(0, Math.floor(army.monsters[id]?.count ?? 0));
    if (want === 0) continue;
    const count = Math.min(want, maxOf(kept, id, cap));
    kept = { ...kept, monsters: { ...kept.monsters, [id]: { count, level: monsters[id]!.level } } };
  }
  for (const champion of army.champions) kept = withChampion(kept, champion);
  return kept;
};

/** The monsters to send, by id: only rows with a count. */
export const picksOf = (army: TestArmy): Record<string, number> => {
  const picks: Record<string, number> = {};
  for (const id of TEST_ROSTER) {
    const count = Math.max(0, Math.floor(army.monsters[id]?.count ?? 0));
    if (count > 0) picks[id] = count;
  }
  return picks;
};

/** Each row's academy level, by id, which is what the attack's `levels` carries. */
export const levelsOf = (army: TestArmy): Record<string, number> =>
  Object.fromEntries(TEST_ROSTER.map((id) => [id, clampLevel(id, army.monsters[id]?.level ?? 1)]));

/**
 * A test champion as the attack's roster lists champions (`ChampionSaveEntry`):
 * made up, at full health for its level and power level, active (`status: 0`),
 * fed nothing, and with no learned brain, so it always fights as a fresh one
 * (owner answer Q6).
 */
export const testChampionEntry = (champion: TestChampion): ChampionSaveEntry => {
  const id = championByType(champion.t) ?? "";
  return {
    t: champion.t,
    l: champion.l,
    pl: champion.pl,
    hp: championStatWithPower(id, "health", champion.l, champion.pl),
    status: 0,
    ft: 0,
    fd: 0,
    fb: 0,
    ...(champion.s ? { s: champion.s } : {}),
  };
};

/**
 * The attack roster of a test: the army's monsters at their levels and its
 * made-up champions. No Catapult, no siege weapons, no resources to buy bombs
 * with (owner answer Q7), and no flinger cells: a test is monsters and
 * champions only.
 */
export const testRoster = (army: TestArmy): AttackRoster => ({
  monsters: picksOf(army),
  levels: levelsOf(army),
  champions: army.champions.map(testChampionEntry),
  flingerLevel: 0,
  catapultLevel: 0,
  sources: [],
  siege: null,
  resources: null,
});

/** One test, as the yard hands it to the scene. */
export interface BaiterRun {
  /** The player's own yard as it stands now: the load the scene fights on (owner answer Q4). */
  readonly save: BaseLoadResponse;
  readonly army: TestArmy;
  /** The Baiter's level, for the summary. */
  readonly baiterLevel: number;
}

let pendingRun: BaiterRun | null = null;

/** Records the test the Baiter scene should run next. */
export const setBaiterRun = (run: BaiterRun): void => {
  pendingRun = run;
};

/** Takes the pending test, clearing it. */
export const consumeBaiterRun = (): BaiterRun | null => {
  const run = pendingRun;
  pendingRun = null;
  return run;
};

/** The attack scene's target for a test: the own yard against the test army. */
export const baiterTarget = (run: BaiterRun): AttackTarget => ownYardTarget(run.save, testRoster(run.army));
