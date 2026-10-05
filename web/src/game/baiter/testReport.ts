import type { AttackEndReason } from "@/game/attack/AttackSession";
import {
  championMode,
  clockOf,
  hitsFlyers,
  isFlyingMovement,
  monsterMovement,
  monsterName,
  type AttackerReport,
  type BattleState,
} from "@/game/combat/rules";
import { championEntry } from "@/game/yard/championCatalogue";
import { typeName } from "@/game/yard/planner/summary";

/**
 * The report of one Baiter test (#22, WP4, `docs/design/baiter-simulator.md`
 * §7): the battle's own counters (WP0) turned into the rows the report panel
 * shows. Pure, so a headless battle can be checked against it.
 */

/** One of the yard's buildings as the test began. */
export interface ReportBuilding {
  readonly id: number;
  readonly type: number;
  readonly level: number;
  /** Its full health, for a standing building's "72%". */
  readonly maxHp: number;
}

export interface TestReportInput {
  readonly state: BattleState;
  readonly endReason: AttackEndReason | null;
  readonly buildings: readonly ReportBuilding[];
  readonly damagePercent: number;
  readonly buildingsDestroyed: number;
  readonly buildingsTotal: number;
  /** The tick each attacking champion fell at, by champion id, as the scene saw it. */
  readonly championFell?: Readonly<Record<string, number>>;
  /**
   * The tick of the first drop: the battle's clock runs from the moment the
   * screen opens, and the report's times count from the first drop. 0 when absent.
   */
  readonly startTick?: number;
}

/** How the test ended: the army beaten, every building down, the clock out, or stopped. */
export type TestResult = "held" | "flattened" | "time" | "stopped";

export interface TowerRow {
  readonly id: number;
  /** "Cannon Tower L5". */
  readonly name: string;
  readonly damage: number;
  readonly kills: number;
  readonly shots: number;
  /** "0:12", or "Never fired". */
  readonly firstShot: string;
  readonly fired: boolean;
  /** "Standing, 72%" or "Destroyed at 2:14". */
  readonly fate: string;
}

export interface TrapRow {
  readonly id: number;
  readonly name: string;
  /** m:ss it went off. */
  readonly at: string;
  readonly damage: number;
  readonly kills: number;
}

export interface BunkerRow {
  readonly id: number;
  readonly name: string;
  /** Defenders it held when the test began. */
  readonly held: number;
  readonly sent: number;
  readonly damage: number;
  readonly kills: number;
  readonly lost: number;
  readonly fate: string;
}

export interface CagedChampionRow {
  readonly damage: number;
  readonly kills: number;
  /** Health left, 0 when it died. */
  readonly health: number;
}

export interface AttackerRow {
  /** "Bandito L3", or the champion's name and level. */
  readonly name: string;
  readonly champion: boolean;
  readonly sent: number;
  /** Born on the field rather than dropped: Slimeattikus Minis, zombies. */
  readonly spawned: number;
  readonly lost: number;
  readonly buildingDamage: number;
}

/** An attacking champion's end: alive with its health, or fallen (at m:ss when seen). */
export interface ChampionFate {
  readonly name: string;
  readonly survived: boolean;
  readonly health: number;
  readonly fellAt: string | null;
}

export interface TestReport {
  readonly result: TestResult;
  /** "Your yard held", "Flattened", "Time ran out" or "Stopped". */
  readonly resultLine: string;
  readonly damagePercent: number;
  readonly buildingsDestroyed: number;
  readonly buildingsTotal: number;
  /** m:ss from the first drop to the end. */
  readonly time: string;
  /** Monsters on the field (dropped and born) and how many of them were beaten. */
  readonly attackersSent: number;
  readonly attackersBeaten: number;
  readonly champions: readonly ChampionFate[];
  /** One plain hint read off the numbers, or null when none applies. */
  readonly hint: string | null;
  /** Most damage first; towers that never fired at the bottom. */
  readonly towers: readonly TowerRow[];
  /** In the order they went off. */
  readonly traps: readonly TrapRow[];
  readonly bunkers: readonly BunkerRow[];
  readonly cagedChampion: CagedChampionRow | null;
  /** Monsters by id, then the champions. */
  readonly attackers: readonly AttackerRow[];
}

const RESULT_LINES: Readonly<Record<TestResult, string>> = {
  held: "Your yard held",
  flattened: "Flattened",
  time: "Time ran out",
  stopped: "Stopped",
};

/** The army beaten is a held yard; Stop, or leaving, is a stopped test. */
export const resultOf = (endReason: AttackEndReason | null): TestResult => {
  if (endReason === "exhausted") return "held";
  if (endReason === "destroyed") return "flattened";
  if (endReason === "expired") return "time";
  return "stopped";
};

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

/** "Standing, 72%" off the battle's health map (absent is full), or when it fell. */
const fateOf = (
  at: (tick: number) => string,
  destroyedTick: number | null,
  health: number | undefined,
  maxHp: number,
): string => {
  if (destroyedTick !== null) return `Destroyed at ${at(destroyedTick)}`;
  if (maxHp <= 0) return "Standing";
  const left = health ?? maxHp;
  return `Standing, ${Math.max(0, Math.floor((left / maxHp) * 100))}%`;
};

const attackerName = (row: AttackerReport): string =>
  row.champion
    ? `${championEntry(row.monsterId)?.name ?? "Champion"} L${row.level}`
    : `${monsterName(row.monsterId)} L${row.level}`;

/** Whether a dropped attacker flies at its level. */
const flies = (row: AttackerReport): boolean =>
  isFlyingMovement(row.champion ? championMode(row.monsterId, "movement", row.level) : monsterMovement(row.monsterId));

/** "Sniper Towers", "Sniper Towers and Cannon Towers", "A, B and C". */
const listOf = (names: readonly string[]): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The one hint: a ground-only tower against an army that only flew comes
 * first, then towers that never fired. Nothing to say before anything was sent.
 */
const hintOf = (state: BattleState): string | null => {
  const dropped = state.attackers.filter((row) => row.sent > 0);
  if (dropped.length === 0) return null;
  const grounded = state.towers.filter((tower) => !hitsFlyers(tower.type));
  if (grounded.length > 0 && dropped.every(flies)) {
    const types = [...new Set(grounded.map((tower) => tower.type))];
    const names = grounded.length === 1 ? types.map(typeName) : types.map((type) => `${typeName(type)}s`).sort();
    return `Your ${listOf(names)} can't hit flying monsters, and this army flew.`;
  }
  const silent = state.towers.filter((tower) => tower.firstShotTick === null).length;
  if (silent > 0) return silent === 1 ? "1 tower never fired." : `${silent} towers never fired.`;
  return null;
};

/** The report of a finished test. */
export const buildTestReport = (input: TestReportInput): TestReport => {
  const { state } = input;
  const buildings = new Map(input.buildings.map((building) => [building.id, building]));
  const at = (tick: number): string => clockOf(tick - (input.startTick ?? 0));

  const towers: TowerRow[] = [...state.towers]
    .sort(
      (one, other) =>
        Number(other.firstShotTick !== null) - Number(one.firstShotTick !== null) ||
        other.damageDealt - one.damageDealt ||
        other.kills - one.kills ||
        one.id - other.id,
    )
    .map((tower) => ({
      id: tower.id,
      name: `${typeName(tower.type)} L${tower.level}`,
      damage: tower.damageDealt,
      kills: tower.kills,
      shots: tower.shots,
      firstShot: tower.firstShotTick === null ? "Never fired" : at(tower.firstShotTick),
      fired: tower.firstShotTick !== null,
      fate: fateOf(at, tower.destroyedTick, state.health[String(tower.id)], buildings.get(tower.id)?.maxHp ?? 0),
    }));

  const traps: TrapRow[] = state.traps.map((trap) => ({
    id: trap.id,
    name: typeName(trap.type),
    at: at(trap.tick),
    damage: trap.damageDealt,
    kills: trap.kills,
  }));

  const bunkers: BunkerRow[] = state.bunkers.map((bunker) => {
    const building = buildings.get(bunker.id);
    const left = sum(Object.values(state.bunkerGarrisons[bunker.id] ?? {}));
    const lost = sum(Object.values(state.bunkerLosses[bunker.id] ?? {}));
    return {
      id: bunker.id,
      name: `${building ? typeName(building.type) : "Monster Bunker"} L${bunker.level}`,
      held: left + lost,
      sent: bunker.sent,
      damage: bunker.damageDealt,
      kills: bunker.kills,
      lost,
      fate: fateOf(at, bunker.destroyedTick, state.health[String(bunker.id)], building?.maxHp ?? 0),
    };
  });

  const cagedChampion: CagedChampionRow | null = state.defenderChampion
    ? {
        damage: state.defenderChampion.damageDealt,
        kills: state.defenderChampion.kills,
        health: state.defenderChampionHp ?? 0,
      }
    : null;

  const attackers: AttackerRow[] = state.attackers
    .filter((row) => row.sent + row.spawned > 0)
    .map((row) => ({
      name: attackerName(row),
      champion: row.champion,
      sent: row.sent,
      spawned: row.spawned,
      lost: row.lost,
      buildingDamage: row.buildingDamage,
    }));

  const monsters = state.attackers.filter((row) => !row.champion);
  const champions: ChampionFate[] = state.attackers
    .filter((row) => row.champion && row.sent > 0)
    .map((row) => {
      const health = state.championsHp[row.monsterId] ?? 0;
      const survived = row.lost === 0 && health > 0;
      const fell = input.championFell?.[row.monsterId];
      return {
        name: championEntry(row.monsterId)?.name ?? "Champion",
        survived,
        health: survived ? health : 0,
        fellAt: !survived && fell !== undefined ? at(fell) : null,
      };
    });

  const result = resultOf(input.endReason);
  return {
    result,
    resultLine: RESULT_LINES[result],
    damagePercent: input.damagePercent,
    buildingsDestroyed: input.buildingsDestroyed,
    buildingsTotal: input.buildingsTotal,
    time: at(state.tick),
    attackersSent: sum(monsters.map((row) => row.sent + row.spawned)),
    attackersBeaten: sum(monsters.map((row) => row.lost)),
    champions,
    hint: hintOf(state),
    towers,
    traps,
    bunkers,
    cagedChampion,
    attackers,
  };
};
