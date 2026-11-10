import { KRALLEN_ID } from "./champions.js";
import {
  bunkerGarrisons,
  housedGarrisons,
  type BattleBuffs,
  type BattleOptions,
  type DefenceBonus,
  type DefenderChampion,
  type SideBuffs,
} from "./engine.js";
import { championByType, CHAMPION_MAX_FOOD_BONUS, CHAMPION_MAX_POWER_LEVEL } from "./stats.js";
import { MAX_RANK } from "./specialMoves.js";
import { combineDefenceBonus, landDefenceBonus, landFeatureOf } from "./landFeatures.js";
import type { CombatBuildingDataMap, MonsterLevels, MonsterRanks, Roster } from "./types.js";

/**
 * What a yard defends itself with (issue #195): each Monster Bunker's
 * garrison, the levels its monsters fight at, and the champions in its
 * Champion Cage.
 *
 * One picker for every caller, so the server's replay, the web client's battle
 * and the Wild Monster Baiter fight the same defence off the same save. The
 * attack load works it out once, serves it to the client and keeps it in the
 * attack session, so the save's replay fights exactly what the client did.
 */
export interface DefenderForces {
  /** Each bunker's garrison, by building id ({@link bunkerGarrisons}). */
  readonly bunkers: Readonly<Record<number, Roster>>;
  /** The defender's academy levels, by monster id; an absent one fights at level 1. */
  readonly defenderLevels: MonsterLevels;
  /**
   * The defender's Monster Lab ranks, by monster id: what its bunkers'
   * monsters fight with (issue #352). Absent, or an absent id, is rank 0.
   */
  readonly defenderRanks?: MonsterRanks;
  /** The champions at home in the cage, none to two ({@link cagedChampions}). */
  readonly defenderChampions: readonly DefenderChampion[];
  /**
   * The shop boosts running when the battle was set up (engine fidelity note
   * 19): the defending yard's own, and in an attack the attacker's, off its
   * main yard ({@link withAttackerBuffs}). Frozen with the rest of the
   * defence, so every replay fights with the same. Absent: none on either side.
   */
  readonly buffs?: BattleBuffs;
  /**
   * Map Room 2's neighbour defence bonus (`docs/mr2-neighbours.md`): the
   * friendly cells around the defending cell, 1 to 6, as the attack load
   * counted them with the bonus switched on. Absent: no bonus, the battle as
   * it always was.
   */
  readonly neighbours?: number;
  /**
   * The defending cell's Map Room 2 land feature (`landFeatures.ts`), 1 to 7,
   * as the attack load froze it with the land switch on. Absent: open
   * ground, the battle as it always was.
   */
  readonly land?: number;
  /**
   * The defending player's alliance constellation bonuses for this battle
   * (beta 7 alliances, design v5 §9), whole percent, as the attack load froze
   * them ({@link AllianceDefence}). Absent, or every part 0: no bonus, the
   * battle as it always was, which is what an attack log from before beta 7
   * holds.
   */
  readonly alliance?: AllianceDefence;
}

/**
 * An alliance's battle bonuses on the defending yard, whole percent (positive
 * = stronger): `hp` its buildings' health (building health, plus outpost
 * health when the yard is an outpost), `damage` its towers' damage, `trap` its
 * traps' damage. The attack load adds the stats up; the battle only reads them.
 */
export interface AllianceDefence {
  readonly hp?: number;
  readonly damage?: number;
  readonly trap?: number;
}

/** The most an alliance part can change a battle by, either way, in percent: a guard on a bad save. */
export const ALLIANCE_DEFENCE_LIMIT = 90;

const alliancePart = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= ALLIANCE_DEFENCE_LIMIT ? value : 0;

/** The alliance's parts that read cleanly and are not 0, or undefined for none. */
export const parseAllianceDefence = (raw: unknown): AllianceDefence | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const hp = alliancePart(value.hp);
  const damage = alliancePart(value.damage);
  const trap = alliancePart(value.trap);
  if (hp === 0 && damage === 0 && trap === 0) return undefined;
  return { ...(hp !== 0 && { hp }), ...(damage !== 0 && { damage }), ...(trap !== 0 && { trap }) };
};

/** The battle's defence bonus for an alliance's parts, as fractions; none for none. */
export const allianceDefenceBonus = (alliance: AllianceDefence | undefined): DefenceBonus | undefined => {
  const parts = parseAllianceDefence(alliance);
  if (!parts) return undefined;
  return {
    hp: (parts.hp ?? 0) / 100,
    damage: (parts.damage ?? 0) / 100,
    ...(parts.trap !== undefined && { trap: parts.trap / 100 }),
  };
};

/**
 * What each count of friendly neighbours adds to a Map Room 2 cell's defence
 * (`docs/mr2-neighbours.md`), as fractions: index 1 is one neighbour. Both
 * stats rise together, by less for each further neighbour: +5% for the first,
 * then +4, +2, +2 and +1 each for the fifth and sixth, so a cell ringed by six
 * friends has +15% building health and +15% tower damage. The owner's ladder
 * (3 Nov): the first +8, +6, +4, +2, +2, +2 scaled by 5/8 and rounded.
 */
export const NEIGHBOUR_DEFENCE_BONUS: readonly number[] = [
  0, 0.05, 0.09, 0.11, 0.13, 0.14, 0.15,
];

/** The battle's defence bonus for `neighbours` friendly cells; none for 0 or a bad count. */
export const neighbourDefenceBonus = (
  neighbours: number | undefined,
): DefenceBonus | undefined => {
  if (neighbours === undefined || !Number.isSafeInteger(neighbours)) return undefined;
  const top = NEIGHBOUR_DEFENCE_BONUS.length - 1;
  const share = NEIGHBOUR_DEFENCE_BONUS[Math.min(neighbours, top)] ?? 0;
  return share > 0 ? { hp: share, damage: share } : undefined;
};

/**
 * The shop items that boost a side in battle, and what each one turns on
 * (`STORE.as:2431-2500`). `TODI` is the Inferno shop's Tower Overdrive, held
 * only in an Inferno yard's store data (`STORE.as:2439-2444`).
 */
export const BOOST_ITEMS: Readonly<Record<string, keyof SideBuffs>> = {
  TOD: "towerDamage",
  TODI: "towerDamage",
  MOD: "monsterDamage",
  MDOD: "monsterArmour",
  MSOD: "monsterSpeed",
};

/** No defence at all: what a Map Room 1 tribe or a Map Room 2 camp has. */
export const NO_DEFENCE: DefenderForces = {
  bunkers: {},
  defenderLevels: {},
  defenderChampions: [],
};

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A save's `academy`, `{ monsterId: { level } }`, as levels: whole, at least 1. */
export const academyLevels = (academy: unknown): MonsterLevels => {
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(record(academy) ?? {})) {
    const level = Number(record(entry)?.level);
    if (Number.isFinite(level) && level >= 1) levels[id] = Math.floor(level);
  }
  return levels;
};

/**
 * A save's `academy`, `{ monsterId: { powerup } }`, as Monster Lab ranks: whole,
 * 1 to 3. A monster with no rank is left out (issue #352).
 */
export const academyRanks = (academy: unknown): MonsterRanks => {
  const ranks: Record<string, number> = {};
  for (const [id, entry] of Object.entries(record(academy) ?? {})) {
    const rank = Number(record(entry)?.powerup);
    if (Number.isFinite(rank) && rank >= 1) ranks[id] = Math.min(Math.floor(rank), MAX_RANK);
  }
  return ranks;
};

/**
 * The boosts a yard's `storedata` has running at `now` (unix seconds): each
 * {@link BOOST_ITEMS} entry whose end `e` is still ahead, as the whole seconds
 * it has left, so the battle can stop it when it runs out (engine fidelity
 * note 19). An attacker brings no towers, so its Tower Overdrive is left out.
 * Undefined when none runs.
 *
 * @param storedata - The yard's `storedata`.
 * @param now - The battle's start, unix seconds.
 * @param side - Whose boosts these are.
 */
export const storeBuffs = (
  storedata: unknown,
  now: number,
  side: "attacker" | "defender",
): SideBuffs | undefined => {
  const store = record(storedata);
  if (!store) return undefined;
  const buffs: { -readonly [K in keyof SideBuffs]: SideBuffs[K] } = {};
  for (const [item, buff] of Object.entries(BOOST_ITEMS)) {
    if (side === "attacker" && buff === "towerDamage") continue;
    const ends = Number(record(store[item])?.e);
    if (!Number.isFinite(ends) || ends <= now) continue;
    // `TOD` and `TODI` both feed the one `_towerOverdrive`, the later read
    // winning (`STORE.as:2436-2444`).
    buffs[buff] = Math.floor(ends - now);
  }
  return Object.keys(buffs).length > 0 ? buffs : undefined;
};

/**
 * A side's boosts as stored or served: only the known ones, and only when on.
 * A boost is `true` (on all battle, as stored before boosts could run out) or
 * the whole seconds it had left.
 */
const parseSideBuffs = (raw: unknown): SideBuffs | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const buffs: { -readonly [K in keyof SideBuffs]: SideBuffs[K] } = {};
  for (const buff of Object.values(BOOST_ITEMS)) {
    const span = value[buff];
    if (span === true) buffs[buff] = true;
    else if (typeof span === "number" && Number.isFinite(span) && span >= 0) {
      buffs[buff] = Math.floor(span);
    }
  }
  return Object.keys(buffs).length > 0 ? buffs : undefined;
};

/** Both sides' boosts as stored or served; undefined when neither has any. */
const parseBattleBuffs = (raw: unknown): BattleBuffs | undefined => {
  const value = record(raw);
  const attacker = parseSideBuffs(value?.attacker);
  const defender = parseSideBuffs(value?.defender);
  if (!attacker && !defender) return undefined;
  return { ...(attacker && { attacker }), ...(defender && { defender }) };
};

/**
 * A defence with the attacker's boosts added: the ones running on its main
 * yard at attack start (`GLOBAL.as:816-822`), never its Tower Overdrive.
 *
 * @param forces - The defence the attack load worked out.
 * @param storedata - The attacker's main yard's `storedata`.
 * @param now - The attack's start, unix seconds.
 */
export const withAttackerBuffs = (
  forces: DefenderForces,
  storedata: unknown,
  now: number,
): DefenderForces => {
  const attacker = storeBuffs(storedata, now, "attacker");
  if (!attacker) return forces;
  return { ...forces, buffs: { ...forces.buffs, attacker } };
};

/** One save entry as a caged champion, or null when it is not at home with health left. */
const atHome = (entry: unknown): DefenderChampion | null => {
  const champion = record(entry);
  if (!champion) return null;
  const t = Number(champion.t);
  const l = Number(champion.l);
  const hp = Number(champion.hp);
  if (!championByType(t) || !(Number(champion.status ?? 0) === 0)) return null;
  if (!Number.isFinite(l) || l < 1 || !Number.isFinite(hp) || hp <= 0) return null;
  const pl = Number(champion.pl);
  const fb = Number(champion.fb);
  return {
    t,
    l: Math.floor(l),
    hp: Math.floor(hp),
    pl: Number.isFinite(pl) ? Math.min(Math.max(Math.floor(pl), 0), CHAMPION_MAX_POWER_LEVEL) : 0,
    fb: Number.isFinite(fb) ? Math.min(Math.max(Math.floor(fb), 0), CHAMPION_MAX_FOOD_BONUS) : 0,
  };
};

/**
 * The champions that defend (issues #195, #310): those at home (`status` 0)
 * with health left, at most one basic champion and one Krallen, in the save's
 * order. Flash's cage pens both: the basic one in `CREATURES._guardian`, its
 * single slot, and Krallen, a special champion, beside it through
 * `addGuardian` (`CHAMPIONCAGE.as:628-655`, `CREATURES.as:219-257`).
 *
 * @param champions - The defender's save's `champion` list.
 */
export const cagedChampions = (champions: unknown): DefenderChampion[] => {
  if (!Array.isArray(champions)) return [];
  const picked: DefenderChampion[] = [];
  let basic = false;
  let krallen = false;
  for (const entry of champions) {
    const champion = atHome(entry);
    if (!champion) continue;
    const isKrallen = championByType(champion.t) === KRALLEN_ID;
    if (isKrallen ? krallen : basic) continue;
    if (isKrallen) krallen = true;
    else basic = true;
    picked.push(champion);
  }
  return picked;
};

/** Two sets of garrisons as one, counts added where a bunker is in both. */
const mergeGarrisons = (
  one: Record<number, Roster>,
  other: Record<number, Roster>,
): Record<number, Roster> => {
  const merged: Record<number, Record<string, number>> = {};
  for (const garrisons of [one, other]) {
    for (const [id, roster] of Object.entries(garrisons)) {
      const into = (merged[Number(id)] ??= {});
      for (const [monsterId, count] of Object.entries(roster)) {
        into[monsterId] = (into[monsterId] ?? 0) + (count ?? 0);
      }
    }
  }
  return merged;
};

/**
 * A yard's defence, read off the save that defends it.
 *
 * @param save - The defending row's `buildingdata` and `champion`, and the
 *   academy its monsters fight at: its own, or its owner's main yard's for an
 *   outpost; and, with the battle's start `now`, its own `storedata`, for the
 *   shop boosts it defends with ({@link storeBuffs}). An Inferno yard's housed
 *   `monsters` defend from its Housing Bunkers ({@link housedGarrisons}), read
 *   with its `buildinghealthdata`; no other yard has a Housing Bunker.
 */
export const defenderForcesOf = (save: {
  readonly buildingdata: unknown;
  readonly academy: unknown;
  readonly champion: unknown;
  readonly storedata?: unknown;
  readonly now?: number;
  readonly monsters?: unknown;
  readonly buildinghealthdata?: unknown;
}): DefenderForces => {
  const defenderRanks = academyRanks(save.academy);
  const defender =
    save.now === undefined ? undefined : storeBuffs(save.storedata, save.now, "defender");
  const buildingdata = record(save.buildingdata) as CombatBuildingDataMap | null;
  const housed = housedGarrisons(buildingdata, save.monsters, record(save.buildinghealthdata));
  return {
    bunkers: mergeGarrisons(bunkerGarrisons(buildingdata), housed),
    defenderLevels: academyLevels(save.academy),
    // Kept only when the Lab has researched something, so a yard without ranks serves what it did.
    ...(Object.keys(defenderRanks).length > 0 ? { defenderRanks } : {}),
    defenderChampions: cagedChampions(save.champion),
    ...(defender && { buffs: { defender } }),
  };
};

/**
 * A defence as stored or served (the attack session, the attack load's
 * `defenderforces`), each part kept only as far as it reads cleanly.
 */
export const parseDefenderForces = (raw: unknown): DefenderForces | undefined => {
  const value = record(raw);
  if (!value) return undefined;
  const bunkers: Record<number, Roster> = {};
  for (const [key, garrison] of Object.entries(record(value.bunkers) ?? {})) {
    const id = Number(key);
    if (!Number.isSafeInteger(id)) continue;
    const counts: Record<string, number> = {};
    for (const [monsterId, count] of Object.entries(record(garrison) ?? {})) {
      if (Number.isSafeInteger(count) && (count as number) > 0) counts[monsterId] = count as number;
    }
    bunkers[id] = counts;
  }
  const levels: Record<string, number> = {};
  for (const [id, level] of Object.entries(record(value.defenderLevels) ?? {})) {
    if (Number.isSafeInteger(level) && (level as number) >= 1) levels[id] = level as number;
  }
  const ranks: Record<string, number> = {};
  for (const [id, rank] of Object.entries(record(value.defenderRanks) ?? {})) {
    if (Number.isSafeInteger(rank) && (rank as number) >= 1 && (rank as number) <= MAX_RANK) {
      ranks[id] = rank as number;
    }
  }
  const buffs = parseBattleBuffs(value.buffs);
  const neighbours = typeof value.neighbours === "number" ? value.neighbours : undefined;
  const land = landFeatureOf(value.land);
  const alliance = parseAllianceDefence(value.alliance);
  // A session stored before issue #310 holds one `defenderChampion`.
  const champions = Array.isArray(value.defenderChampions)
    ? value.defenderChampions
    : value.defenderChampion === undefined
      ? []
      : [value.defenderChampion];
  return {
    bunkers,
    defenderLevels: levels,
    ...(Object.keys(ranks).length > 0 ? { defenderRanks: ranks } : {}),
    defenderChampions: cagedChampions(
      champions.map((entry) => {
        const champion = record(entry);
        return champion ? { ...champion, status: 0 } : null;
      }),
    ),
    ...(buffs && { buffs }),
    ...(neighbours !== undefined && neighbourDefenceBonus(neighbours) && { neighbours }),
    ...(land !== 0 && { land }),
    ...(alliance && { alliance }),
  };
};

/**
 * The battle options a defence gives, and none for no defence at all, so a
 * battle without one runs as it always did. The levels go in whenever there
 * are any: a Spurtz Cannon's Spurtz fight at the defender's level with no
 * bunker or caged champion on the yard too (issue #313). The boosts go in
 * whenever either side has one, and the neighbour bonus whenever the count
 * gives one.
 */
export const battleDefence = (
  forces: DefenderForces | null | undefined,
): Pick<
  BattleOptions,
  | "bunkers"
  | "defenderLevels"
  | "defenderRanks"
  | "defenderChampions"
  | "buffs"
  | "defenceBonus"
> => {
  if (!forces) return {};
  const hasBunkers = Object.keys(forces.bunkers).length > 0;
  const hasChampions = forces.defenderChampions.length > 0;
  const hasLevels = Object.keys(forces.defenderLevels).length > 0;
  const hasRanks = Object.keys(forces.defenderRanks ?? {}).length > 0;
  const hasBuffs = Boolean(forces.buffs && (forces.buffs.attacker || forces.buffs.defender));
  // The neighbour bonus, the land feature and the alliance multiply (`combineDefenceBonus`).
  const defenceBonus = combineDefenceBonus(
    combineDefenceBonus(neighbourDefenceBonus(forces.neighbours), landDefenceBonus(forces.land)),
    allianceDefenceBonus(forces.alliance),
  );
  return {
    ...(hasBunkers ? { bunkers: forces.bunkers } : {}),
    ...(hasBunkers || hasChampions || hasLevels ? { defenderLevels: forces.defenderLevels } : {}),
    // Only a bunker's monsters fight at the defender's rank (issue #352).
    ...(hasBunkers && hasRanks ? { defenderRanks: forces.defenderRanks as MonsterRanks } : {}),
    ...(hasChampions ? { defenderChampions: forces.defenderChampions } : {}),
    ...(hasBuffs ? { buffs: forces.buffs } : {}),
    ...(defenceBonus ? { defenceBonus } : {}),
  };
};
