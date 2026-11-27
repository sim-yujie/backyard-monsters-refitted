import { z } from "zod";

import type { Save } from "../../database/models/save.model.js";
import { monsterStats } from "../../game-data/stats/monsterStats.js";
import {
  CHAMPION_MAX_FOOD_BONUS,
  KRALLEN_MAX_POWER_LEVEL,
  championMaxPower,
  championByType,
  championStatWithFood,
  isChampionStance,
  ticks,
  type ChampionStance,
  type FlingEvent,
} from "../../game-rules/combat/index.js";
import type { ChampionData } from "../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../types/JsonObject.js";
import type { AbandonedAttacker, AbandonedOutcome } from "../base/combat/abandonedAttack.js";
import { levelOf } from "../yardplanner/costs.js";

/**
 * Friend tests of a yard (beta 9 feature #4, owner grilling 21 Nov 2026 and
 * desk card b9-baiter-screen, design A): a player with a Wild Monster Baiter
 * invites friends or alliance mates; for 24 hours each of them may test the
 * inviter's MAIN yard as often as they like, with a free made-up test army
 * capped by the INVITER's Baiter level. Nothing real is lost or won by anyone;
 * the inviter gets each test's replay and report on a list of its own (the
 * Baiter window's Results tab), never mixed with real defences.
 *
 * This file is the pure part: the numbers, the shape of a test army and the
 * checks the server makes on a finished test before it fights it again.
 * `baiterTestStore.ts` keeps the rows, `baiterTests.ts` answers the routes.
 */

/** The Wild Monster Baiter's type id (`client/scripts/MONSTERBAITER.as:7`). */
export const BAITER_TYPE = 19;

/**
 * The test army's cap per Baiter level, in housing space: the same table as
 * the web client's `BAITER_CAP` (`web/src/game/baiter/baiterSession.ts`).
 */
export const BAITER_CAP: readonly number[] = [600, 900, 1_200, 1_500, 2_100, 3_200, 4_800];

/** The cap for a Baiter at `level`, clamped to the table. */
export const capOfLevel = (level: number): number => {
  const index = Math.min(Math.max(Math.floor(level) || 1, 1), BAITER_CAP.length) - 1;
  return BAITER_CAP[index] ?? BAITER_CAP[0]!;
};

/**
 * The monsters a test army can hold: the 18 surface monsters a player can
 * hatch, as the web client's `TEST_ROSTER` lists them (not the Inferno ones,
 * not C18).
 */
export const TEST_ROSTER: readonly string[] = [
  "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C16",
  "C9", "C17", "C10", "C11", "C15", "C14", "C13", "C12", "C19",
];

/** Krallen's champion type: one Krallen may join one ordinary champion. */
export const KRALLEN_TYPE = 5;

/** How long an invite lasts (owner, 21 Nov: 24 h, any number of tests). */
export const INVITE_SECONDS = 24 * 60 * 60;

/** How long a test result is kept ("Kept 7 days", design A). */
export const RESULT_KEEP_SECONDS = 7 * 24 * 60 * 60;

/** At most this many results are kept per inviter, newest first. */
export const RESULT_LIMIT = 50;

/** At most this many players in one Send. */
export const MAX_INVITES_PER_SEND = 25;

/** At most this many invites open at once, per inviter. */
export const MAX_OPEN_INVITES = 100;

/** How long a started test may run before its ticket lapses. */
export const RUN_TICKET_SECONDS = 30 * 60;

/** No test runs longer than this many ticks (its clock waits for the first drop). */
export const MAX_TEST_TICK = ticks(RUN_TICKET_SECONDS);

/** More events than a test can hold. */
export const MAX_TEST_EVENTS = 500;

/** The tester's report is kept only when it is at most this big, as JSON. */
export const MAX_REPORT_BYTES = 64 * 1024;

/** The tester's report must agree with the server's damage within this many points. */
export const DAMAGE_TOLERANCE = 0.5;

/** Ways a test can end, as the tester's report words them (`TestResult`). */
export const TEST_RESULTS = ["held", "flattened", "time", "stopped"] as const;
export type TestResult = (typeof TEST_RESULTS)[number];

/** The highest academy level `id` can have; 0 for a monster a test cannot hold. */
export const maxLevelOf = (id: string): number => {
  if (!TEST_ROSTER.includes(id)) return 0;
  const stat = monsterStats[id];
  return stat ? stat.trainingCosts.length + 1 : 0;
};

/** The housing space one `id` at `level` takes (`cStorage`). */
export const spaceOf = (id: string, level: number): number => {
  const storage = monsterStats[id]?.props.cStorage ?? [];
  if (storage.length === 0) return 0;
  const index = Math.min(Math.max(Math.floor(level) || 1, 1), storage.length) - 1;
  return storage[index] ?? 0;
};

/** How many evolution levels champion type `t` has: 6 for the four basic ones, 5 for Krallen. */
export const championLevelsOf = (t: number): number => {
  if (!championByType(t)) return 0;
  return t === KRALLEN_TYPE ? 5 : t >= 1 && t <= 4 ? 6 : 0;
};

/** The highest power level champion type `t` can have. */
export const championPowerOf = (t: number): number =>
  t === KRALLEN_TYPE ? KRALLEN_MAX_POWER_LEVEL : championMaxPower(championByType(t) ?? "");

/** One row of a test army. */
export interface TestRow {
  readonly count: number;
  readonly level: number;
}

/** One made-up champion. */
export interface TestChampion {
  readonly t: number;
  readonly l: number;
  readonly pl: number;
  readonly s?: ChampionStance;
}

/** A test army, as the tester sends it. */
export interface TestArmy {
  readonly monsters: Readonly<Record<string, TestRow>>;
  readonly champions: readonly TestChampion[];
}

const count = z.coerce.number().int().min(0).max(100_000);
const level = z.coerce.number().int().min(1).max(20);

export const TestArmySchema = z.object({
  monsters: z.record(z.string().max(8), z.object({ count, level })).default({}),
  champions: z
    .array(
      z.object({
        t: z.coerce.number().int().min(1).max(50),
        l: z.coerce.number().int().min(1).max(20),
        pl: z.coerce.number().int().min(0).max(10).default(0),
        s: z.string().max(16).optional(),
      })
    )
    .max(2)
    .default([]),
});

/** Why a test army or its battle is refused. */
export type ArmyRefusal = "badArmy" | "overCap" | "badEvents";

/**
 * A sent army as one the rules allow, or why not: every monster on the
 * roster, every level within its monster's, at most one ordinary champion and
 * one Krallen, each within its levels; the whole army within `cap`.
 */
export const parseTestArmy = (raw: unknown, cap: number): { army: TestArmy } | { refusal: ArmyRefusal } => {
  const parsed = TestArmySchema.safeParse(raw);
  if (!parsed.success) return { refusal: "badArmy" };
  const monsters: Record<string, TestRow> = {};
  for (const [id, row] of Object.entries(parsed.data.monsters)) {
    const max = maxLevelOf(id);
    if (max === 0 || row.level > max) return { refusal: "badArmy" };
    if (row.count > 0) monsters[id] = { count: row.count, level: row.level };
  }
  const champions: TestChampion[] = [];
  for (const champion of parsed.data.champions) {
    const levels = championLevelsOf(champion.t);
    if (levels === 0 || champion.l > levels || champion.pl > championPowerOf(champion.t)) return { refusal: "badArmy" };
    if (champion.s !== undefined && !isChampionStance(champion.s)) return { refusal: "badArmy" };
    champions.push({ t: champion.t, l: champion.l, pl: champion.pl, ...(champion.s ? { s: champion.s as ChampionStance } : {}) });
  }
  const krallen = champions.filter((one) => one.t === KRALLEN_TYPE).length;
  if (krallen > 1 || champions.length - krallen > 1) return { refusal: "badArmy" };
  const army: TestArmy = { monsters, champions };
  return armySpace(army) > cap ? { refusal: "overCap" } : { army };
};

/** The housing space the army's monsters take (champions take none, as in the Baiter window). */
export const armySpace = (army: TestArmy): number =>
  Object.entries(army.monsters).reduce((sum, [id, row]) => sum + spaceOf(id, row.level) * row.count, 0);

/** A champion's food bonus in a test: full at its top level (`testChampionFoodBonus`). */
export const testFoodBonus = (champion: Pick<TestChampion, "t" | "l">): number =>
  champion.l >= championLevelsOf(champion.t) ? CHAMPION_MAX_FOOD_BONUS : 0;

/** A test champion as a save's champion entry, at full health (`testChampionEntry`). */
export const testChampionData = (champion: TestChampion): ChampionData => {
  const id = championByType(champion.t) ?? "";
  const fb = testFoodBonus(champion);
  return {
    t: champion.t,
    l: champion.l,
    pl: champion.pl,
    hp: championStatWithFood(id, "health", champion.l, fb),
    status: 0,
    ft: 0,
    fd: 0,
    fb,
    ...(champion.s ? { s: champion.s } : {}),
  } as ChampionData;
};

/**
 * The attacker the server fights a test with: the army's levels as an
 * academy (no Monster Lab ranks: a test army is made up, not the tester's),
 * its champions at full health, no siege.
 */
export const testAttacker = (army: TestArmy): AbandonedAttacker => {
  const academy: JsonObject = {};
  for (const id of TEST_ROSTER) academy[id] = { level: army.monsters[id]?.level ?? 1 };
  return {
    academy,
    champion: army.champions.length > 0 ? army.champions.map(testChampionData) : null,
    siege: null,
  };
};

/**
 * Whether a finished test's drops are ones its army could make: only monster
 * and champion drops and retreats; never more of a monster than the army
 * holds; each champion one of the army's, at its level, power level and food
 * bonus, at no more than full health. Bombs and siege weapons are not part of
 * a test.
 */
export const eventsFit = (events: readonly FlingEvent[], army: TestArmy): boolean => {
  if (events.length > MAX_TEST_EVENTS) return false;
  const flung: Record<string, number> = {};
  for (const event of events) {
    if (!Number.isFinite(event.t) || event.t < 0 || event.t > MAX_TEST_TICK) return false;
    if (event.kind === "retreat" || event.kind === "championRetreat") continue;
    if (event.kind !== "fling") return false;
    for (const [id, many] of Object.entries(event.monsters ?? {})) {
      const n = Number(many);
      if (!Number.isFinite(n) || n < 0) return false;
      flung[id] = (flung[id] ?? 0) + n;
      if (flung[id]! > (army.monsters[id]?.count ?? 0)) return false;
    }
    const champion = event.champion;
    if (champion) {
      const own = army.champions.find((one) => one.t === champion.t);
      if (!own || champion.l !== own.l || (champion.pl ?? 0) !== own.pl) return false;
      if ((champion.fb ?? 0) !== testFoodBonus(own)) return false;
      const full = testChampionData(own).hp ?? 0;
      if (champion.hp !== undefined && champion.hp > full + 1) return false;
    }
  }
  return true;
};

/** The level of the inviter's standing Wild Monster Baiter, 0 when there is none. */
export const baiterLevelOf = (save: Pick<Save, "buildingdata"> | null | undefined): number =>
  Object.values(save?.buildingdata ?? {}).reduce((best, building) => {
    if (!building || Number(building.t) !== BAITER_TYPE) return best;
    return Math.max(best, levelOf(building));
  }, 0);

/** The tester's report, when it is a report this server can keep and it agrees with the battle the server fought. */
export const keptReport = (report: unknown, outcome: Pick<AbandonedOutcome, "damage">): JsonObject | null => {
  if (!report || typeof report !== "object" || Array.isArray(report)) return null;
  const damage = Number((report as { damagePercent?: unknown }).damagePercent);
  if (!Number.isFinite(damage) || Math.abs(damage - outcome.damage) > DAMAGE_TOLERANCE) return null;
  const result = (report as { result?: unknown }).result;
  if (typeof result !== "string" || !(TEST_RESULTS as readonly string[]).includes(result)) return null;
  if (JSON.stringify(report).length > MAX_REPORT_BYTES) return null;
  return report as JsonObject;
};

/**
 * How the test ended, for the Results list: the tester's word for it (Held,
 * Flattened, Time ran out, Stopped), which is about their side alone and
 * changes nothing; Flattened only when the server's battle agrees (its damage
 * matched the report, or the yard is down to 100%).
 */
export const resultOf = (outcome: Pick<AbandonedOutcome, "damage">, claimed: unknown, reportKept: boolean): TestResult => {
  if (outcome.damage >= 100) return "flattened";
  if (claimed === "held" || claimed === "time" || claimed === "stopped") return claimed;
  if (claimed === "flattened" && reportKept) return "flattened";
  return "stopped";
};
