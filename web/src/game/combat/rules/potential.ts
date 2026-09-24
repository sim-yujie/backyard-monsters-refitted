import {
  championAttackDelay,
  championStat,
  HARVESTER_TYPES,
  KRALLEN_STORAGE_LOOT_MULTIPLIER,
  lowLevelLootBonus,
  maxBombDamage,
  maxBombSpend,
  monsterAttackDelay,
  monsterStat,
  SPECIALIST_DAMAGE_MULTIPLIER,
  TARGET_GROUP,
  TICKS_PER_SECOND,
} from "./stats.js";
import {
  amountsOf,
  COMBAT_TOLERANCES,
  noAmounts,
  RESOURCE_KEYS,
  type AttackContext,
  type CombatTolerances,
  type CombatViolation,
  type CombatYard,
  type ResourceAmounts,
  type ResourceKey,
  type Roster,
} from "./types.js";

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
 * Korath (G4) stomps over `range * 2.5` at power level 3
 * (`com/monsters/monsters/champions/Korath.as:167-200`). The other four hit one
 * target, so they default to 1.
 */
export const CHAMPION_AOE: Readonly<Record<string, number>> = { G4: AOE_FOOTPRINTS };

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
      const hits = swings(elapsedSeconds, monsterAttackDelay(id, level));
      total = damage * multiplier * hits * area * count;
    }
  }

  const splits = monsterStat(id, "splits", level);
  if (splits > 0) {
    total += monsterPotential(SPLIT_CHILD_ID, level, count * splits, elapsedSeconds);
  }

  return total;
};

/** The most a champion on the field can deal in the interval. */
export const championPotential = (id: string, level: number, elapsedSeconds: number): number => {
  const damage = championStat(id, "damage", level);
  if (damage <= 0) return 0;
  const area = CHAMPION_AOE[id] ?? 1;
  return damage * swings(elapsedSeconds, championAttackDelay(id, level)) * area;
};

/* ── The damage budget ────────────────────────────────────────────────────── */

/** Where the bound's figure came from, for the log line and the Baiter. */
export interface PotentialBreakdown {
  /** Every flung monster's term, at its academy level. */
  readonly monsters: number;
  /** The same figure again when a Rezghul is on the field, else 0. */
  readonly zombies: number;
  readonly champion: number;
  /** One bomb per resource at its largest tier the catapult unlocks. */
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
 * and the catapult level that decides which bombs exist. Nothing here looks at
 * the defender's yard, because the bound is what the attacker could deal and
 * not what the yard could absorb — a tighter figure would need positions.
 */
export const damagePotential = (
  context: AttackContext,
  tolerances: CombatTolerances = COMBAT_TOLERANCES,
): PotentialReport => {
  const elapsed = context.elapsedSave;
  let monsters = 0;

  for (const [id, count] of Object.entries(context.flung)) {
    const level = context.levels[id] ?? 1;
    monsters += monsterPotential(id, level, count, elapsed);
  }

  const zombies = (context.flung[REZGHUL_ID] ?? 0) > 0 ? monsters : 0;

  const champion = context.champion
    ? championPotential(context.champion.id, context.champion.level, elapsed)
    : 0;

  const bombs = maxBombDamage(context.attacker.catapultLevel);
  const potential = monsters + zombies + champion + bombs;
  const slack = Math.max(tolerances.damageSlackMin, potential * tolerances.damageSlackFraction);

  return {
    potential,
    slack,
    limit: potential + slack,
    breakdown: { monsters, zombies, champion, bombs },
    empty:
      !anyFlung(context.flung) &&
      context.champion === null &&
      context.attacker.catapultLevel <= 0,
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
 * Krallen's `x3` against storage is the largest multiplier in the client
 * (`champions/Krallen.as:31-32`); a resource specialist and a champion each add
 * 1.5 to a looting property based at 1 (`CreepBase.as:224-226`,
 * `ChampionBase.as:221`), which is at most 2.5 whichever way
 * `CModifiableProperty` composes them (`combat.md:1370-1372`). 5 covers the
 * largest reading of both together plus the low-level bonus.
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
 * Krallen, the only champion whose buff reaches the attacker's storage cap.
 *
 * `ATTACK.Loot` reads `CREEPS.krallen` by name (`ATTACK.as:696-702`), so
 * Fomor's `buffs` ladder — which is an enrage aura, not a cap — must not be
 * read here even though the stat table spells it the same way.
 */
export const KRALLEN_ID = "G5";

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
  const champion = context.champion;
  if (!champion || champion.id !== KRALLEN_ID) return caps;

  const buff = championStat(KRALLEN_ID, "buffs", champion.level);
  if (buff <= 0) return caps;

  for (const key of RESOURCE_KEYS) caps[key] *= 1 + buff;
  return caps;
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

  // Krallen's `x3` against a silo is the largest multiplier a battle can carry,
  // and a Vacuum's per-level `lootBonus` was never traced (§6, item 4), so its
  // presence doubles the allowance rather than guessing the figure.
  const multiplier =
    tolerances.lootMultMax * (context.attacker.hasVacuum ? tolerances.vacuumLootSlack : 1);
  const allowance = input.lootableDrop * multiplier;

  if (gained > allowance) {
    violations.push({
      rule: "lootExceedsDamage",
      detail: {
        gain: gained,
        lootableDrop: input.lootableDrop,
        mult: multiplier,
        krallen: KRALLEN_STORAGE_LOOT_MULTIPLIER,
      },
      enforced: true,
    });
  }

  return { attackloot, credited, caps, violations };
};
