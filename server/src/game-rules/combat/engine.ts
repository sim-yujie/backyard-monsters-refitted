import { buildPathGrid } from "./grid.js";
import { mulberry32 } from "./rng.js";
import {
  ATTACK_COUNTDOWN_SECONDS,
  BEHAVIOUR_SPEED,
  BOMBS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  KRALLEN_RESOURCE_LOOT_MULTIPLIER,
  KRALLEN_STORAGE_LOOT_MULTIPLIER,
  MR2_FLINGER_LEVEL,
  RETARGET_TICKS,
  RETREAT_GRACE_SECONDS,
  STORAGE_SCALAR_MAIN,
  STORAGE_SCALAR_OUTPOST,
  STORAGE_TYPES,
  TARGET_GROUP,
  TOWER_ACQUIRE_TICKS,
  TOWER_REARM_MULTIPLIER,
  TRAP_RETARGET_TICKS,
  TRAP_TRIGGER_RANGE,
  WILD_MONSTER_LOOT_DIVISOR,
  capacity,
  championAttackDelay,
  championByType,
  championStat,
  fortifiedDamage,
  isLootable,
  lowLevelLootBonus,
  monsterAttackDelay,
  monsterMovement,
  monsterRange,
  monsterStat,
  monsterTickSpeed,
  specialistMultiplier,
  ticks,
  towerStats,
  trapDamageAt,
  trapStats,
} from "./stats.js";
import {
  canHit,
  createCreepIndex,
  defenseFlags,
  findBuildingTarget,
  isBunker,
  isFlyingMovement,
  oldStyleTargets,
  towerTargets,
  TRAP_TARGETS,
} from "./targeting.js";
import { distanceSquared, fromIso, isMainTarget } from "./yard.js";
import type { Cart, EngineBuilding, EngineYard } from "./yard.js";
import type { PathGrid } from "./grid.js";
import type { Rng } from "./rng.js";
import type { CreepIndex } from "./targeting.js";
import type { FlingEvent, MonsterLevels, ResourceAmounts, Roster } from "./types.js";

/**
 * The deterministic battle: one fixed-timestep simulation both trees run.
 *
 * `docs/design/server-combat.md` §1.2 makes this engine the thing the Wild
 * Monster Baiter (issue #22) simulates with, the thing the web client's attack
 * renderer draws, and the thing the server replays in Phase B (§2.8). All three
 * must agree to the digest, so the engine takes its clock and its randomness as
 * inputs, iterates in one fixed order, and calls no transcendental function
 * (§3.4). It reads the world through `stats.ts` and mutates nothing outside the
 * {@link EngineYard} it is handed.
 *
 * One tick is 1/80 s (`stats.ts` `TICKS_PER_SECOND`). The order inside a tick
 * is fixed and is the order the client's `BASE.TickFast` runs its lists in:
 * traps, towers, bunkers, then creeps, each by ascending id.
 *
 * ## What is simulated
 *
 * Creeps with their six target groups and their specialist multipliers; the
 * pathing grid and the wall that gets in the way; ranged and melee swings;
 * Eye-ra's blast; towers with their acquire delay, re-arm and splash; the two
 * traps; bunkers dispatching defenders; resource bombs; loot out of harvesters
 * and storage; the countdown and the retreat.
 *
 * ## Fidelity notes — every place this is not Flash
 *
 * Each is a deliberate simplification, cited, and each is a candidate for a
 * later pass rather than a bug.
 *
 * 1. **Projectiles land instantly.** A tower's `speed` is the flight time of
 *    its shot (`client/scripts/BTOWER.as:107`); the engine applies the damage
 *    on the tick the tower fires. A creep that would have outrun a slow shell
 *    does not here, so slow towers are slightly stronger and a creep killed by
 *    a shot already in the air dies a few ticks earlier.
 * 2. **Unit steps use a normalised vector, not `cos(atan2(…))`.** The client
 *    advances `_tmpPoint` by `cos(atan2(dy, dx)) * speed` and the matching sine
 *    (`CreepBase.as:1679-1680`), which is the unit vector written the long way.
 *    The engine divides by the length instead, because §3.4 rule 3 forbids
 *    trigonometry: two runtimes may round `atan2` differently and a digest
 *    cannot survive that. The values agree to within floating-point noise.
 * 3. **Spawn positions are rejection-sampled.** `ATTACK.Spawn` places each
 *    creep at a random bearing and a random radius inside the drop circle with
 *    `sin` and `cos` (`ATTACK.as:546-547`). The engine draws a point in the
 *    bounding square and rejects it until it is inside the circle, which needs
 *    no trigonometry. The distribution is uniform over the disc rather than the
 *    client's radius-biased one, so creeps start a little further out on
 *    average.
 * 4. **Flyers fly straight.** `findTarget` puts a flying creep on a ring 120
 *    units out and circles it in until it is within 170
 *    (`MonsterBase.as:1121-1158`), which costs two random draws per retarget.
 *    The engine flies straight at the target and uses the same 170 threshold.
 *    Flight paths differ; arrival times barely do.
 * 5. **Burrowers do not pick a side.** `_movement == "burrow"` picks one of a
 *    building's four sides at random (`MonsterBase.as:1093-1119`). The engine
 *    treats a burrower as a ground creep that ignores walls, which is the part
 *    that matters for damage.
 * 6. **Only the closest target is routed to.** The client asks the grid for a
 *    route to the closest *and* the second closest and takes whichever answers
 *    first, because its flood is asynchronous (`MonsterBase.as:1163-1169`). The
 *    engine's flood answers within the tick, so it routes to the closest and
 *    the second is reported but unused.
 * 7. **Retreat removes a creep.** A creep with nothing left to attack, or one
 *    caught by the retreat at the end of the countdown, is taken off the field
 *    rather than walked to the edge (`ATTACK.as:237-240`). It deals no more
 *    damage either way.
 * 8. **Not modelled at all**, each because its numbers were never traced
 *    (`docs/specs/combat.md:1362-1375`) or because it is out of Map Room 2's
 *    scope: champion abilities and buffs beyond damage and Krallen's looting,
 *    Rezghul's zombies, Slimeattikus' splits, the healers C15 and C16,
 *    invisibility, `Blink`, `PoisonOnAttack`, `GlavesOnAttack`, the Stronghold's
 *    four emitters, the Spurtz Cannon's burst, every siege weapon, and the
 *    per-creep `_hitLimit`. A yard holding one of those buildings fires it as
 *    an ordinary single-target tower.
 * 9. **Bunker contents must be supplied.** The defender's bunker blob is opaque
 *    to the server (§6 item 5), so {@link BattleOptions.bunkers} carries it. A
 *    bunker with no entry dispatches nothing and is not a valid group 4 or
 *    group 6 target, which is what an empty bunker is.
 * 10. **Storage loot is not capped by the attacker's pool.** `ATTACK.Loot`
 *    clamps a gain to the attacker's storage cap (`ATTACK.as:696-710`); the cap
 *    is a property of the attacker's row, not the battle, so the audit derives
 *    it (§2.4 `lootOverCap`) and the engine reports the uncapped gain.
 */

/* ── Inputs ───────────────────────────────────────────────────────────────── */

/**
 * One thing the attacker did, at a tick.
 *
 * The union is `types.ts`'s {@link FlingEvent}, which is the §3.10 contract the
 * web client's attack flow (issue #32) builds against. The engine consumes it
 * directly rather than restating it, so the two cannot drift apart. A `siege`
 * event is accepted and ignored (fidelity note 8).
 */
export type AttackEvent = FlingEvent;

/** A fling, narrowed out of the union. */
export type FlingDrop = Extract<FlingEvent, { kind: "fling" }>;

/** A resource bomb, narrowed out of the union. */
export type BombDrop = Extract<FlingEvent, { kind: "bomb" }>;

/** Everything a battle needs that the yard does not carry. */
export interface BattleOptions {
  /** The attack session's seed; the whole battle hangs off it. */
  readonly seed: number;
  /** Academy levels per monster id; an absent id is level 1. */
  readonly levels?: MonsterLevels;
  /** The attacker's player level, for the low-level loot bonus. */
  readonly playerLevel?: number;
  /** Declare War lengthens the countdown to 420 s (`GLOBAL.as:839-842`). */
  readonly declareWar?: boolean;
  /** What each bunker holds, keyed by building id (fidelity note 9). */
  readonly bunkers?: Readonly<Record<number, Roster>>;
  /** Levels for the defenders a bunker sends out; defaults to the attacker's. */
  readonly defenderLevels?: MonsterLevels;
}

/* ── Outputs ──────────────────────────────────────────────────────────────── */

/** What one tower did, which issue #22's per-tower report asks for (§6 item 14). */
export interface TowerReport {
  readonly id: number;
  readonly type: number;
  readonly level: number;
  /** Health actually removed, after fortification. */
  damageDealt: number;
  shots: number;
  kills: number;
}

/** The battle at one moment. */
export interface BattleState {
  readonly tick: number;
  /** Every building below full health, `id -> int(health)` (`BFOUNDATION.as:452-455`). */
  readonly health: Record<string, number>;
  /** Ids at zero health, ascending. */
  readonly destroyedIds: readonly number[];
  /** Trap ids that went off, ascending. */
  readonly firedTraps: readonly number[];
  /** What the attacker gained, before the storage cap (fidelity note 10). */
  readonly loot: ResourceAmounts;
  /** What the defender lost, which is the gain before every scalar. */
  readonly defenderLoss: ResourceAmounts;
  readonly creepsFlung: number;
  readonly creepsAlive: number;
  readonly creepsKilled: number;
  /** The champion's remaining health, or null when none was flung. */
  readonly championHp: number | null;
  readonly towers: readonly TowerReport[];
  /** Draws taken from the battle's random stream, a cheap divergence tripwire. */
  readonly rngDraws: number;
  readonly over: boolean;
}

/** The running battle. */
export interface Battle {
  /** Ticks elapsed since the attack started. */
  readonly tick: number;
  /** Apply one event; its `t` must not be in the past. */
  apply(event: AttackEvent): void;
  /** Advance one tick. */
  step(): void;
  /** Advance to a tick, applying nothing. */
  runTo(tick: number): void;
  /** Whether the countdown, the retreat or an empty field has ended it. */
  over(): boolean;
  state(): BattleState;
  /** The values a checkpoint digest folds in, in a fixed order. */
  checkpoint(): number[];
}

/* ── Internals ────────────────────────────────────────────────────────────── */

type Behaviour = "attack" | "defend" | "bunker" | "retreat";

interface Creep {
  id: number;
  monsterId: string;
  level: number;
  champion: boolean;
  friendly: boolean;
  /** Isometric position, which is the space movement happens in. */
  ix: number;
  iy: number;
  /** The cartesian projection, which is the space every range test uses. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  baseSpeed: number;
  damage: number;
  range: number;
  attackDelay: number;
  targetGroup: number;
  flying: boolean;
  ignoreWalls: boolean;
  explode: boolean;
  resourceLoot: number;
  storageLoot: number;
  flags: number;
  targetable: boolean;
  behaviour: Behaviour;
  attackCooldown: number;
  atTarget: boolean;
  attacking: boolean;
  targetBuilding: number;
  targetCreep: number;
  waypoints: Cart[];
  waypointIndex: number;
  phase: number;
  gone: boolean;
}

interface Tower {
  readonly building: EngineBuilding;
  readonly report: TowerReport;
  fireTick: number;
  targets: number[];
}

interface Trap {
  readonly building: EngineBuilding;
  retarget: number;
}

interface Bunker {
  readonly building: EngineBuilding;
  /** What is left to send out. */
  pool: Map<string, number>;
  dispatched: number;
  tickNumber: number;
}

/** The drop radius a payload earns: `max(200, bucket / 4) / 2` (`ATTACK.as:667-671`). */
export const dropRadius = (bucketTotal: number): number =>
  Math.max(200, bucketTotal / 4) / 2;

/** The bucket units one fling costs, which the flinger's payload caps. */
export const bucketCost = (roster: Roster, levels: MonsterLevels | undefined): number => {
  let total = 0;
  for (const id of Object.keys(roster).sort()) {
    const count = roster[id] ?? 0;
    const level = levels?.[id] ?? 1;
    total += monsterStat(id, "bucket", level) * count;
  }
  return total;
};

/** The Map Room 2 flinger payload, which is pinned to level 4 (`GLOBAL.as:863`). */
export const flingerPayload = (): number => capacity(5, MR2_FLINGER_LEVEL);

const clampLevel = (levels: MonsterLevels | undefined, id: string): number => {
  const level = levels?.[id];
  return level && level > 0 ? Math.floor(level) : 1;
};

/**
 * Start a battle over a yard.
 *
 * The yard is mutated in place: health falls, traps fire, harvesters empty.
 * Callers that need the original keep their own copy, which is what
 * `replay.ts` does.
 */
export const createBattle = (yard: EngineYard, options: BattleOptions): Battle => {
  const rng: Rng = mulberry32(options.seed);
  const grid: PathGrid = buildPathGrid(yard);
  const index: CreepIndex<Creep> = createCreepIndex<Creep>();

  const creeps: Creep[] = [];
  const byCreepId = new Map<number, Creep>();
  const towers: Tower[] = [];
  const traps: Trap[] = [];
  const bunkers: Bunker[] = [];
  const firedTraps: number[] = [];
  const destroyedIds: number[] = [];

  const loot: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const defenderLoss: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };

  let tick = 0;
  let nextCreepId = 1;
  let creepsFlung = 0;
  let creepsKilled = 0;
  let championHp: number | null = null;
  let finished = false;
  let retreated = false;

  const countdown = ticks(
    options.declareWar === true ? DECLARE_WAR_COUNTDOWN_SECONDS : ATTACK_COUNTDOWN_SECONDS,
  );
  const retreatAt = countdown + ticks(RETREAT_GRACE_SECONDS);
  const lootBonus = lowLevelLootBonus(options.playerLevel ?? 20);
  const storageScalar =
    yard.kind === "outpost" ? STORAGE_SCALAR_OUTPOST : STORAGE_SCALAR_MAIN;

  for (const building of yard.buildings) {
    if (building.hp <= 0) continue;
    if (building.trap) {
      traps.push({ building, retarget: 0 });
      continue;
    }
    if (building.kind !== "tower") continue;
    if (isBunker(building.type)) {
      const held = options.bunkers?.[building.id];
      const pool = new Map<string, number>();
      if (held) {
        for (const id of Object.keys(held).sort()) {
          const count = held[id] ?? 0;
          if (count > 0) pool.set(id, count);
        }
      }
      bunkers.push({ building, pool, dispatched: 0, tickNumber: 0 });
      continue;
    }
    const stats = towerStats(building.type, building.level);
    if (!stats || stats.damage === undefined) continue;
    towers.push({
      building,
      report: {
        id: building.id,
        type: building.type,
        level: building.level,
        damageDealt: 0,
        shots: 0,
        kills: 0,
      },
      // `Props()` seeds the fire tick with `rate`, not `rate * 2` (`BTOWER.as:112`).
      fireTick: stats.rate ?? 0,
      targets: [],
    });
  }

  const bunkerById = new Map<number, Bunker>();
  for (const bunker of bunkers) bunkerById.set(bunker.building.id, bunker);

  /**
   * A bunker is a target only once it has something to send or has sent it.
   *
   * `_used > 0 || _monstersDispatchedTotal > 0` (`MonsterBase.as:1031`,
   * `:1056`); an empty bunker is scenery to a tower specialist.
   */
  const bunkerInUse = (building: EngineBuilding): boolean => {
    const bunker = bunkerById.get(building.id);
    if (!bunker) return false;
    if (bunker.dispatched > 0) return true;
    for (const count of bunker.pool.values()) {
      if (count > 0) return true;
    }
    return false;
  };

  /* ── Damage and loot ───────────────────────────────────────────────────── */

  const creditLoot = (resource: number, amount: number): void => {
    if (amount <= 0) return;
    const key = `r${resource}` as keyof ResourceAmounts;
    loot[key] += amount * lootBonus;
  };

  /**
   * `BRESOURCE.Loot` and `BSTORAGE.Loot`: a point of damage is a unit of
   * resource (`docs/specs/combat.md:1410-1416`).
   *
   * A harvester hands over its own buffer of its own resource
   * (`BRESOURCE.as:93-134`). A storage building draws from the yard's pool, a
   * resource picked at random from the ones that are not empty, scaled by where
   * the yard is (`BSTORAGE.as:56-88`).
   */
  const takeLoot = (building: EngineBuilding, amount: number, creep: Creep | null): void => {
    if (amount <= 0 || !isLootable(building.type)) return;
    if (STORAGE_TYPES.includes(building.type)) {
      const available: number[] = [];
      for (let resource = 1; resource <= 4; resource += 1) {
        const key = `r${resource}` as keyof ResourceAmounts;
        if (yard.resources[key] > 0) available.push(resource);
      }
      if (available.length === 0) return;
      const picked = available[rng.int(available.length)] as number;
      const key = `r${picked}` as keyof ResourceAmounts;
      const wanted = Math.ceil(amount * (creep ? creep.storageLoot : 1));
      const taken = Math.min(yard.resources[key], wanted);
      if (taken <= 0) return;
      yard.resources[key] -= taken;
      defenderLoss[key] += taken;
      let credited = taken * storageScalar;
      if (yard.kind === "wild") credited = Math.trunc(credited / WILD_MONSTER_LOOT_DIVISOR);
      creditLoot(picked, credited);
      return;
    }
    // A harvester: its own buffer, its own resource, no scalar.
    const wanted = Math.floor(amount * (creep ? creep.resourceLoot : 1));
    const taken = Math.min(building.stored, wanted);
    if (taken <= 0) return;
    building.stored -= taken;
    if (building.stored <= 0) building.looted = true;
    const key = `r${building.type}` as keyof ResourceAmounts;
    defenderLoss[key] += taken;
    creditLoot(building.type, taken);
  };

  const destroy = (building: EngineBuilding): void => {
    building.hp = 0;
    destroyedIds.push(building.id);
    // The client empties a harvester when it falls (`BRESOURCE.as:132-137`).
    if (building.stored > 0) takeLoot(building, building.stored, null);
    grid.removeBuilding(building);
  };

  /** `BFOUNDATION.modifyHealth` (`:499-541`): fortification, then loot. */
  const damageBuilding = (
    building: EngineBuilding,
    raw: number,
    creep: Creep | null,
  ): number => {
    if (building.hp <= 0 || raw <= 0) return 0;
    const dealt = fortifiedDamage(raw, building.fortification, 0);
    const applied = Math.min(dealt, building.hp);
    building.hp -= dealt;
    if (creep) takeLoot(building, dealt, creep);
    if (building.hp <= 0) destroy(building);
    return applied;
  };

  const damageCreep = (creep: Creep, raw: number): number => {
    if (creep.hp <= 0) return 0;
    const applied = Math.min(raw, creep.hp);
    creep.hp -= raw;
    if (creep.hp <= 0) {
      creep.hp = 0;
      creep.gone = true;
      if (!creep.friendly) creepsKilled += 1;
    }
    return applied;
  };

  /* ── Flinging ──────────────────────────────────────────────────────────── */

  /**
   * A point inside the drop circle, by rejection sampling (fidelity note 3).
   *
   * Two draws per attempt, and the expected number of attempts is 4/pi, so the
   * stream position after a fling depends on the seed. That is fine: the
   * digest is generated from this engine, not from Flash.
   */
  const dropPoint = (centreX: number, centreY: number, radius: number): Cart => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const offsetX = (rng.float() * 2 - 1) * radius;
      const offsetY = (rng.float() * 2 - 1) * radius;
      if (offsetX * offsetX + offsetY * offsetY <= radius * radius) {
        return { x: centreX + offsetX, y: centreY + offsetY };
      }
    }
    return { x: centreX, y: centreY };
  };

  const spawnCreep = (
    monsterId: string,
    level: number,
    at: Cart,
    friendly: boolean,
    behaviour: Behaviour,
  ): Creep => {
    const movement = monsterMovement(monsterId);
    const flying = isFlyingMovement(movement);
    const health = monsterStat(monsterId, "health", level);
    const targetGroup = monsterStat(monsterId, "targetGroup", level) || TARGET_GROUP.ALL;
    const cart = fromIso(at.x, at.y);
    const creep: Creep = {
      id: nextCreepId,
      monsterId,
      level,
      champion: false,
      friendly,
      ix: at.x,
      iy: at.y,
      x: cart.x,
      y: cart.y,
      hp: health,
      maxHp: health,
      baseSpeed: monsterTickSpeed(monsterId, level),
      damage: monsterStat(monsterId, "damage", level),
      range: monsterRange(monsterId, level),
      attackDelay: monsterAttackDelay(monsterId, level),
      targetGroup,
      flying,
      ignoreWalls: movement === "burrow" || movement === "jump",
      explode: monsterStat(monsterId, "explode", level) > 0,
      resourceLoot: 1,
      storageLoot: 1,
      flags: defenseFlags(friendly, flying, false),
      targetable: true,
      behaviour,
      attackCooldown: 0,
      atTarget: false,
      attacking: false,
      targetBuilding: -1,
      targetCreep: -1,
      waypoints: [],
      waypointIndex: 0,
      phase: nextCreepId % RETARGET_TICKS,
      gone: false,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    return creep;
  };

  const spawnChampion = (type: number, level: number, at: Cart): Creep | null => {
    const id = championByType(type);
    if (!id) return null;
    const health = championStat(id, "health", level);
    const cart = fromIso(at.x, at.y);
    const creep: Creep = {
      id: nextCreepId,
      monsterId: id,
      level,
      champion: true,
      friendly: false,
      ix: at.x,
      iy: at.y,
      x: cart.x,
      y: cart.y,
      hp: health,
      maxHp: health,
      baseSpeed: championStat(id, "speed", level) / 4,
      damage: championStat(id, "damage", level),
      range: championStat(id, "range", level) || 1,
      attackDelay: championAttackDelay(id, level),
      targetGroup: championStat(id, "targetGroup", level) || TARGET_GROUP.ALL,
      flying: false,
      ignoreWalls: false,
      explode: false,
      // Krallen's looting, the largest in the client (`champions/Krallen.as:31-32`).
      resourceLoot: id === "G2" ? KRALLEN_RESOURCE_LOOT_MULTIPLIER : 1,
      storageLoot: id === "G2" ? KRALLEN_STORAGE_LOOT_MULTIPLIER : 1,
      flags: defenseFlags(false, false, false),
      targetable: true,
      behaviour: "attack",
      attackCooldown: 0,
      atTarget: false,
      attacking: false,
      targetBuilding: -1,
      targetCreep: -1,
      waypoints: [],
      waypointIndex: 0,
      phase: nextCreepId % RETARGET_TICKS,
      gone: false,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    championHp = creep.hp;
    return creep;
  };

  const fling = (event: FlingDrop): void => {
    const ids = Object.keys(event.monsters).sort();
    // The log's own `r` is ignored: §3.10 makes the radius a function of the
    // payload, so the server recomputes it and a mismatch is the client's bug.
    const radius = dropRadius(bucketCost(event.monsters, options.levels));
    for (const monsterId of ids) {
      const count = Math.max(0, Math.floor(event.monsters[monsterId] ?? 0));
      const level = clampLevel(options.levels, monsterId);
      for (let spawned = 0; spawned < count; spawned += 1) {
        spawnCreep(monsterId, level, dropPoint(event.x, event.y, radius), false, "attack");
        creepsFlung += 1;
      }
    }
    if (event.champion) {
      // The power level a champion's `bonus*` ladders are indexed by is read but
      // not applied: those ladders feed abilities the spec never traced
      // (fidelity note 8), so a champion fights at its base damage.
      spawnChampion(event.champion.t, event.champion.l, dropPoint(event.x, event.y, radius));
    }
  };

  /**
   * A resource bomb, as `Targeting.DealLinearAEDamage` applies one (`:340-389`).
   *
   * Linear falloff over the radius with a floor of a fifth of the full figure,
   * against every building and creep inside it. Putty bombs carry no damage at
   * all; their slow is not modelled (fidelity note 8).
   */
  const bomb = (event: BombDrop): void => {
    const spec = BOMBS.find((one) => one.id === event.id);
    if (!spec || spec.damage <= 0) return;
    const centre = fromIso(event.x, event.y);
    for (const building of yard.buildings) {
      if (building.hp <= 0 || building.kind === "decoration" || building.kind === "enemy") continue;
      const away = Math.sqrt(distanceSquared(centre.x, centre.y, building.cx, building.cy));
      if (away > spec.radius) continue;
      const linear = (spec.damage / spec.radius) * (spec.radius - away);
      damageBuilding(building, Math.max(linear, spec.damage / 5), null);
    }
  };

  /* ── Creeps ────────────────────────────────────────────────────────────── */

  const targetContext = { bunkerInUse };

  const buildingOf = (id: number): EngineBuilding | null => {
    const at = yard.byId.get(id);
    return at === undefined ? null : (yard.buildings[at] as EngineBuilding);
  };

  const loseTarget = (creep: Creep): void => {
    creep.targetBuilding = -1;
    creep.targetCreep = -1;
    creep.atTarget = false;
    creep.attacking = false;
    creep.waypoints = [];
    creep.waypointIndex = 0;
  };

  /** Returns false when the creep found nothing and turned for home. */
  const findTarget = (creep: Creep): boolean => {
    const result = findBuildingTarget(yard, creep.x, creep.y, creep.targetGroup, targetContext);
    if (result.fellThrough && creep.targetGroup !== TARGET_GROUP.TOWERS) {
      creep.targetGroup = TARGET_GROUP.ALL;
    }
    const chosen = result.closest;
    if (!chosen) {
      // Nothing left to attack: `changeModeRetreat` (`MonsterBase.as:1089`).
      creep.behaviour = "retreat";
      return false;
    }
    creep.targetBuilding = chosen.id;
    creep.waypointIndex = 0;
    if (creep.flying) {
      creep.waypoints = [{ x: chosen.x, y: chosen.y }];
      creep.atTarget = distanceSquared(creep.ix, creep.iy, chosen.x, chosen.y) < 170 * 170;
      return true;
    }
    const route = grid.path(
      { fromX: creep.ix, fromY: creep.iy, target: chosen, ignoreWalls: creep.ignoreWalls },
      rng,
    );
    if (route.blockedBy >= 0) {
      const wall = buildingOf(route.blockedBy);
      if (wall && wall.hp > 0) creep.targetBuilding = wall.id;
    }
    if (route.waypoints.length > 1) {
      // The first waypoint is the creep's own cell; walking to it is a no-op.
      creep.waypoints = route.waypoints.slice(1);
    } else {
      creep.waypoints = [{ x: chosen.x, y: chosen.y }];
    }
    creep.atTarget = false;
    return true;
  };

  /** One swing, with the specialist multipliers of `CreepBase.as:884-894`. */
  const swing = (creep: Creep): void => {
    const target = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    if (creep.explode) {
      explodeCreep(creep);
      return;
    }
    if (creep.targetCreep >= 0) {
      const other = byCreepId.get(creep.targetCreep);
      if (other && other.hp > 0) damageCreep(other, creep.damage);
      return;
    }
    if (!target || target.hp <= 0) return;
    const multiplier = specialistMultiplier(creep.targetGroup, target.kind);
    damageBuilding(target, creep.damage * multiplier, creep);
  };

  /** Eye-ra's blast: radius 60 in cartesian, linear in the squared distance. */
  const explodeCreep = (creep: Creep): void => {
    const originX = creep.x - 5;
    const originY = creep.y - 5;
    for (const building of yard.buildings) {
      if (building.hp <= 0 || building.kind === "decoration" || building.kind === "enemy") continue;
      // `tmpPointB.add(tmpPointC)` at `CreepBase.as:797` discards its result, so
      // the `_middle` offset the client meant to apply never reaches the test.
      const squared = distanceSquared(originX, originY, building.cx, building.cy);
      if (squared >= 3600) continue;
      damageBuilding(building, Math.round(creep.damage * ((3600 - squared) / 3600)), creep);
    }
    creep.hp = 0;
    creep.gone = true;
  };

  const moveCreep = (creep: Creep): void => {
    let speed = creep.baseSpeed;
    const factor = BEHAVIOUR_SPEED[creep.behaviour];
    if (factor !== undefined) speed *= factor;
    if (creep.attacking) return;
    if (creep.waypointIndex >= creep.waypoints.length) return;

    let waypoint = creep.waypoints[creep.waypointIndex] as Cart;
    // `move()` drains waypoints it has arrived at (`CreepBase.as:1494-1503`).
    while (distanceSquared(creep.ix, creep.iy, waypoint.x, waypoint.y) <= 100) {
      creep.waypointIndex += 1;
      if (creep.waypointIndex >= creep.waypoints.length) {
        // The route ran out: a melee creep is where it was going.
        creep.atTarget = true;
        return;
      }
      waypoint = creep.waypoints[creep.waypointIndex] as Cart;
    }

    const deltaX = waypoint.x - creep.ix;
    const deltaY = waypoint.y - creep.iy;
    const length = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    if (length > 0) {
      creep.ix += (deltaX / length) * speed;
      creep.iy += (deltaY / length) * speed;
      const cart = fromIso(creep.ix, creep.iy);
      creep.x = cart.x;
      creep.y = cart.y;
    }
  };

  /**
   * A bunker defender: it chases attackers and never touches a building.
   *
   * `k_sBHVR_DEFEND` keeps a creep on the nearest enemy creep and drops it for
   * another when that one dies (`CreepBase.as:1531-1556`, `:1596-1604`). It is
   * simpler than an attacker's loop because there is no pathing and no target
   * group: a defender walks straight at whoever it is on.
   */
  const tickDefender = (creep: Creep): void => {
    let target = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (!target || target.hp <= 0) {
      const found = index.closest(400, creep.x, creep.y, oldStyleTargets(1));
      if (!found) {
        creep.targetCreep = -1;
        creep.atTarget = false;
        creep.attacking = false;
        return;
      }
      creep.targetCreep = found.id;
      target = found;
    }
    // `DEFENSE_RANGE_SQUARED` is 2,500 in the client's own units (`:1543`).
    const reach = Math.max(creep.range * creep.range, 2500);
    creep.atTarget = distanceSquared(creep.ix, creep.iy, target.ix, target.iy) < reach;
    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += Math.trunc(creep.attackDelay);
        damageCreep(target, creep.damage);
      } else {
        creep.attackCooldown -= 1;
      }
      return;
    }
    creep.attacking = false;
    creep.waypoints = [{ x: target.ix, y: target.iy }];
    creep.waypointIndex = 0;
    moveCreep(creep);
  };

  const tickCreep = (creep: Creep): void => {
    if (creep.hp <= 0 || creep.gone) return;
    if (creep.behaviour === "retreat") {
      creep.gone = true;
      return;
    }
    if (creep.friendly) {
      tickDefender(creep);
      return;
    }

    const target = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    const stale =
      !target ||
      target.hp <= 0 ||
      (creep.targetGroup === TARGET_GROUP.RESOURCES && target.looted) ||
      (target.kind === "tower" && !isBunker(target.type) && target.jarred);
    let hunting = true;
    if (creep.targetBuilding >= 0 && stale) {
      loseTarget(creep);
      hunting = findTarget(creep);
    }
    if (hunting && !creep.attacking && (tick + creep.phase) % RETARGET_TICKS === 0) {
      hunting = findTarget(creep);
    }
    if (hunting && creep.targetBuilding < 0) hunting = findTarget(creep);
    if (!hunting) return;

    // A ranged creep stops as soon as its target is inside its range
    // (`CreepBase.as:735-748`); line of sight is not modelled.
    if (!creep.atTarget && creep.range > 1) {
      const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
      if (aim && distanceSquared(creep.ix, creep.iy, aim.x, aim.y) <= creep.range * creep.range) {
        creep.atTarget = true;
      }
    }

    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += Math.trunc(creep.attackDelay);
        swing(creep);
      } else {
        creep.attackCooldown -= 1;
      }
    } else {
      creep.attacking = false;
    }
    moveCreep(creep);
  };

  /* ── Towers, traps and bunkers ─────────────────────────────────────────── */

  const tickTower = (tower: Tower): void => {
    const building = tower.building;
    if (building.hp <= 0) return;
    const stats = towerStats(building.type, building.level);
    const range = stats?.range;
    const damage = stats?.damage;
    if (range === undefined || damage === undefined) return;
    tower.fireTick -= 1;
    if (tower.fireTick > 0) return;
    tower.fireTick += (stats?.rate ?? 0) * TOWER_REARM_MULTIPLIER;

    const flags = towerTargets(building.type);
    // `FindTargets` scans from the footprint's middle (`BTOWER.as:394`), which
    // the isometric projection puts at the same offset on both cartesian axes.
    const scanX = building.cx + building.h / 2;
    const scanY = building.cy + building.h / 2;
    const reach = range * range;

    const live: Creep[] = [];
    for (const id of tower.targets) {
      const creep = byCreepId.get(id);
      if (!creep || creep.hp <= 0 || !creep.targetable) continue;
      if (!canHit(flags, creep.flags)) continue;
      if (distanceSquared(scanX, scanY, creep.x, creep.y) >= reach) continue;
      live.push(creep);
    }

    if (live.length === 0) {
      const found = index.inRange(range, scanX, scanY, flags);
      tower.targets = found.slice(0, 1).map((hit) => hit.creep.id);
      // Every re-acquire path resets the fire tick to 30 (`BTOWER.as:184`, `:189`, `:220`).
      tower.fireTick = TOWER_ACQUIRE_TICKS;
      return;
    }

    for (const creep of live) {
      tower.report.shots += 1;
      const before = creep.hp;
      tower.report.damageDealt += damageCreep(creep, damage);
      if (before > 0 && creep.hp <= 0) tower.report.kills += 1;
      const splash = stats?.splash ?? 0;
      if (splash <= 0) continue;
      // `DealLinearAEDamage` over the blast, with its floor of a fifth (`:340-389`).
      for (const hit of index.inRange(splash, creep.x, creep.y, flags, creep.id)) {
        const linear = (damage / splash) * (splash - hit.dist);
        const dealt = Math.max(linear, damage / 5);
        const health = hit.creep.hp;
        tower.report.damageDealt += damageCreep(hit.creep, dealt);
        if (health > 0 && hit.creep.hp <= 0) tower.report.kills += 1;
      }
    }
  };

  const tickTrap = (trap: Trap): void => {
    const building = trap.building;
    if (building.fired || building.hp <= 0) return;
    if (trap.retarget > 0) {
      trap.retarget -= 1;
      return;
    }
    trap.retarget = TRAP_RETARGET_TICKS;
    const spec = trapStats(building.type);
    if (!spec) return;
    const watching = index.inRange(TRAP_TRIGGER_RANGE, building.cx, building.cy, TRAP_TARGETS);
    if (watching.length === 0) return;

    // `Explode` hits everything inside `size`, not just what tripped it.
    let touched = 0;
    for (const hit of index.inRange(spec.size, building.cx, building.cy, TRAP_TARGETS)) {
      if (hit.creep.hp <= 0) continue;
      touched += 1;
      damageCreep(hit.creep, trapDamageAt(building.type, hit.dist));
    }
    if (touched === 0) return;
    building.fired = true;
    building.hp = 0;
    firedTraps.push(building.id);
    grid.removeBuilding(building);
  };

  const tickBunker = (bunker: Bunker): void => {
    const building = bunker.building;
    if (building.hp <= 0) return;
    bunker.tickNumber += 1;
    if (bunker.tickNumber % 30 !== 0) return;
    let left = 0;
    for (const count of bunker.pool.values()) left += count;
    if (left === 0) return;

    const stats = towerStats(building.type, building.level);
    const range = stats?.range ?? 0;
    if (range <= 0) return;
    // A bunker sends its defenders at anything attacking, air or ground
    // (`HOUSINGBUNKER.as:269-300`); the interceptor pick is the random draw.
    const found = index.inRange(range, building.cx, building.cy, oldStyleTargets(1));
    if (found.length === 0) return;

    const ids: string[] = [];
    for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
      if (count > 0) ids.push(monsterId);
    }
    if (ids.length === 0) return;
    const monsterId = ids[rng.int(ids.length)] as string;
    bunker.pool.set(monsterId, (bunker.pool.get(monsterId) ?? 0) - 1);
    bunker.dispatched += 1;
    const level = clampLevel(options.defenderLevels ?? options.levels, monsterId);
    const defender = spawnCreep(monsterId, level, { x: building.x, y: building.y }, true, "defend");
    defender.targetCreep = (found[0] as { creep: Creep }).creep.id;
  };

  /* ── The tick ──────────────────────────────────────────────────────────── */

  const anyAttackerLeft = (): boolean =>
    creeps.some((creep) => !creep.friendly && !creep.gone && creep.hp > 0);

  const step = (): void => {
    if (finished) return;
    tick += 1;
    if (tick >= retreatAt || (retreated && !anyAttackerLeft())) {
      finished = true;
      return;
    }

    index.rebuild(creeps);
    for (const trap of traps) tickTrap(trap);
    for (const tower of towers) tickTower(tower);
    for (const bunker of bunkers) tickBunker(bunker);
    for (const creep of creeps) tickCreep(creep);

    if (creeps.length > 0) {
      let write = 0;
      for (let read = 0; read < creeps.length; read += 1) {
        const creep = creeps[read] as Creep;
        if (creep.gone || creep.hp <= 0) {
          byCreepId.delete(creep.id);
          if (creep.champion) championHp = 0;
          continue;
        }
        if (creep.champion) championHp = creep.hp;
        creeps[write] = creep;
        write += 1;
      }
      creeps.length = write;
    }

    if (tick >= countdown && !retreated) retreated = true;
    if (creepsFlung > 0 && !anyAttackerLeft() && retreated) finished = true;
  };

  const apply = (event: AttackEvent): void => {
    if (finished) return;
    if (event.kind === "fling") fling(event);
    else if (event.kind === "bomb") bomb(event);
    else if (event.kind === "retreat") {
      retreated = true;
      for (const creep of creeps) {
        if (!creep.friendly) creep.gone = true;
      }
    }
  };

  const healthMap = (): Record<string, number> => {
    const map: Record<string, number> = {};
    for (const building of yard.buildings) {
      if (building.fired) {
        map[String(building.id)] = 0;
        continue;
      }
      if (building.hp < building.maxHp) {
        map[String(building.id)] = Math.max(0, Math.trunc(building.hp));
      }
    }
    return map;
  };

  const state = (): BattleState => ({
    tick,
    health: healthMap(),
    destroyedIds: [...destroyedIds].sort((one, other) => one - other),
    firedTraps: [...firedTraps].sort((one, other) => one - other),
    loot: { ...loot },
    defenderLoss: { ...defenderLoss },
    creepsFlung,
    creepsAlive: creeps.filter((creep) => !creep.friendly && creep.hp > 0).length,
    creepsKilled,
    championHp,
    towers: towers.map((tower) => ({ ...tower.report })),
    rngDraws: rng.count(),
    over: finished,
  });

  /**
   * The numbers a checkpoint folds in, in one fixed order (§3.4 rule 5).
   *
   * Buildings by id, then creeps by id, then the battle's running totals. The
   * random stream's own position is last, because a divergence that has not yet
   * moved anything still shows up there.
   */
  const checkpoint = (): number[] => {
    const values: number[] = [tick];
    for (const building of yard.buildings) {
      values.push(building.id, building.hp, building.stored, building.fired ? 1 : 0);
    }
    for (const creep of creeps) {
      values.push(creep.id, creep.ix, creep.iy, creep.hp, creep.targetBuilding);
    }
    values.push(
      loot.r1,
      loot.r2,
      loot.r3,
      loot.r4,
      defenderLoss.r1,
      defenderLoss.r2,
      defenderLoss.r3,
      defenderLoss.r4,
      creepsFlung,
      creepsKilled,
      rng.state(),
      rng.count(),
    );
    return values;
  };

  return {
    get tick() {
      return tick;
    },
    apply,
    step,
    runTo: (target: number) => {
      while (tick < target && !finished) step();
    },
    over: () => finished,
    state,
    checkpoint,
  };
};

/** Whether a building is one a creep could ever pick, for a caller's filter. */
export const isAttackableBuilding = (building: EngineBuilding): boolean =>
  isMainTarget(building.kind) && building.hp > 0;
