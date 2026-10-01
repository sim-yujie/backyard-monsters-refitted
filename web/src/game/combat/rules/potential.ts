import {
  FOMOR_ID,
  KRALLEN_ID,
  QUAKE_RADIUS_RANGES,
  QUAKE_SWINGS,
  UNTARGETABLE_TYPES,
  championPower,
  enrageMultiplier,
  fomorBuff,
  hasLootAura,
  hasQuake,
  krallenBuff,
  lootAuraBonus,
} from "./champions.js";
import {
  bombBlast,
  bombParticleDamage,
  bombsFor,
  championAttackDelay,
  championStat,
  championStatWithPower,
  HARVESTER_TYPES,
  LOOT_PROPERTY_BASE,
  LOOT_PROPERTY_BONUS,
  lowLevelLootBonus,
  maxBombSpend,
  monsterAttackDelay,
  monsterStat,
  propsSizeOf,
  SPECIALIST_DAMAGE_MULTIPLIER,
  squashedEllipse,
  TARGET_GROUP,
  TICKS_PER_SECOND,
  type BombStats,
} from "./stats.js";
import {
  amountsOf,
  COMBAT_TOLERANCES,
  noAmounts,
  RESOURCE_KEYS,
  type AttackContext,
  type ChampionOnField,
  type CombatTolerances,
  type CombatViolation,
  type CombatYard,
  type ResourceAmounts,
  type ResourceKey,
  type Roster,
} from "./types.js";
import { buildingClass, footprintOf, screenOf } from "./yard.js";

/**
 * The damage budget and the loot bounds: Phase A's envelope (§2.3, §2.4).
 *
 * The server has no fling log from a Flash attacker — no positions, no drop
 * times, no per-fling composition as data (§1.1) — so it cannot replay the
 * battle and cannot say what *did* happen. What it can say is what *could*
 * have: the most damage the monsters known to be on the field could deal in the
 * interval this save covers, and the most loot that damage could have carried.
 * Anything past that is a claim no honest client makes.
 *
 * The bound is deliberately loose. Travel time, tower fire, walls in the way
 * and monsters dying are all ignored, so a full fling can bound more damage
 * than most yards hold; §6 item 1 is why that is the right first bound. It is
 * exact where exactness is free — nothing flung means nothing fell, loot cannot
 * exceed what the defender lost — and an envelope everywhere else. Tightening
 * it needs positions, and positions need issue #32.
 *
 * Every figure here is an upper bound by construction: fortification and armour
 * only lower real damage (`client/scripts/BFOUNDATION.as:508-512`) and every
 * storage scalar only shrinks a gain (`BSTORAGE.as:77-85`), so neither appears.
 */

/* ── Swings ───────────────────────────────────────────────────────────────── */

/**
 * The most swings one attacker gets in `elapsed` seconds at `delay` fast ticks.
 *
 * `floor(elapsed * 80 / delay) + 1`: the `+ 1` is the swing that lands on the
 * first tick of the interval, because a creep that was already in range when
 * the last save went out swings immediately rather than waiting out a delay.
 * A delay of 0 would be a division by zero, so it reads as one tick.
 */
export const swings = (elapsedSeconds: number, delay: number): number => {
  const ticks = Math.max(0, elapsedSeconds) * TICKS_PER_SECOND;
  return Math.floor(ticks / Math.max(1, delay)) + 1;
};

/* ── What one swing can reach ─────────────────────────────────────────────── */

/**
 * How many 50-unit footprints one splash swing can cover.
 *
 * A 60 px blast around a melee creep's target, or Wormzer's 100 px, reaches at
 * most the target and the ring of buildings touching it, which is six
 * footprints (`docs/specs/combat.md:652-678`). The bound takes the ring as full
 * every time, which no real yard is.
 */
export const AOE_FOOTPRINTS = 6;

/**
 * The area multiplier a monster's swing carries, keyed by monster id.
 *
 * Only the four creeps whose ability touches **buildings** are here. Fink's
 * `AOEDamageOnAttack(60, …)` and Bandito's `BanditoAOEDamageSpin(60, …)` splash
 * on each hit; Wormzer's `AOEDamageOnAttackOncePerTarget(100, …)` hits each
 * target at most once per swing, which is still the ring; D.A.V.E.'s
 * `DAVERockets` fires two missiles at **half** damage each, so it is 1 and is
 * listed rather than defaulted, because a reader would otherwise assume it was
 * missed (`combat.md:652-678`). Project X's blast is on death, not on attack,
 * and a creep that died dealt its swings already.
 */
export const MONSTER_AOE: Readonly<Record<string, number>> = {
  // Fink
  C4: AOE_FOOTPRINTS,
  // Bandito
  C7: AOE_FOOTPRINTS,
  // D.A.V.E. — two rockets at half damage is one swing's worth
  C12: 1,
  // Wormzer
  C13: AOE_FOOTPRINTS,
};

/**
 * The area multiplier a champion's swing carries, keyed by champion id.
 *
 * Every champion's swing hits one target. Korath's quake is not a swing: it
 * is bounded on its own, from the yard ({@link quakePotential}, issue #222).
 */
export const CHAMPION_AOE: Readonly<Record<string, number>> = {};

/**
 * The swing interval an enraged creep fights at: `int(attackDelay / m)`
 * (`Enrage.as:23`, issue #222), never below one tick.
 */
const enragedDelay = (delay: number, enrage: number): number =>
  enrage === 1 ? delay : Math.max(1, Math.trunc(delay / enrage));

/** Slimeattikus, whose death leaves `splits[L]` children (`creeps/Slimeattikus.as:11-13`). */
export const SPLIT_CHILD_ID = "C18";

/**
 * Rezghul, whose presence means every dead creep may come back once.
 *
 * `RezghulResurrectAttack` is always on, not gated behind the academy
 * (`creeps/Rezghul.as:48-53`), so one on the field doubles the roster's whole
 * term rather than adding a figure of its own (§2.3).
 */
export const REZGHUL_ID = "C19";

/**
 * What a monster's swing does to the class it specialises in.
 *
 * `targetGroup` 2 is the wall breakers and 4 the tower killers, and each deals
 * double to its own class (`CreepBase.as:884-894`). The bound takes the double
 * unconditionally: it cannot know what the creep actually hit, and the swing
 * against anything else is the smaller figure.
 */
export const specialistBound = (targetGroup: number): number =>
  targetGroup === TARGET_GROUP.WALLS || targetGroup === TARGET_GROUP.TOWERS
    ? SPECIALIST_DAMAGE_MULTIPLIER
    : 1;

/**
 * The most one monster of a type, at one level, can deal in the interval.
 *
 * Three shapes of creep, in the order they are decided:
 *
 * 1. **A healer.** C15 and C16 carry negative damage (`combat.md:508-510`), and
 *    a negative term would buy a cheat budget. They contribute 0.
 * 2. **A suicide.** Eye-ra's `explode: [1]` means the creep dies on its own
 *    blast (`CreepBase.as:896-898`), so its damage lands once however long the
 *    interval is — times 2, because it is a wall specialist.
 * 3. **Everything else.** Damage times the specialist multiplier, times the
 *    swings the interval allows, times the area a swing covers.
 *
 * A Slimeattikus adds its children on top, at its own level: they are spawned
 * on its death and swing for whatever is left of the interval, which the bound
 * takes as all of it.
 */
export const monsterPotential = (
  id: string,
  level: number,
  count: number,
  elapsedSeconds: number,
  enrage = 1,
): number => {
  if (count <= 0) return 0;

  const damage = monsterStat(id, "damage", level);
  const multiplier = specialistBound(monsterStat(id, "targetGroup", level));
  let total = 0;

  if (damage > 0) {
    if (monsterStat(id, "explode", level) > 0) {
      total = damage * multiplier * count;
    } else {
      const area = MONSTER_AOE[id] ?? 1;
      const hits = swings(elapsedSeconds, enragedDelay(monsterAttackDelay(id, level), enrage));
      total = damage * multiplier * hits * area * count;
    }
  }

  const splits = monsterStat(id, "splits", level);
  if (splits > 0) {
    total += monsterPotential(SPLIT_CHILD_ID, level, count * splits, elapsedSeconds, enrage);
  }

  return total;
};

/**
 * The most a champion on the field can deal in the interval: its swings at
 * its level plus its power level's bonus (issue #202), swinging faster when
 * Fomor has enraged it, and Korath's quakes on top (issue #222).
 *
 * A quake comes after three swings (`Korath.as:184`), so the interval holds
 * at most one for every three swings, and one more for the swings the last
 * save left counted. Each takes off no more than {@link quakePotential} reads
 * off the yard; with no yard the quake is not bounded and adds nothing.
 */
export const championPotential = (
  id: string,
  level: number,
  elapsedSeconds: number,
  powerLevel = 0,
  yard: CombatYard | null = null,
  enrage = 1,
): number => {
  const damage = championStatWithPower(id, "damage", level, powerLevel);
  if (damage <= 0) return 0;
  const area = CHAMPION_AOE[id] ?? 1;
  const hits = swings(elapsedSeconds, enragedDelay(championAttackDelay(id, level), enrage));
  let total = damage * hits * area;
  if (yard && hasQuake(id, level, championPower(id, powerLevel))) {
    const range = championStatWithPower(id, "range", level, powerLevel);
    const quakes = Math.floor(hits / QUAKE_SWINGS) + 1;
    total += quakes * quakePotential(yard, range * QUAKE_RADIUS_RANGES, damage);
  }
  return total;
};

/** A building a quake could reach, as {@link quakePotential} weighs it. */
interface QuakeTarget {
  /** Its anchor on screen, which `getBuildingsInRange` measures to. */
  readonly x: number;
  readonly y: number;
  /** The most one quake takes off it: its damage, never past its health. */
  readonly most: number;
}

/**
 * The most one of Korath's quakes can take off the yard, wherever he stands
 * (issue #222).
 *
 * The quake reaches every building but the untargetable whose anchor is
 * closer than `radius` on screen (`Korath.as:192-209`, `Targeting.as:151-173`),
 * and none for more than Korath's damage (`DealLinearAEDamage`'s figure falls
 * off from it). Any two buildings one quake reaches are therefore closer than
 * two radii apart, so taking each building in turn and adding up every
 * building that close to it covers every set one quake can reach, as
 * {@link bombPotential} does for a bomb.
 */
export const quakePotential = (yard: CombatYard, radius: number, damage: number): number => {
  const targets: QuakeTarget[] = [];
  for (const building of yard.buildings) {
    if (building.hp <= 0 || building.spent || UNTARGETABLE_TYPES.includes(building.type)) continue;
    const at = screenOf(building.x, building.y);
    targets.push({ x: at.x, y: at.y, most: Math.min(building.hp, damage) });
  }
  if (targets.length === 0) return 0;
  // The sort is stable, so equal columns keep the yard's id order.
  targets.sort((a, b) => a.x - b.x);
  const span = radius * 2;
  let best = 0;
  let low = 0;
  let high = 0;
  for (const anchor of targets) {
    while ((targets[low] as QuakeTarget).x <= anchor.x - span) low += 1;
    while (high < targets.length && (targets[high] as QuakeTarget).x < anchor.x + span) high += 1;
    let total = 0;
    for (let index = low; index < high; index += 1) {
      const other = targets[index] as QuakeTarget;
      const dx = other.x - anchor.x;
      const dy = other.y - anchor.y;
      if (dx * dx + dy * dy < span * span) total += other.most;
    }
    best = Math.max(best, total);
  }
  return best;
};

/**
 * Every attacking champion the context names: the list when it carries one,
 * else its single champion (an attack may field an ordinary champion and
 * Krallen together, issue #74).
 */
export const championsOnField = (context: AttackContext): readonly ChampionOnField[] =>
  context.champions ?? (context.champion ? [context.champion] : []);

/**
 * How much Fomor's enrage aura speeds its allies up, 1 without a Fomor on the
 * attacker's side (`AOEEnrage`, `Fomor.as:18`, issue #222). The bound takes
 * every ally as enraged for the whole interval.
 */
export const enrageBound = (champions: readonly ChampionOnField[]): number => {
  const fomor = champions.find((champion) => champion.id === FOMOR_ID);
  if (!fomor) return 1;
  return enrageMultiplier(fomorBuff(fomor.level, championPower(FOMOR_ID, fomor.powerLevel)));
};

/* ── What one bomb can reach ──────────────────────────────────────────────── */

/** A building a bomb could hurt, as {@link bombPotential} weighs it. */
interface BombTarget {
  /** The point `ResourceBomb` measures to, `_mc` plus `_middle`, on screen. */
  readonly x: number;
  readonly y: number;
  /** How far from the blast's centre this building can be and still be hit. */
  readonly reach: number;
  /** The most the bomb can take off it: its whole health, at most. */
  readonly most: number;
}

/**
 * The most one damage bomb can take off the defender's yard, wherever it lands.
 *
 * A bomb hits every building its blast reaches, each for the full
 * `particles * bombParticleDamage` (`ResourceBomb.as`), so over a dense corner
 * it deals its `damage` many times over (issue #84). The figure here is
 * derived from the yard, in the same screen space and with the same skips the
 * engine's `bomb` uses, and it is an upper bound for every drop point:
 *
 * - {@link bombReaches} hits a building only when its distance from the
 *   centre is under `sqrt(e1² + e2²)`, the blast's and the building's edge
 *   distances along the line between them. Neither edge is longer than its
 *   ellipse's horizontal semi-axis, so a building is hit only within `reach`,
 *   `sqrt(blast.rx² + building.rx²)`, of the centre.
 * - Any two buildings one blast reaches are therefore closer together than
 *   their two reaches added up. Taking each building in turn as one of the hit
 *   ones and adding up every building that close to it covers every set of
 *   buildings one blast can hit.
 * - Each building counts for what the bomb would deal it, and never more than
 *   the health it has at the reference point, which is all it can lose.
 *
 * The neighbourhood is up to twice the blast's reach across, so on a crowded
 * yard the bound can run to a few times what the best-placed bomb really
 * deals. It trades that for being cheap (one sweep over the buildings sorted
 * across the screen) and provably never short, which is what a budget that
 * refuses saves must be. An empty yard gives 0: there is nothing to hit.
 */
export const bombPotential = (bomb: BombStats, yard: CombatYard): number => {
  if (bomb.damage <= 0) return 0;
  const blast = bombBlast(bomb).rx;
  const targets: BombTarget[] = [];
  for (const building of yard.buildings) {
    if (building.hp <= 0 || building.spent) continue;
    const kind = buildingClass(building.type);
    if (kind === "trap" || kind === "decoration" || kind === "enemy" || kind === "immovable") {
      continue;
    }
    const share = bombParticleDamage(bomb, { type: building.type, level: building.level, kind });
    const most = Math.min(building.hp, share * bomb.particles);
    if (most <= 0) continue;
    const at = screenOf(building.x, building.y);
    const edge = squashedEllipse(propsSizeOf(building.type)).rx;
    targets.push({
      x: at.x,
      y: at.y + footprintOf(building.type).h * 0.5,
      reach: Math.sqrt(blast * blast + edge * edge),
      most,
    });
  }
  if (targets.length === 0) return 0;

  // Sorted across the screen, so each building's neighbours sit in one run of the list.
  // The sort is stable, so equal columns keep the yard's id order.
  targets.sort((a, b) => a.x - b.x);
  let widest = 0;
  for (const target of targets) widest = Math.max(widest, target.reach);
  const span = widest * 2;

  let best = 0;
  let low = 0;
  let high = 0;
  for (const anchor of targets) {
    while ((targets[low] as BombTarget).x <= anchor.x - span) low += 1;
    while (high < targets.length && (targets[high] as BombTarget).x < anchor.x + span) high += 1;
    let total = 0;
    for (let index = low; index < high; index += 1) {
      const other = targets[index] as BombTarget;
      const apart = other.reach + anchor.reach;
      const dx = other.x - anchor.x;
      const dy = other.y - anchor.y;
      if (dx * dx + dy * dy < apart * apart) total += other.most;
    }
    best = Math.max(best, total);
  }
  return best;
};

/**
 * The most the bombs of one attack can take off the yard.
 *
 * One bomb per resource (§2.3), and of that resource's tiers the catapult
 * unlocks, whichever could deal the most here. A tier another one outdoes on
 * damage and on blast, with the same number of particles, can deal no more
 * to any building nor reach any building the other misses, so it is skipped
 * without being weighed; that leaves one tier per resource in today's table.
 */
export const bombsPotential = (catapultLevel: number, yard: CombatYard): number => {
  const unlocked = bombsFor(catapultLevel).filter((bomb) => bomb.damage > 0);
  const best = new Map<number, number>();
  unlocked.forEach((bomb, at) => {
    // Of two identical tiers, the first stands for both.
    const outdone = unlocked.some(
      (other, index) =>
        index !== at &&
        other.resource === bomb.resource &&
        other.particles === bomb.particles &&
        other.damage >= bomb.damage &&
        other.radius >= bomb.radius &&
        (other.damage > bomb.damage || other.radius > bomb.radius || index < at),
    );
    if (outdone) return;
    const most = bombPotential(bomb, yard);
    best.set(bomb.resource, Math.max(best.get(bomb.resource) ?? 0, most));
  });
  let total = 0;
  for (const resource of [...best.keys()].sort((a, b) => a - b)) {
    total += best.get(resource) as number;
  }
  return total;
};

/* ── The damage budget ────────────────────────────────────────────────────── */

/** Where the bound's figure came from, for the log line and the Baiter. */
export interface PotentialBreakdown {
  /** Every flung monster's term, at its academy level. */
  readonly monsters: number;
  /** The same figure again when a Rezghul is on the field, else 0. */
  readonly zombies: number;
  readonly champion: number;
  /** One bomb per resource, at the most its blast could take off this yard. */
  readonly bombs: number;
}

/** The envelope one save's health drop is read against (§2.3). */
export interface PotentialReport {
  readonly potential: number;
  /** 1% of `potential`, never below `damageSlackMin`. */
  readonly slack: number;
  /** `potential + slack`: the most `drop` may be. */
  readonly limit: number;
  readonly breakdown: PotentialBreakdown;
  /**
   * Nothing was flung, no champion is on the field and there is no catapult.
   *
   * The one case the bound is exact in: a yard cannot lose a point of health to
   * an attacker who put nothing on it (§2.3).
   */
  readonly empty: boolean;
}

/** Whether a roster names anything at all. */
const anyFlung = (flung: Roster): boolean =>
  Object.values(flung).some((count) => count > 0);

/**
 * The most damage the attack could have done in the interval this save covers.
 *
 * Reads only the context: the roster that has left the attacker's cells, the
 * academy levels those monsters fight at, the champion if one is on the field,
 * and the catapult level that decides which bombs exist. The monsters' terms do
 * not look at the defender's yard, because they bound what the attacker could
 * deal and not what the yard could absorb — a tighter figure would need
 * positions. The bombs' term does, because a bomb deals its damage to every
 * building under it and the yard is what says how many that can be
 * ({@link bombPotential}).
 */
export const damagePotential = (
  context: AttackContext,
  tolerances: CombatTolerances = COMBAT_TOLERANCES,
): PotentialReport => {
  const elapsed = context.elapsedSave;
  const champions = championsOnField(context);
  const enrage = enrageBound(champions);
  let monsters = 0;

  for (const [id, count] of Object.entries(context.flung)) {
    const level = context.levels[id] ?? 1;
    monsters += monsterPotential(id, level, count, elapsed, enrage);
  }

  const zombies = (context.flung[REZGHUL_ID] ?? 0) > 0 ? monsters : 0;

  let champion = 0;
  for (const one of champions) {
    // Fomor does not enrage itself (`AOEEnrage.as:45`).
    const sped = one.id === FOMOR_ID ? 1 : enrage;
    champion += championPotential(one.id, one.level, elapsed, one.powerLevel, context.yard, sped);
  }

  const bombs = bombsPotential(context.attacker.catapultLevel, context.yard);
  const potential = monsters + zombies + champion + bombs;
  const slack = Math.max(tolerances.damageSlackMin, potential * tolerances.damageSlackFraction);

  return {
    potential,
    slack,
    limit: potential + slack,
    breakdown: { monsters, zombies, champion, bombs },
    empty:
      !anyFlung(context.flung) && champions.length === 0 && context.attacker.catapultLevel <= 0,
  };
};

/** The budget rules of §2.3 over one save's health drop. */
export const auditDamageBudget = (
  context: AttackContext,
  drop: number,
  tolerances: CombatTolerances = COMBAT_TOLERANCES,
): { readonly report: PotentialReport; readonly violations: readonly CombatViolation[] } => {
  const report = damagePotential(context, tolerances);
  const violations: CombatViolation[] = [];

  if (report.empty) {
    // No envelope to compute: nothing was on the field, so nothing fell.
    if (drop > 0) {
      violations.push({ rule: "damageWithoutMonsters", detail: { drop }, enforced: true });
    }
    return { report, violations };
  }

  if (drop > report.limit) {
    violations.push({
      rule: "damageBudget",
      detail: {
        drop,
        potential: report.potential,
        slack: report.slack,
        elapsed: context.elapsedSave,
        breakdown: report.breakdown,
      },
      enforced: true,
    });
  }

  return { report, violations };
};

/* ── Loot ─────────────────────────────────────────────────────────────────── */

/**
 * The most a gain may exceed the matching loss, as a ratio.
 *
 * A point of damage to a resource building takes a unit of that resource with
 * it, so the two deltas are the same quantity seen from each side
 * (`docs/specs/combat.md:1410-1416`). Everything between them shrinks the
 * attacker's share except one thing: the low-level bonus, `+3%` per level below
 * 20, which is `+57%` at level 1 (`client/scripts/ATTACK.as:678-680`). 1.6
 * covers it with room for the rounding (§6, item 3).
 */
export const LOOT_GAIN_RATIO = COMBAT_TOLERANCES.lootGainRatio;

/**
 * The most the whole gain may exceed the damage that carried it.
 *
 * The largest looting multiplier a creep carries is 2: a resource specialist
 * and every champion, Krallen included, add 1.5 to a looting property based at
 * 0.5 (`MonsterBase.as:260`, `CreepBase.as:224-226`, `ChampionBase.as:221`).
 * With the low-level bonus that is 3.14 a point of damage, and 5 leaves room
 * for the rounding. Krallen's aura, `LootingMultiplier`, can add up to 1.3 on
 * top, which {@link lootAuraBound} widens the allowance by (issue #222).
 */
export const LOOT_MULT_MAX = COMBAT_TOLERANCES.lootMultMax;

/** A harvester's type is its resource index (`client/scripts/BRESOURCE.as:106`). */
export const harvesterResource = (type: number): ResourceKey | undefined =>
  HARVESTER_TYPES.includes(type) ? (`r${type}` as ResourceKey) : undefined;

/**
 * What the defender's harvesters hold in their own buffers, per resource.
 *
 * `st` is banked in the building and is drawn before the pool
 * (`BRESOURCE.as:481-493`), so a yard can lose more than its pool holds and
 * `lossExceedsPool` has to allow for it (§2.4).
 */
export const bankedByResource = (yard: CombatYard): ResourceAmounts => {
  const banked = noAmounts();

  for (const building of yard.buildings) {
    const resource = harvesterResource(building.type);
    if (resource) banked[resource] += building.banked;
  }

  return banked;
};

/**
 * Krallen is the only champion whose buff reaches the attacker's storage cap.
 *
 * `ATTACK.Loot` reads `CREEPS.krallen` by name (`ATTACK.as:696-702`), so
 * Fomor's `buffs` ladder — which is an enrage aura, not a cap — must not be
 * read here even though the stat table spells it the same way. Her id,
 * `KRALLEN_ID`, lives in `champions.ts`.
 */

/**
 * The attacker's storage cap with Krallen's buff applied, per resource.
 *
 * `ATTACK.Loot` raises the cap by `cap * krallen._buff` while she is on the
 * field (`ATTACK.as:696-702`), and her `buffs` ladder is on the stat table. The
 * caps are already `storageCap(A)`; this is the one thing a battle can do to
 * them.
 */
export const lootCaps = (context: AttackContext): ResourceAmounts => {
  const caps = { ...context.attacker.caps };
  const champion = championsOnField(context).find((one) => one.id === KRALLEN_ID);
  if (!champion) return caps;

  const buff = championStat(KRALLEN_ID, "buffs", champion.level);
  if (buff <= 0) return caps;

  for (const key of RESOURCE_KEYS) caps[key] *= 1 + buff;
  return caps;
};

/**
 * How far Krallen's loot aura can raise the largest looting property, as a
 * ratio of it: `(2 + 1 + buff) / 2` while she has it, else 1
 * (`ProximityLootBuff`, `LootingMultiplier`, issue #222).
 */
export const lootAuraBound = (champions: readonly ChampionOnField[]): number => {
  const krallen = champions.find((champion) => champion.id === KRALLEN_ID);
  if (!krallen || !hasLootAura(KRALLEN_ID, championPower(KRALLEN_ID, krallen.powerLevel))) {
    return 1;
  }
  const most = LOOT_PROPERTY_BASE + LOOT_PROPERTY_BONUS;
  return (most + lootAuraBonus(krallenBuff(krallen.level))) / most;
};

/** What {@link auditLoot} is handed. */
export interface LootAuditInput {
  readonly context: AttackContext;
  /** `T.attackloot`: positive is the attacker's gain, negative is bomb spend. */
  readonly attackloot?: unknown;
  /** `T.resources`: the defender's delta, whose negative part is the loss. */
  readonly defenderDelta?: unknown;
  /** The defender's stored pool, before this save. */
  readonly defenderPool: ResourceAmounts;
  /** The part of the health drop that fell on lootable buildings (§2.4). */
  readonly lootableDrop: number;
  readonly tolerances?: CombatTolerances;
}

/** The credited loot, and everything the bounds had to say about it. */
export interface LootAudit {
  /** What the server credits: gains capped at storage, bomb spend preserved. */
  readonly attackloot: ResourceAmounts;
  /** The gain per resource after the cap, before the spend is folded back in. */
  readonly credited: ResourceAmounts;
  /** The caps the credit was taken against, Krallen included. */
  readonly caps: ResourceAmounts;
  readonly violations: readonly CombatViolation[];
}

/**
 * The loot rules of §2.4, all five, in one pass.
 *
 * Four are checks and one is a derivation. `lootOverCap` is the derivation: the
 * client already refuses to bank past the cap (`ATTACK.as:703-710`), so a gain
 * above it is a difference of opinion about the cap rather than a cheat, and
 * the server simply credits its own figure and records the gap.
 *
 * The three bounds are each an upper bound of a different kind.
 * `lootExceedsLoss` compares the two halves of one transaction and allows only
 * the low-level bonus between them. `lootExceedsDamage` compares the gain to
 * the damage that had to carry it. `lossExceedsPool` says a yard cannot lose
 * what it does not hold; `defenderLootHandler` already floors the pool at 0, so
 * this is what makes the excess visible rather than silently absorbed.
 */
export const auditLoot = (input: LootAuditInput): LootAudit => {
  const { context } = input;
  const tolerances = input.tolerances ?? COMBAT_TOLERANCES;
  const sent = amountsOf(input.attackloot);
  const delta = amountsOf(input.defenderDelta);
  const banked = bankedByResource(context.yard);
  const caps = lootCaps(context);

  const violations: CombatViolation[] = [];
  const credited = noAmounts();
  const attackloot = noAmounts();

  // The bonus the attacker's own level earns, which is the only thing that
  // makes a gain legitimately larger than the matching loss.
  const bonus = Math.max(
    tolerances.lootGainRatio,
    lowLevelLootBonus(context.attacker.playerLevel),
  );

  let gained = 0;

  for (const key of RESOURCE_KEYS) {
    const gain = Math.max(0, sent[key]);
    const spend = Math.max(0, -sent[key]);
    const loss = Math.max(0, -delta[key]);
    gained += gain;

    if (gain > loss * bonus) {
      violations.push({
        rule: "lootExceedsLoss",
        detail: { resource: key, gain, loss, ratio: bonus },
        enforced: true,
      });
    }

    const pool = input.defenderPool[key] + banked[key];
    if (loss > pool) {
      violations.push({
        rule: "lossExceedsPool",
        detail: { resource: key, loss, pool },
        enforced: true,
      });
    }

    const spendMax = maxBombSpend(Number(key.slice(1)), context.attacker.catapultLevel);
    if (spend > spendMax) {
      violations.push({
        rule: "bombSpend",
        detail: { resource: key, spend, max: spendMax },
        enforced: true,
      });
    }

    const room = Math.max(0, caps[key] - context.attacker.pool[key]);
    const take = Math.min(gain, room);
    credited[key] = take;
    attackloot[key] = take - spend;

    if (take < gain) {
      violations.push({
        rule: "lootOverCap",
        detail: { resource: key, gain, credited: take, cap: caps[key] },
        enforced: false,
      });
    }
  }

  // A specialist's or a champion's 2 is the largest multiplier a creep carries,
  // and a Vacuum's per-level `lootBonus` was never traced (§6, item 4), so its
  // presence doubles the allowance rather than guessing the figure. Krallen's
  // aura raises the 2 by `1 + buff` (issue #222).
  const multiplier =
    tolerances.lootMultMax *
    (context.attacker.hasVacuum ? tolerances.vacuumLootSlack : 1) *
    lootAuraBound(championsOnField(context));
  const allowance = input.lootableDrop * multiplier;

  if (gained > allowance) {
    violations.push({
      rule: "lootExceedsDamage",
      detail: {
        gain: gained,
        lootableDrop: input.lootableDrop,
        mult: multiplier,
        creepMax: LOOT_PROPERTY_BASE + LOOT_PROPERTY_BONUS,
      },
      enforced: true,
    });
  }

  return { attackloot, credited, caps, violations };
};
