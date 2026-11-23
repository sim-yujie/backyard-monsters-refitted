import type { EntityManager } from "@mikro-orm/postgresql";

import { monsterStats } from "../../game-data/stats/monsterStats.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { MONSTER_NAMES } from "../../game-rules/combat/report.js";
import { INFERNO_TRIBE_LEVEL_OFFSETS } from "../inferno/infernoTribes.js";
import { MR1_TRIBE_LEVEL_OFFSETS } from "../maproom/v1/mr1TribeRules.js";
import { TRIBE_IDS, tribeLevels } from "../maproom/v2/tribeLayouts.js";
import { realPlayerSql } from "./realPlayers.js";

/**
 * The dashboard's Monsters tab (owner, 23 Nov 2026; layout A "Balance
 * sheet"): which monsters real players fling, on players and on camps apart,
 * which camps they attack, read from `bym.monster_usage` (`monsterUsage.ts`).
 *
 * - Monsters are the normal C1-C17 and C19 and the Inferno IC1-IC8; no
 *   champion, no bomb. Per monster: how many were flung, the share of
 *   attacks it was in, how many different players flung it, each split by
 *   its level; and a line per day.
 * - "Attacks" are every landed attack of the side in the period, those that
 *   flung nothing counted too, except the Inferno attacks landed as their
 *   whole army (`assumed`), whose monsters are a worst case: they are left
 *   out everywhere and only counted, for the note under the list.
 * - Camps: attacks and players per tribe and camp level. Repeat attacks are
 *   on camps, so they count there.
 * - Days are UTC days, as every other dashboard number. Counting began the
 *   day the table did; `since` is its first day.
 *
 * The answer is cached for {@link MONSTER_STATS_TTL_MS} per period.
 */

export type MonsterPeriod = "7" | "30" | "all";
export const MONSTER_PERIODS: readonly MonsterPeriod[] = ["7", "30", "all"];

/** The monsters the table shows, in roster order. */
export const SHOWN_MONSTERS: readonly string[] = [
  ...Array.from({ length: 17 }, (_, index) => `C${index + 1}`),
  "C19",
  ...Array.from({ length: 8 }, (_, index) => `IC${index + 1}`),
];

/** How long one period's answer is reused. */
export const MONSTER_STATS_TTL_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface LevelCount {
  readonly level: number;
  readonly flung: number;
  readonly attacks: number;
  readonly players: number;
}

export interface MonsterCount {
  readonly id: string;
  readonly name: string;
  readonly kind: "normal" | "inferno";
  /** Its highest level (Zafreeti has 5). */
  readonly maxLevel: number;
  readonly flung: number;
  /** Attacks it was flung in. */
  readonly attacks: number;
  readonly players: number;
  /** Levels 1 to `maxLevel`, every one listed. */
  readonly levels: readonly LevelCount[];
  /** Flung each day, one per entry of {@link MonsterStats.days}. */
  readonly daily: readonly number[];
}

export interface SideCount {
  readonly attacks: number;
  readonly players: number;
  readonly flung: number;
  readonly daily: readonly number[];
  readonly monsters: readonly MonsterCount[];
}

export interface CampLevelCount {
  readonly level: number;
  readonly attacks: number;
  readonly players: number;
}

export interface TribeCount {
  /** `mr2:kozu`, `mr1:legionnaire`, `inferno:moloch`, `descent:descent`. */
  readonly key: string;
  readonly name: string;
  readonly where: "Map Room 1" | "Map Room 2" | "Inferno" | "Descent";
  readonly attacks: number;
  readonly players: number;
  /** The levels its camps can really have, lowest and highest. */
  readonly range: readonly [number, number] | null;
  /** Map Room 2: the only levels its camps have (every 4th). */
  readonly only?: readonly number[];
  /** Each level attacked, low to high. */
  readonly levels: readonly CampLevelCount[];
}

export interface MonsterStats {
  readonly generatedAt: string;
  readonly period: MonsterPeriod;
  /** The first day anything was counted, or null before the first attack. */
  readonly since: string | null;
  /** Days counted so far, today included (0 before the first attack). */
  readonly daysCounted: number;
  /** The period's days, oldest first; never before `since`. */
  readonly days: readonly string[];
  readonly players: SideCount;
  readonly camps: SideCount & { readonly tribes: readonly TribeCount[] };
  /** Inferno attacks landed as their whole army, left out above. */
  readonly assumed: number;
  /** Attacks landed with no battle (a replay that kept failing): counted from their log. */
  readonly unreplayed: number;
}

/** A day as `YYYY-MM-DD`, UTC. */
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

const dayCount = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;

/** The period's days: the last 7 or 30 up to today, or all since counting began; none before `since`. */
export const periodDays = (period: MonsterPeriod, since: string | null, now: number): string[] => {
  const today = dayOf(now);
  if (!since || since > today) return [];
  const back = period === "all" ? dayCount(since, today) : Number(period);
  const first = Math.max(Date.parse(`${today}T00:00:00Z`) - (back - 1) * DAY_MS, Date.parse(`${since}T00:00:00Z`));
  const days: string[] = [];
  for (let at = first; at <= Date.parse(`${today}T00:00:00Z`); at += DAY_MS) days.push(dayOf(at));
  return days;
};

/** Each shown monster's highest level, from the game's own table. */
const MAX_LEVEL: Readonly<Record<string, number>> = Object.fromEntries(
  SHOWN_MONSTERS.map((id) => [id, (monsterStats[id]?.trainingCosts.length ?? 5) + 1])
);

const HIGHEST_PLAYER_LEVEL = experiencePoints.length;

const MR2_NAMES: Readonly<Record<string, string>> = { legionnaire: "Legionnaire", kozu: "Kozu", abunakki: "Abunakki", dreadnaut: "Dreadnaut" };
const MR1_ORDER = ["legionnaire", "kozu", "abunakki", "dreadnaut"] as const;

/**
 * Every camp the game has, with the levels its camps can be at, from the
 * game's own rules: Map Room 2 camps by `tribeLevels` (every 4th level of
 * their band), Map Room 1 tribes and Moloch tribes as the map shows them
 * (the player's level with each tribe's offset), the Descent's 13 yards.
 */
export const CAMP_KINDS: readonly Omit<TribeCount, "attacks" | "players" | "levels">[] = [
  ...MR1_ORDER.map((tribe, index) => {
    const only = tribeLevels(TRIBE_IDS[index]!);
    return { key: `mr2:${tribe}`, name: MR2_NAMES[tribe]!, where: "Map Room 2" as const, range: [only[0]!, only[only.length - 1]!] as const, only };
  }),
  ...MR1_ORDER.map((tribe, index) => {
    const offset = MR1_TRIBE_LEVEL_OFFSETS[index]!;
    return {
      key: `mr1:${tribe}`,
      name: MR2_NAMES[tribe]!,
      where: "Map Room 1" as const,
      range: [Math.max(1, 1 + offset), Math.max(1, HIGHEST_PLAYER_LEVEL + offset)] as const,
    };
  }),
  { key: "mr1:practice", name: "Practice camp", where: "Map Room 1" as const, range: null },
  {
    key: "inferno:moloch",
    name: "Moloch",
    where: "Inferno" as const,
    range: [
      Math.max(1, 1 + Math.min(...INFERNO_TRIBE_LEVEL_OFFSETS)),
      HIGHEST_PLAYER_LEVEL + Math.max(...INFERNO_TRIBE_LEVEL_OFFSETS),
    ] as const,
  },
  { key: "descent:descent", name: "Descent", where: "Descent" as const, range: [1, 13] as const },
];

const n = (value: unknown): number => Number(value) || 0;

interface Rows {
  levels: { mode: string; id: string; level: number | null; flung: string; attacks: string; players: string }[];
  daily: { mode: string; day: string; id: string; flung: string }[];
  sides: { mode: string; day: string | null; attacks: string; players: string }[];
  /** `whole` is 1 on a tribe's total row: a camp with no level (the practice camp) has a null level too. */
  camps: { arena: string; tribe: string | null; level: number | null; whole: number; attacks: string; players: string }[];
  extra: { assumed: string; unreplayed: string }[];
}

/**
 * The rows of a period, the real players' only, as `r`. Takes `[from, to]`.
 * Each read groups straight off the table and names only the columns it
 * needs: carrying whole rows (`r.*`) into the sorts made it 4x slower.
 */
const period = (lateral = "") => `
    FROM bym.monster_usage r ${lateral}
    JOIN bym."user" u ON u.userid = r.attacker_userid
   WHERE r.day BETWEEN ?::date AND ?::date AND ${realPlayerSql("u")}`;

/** Each row's monsters, as `m`. */
const MONSTERS = `CROSS JOIN LATERAL jsonb_each(r.monsters) m`;

/**
 * The period's grouped rows, read one after another on one connection: run
 * side by side they only fought over the database's cores (the same 1.1 s
 * for 30 days of 150,000 rows), and a game server's queries share those.
 */
const readRows = async (em: EntityManager, from: string, to: string): Promise<Rows> => {
  const shown = `{${SHOWN_MONSTERS.join(",")}}`;
  const levels = await em.execute<Rows["levels"]>(
    `SELECT r.mode, m.key AS id, (m.value->>'l')::int AS level,
            sum((m.value->>'f')::int) AS flung, count(*) AS attacks, count(DISTINCT r.attacker_userid) AS players
       ${period(MONSTERS)} AND NOT r.assumed AND m.key = ANY(?::text[])
      GROUP BY GROUPING SETS ((r.mode, m.key, (m.value->>'l')::int), (r.mode, m.key))`,
    [from, to, shown]
  );
  const daily = await em.execute<Rows["daily"]>(
    `SELECT r.mode, r.day::text AS day, m.key AS id, sum((m.value->>'f')::int) AS flung
       ${period(MONSTERS)} AND NOT r.assumed AND m.key = ANY(?::text[])
      GROUP BY 1, 2, 3`,
    [from, to, shown]
  );
  const sides = await em.execute<Rows["sides"]>(
    `SELECT r.mode, r.day::text AS day, count(*) AS attacks, count(DISTINCT r.attacker_userid) AS players
       ${period()} AND NOT r.assumed
      GROUP BY GROUPING SETS ((r.mode), (r.mode, r.day))`,
    [from, to]
  );
  const camps = await em.execute<Rows["camps"]>(
    `SELECT r.arena, r.tribe, r.camp_level AS level, GROUPING(r.camp_level) AS whole,
            count(*) AS attacks, count(DISTINCT r.attacker_userid) AS players
       ${period()} AND NOT r.assumed AND r.mode = 'camp'
      GROUP BY GROUPING SETS ((r.arena, r.tribe), (r.arena, r.tribe, r.camp_level))`,
    [from, to]
  );
  const extra = await em.execute<Rows["extra"]>(
    `SELECT count(*) FILTER (WHERE r.assumed) AS assumed, count(*) FILTER (WHERE NOT r.replayed AND NOT r.assumed) AS unreplayed
       ${period()}`,
    [from, to]
  );
  return { levels, daily, sides, camps, extra };
};

/** One side (players or camps) from the rows. */
const sideOf = (mode: "player" | "camp", rows: Rows, days: readonly string[]): SideCount => {
  const at = new Map(days.map((day, index) => [day, index]));
  const total = rows.sides.find((row) => row.mode === mode && row.day === null);
  const dailyAttacks = days.map(() => 0);
  const perMonster = new Map<string, number[]>();
  const dailyAll = days.map(() => 0);
  for (const row of rows.daily) {
    if (row.mode !== mode) continue;
    const index = at.get(row.day);
    if (index === undefined) continue;
    const list = perMonster.get(row.id) ?? days.map(() => 0);
    list[index]! += n(row.flung);
    dailyAll[index]! += n(row.flung);
    perMonster.set(row.id, list);
  }
  for (const row of rows.sides) {
    if (row.mode === mode && row.day !== null && at.has(row.day)) dailyAttacks[at.get(row.day)!] = n(row.attacks);
  }
  const monsters = SHOWN_MONSTERS.map((id): MonsterCount => {
    const whole = rows.levels.find((row) => row.mode === mode && row.id === id && row.level === null);
    const maxLevel = MAX_LEVEL[id]!;
    const levels = Array.from({ length: maxLevel }, (_, index): LevelCount => {
      const row = rows.levels.find((one) => one.mode === mode && one.id === id && one.level === index + 1);
      return { level: index + 1, flung: n(row?.flung), attacks: n(row?.attacks), players: n(row?.players) };
    });
    return {
      id,
      name: MONSTER_NAMES[id] ?? id,
      kind: id.startsWith("IC") ? "inferno" : "normal",
      maxLevel,
      flung: n(whole?.flung),
      attacks: n(whole?.attacks),
      players: n(whole?.players),
      levels,
      daily: perMonster.get(id) ?? days.map(() => 0),
    };
  });
  return {
    attacks: n(total?.attacks),
    players: n(total?.players),
    flung: monsters.reduce((sum, monster) => sum + monster.flung, 0),
    daily: dailyAll,
    monsters,
  };
};

const campKeyOf = (arena: string, tribe: string | null): string => `${arena}:${tribe ?? "other"}`;

const tribesOf = (rows: Rows): TribeCount[] =>
  CAMP_KINDS.map((kind) => {
    const mine = rows.camps.filter((row) => campKeyOf(row.arena, row.tribe) === kind.key);
    const whole = mine.find((row) => Number(row.whole) === 1);
    return {
      ...kind,
      attacks: n(whole?.attacks),
      players: n(whole?.players),
      levels: mine
        .filter((row) => Number(row.whole) === 0 && row.level !== null)
        .map((row) => ({ level: Number(row.level), attacks: n(row.attacks), players: n(row.players) }))
        .sort((one, other) => one.level - other.level),
    };
  });

/** The first day anything was counted, or null. Reads the day index's first entry. */
export const countingSince = async (em: EntityManager): Promise<string | null> => {
  const [row] = await em.execute<{ day: string | null }[]>(`SELECT min(day)::text AS day FROM bym.monster_usage`);
  return row?.day ?? null;
};

/** The Monsters tab's numbers for one period, as of `now`. */
export const monsterStatsFor = async (em: EntityManager, period: MonsterPeriod, now: number = Date.now()): Promise<MonsterStats> => {
  const since = await countingSince(em);
  const days = periodDays(period, since, now);
  const today = dayOf(now);
  const rows: Rows = days.length
    ? await readRows(em, days[0]!, days[days.length - 1]!)
    : { levels: [], daily: [], sides: [], camps: [], extra: [] };
  return {
    generatedAt: new Date(now).toISOString(),
    period,
    since,
    daysCounted: since && since <= today ? dayCount(since, today) : 0,
    days,
    players: sideOf("player", rows, days),
    camps: { ...sideOf("camp", rows, days), tribes: tribesOf(rows) },
    assumed: n(rows.extra[0]?.assumed),
    unreplayed: n(rows.extra[0]?.unreplayed),
  };
};

const cache = new Map<MonsterPeriod, { at: number; stats: MonsterStats }>();

/** {@link monsterStatsFor}, reused for {@link MONSTER_STATS_TTL_MS}. */
export const cachedMonsterStats = async (em: EntityManager, period: MonsterPeriod, now: number = Date.now()): Promise<MonsterStats> => {
  const held = cache.get(period);
  if (held && now - held.at < MONSTER_STATS_TTL_MS) return held.stats;
  const stats = await monsterStatsFor(em, period, now);
  cache.set(period, { at: now, stats });
  return stats;
};



/** Owned champions, by who counts. */
export interface ChampionScope {
  /** Players counted: real players with a main yard (seen in the last 30 days, for `active`). */
  readonly players: number;
  /** Of them, with no champion. */
  readonly none: number;
  /** Champions owned, by id (`G1`..`G5`), every type listed. */
  readonly owned: readonly { readonly id: string; readonly count: number }[];
  /** Players owning 1, 2, 3... champions: `byCount[0]` own exactly one. */
  readonly byCount: readonly number[];
}

export interface ChampionOwnership {
  readonly generatedAt: string;
  /** Real players seen in the last 30 days (the default). */
  readonly active: ChampionScope;
  /** Every real player's account. */
  readonly every: ChampionScope;
}

const CHAMPION_IDS = ["G1", "G2", "G3", "G4", "G5"] as const;

/** The main yards in a scope, as `s`, with their owner as `u`. Takes `[since]` when active. */
const scopeFrom = (active: boolean, join = "") => `
  FROM bym.save s JOIN bym."user" u ON u.userid = s.userid ${join}
 WHERE s.type = 'main' AND ${realPlayerSql("u")}${active ? " AND u.last_seen_at >= ?" : ""}`;

const championScope = async (em: EntityManager, active: boolean, now: number): Promise<ChampionScope> => {
  const params = active ? [new Date(now - 30 * DAY_MS)] : [];
  const champions = `CASE WHEN jsonb_typeof(s.champion) = 'array' THEN s.champion ELSE '[]'::jsonb END`;
  const [types, counts] = await Promise.all([
    em.execute<{ t: number | null; n: string }[]>(
      `SELECT (c->>'t')::int AS t, count(*) AS n ${scopeFrom(active, `CROSS JOIN LATERAL jsonb_array_elements(${champions}) c`)} GROUP BY 1`,
      params
    ),
    em.execute<{ k: number; n: string }[]>(`SELECT jsonb_array_length(${champions}) AS k, count(*) AS n ${scopeFrom(active)} GROUP BY 1`, params),
  ]);
  const owned = CHAMPION_IDS.map((id, index) => ({ id, count: n(types.find((row) => Number(row.t) === index + 1)?.n) }));
  const most = Math.max(0, ...counts.map((row) => Number(row.k)));
  return {
    players: counts.reduce((sum, row) => sum + n(row.n), 0),
    none: n(counts.find((row) => Number(row.k) === 0)?.n),
    owned,
    byCount: Array.from({ length: most }, (_, index) => n(counts.find((row) => Number(row.k) === index + 1)?.n)),
  };
};

/** Who owns which champion right now, both ways of counting (the period changes nothing). */
export const championOwnership = async (em: EntityManager, now: number = Date.now()): Promise<ChampionOwnership> => {
  const [active, every] = await Promise.all([championScope(em, true, now), championScope(em, false, now)]);
  return { generatedAt: new Date(now).toISOString(), active, every };
};

let championCache: { at: number; value: ChampionOwnership } | null = null;

/** {@link championOwnership}, reused for {@link MONSTER_STATS_TTL_MS}. */
export const cachedChampionOwnership = async (em: EntityManager, now: number = Date.now()): Promise<ChampionOwnership> => {
  if (championCache && now - championCache.at < MONSTER_STATS_TTL_MS) return championCache.value;
  const value = await championOwnership(em, now);
  championCache = { at: now, value };
  return value;
};

/** Forgets the cached answers (tests). */
export const clearMonsterStatsCache = (): void => {
  cache.clear();
  championCache = null;
};
