import { buildPathGrid } from "./grid.js";
import { mulberry32 } from "./rng.js";
import { REZGHUL_ID, SPLIT_CHILD_ID } from "./potential.js";
import {
  ATTACK_COUNTDOWN_SECONDS,
  BEHAVIOUR_SPEED,
  BOMBS,
  bombParticleDamage,
  bombReaches,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  MR2_FLINGER_LEVEL,
  RETARGET_TICKS,
  RETREAT_GRACE_SECONDS,
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
  championMode,
  championStat,
  championStatWithPower,
  fortifiedDamage,
  lootingMultiplier,
  isLootable,
  isWildMonsterAttack,
  storageFallLoot,
  storageScalar,
  withLowLevelBonus,
  monsterAttackDelay,
  monsterMovement,
  monsterRange,
  monsterStat,
  monsterTickSpeed,
  propsSizeOf,
  specialistMultiplier,
  ticks,
  towerRange,
  towerStats,
  trapDamageAt,
  trapStats,
  isKnownMonster,
} from "./stats.js";
import {
  canHit,
  TARGETS_ATTACKERS,
  TARGETS_DEFENDERS,
  TARGETS_FLYING,
  TARGETS_GROUND,
  createCreepIndex,
  defenseFlags,
  findBuildingTarget,
  isBunker,
  isFlyingMovement,
  oldStyleTargets,
  towerTargets,
  TRAP_TARGETS,
} from "./targeting.js";
import {
  distanceSquared,
  isMainTarget,
  rangePointOf,
  reachesBuilding,
  screenDistanceSquared,
  screenOf,
  screenPointOf,
  towerScanPoint,
} from "./yard.js";
import type { Cart, EngineBuilding, EngineYard } from "./yard.js";
import type { PathGrid } from "./grid.js";
import type { Rng } from "./rng.js";
import type { CreepIndex } from "./targeting.js";
import { numberOf } from "./types.js";
import type {
  CombatBuildingData,
  CombatBuildingDataMap,
  FlingEvent,
  MonsterLevels,
  ResourceAmounts,
  Roster,
} from "./types.js";

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
 * Eye-ra's blast; Slimeattikus splitting as it dies; the healers; Rezghul
 * raising the dead; towers with
 * their acquire delay, re-arm and splash; the two traps; bunkers dispatching
 * defenders; resource bombs; loot out of harvesters and storage, hit by hit,
 * and the share of the pool a fallen storage building gives up; the countdown
 * and the retreat.
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
 *    advances `_tmpPoint`, a screen point, by `cos(atan2(dy, dx)) * speed` and
 *    the matching sine (`CreepBase.as:1679-1680`), which is the unit vector
 *    written the long way. The engine takes the same step on screen but
 *    divides by the length instead, because §3.4 rule 3 forbids trigonometry:
 *    two runtimes may round `atan2` differently and a digest cannot survive
 *    that. The values agree to within floating-point noise.
 * 3. **Spawn bearings are rejection-sampled.** `ATTACK.Spawn` places each
 *    creep at a random bearing and a random distance from the drop point, on
 *    screen, with `sin` and `cos` (`ATTACK.as:546-547`). The engine draws the
 *    bearing as a point in the unit square, rejected until it is inside the
 *    unit circle, and scales it to length with `sqrt`, which needs no
 *    trigonometry. The distance is drawn as the client draws it, uniform along
 *    the radius, so the scatter crowds the middle just as Flash's does
 *    ({@link scatterRadius}).
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
 *    scope: champion abilities and buffs beyond damage and looting,
 *    invisibility, `Blink`, `PoisonOnAttack`, `GlavesOnAttack`, the Stronghold's
 *    four emitters, the Spurtz Cannon's burst, every siege weapon, and the
 *    per-creep `_hitLimit`. A yard holding one of those buildings fires it as
 *    an ordinary single-target tower.
 * 9. **The defence is supplied, and its rules are the owner's.** The defender's
 *    bunker blob is opaque to the server (§6 item 5), so
 *    {@link BattleOptions.bunkers} carries it, read off `buildingdata` by
 *    {@link bunkerGarrisons}; the caged champion comes in as
 *    {@link BattleOptions.defenderChampion}. A bunker with no entry dispatches
 *    nothing and is not a valid group 4 or group 6 target, which is what an
 *    empty bunker is. The fight-back rules below are the owner's decisions of
 *    2026-09-29 (issue #195), not traced Flash:
 *    - An attacker turns on a defender that hits it or that comes within its
 *      reach, fights it until one of them dies, then goes back to buildings.
 *      Healers and Eye-ras do not. A ground attacker in melee cannot reach a
 *      flying defender. It walks straight at its foe, walls or no walls.
 *    - A bunker's defender chases attackers inside the bunker's range and no
 *      further, walks back in when none is left, and can be sent out again.
 *      A bunker keeps its healers in. Every defender that dies is counted
 *      against its bunker ({@link BattleState.bunkerLosses}, issue #130), and
 *      {@link BattleState.bunkerGarrisons} is what each holds afterwards: a
 *      fallen bunker keeps only the defenders that were out.
 *    - The champion comes out of its Champion Cage when an attacker first
 *      comes within {@link CAGE_ALERT_RANGE} of it, at its stored health, at its
 *      level plus its power level's bonus. It fights the nearest attacker it
 *      can reach within {@link CAGE_LEASH} of the cage, walks back when none is
 *      left, and fights on if the cage falls. Towers, traps and bombs never
 *      hurt a defender.
 * 10. **Storage loot is not capped by the attacker's pool.** `ATTACK.Loot`
 *    clamps a gain to the attacker's storage cap (`ATTACK.as:696-710`); the cap
 *    is a property of the attacker's row, not the battle, so the audit derives
 *    it (§2.4 `lootOverCap`) and the engine reports the uncapped gain.
 * 11. **Only the looting property's construction is modelled.** A creep loots
 *    at 0.5 and a resource specialist or a champion at 2
 *    (`MonsterBase.as:260`, `CreepBase.as:224-226`, `ChampionBase.as:221`),
 *    Krallen included, whose `_lootMults` is never read (issue #178). What
 *    changes it during a battle is not: Krallen's `ProximityLootBuff` at
 *    power level 2 (`CHAMPIONCAGE.as:265`) and the `LootingMultiplier` it
 *    hands nearby creeps, both abilities under note 8, and the Vacuum's
 *    `lootBonus`, a siege weapon.
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
  /** The defender's champion in its Champion Cage (issue #195), or none. */
  readonly defenderChampion?: DefenderChampion | null;
}

/** The champion a Champion Cage holds, as the defender's save keeps it (issue #195). */
export interface DefenderChampion {
  /** The champion type, `t` in the save (`G{t}`). */
  readonly t: number;
  /** Its level, `l`. */
  readonly l: number;
  /** The health it has now, which is what it comes out with. */
  readonly hp: number;
  /** Its power level, `pl`, 0 to 3. */
  readonly pl?: number;
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
  /**
   * The champion's remaining health, or null when none was flung. Zero only
   * when it died; a champion that retreated or walked home keeps the health
   * it left the field with. With two champions on the field this is whichever
   * one the last step touched; {@link championsHp} keeps them apart.
   */
  readonly championHp: number | null;
  /**
   * Every flung champion's health, keyed by champion id (`G1`..`G5`), empty
   * when none was flung. The same rule as {@link championHp}: zero only for a
   * death. An attack may field one ordinary champion and Krallen together
   * (`client/scripts/UI_TOP.as:336-347`), and `championHp` alone cannot tell
   * the two apart, so a caller that writes champions back reads this.
   */
  readonly championsHp: Readonly<Record<string, number>>;
  readonly towers: readonly TowerReport[];
  /** Draws taken from the battle's random stream, a cheap divergence tripwire. */
  readonly rngDraws: number;
  readonly over: boolean;
  /**
   * Each bunker's defenders that died, by building id and monster id; a bunker
   * that lost none is absent (issue #130). A defender that dies is gone from
   * its bunker for good, and one that lives is still counted in it
   * (`CreepBase.as:1004-1030`), so this is what the attack takes off the
   * garrison. Not a checkpoint value: the creeps it counts are already there.
   */
  readonly bunkerLosses: Readonly<Record<number, Readonly<Record<string, number>>>>;
  /**
   * What each supplied bunker holds after the battle, by building id and
   * monster id (issue #195): what it never sent, plus the defenders still out,
   * who walk back in; a fallen bunker keeps only the ones that were out. Empty
   * when no bunker was supplied.
   */
  readonly bunkerGarrisons: Readonly<Record<number, Readonly<Record<string, number>>>>;
  /**
   * The caged champion's health (issue #195): what it came out with less what
   * it took, 0 when it died, its stored health when it never came out, null
   * when there is none to defend.
   */
  readonly defenderChampionHp: number | null;
}

/**
 * One creep as the live renderer sees it (issue #32, WP5).
 *
 * A read-only copy taken by {@link Battle.creeps}; nothing the renderer does
 * with it reaches the simulation. Positions are yard units, the space
 * `buildingdata.X/Y` and a fling's `x`/`y` are in; the renderer draws them
 * through `toIso` like a building.
 */
export interface CreepSnapshot {
  readonly id: number;
  /** The creature id: `C1`, `G1`. */
  readonly monsterId: string;
  readonly level: number;
  readonly champion: boolean;
  /** A bunker's defender rather than an attacker. */
  readonly friendly: boolean;
  readonly ix: number;
  readonly iy: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly flying: boolean;
  /** `attacking` while it swings at what it is on; `walking` otherwise. */
  readonly state: "walking" | "attacking";
  /** The building it is on, or -1. */
  readonly targetBuilding: number;
  /** The creep it is on — a defender's quarry — or -1. */
  readonly targetCreep: number;
}

/**
 * Something the renderer draws a moment for: a tower firing, a creep
 * swinging, a creep taking damage, a creep dying.
 *
 * Kept for {@link VISUAL_MEMORY_TICKS} ticks and read back through
 * {@link Battle.recentEvents}; never folded into the checkpoint.
 */
export type BattleVisualEvent =
  | {
      readonly kind: "shot";
      readonly tick: number;
      readonly towerId: number;
      readonly creepId: number;
      /** Where the shot landed: the creep's yard position that tick. */
      readonly ix: number;
      readonly iy: number;
    }
  | {
      /** A creep landed a swing on a building or on another creep. */
      readonly kind: "hit";
      readonly tick: number;
      readonly creepId: number;
      /** The building struck, or -1 when the quarry was a creep. */
      readonly buildingId: number;
      /** The creep struck, or -1 when the target was a building. */
      readonly creepTargetId: number;
      /** The attacker's yard position that tick. */
      readonly ix: number;
      readonly iy: number;
      /** The target's yard position: a creep's spot, or a building's anchor. */
      readonly targetIx: number;
      readonly targetIy: number;
      /** True when the creep fights from range (`range > 1`): a projectile, not a bite. */
      readonly ranged: boolean;
      readonly flying: boolean;
      /** Health the swing took off, after fortification; 0 when it hit nothing. */
      readonly amount: number;
    }
  | {
      /** A creep lost health: a tower shot, splash, a trap, or another creep. */
      readonly kind: "hurt";
      readonly tick: number;
      readonly creepId: number;
      readonly friendly: boolean;
      /** The creep's yard position that tick. */
      readonly ix: number;
      readonly iy: number;
      /** Health actually taken, capped at what the creep had left. */
      readonly amount: number;
    }
  | {
      readonly kind: "death";
      readonly tick: number;
      readonly creepId: number;
      readonly monsterId: string;
      readonly champion: boolean;
      readonly friendly: boolean;
      readonly flying: boolean;
      readonly ix: number;
      readonly iy: number;
    };

/** How many ticks of shots and deaths a battle remembers: two seconds. */
export const VISUAL_MEMORY_TICKS = 160;

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
  /**
   * Every creep on the field, attackers and defenders, ascending id. A fresh
   * copy per call; the renderer reads it once a frame (§F5, Q8).
   */
  creeps(): readonly CreepSnapshot[];
  /**
   * The shots, hits, hurts and deaths after `sinceTick`, oldest first. Only the last
   * {@link VISUAL_MEMORY_TICKS} ticks are kept, so a caller that reads every
   * frame sees everything and one that does not sees the recent past.
   */
  recentEvents(sinceTick: number): readonly BattleVisualEvent[];
}

/* ── Internals ────────────────────────────────────────────────────────────── */

type Behaviour = "attack" | "defend" | "bunker" | "heal" | "retreat";

interface Creep {
  id: number;
  monsterId: string;
  level: number;
  champion: boolean;
  friendly: boolean;
  /** Yard units: the exact yard point of the creep's `_tmpPoint`. */
  ix: number;
  iy: number;
  /** {@link rangePointOf} the above, the truncated point range tests use. */
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
  /** `MonsterBase.lootingMultiplier`: resource drawn per point of damage. */
  lootMultiplier: number;
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
  /** The bunker that sent it out, by building id; -1 for any other creep. */
  homeBunker: number;
  /** The tick it joined the field; its own `_frameNumber` counts from here. */
  born: number;
  /** A healer's `_healerGiveUpTimer`: looks left before it gives up (`CreepBase.as:41`). */
  giveUp: number;
  /**
   * Spawned mid-battle rather than flung or sent out: a Slimeattikus Mini or a
   * zombie. It leaves no corpse (`MonsterBase.as:1214-1216`), so nothing
   * raises it again.
   */
  disposable: boolean;
  /** Rezghul: the tick its raise is ready again (`RangedAttack.as:45-51`). */
  rechargeAt: number;
  /** The flags of the creeps it can fight: its foes' side, and whether it reaches the air. */
  hitFlags: number;
  /**
   * Where a defender belongs (issue #195): the point it walks back to, and the
   * circle, around the cartesian `centre`, it will not chase outside. Null for
   * an attacker and for a defender with nowhere to go back to.
   */
  home: DefenderHome | null;
  /** The defender that last hit this attacker, or -1 (issue #195). */
  provokedBy: number;
}

interface DefenderHome {
  readonly ix: number;
  readonly iy: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly leash: number;
}

interface Tower {
  readonly building: EngineBuilding;
  readonly report: TowerReport;
  /** What it reaches, in yard units, the cell's height applied (`towerRange`). */
  readonly range: number;
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

/**
 * How far from the drop point a fling's creeps land, in screen pixels.
 *
 * `DROPZONE.Drop` hands `ATTACK.Spawn` half the zone's size, which is
 * {@link dropRadius}, and `Spawn` puts each creep up to half of that away on
 * screen (`DROPZONE.as:160`, `ATTACK.as:546-547`): a quarter of the size. The
 * zone's ring is `1.2 x 0.6` of the size (`DROPZONE.as:48-49`), so its short
 * half-axis, `0.3` of the size, still clears the scatter.
 */
export const scatterRadius = (bucketTotal: number): number => dropRadius(bucketTotal) / 2;

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

/**
 * The bucket units a fling fills for sizing its drop zone, champion included.
 *
 * `ATTACK.BucketUpdate` sums every entry in the flinger bucket, and a champion's
 * entry adds its own `bucket` at its level (`ATTACK.as:645-653`), before the
 * total is quartered and floored at 200 ({@link dropRadius}). Alone a champion
 * never passes that floor (the largest `bucket` is Gorgo's 240); with monsters
 * it widens the scatter (issue #143).
 */
export const flingCost = (
  drop: Pick<FlingDrop, "monsters" | "champion">,
  levels: MonsterLevels | undefined,
): number => {
  const monsters = bucketCost(drop.monsters, levels);
  if (!drop.champion) return monsters;
  const id = championByType(drop.champion.t);
  return id ? monsters + championStat(id, "bucket", drop.champion.l) : monsters;
};

/** The Map Room 2 flinger payload, which is pinned to level 4 (`GLOBAL.as:863`). */
export const flingerPayload = (): number => capacity(5, MR2_FLINGER_LEVEL);

/** A creep that died where Rezghul can find it (`Targeting.CreepCellAdd`). */
interface Corpse {
  readonly creepId: number;
  readonly monsterId: string;
  readonly friendly: boolean;
  /** The flags it was hit by while it lived: its side and whether it flew. */
  readonly flags: number;
  readonly ix: number;
  readonly iy: number;
  readonly x: number;
  readonly y: number;
}

/** How far Rezghul throws its raise, and how wide it lands (`creeps/Rezghul.as:52`). */
const RAISE_RANGE = 300;
const RAISE_AREA = 50;

/** Nobody raises these (`RezghulResurrectAttack.as:13`). */
const UNRAISABLE: ReadonlySet<string> = new Set(["C16", "C15", "C19", "C18"]);

/** Its own side, on the ground: `getFriendlyFlag | k_TARGETS_GROUND` (`Rezghul.as:52`). */
const raiseTargets = (creep: { friendly: boolean }): number =>
  (creep.friendly ? TARGETS_DEFENDERS : TARGETS_ATTACKERS) | TARGETS_GROUND;

/**
 * How close an attacker must come to a Champion Cage for its champion to come
 * out, and how far from the cage it will chase, in cartesian units (issue #195).
 */
export const CAGE_ALERT_RANGE = 400;
export const CAGE_LEASH = 2 * CAGE_ALERT_RANGE;

/** The Champion Cage's building type (`CHAMPIONCAGE`, `YARD_PROPS.as:5993`). */
const CHAMPION_CAGE_TYPE = 114;

/** How far a defender looks for an attacker to chase (`CreepBase.as:1531-1556`). */
const DEFEND_SEARCH = 400;

/** The reach a creep fights another at: its range, and never less than `DEFENSE_RANGE_SQUARED`. */
const creepReach = (range: number): number => Math.max(range * range, 2500);

/**
 * The creeps one can fight (issue #195): the other side, on the ground, and in
 * the air too unless it is a ground creep that swings in melee.
 */
const fightFlags = (friendly: boolean, flying: boolean, range: number): number =>
  (friendly ? TARGETS_ATTACKERS : TARGETS_DEFENDERS) |
  TARGETS_GROUND |
  (flying || range > 1 ? TARGETS_FLYING : 0);

/** How far a healer looks for someone to heal (`CreepBase.as:612`). */
const HEAL_SEARCH = 600;

/** A healer's `_healerGiveUpTimer` at spawn (`CreepBase.as:41`). */
const HEALER_GIVE_UP = 800;

/** Monsters no healer will touch: the two healers (`CREATURELOCKER.as:469`, `:500`). */
const ANTI_HEAL: ReadonlySet<string> = new Set(["C15", "C16"]);

const isAntiHeal = (id: string): boolean => ANTI_HEAL.has(id);

/** What a caged champion comes out with: its stored health, whole and not negative. */
const cagedHealth = (caged: DefenderChampion): number => Math.max(0, Math.floor(caged.hp));

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
  const bunkerLosses: BunkerLossTally = new Map();
  /** Dead Slimeattikus whose Minis are born at the end of the step (issue #129). */
  const pendingSplits: Array<{ readonly parent: Creep; readonly count: number }> = [];
  /** Where the dead lie, for Rezghul to raise (`Targeting._deadCreepCells`). */
  const corpses: Corpse[] = [];
  /** Corpses Rezghul raised this step, back on their feet at its end. */
  const pendingZombies: Array<{ readonly corpse: Corpse; readonly raiser: Creep }> = [];
  const firedTraps: number[] = [];
  const destroyedIds: number[] = [];
  /** Shots, hits, hurts and deaths for the renderer, pruned each step; not simulation state. */
  const visual: BattleVisualEvent[] = [];

  const loot: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const defenderLoss: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };

  let tick = 0;
  let nextCreepId = 1;
  let creepsFlung = 0;
  let creepsKilled = 0;
  let championHp: number | null = null;
  const championsHp: Record<string, number> = {};
  /** Whether this battle has a defence at all; without one no fight-back code runs (issue #195). */
  const defended =
    (options.defenderChampion !== undefined && options.defenderChampion !== null) ||
    Object.keys(options.bunkers ?? {}).length > 0;
  let finished = false;
  let retreated = false;

  const countdown = ticks(
    options.declareWar === true ? DECLARE_WAR_COUNTDOWN_SECONDS : ATTACK_COUNTDOWN_SECONDS,
  );
  const retreatAt = countdown + ticks(RETREAT_GRACE_SECONDS);
  const playerLevel = options.playerLevel ?? 20;
  const storageHitScalar = storageScalar(yard.kind);
  const wildMonsterAttack = isWildMonsterAttack(yard.kind);

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
    const stats = towerStats(building.type, building.level, yard.kind);
    if (!stats || stats.damage === undefined) continue;
    towers.push({
      building,
      range: towerRange(building.type, building.level, yard.kind, yard.height) ?? 0,
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

  /**
   * The Champion Cage and the champion it holds (issue #195): the first cage
   * by id, and only when a champion was supplied for it.
   */
  const cage =
    options.defenderChampion && options.defenderChampion.hp > 0
      ? (yard.buildings
          .filter((building) => building.type === CHAMPION_CAGE_TYPE)
          .sort((one, other) => one.id - other.id)[0] ?? null)
      : null;
  /** The caged champion once it is out; its health while it lives. */
  let cageChampion: Creep | null = null;
  /** Defenders on the field as this step's creeps move; attackers skip the scan when none is. */
  let defendersOut = 0;
  let defenderChampionHp: number | null =
    cage && options.defenderChampion ? cagedHealth(options.defenderChampion) : null;

  /* ── Damage and loot ───────────────────────────────────────────────────── */

  /** `ATTACK.Loot`: the low-level bonus, one whole gain at a time. */
  const creditLoot = (resource: number, amount: number): void => {
    if (amount <= 0) return;
    const key = `r${resource}` as keyof ResourceAmounts;
    loot[key] += withLowLevelBonus(amount, playerLevel);
  };

  /**
   * `BRESOURCE.Loot` and `BSTORAGE.Loot`: a point of damage is a unit of
   * resource (`docs/specs/combat.md:1410-1416`).
   *
   * A harvester hands over its own buffer of its own resource
   * (`BRESOURCE.as:93-134`). A storage building draws from the yard's pool, a
   * resource picked at random from the ones that are not empty, scaled by where
   * the yard is (`BSTORAGE.as:56-88`). `Loot(param1:int)` truncates the damage
   * times the looting multiplier, and every scalar after it lands on an `int`,
   * so each step truncates.
   */
  /** The resource a storage hit draws: one of the pool's non-empty ones, at random. */
  const pickStored = (): number | null => {
    const available: number[] = [];
    for (let resource = 1; resource <= 4; resource += 1) {
      const key = `r${resource}` as keyof ResourceAmounts;
      if (yard.resources[key] > 0) available.push(resource);
    }
    if (available.length === 0) return null;
    return available[rng.int(available.length)] as number;
  };

  const takeLoot = (building: EngineBuilding, amount: number, creep: Creep | null): void => {
    if (amount <= 0 || !isLootable(building.type)) return;
    if (STORAGE_TYPES.includes(building.type)) {
      const picked = pickStored();
      if (picked === null) return;
      const key = `r${picked}` as keyof ResourceAmounts;
      const wanted = Math.trunc(amount * (creep ? creep.lootMultiplier : 1));
      const taken = Math.trunc(Math.min(yard.resources[key], wanted));
      if (taken <= 0) return;
      yard.resources[key] -= taken;
      defenderLoss[key] += taken;
      let credited = Math.trunc(taken * storageHitScalar);
      if (wildMonsterAttack) credited = Math.trunc(credited / WILD_MONSTER_LOOT_DIVISOR);
      creditLoot(picked, credited);
      return;
    }
    // A harvester: its own buffer, its own resource, no scalar.
    const wanted = Math.trunc(amount * (creep ? creep.lootMultiplier : 1));
    const taken = Math.min(building.stored, wanted);
    if (taken <= 0) return;
    building.stored -= taken;
    if (building.stored <= 0) building.looted = true;
    const key = `r${building.type}` as keyof ResourceAmounts;
    // An outpost's buffer is given, not banked, so what it hands over comes
    // out of the owner's pool too (`BRESOURCE.as:104-118`), before any later
    // storage hit or fall reads it.
    if (yard.kind === "outpost") yard.resources[key] = Math.max(0, yard.resources[key] - taken);
    defenderLoss[key] += taken;
    creditLoot(building.type, taken);
  };

  /**
   * `BSTORAGE.Destroyed` (`BSTORAGE.as:91-155`): a fallen storage building
   * hands over a share of the whole pool, each resource in turn, each share
   * taken from what the pool holds by then ({@link storageFallLoot}).
   */
  const storageFall = (building: EngineBuilding): void => {
    const onWildCamp = yard.kind === "wild";
    for (let resource = 1; resource <= 4; resource += 1) {
      const key = `r${resource}` as keyof ResourceAmounts;
      const taken = storageFallLoot(building.type, resource, yard.resources[key], onWildCamp);
      if (taken <= 0) continue;
      yard.resources[key] -= taken;
      defenderLoss[key] += taken;
      creditLoot(resource, taken);
    }
  };

  /**
   * `BFOUNDATION.Destroyed(param2 != null)`: only a building an attacker
   * brought down gives anything up. A resource bomb's `modifyHealth` names no
   * attacker (`effects/ResourceBomb.as:172`), so a building it fells keeps
   * what it held.
   */
  const destroy = (building: EngineBuilding, byAttacker: boolean): void => {
    building.hp = 0;
    destroyedIds.push(building.id);
    if (byAttacker) {
      // The client empties a harvester when it falls (`BRESOURCE.as:129-134`).
      if (building.stored > 0) takeLoot(building, building.stored, null);
      if (STORAGE_TYPES.includes(building.type)) storageFall(building);
    }
    grid.removeBuilding(building);
  };

  /**
   * `BFOUNDATION.modifyHealth` (`:499-541`): fortification, then loot.
   *
   * The hit that brings a building down loots nothing of its own: the client
   * calls `Destroyed` first and loots only `if (!this._destroyed)`, so the
   * fall's own rule is all that hit takes.
   */
  const damageBuilding = (
    building: EngineBuilding,
    raw: number,
    creep: Creep | null,
  ): number => {
    if (building.hp <= 0 || raw <= 0) return 0;
    const dealt = fortifiedDamage(raw, building.fortification, 0);
    const applied = Math.min(dealt, building.hp);
    building.hp -= dealt;
    if (building.hp > 0) {
      if (creep) takeLoot(building, dealt, creep);
      return applied;
    }
    // The killing hit on storage still makes the pick it made before issue
    // #167 and throws it away, so the random stream every later bunker pick
    // reads is the one it was, and the fall changes the loot and nothing else.
    if (creep && STORAGE_TYPES.includes(building.type)) pickStored();
    destroy(building, creep !== null);
    return applied;
  };

  const recordDeath = (creep: Creep): void => {
    visual.push({
      kind: "death",
      tick,
      creepId: creep.id,
      monsterId: creep.monsterId,
      champion: creep.champion,
      friendly: creep.friendly,
      flying: creep.flying,
      ix: creep.ix,
      iy: creep.iy,
    });
  };

  const damageCreep = (creep: Creep, raw: number, by: Creep | null = null): number => {
    if (creep.hp <= 0) return 0;
    // A defender's blow turns the attacker on it (issue #195).
    if (by && by.friendly && !creep.friendly) creep.provokedBy = by.id;
    const applied = Math.min(raw, creep.hp);
    if (applied > 0) {
      visual.push({
        kind: "hurt",
        tick,
        creepId: creep.id,
        friendly: creep.friendly,
        ix: creep.ix,
        iy: creep.iy,
        amount: applied,
      });
    }
    creep.hp -= raw;
    if (creep.hp <= 0) {
      creep.hp = 0;
      creep.gone = true;
      if (!creep.friendly) creepsKilled += 1;
      recordDeath(creep);
      onDeath(creep);
    }
    return applied;
  };

  /**
   * What a creep's death sets off. A Slimeattikus splits into Slimeattikus
   * Minis (issue #129, {@link splitOnDeath}); they are born when the step is
   * done, so none of them acts on the tick its parent fell.
   */
  const onDeath = (creep: Creep): void => {
    // `dieFinish` files every dead creep but a champion or a disposable one as
    // a corpse where it fell (`MonsterBase.as:1206-1217`).
    if (!creep.champion && !creep.disposable) {
      corpses.push({
        creepId: creep.id,
        monsterId: creep.monsterId,
        friendly: creep.friendly,
        flags: creep.flags,
        ix: creep.ix,
        iy: creep.iy,
        x: creep.x,
        y: creep.y,
      });
    }
    const splits = monsterStat(creep.monsterId, "splits", creep.level);
    if (splits > 0 && !creep.champion) {
      pendingSplits.push({ parent: creep, count: Math.floor(splits) });
    }
  };

  /**
   * `DeathSplit.split` (`creeps/Slimeattikus.as:11-13`,
   * `components/abilities/DeathSplit.as:23-51`): a dead Slimeattikus leaves
   * `splits` Slimeattikus Minis, `C18`, each at its own random point up to 60
   * screen pixels either way of where it fell (`:30`, `:46`). An attacker's
   * children attack and a defender's defend (`:35-38`, `:47-49`). They are
   * spawned, not flung, so the fling count does not move (`CREEPS.as:246-248`),
   * and a Mini fights at its parent's level, because `C18` is `dependent` on
   * `C17` and takes that monster's upgrade (`CREATURES.as:53-55`).
   */
  const splitOnDeath = (parent: Creep, count: number): void => {
    for (let child = 0; child < count; child += 1) {
      const screenX = rng.float() * 120 - 60;
      const screenY = rng.float() * 120 - 60;
      // `screenPointOf` undone, as in {@link dropPoint}.
      const at = { x: parent.ix + screenY + screenX / 2, y: parent.iy + screenY - screenX / 2 };
      const mini = spawnCreep(
        SPLIT_CHILD_ID,
        parent.level,
        at,
        parent.friendly,
        parent.friendly ? "defend" : "attack",
      );
      // `CREEPS.Spawn(…, true)`, and `isDisposable` for a defender's (`:40-44`).
      mini.disposable = true;
    }
  };

  /** Splits waiting for the end of the step (issue #129). */
  const bornAtStepEnd = (): void => {
    const waiting = pendingSplits.splice(0);
    for (const { parent, count } of waiting) splitOnDeath(parent, count);
    const risen = pendingZombies.splice(0);
    for (const { corpse, raiser } of risen) raise(corpse, raiser);
  };

  /**
   * `RezghulResurrectAttack` (`creeps/Rezghul.as:48-53`,
   * `components/abilities/RezghulResurrectAttack.as`): while it fights, a
   * Rezghul whose raise is ready throws it at the nearest corpse of its own
   * side within 300 that lay on the ground, and every such corpse within 50 of
   * where it lands gets up (`:29-44`, `:58-71`). Healers, Minis and Rezghul
   * never do (`:13`). The raise is then `resurrectCooldown` seconds away
   * (`RangedAttack.as:45-51`), counted in ticks here rather than whole
   * seconds of the clock. The throw lands at once (fidelity note 1), and the
   * corpses rise when the step is done.
   */
  const tickRaise = (creep: Creep): void => {
    if (tick < creep.rechargeAt) return;
    const reach = (from: { x: number; y: number }, radius: number): Corpse[] =>
      corpses
        .filter(
          (corpse) =>
            !UNRAISABLE.has(corpse.monsterId) &&
            canHit(raiseTargets(creep), corpse.flags) &&
            Math.trunc(distanceSquared(from.x, from.y, corpse.x, corpse.y)) < radius * radius,
        )
        .sort(
          (one, other) =>
            distanceSquared(from.x, from.y, one.x, one.y) -
              distanceSquared(from.x, from.y, other.x, other.y) || one.creepId - other.creepId,
        );
    const aim = reach(creep, RAISE_RANGE)[0];
    if (!aim) return;
    for (const corpse of reach(aim, RAISE_AREA)) {
      corpses.splice(corpses.indexOf(corpse), 1);
      pendingZombies.push({ corpse, raiser: creep });
    }
    creep.rechargeAt = tick + ticks(monsterStat(creep.monsterId, "resurrectCooldown", creep.level));
  };

  /**
   * `resurrect` and `Zombiefy` (`RezghulResurrectAttack.as:73-89`,
   * `Zombiefy.as:22-40`): the dead creep again, where it fell, at the
   * attacker's level for it, as a zombie: slower by the Rezghul's speed
   * multiplier, which also stretches its swing; harder and stronger by its
   * health and damage multipliers; on full health (`MaxHealthProperty.as:
   * 19-29` scales a fresh spawn's full health to the new maximum); and
   * disposable, so it does not rise twice.
   */
  const raise = (corpse: Corpse, raiser: Creep): void => {
    const levels = corpse.friendly ? options.defenderLevels ?? options.levels : options.levels;
    const level = clampLevel(levels, corpse.monsterId);
    const zombie = spawnCreep(
      corpse.monsterId,
      level,
      { x: corpse.ix, y: corpse.iy },
      corpse.friendly,
      corpse.friendly ? "defend" : "attack",
    );
    const speed = monsterStat(raiser.monsterId, "zombieSpeedMultiplier", raiser.level) || 1;
    const health = monsterStat(raiser.monsterId, "zombieHealthMultiplier", raiser.level) || 1;
    const damage = monsterStat(raiser.monsterId, "zombieDamageMultiplier", raiser.level) || 1;
    zombie.baseSpeed *= speed;
    zombie.attackDelay /= speed;
    zombie.damage *= damage;
    zombie.maxHp *= health;
    zombie.hp = zombie.maxHp;
    zombie.disposable = true;
  };

  /* ── Flinging ──────────────────────────────────────────────────────────── */

  /**
   * Where one creep of a fling lands: a random bearing and a random distance
   * up to `radius` from the drop point, on screen, as `ATTACK.Spawn` places it
   * (fidelity note 3), brought back into yard units.
   *
   * The bearing takes two draws per attempt, and the expected number of
   * attempts is 4/pi, so the stream position after a fling depends on the
   * seed. That is fine: the digest is generated from this engine, not from
   * Flash. A bearing too near the middle to have a direction is redrawn.
   */
  const dropPoint = (centreX: number, centreY: number, radius: number): Cart => {
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const across = rng.float() * 2 - 1;
      const down = rng.float() * 2 - 1;
      const squared = across * across + down * down;
      if (squared > 1 || squared < 1e-6) continue;
      const scale = (rng.float() * radius) / Math.sqrt(squared);
      const screenX = across * scale;
      const screenY = down * scale;
      // `screenPointOf` undone: a screen step (sx, sy) is the yard step
      // (sy + sx / 2, sy - sx / 2).
      return { x: centreX + screenY + screenX / 2, y: centreY + screenY - screenX / 2 };
    }
    return { x: centreX, y: centreY };
  };

  const spawnCreep = (
    monsterId: string,
    level: number,
    at: Cart,
    friendly: boolean,
    behaviour: Behaviour,
    homeBunker = -1,
  ): Creep => {
    const movement = monsterMovement(monsterId);
    const flying = isFlyingMovement(movement);
    const health = monsterStat(monsterId, "health", level);
    const targetGroup = monsterStat(monsterId, "targetGroup", level) || TARGET_GROUP.ALL;
    const cart = rangePointOf(at.x, at.y);
    // An attacker whose target group is monsters is a healer: it goes straight
    // into `heal` (`CreepBase.as:195-196`, issue #129).
    const mode =
      behaviour === "attack" && targetGroup === TARGET_GROUP.MONSTERS ? "heal" : behaviour;
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
      lootMultiplier: lootingMultiplier(targetGroup, false),
      flags: defenseFlags(friendly, flying, false),
      targetable: true,
      behaviour: mode,
      attackCooldown: 0,
      atTarget: false,
      attacking: false,
      targetBuilding: -1,
      targetCreep: -1,
      waypoints: [],
      waypointIndex: 0,
      phase: nextCreepId % RETARGET_TICKS,
      gone: false,
      homeBunker,
      born: tick,
      giveUp: HEALER_GIVE_UP,
      disposable: false,
      rechargeAt: 0,
      // A bunker's defender chases anything attacking, air or ground (`HOUSINGBUNKER.as:269-300`).
      hitFlags: friendly
        ? oldStyleTargets(1)
        : fightFlags(false, flying, monsterRange(monsterId, level)),
      home: null,
      provokedBy: -1,
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
    // A `fly` rung puts the champion in the air exactly as it does a monster:
    // altitude 108 and the flying defence flag (`ChampionBase.as:181-188`), so
    // walls never stop it and only air-capable towers can shoot it.
    const flying = isFlyingMovement(championMode(id, "movement", level));
    const cart = rangePointOf(at.x, at.y);
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
      flying,
      ignoreWalls: false,
      explode: false,
      // Every champion, Krallen included, loots at 2 (`ChampionBase.as:221`).
      lootMultiplier: lootingMultiplier(TARGET_GROUP.RESOURCES, true),
      flags: defenseFlags(false, flying, false),
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
      homeBunker: -1,
      born: tick,
      giveUp: HEALER_GIVE_UP,
      disposable: false,
      rechargeAt: 0,
      hitFlags: fightFlags(false, flying, championStat(id, "range", level) || 1),
      home: null,
      provokedBy: -1,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    championHp = creep.hp;
    championsHp[id] = creep.hp;
    return creep;
  };

  /**
   * The caged champion comes out (issue #195): at the cage, at its stored
   * health, its stats at its level plus its power level's bonus. It defends
   * like a bunker's monster, leashed to {@link CAGE_LEASH} around the cage.
   */
  const releaseChampion = (building: EngineBuilding, caged: DefenderChampion): Creep | null => {
    const id = championByType(caged.t);
    if (!id) return null;
    const level = Math.max(1, Math.floor(caged.l));
    const power = caged.pl ?? 0;
    const maxHp = championStatWithPower(id, "health", level, power);
    const flying = isFlyingMovement(championMode(id, "movement", level));
    const range = championStatWithPower(id, "range", level, power) || 1;
    const cart = rangePointOf(building.x, building.y);
    const scan = towerScanPoint(building);
    const creep: Creep = {
      id: nextCreepId,
      monsterId: id,
      level,
      champion: true,
      friendly: true,
      ix: building.x,
      iy: building.y,
      x: cart.x,
      y: cart.y,
      hp: Math.min(cagedHealth(caged), maxHp),
      maxHp,
      baseSpeed: championStatWithPower(id, "speed", level, power) / 4,
      damage: championStatWithPower(id, "damage", level, power),
      range,
      attackDelay: championAttackDelay(id, level),
      targetGroup: TARGET_GROUP.ALL,
      flying,
      ignoreWalls: false,
      explode: false,
      lootMultiplier: 0,
      flags: defenseFlags(true, flying, false),
      targetable: true,
      behaviour: "defend",
      attackCooldown: 0,
      atTarget: false,
      attacking: false,
      targetBuilding: -1,
      targetCreep: -1,
      waypoints: [],
      waypointIndex: 0,
      phase: nextCreepId % RETARGET_TICKS,
      gone: false,
      homeBunker: -1,
      born: tick,
      giveUp: HEALER_GIVE_UP,
      disposable: false,
      rechargeAt: 0,
      hitFlags: fightFlags(true, flying, range),
      home: { ix: building.x, iy: building.y, centreX: scan.x, centreY: scan.y, leash: CAGE_LEASH },
      provokedBy: -1,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    return creep;
  };

  const fling = (event: FlingDrop): void => {
    const ids = Object.keys(event.monsters).sort();
    // The log's own `r` is ignored: §3.10 makes the radius a function of the
    // payload, so the server recomputes it and a mismatch is the client's bug.
    const radius = scatterRadius(flingCost(event, options.levels));
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
   * A resource bomb, as `ResourceBomb` applies one
   * (`client/scripts/com/monsters/effects/ResourceBomb.as`).
   *
   * The client decides what the blast reached once, when it lands, and in
   * screen space: the drop and each building's middle (`_mc.y + _middle`) go
   * through `GRID.ToISO`, and {@link bombReaches} is its ellipse test. Traps,
   * decorations, the enemy and immovable classes and anything already down are
   * skipped. Each of the bomb's particles then deals {@link bombParticleDamage}
   * to every building on the list, with no falloff. The particles land over a
   * second or so in the client; here they land together, on this tick, which
   * changes when a building falls but not how much it takes.
   *
   * Putty bombs carry no damage at all; their slow is not modelled
   * (fidelity note 8).
   */
  const bomb = (event: BombDrop): void => {
    const spec = BOMBS.find((one) => one.id === event.id);
    if (!spec || spec.damage <= 0) return;
    const centre = screenOf(event.x, event.y);
    for (const building of yard.buildings) {
      if (building.hp <= 0) continue;
      const kind = building.kind;
      if (kind === "trap" || kind === "decoration" || kind === "enemy" || kind === "immovable") {
        continue;
      }
      const at = screenOf(building.x, building.y);
      const dx = at.x - centre.x;
      const dy = at.y + building.middle - centre.y;
      if (!bombReaches(spec, dx, dy, propsSizeOf(building.type))) continue;
      const share = bombParticleDamage(spec, building);
      if (share > 0) damageBuilding(building, share * spec.particles, null);
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
      // Under 170 screen px from `_position` (`ChampionBase.as:662`).
      const at = screenPointOf(creep.ix, creep.iy);
      creep.atTarget = distanceSquared(at.x, at.y, chosen.sx, chosen.sy) < 170 * 170;
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

  /**
   * The renderer's note of a swing that connected: a lunge or a projectile at
   * the attacker's end, a flash at the target's. Not simulation state.
   */
  const recordHit = (creep: Creep, targetIx: number, targetIy: number, amount: number): void => {
    visual.push({
      kind: "hit",
      tick,
      creepId: creep.id,
      buildingId: creep.targetCreep >= 0 ? -1 : creep.targetBuilding,
      creepTargetId: creep.targetCreep,
      ix: creep.ix,
      iy: creep.iy,
      targetIx,
      targetIy,
      ranged: creep.range > 1,
      flying: creep.flying,
      amount,
    });
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
      if (other && other.hp > 0) {
        recordHit(creep, other.ix, other.iy, damageCreep(other, creep.damage));
      }
      return;
    }
    if (!target || target.hp <= 0) return;
    const multiplier = specialistMultiplier(creep.targetGroup, target.kind);
    recordHit(creep, target.x, target.y, damageBuilding(target, creep.damage * multiplier, creep));
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
    recordDeath(creep);
    onDeath(creep);
  };

  const moveCreep = (creep: Creep): void => {
    let speed = creep.baseSpeed;
    const factor = BEHAVIOUR_SPEED[creep.behaviour];
    if (factor !== undefined) speed *= factor;
    if (creep.attacking) return;
    if (creep.waypointIndex >= creep.waypoints.length) return;

    let waypoint = creep.waypoints[creep.waypointIndex] as Cart;
    // `move()` drains waypoints within 10 screen px (`CreepBase.as:1494-1503`).
    while (screenDistanceSquared(creep.ix, creep.iy, waypoint.x, waypoint.y) <= 100) {
      creep.waypointIndex += 1;
      if (creep.waypointIndex >= creep.waypoints.length) {
        // The route ran out: a melee creep is where it was going.
        creep.atTarget = true;
        return;
      }
      waypoint = creep.waypoints[creep.waypointIndex] as Cart;
    }

    // Flash walks `_tmpPoint` `speed` screen px towards the waypoint
    // (`CreepBase.as:1679-1680`), so a creep covers the same ground on screen
    // whichever way it heads. The step is taken on screen, then turned back
    // into yard units: screen (a, d) is yard (a / 2 + d, d - a / 2).
    const deltaX = waypoint.x - creep.ix;
    const deltaY = waypoint.y - creep.iy;
    const across = deltaX - deltaY;
    const down = (deltaX + deltaY) * 0.5;
    const length = Math.sqrt(across * across + down * down);
    if (length > 0) {
      const stepAcross = (across / length) * speed;
      const stepDown = (down / length) * speed;
      creep.ix += stepAcross * 0.5 + stepDown;
      creep.iy += stepDown - stepAcross * 0.5;
      const cart = rangePointOf(creep.ix, creep.iy);
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
    // A defender with a home chases nothing outside its leash (issue #195).
    const home = creep.home;
    const leashed = (other: Creep): boolean =>
      !home ||
      distanceSquared(home.centreX, home.centreY, other.x, other.y) < home.leash * home.leash;
    let target = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (!target || target.hp <= 0 || target.gone || !leashed(target)) {
      const found = index
        .inRange(DEFEND_SEARCH, creep.x, creep.y, creep.hitFlags)
        .find((hit) => leashed(hit.creep))?.creep;
      if (!found) {
        creep.targetCreep = -1;
        creep.atTarget = false;
        creep.attacking = false;
        goHome(creep);
        return;
      }
      creep.targetCreep = found.id;
      target = found;
    }
    fight(creep, target);
  };

  /**
   * One tick of a fight between two creeps: a swing inside the reach, else a
   * step straight at the foe. `DEFENSE_RANGE_SQUARED` is 2,500, measured on
   * screen like the range `canShootCreep` also accepts (`CreepBase.as:1543`,
   * `:723-727`).
   */
  const fight = (creep: Creep, foe: Creep): void => {
    const squared = screenDistanceSquared(creep.ix, creep.iy, foe.ix, foe.iy);
    creep.atTarget = squared < creepReach(creep.range);
    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += Math.trunc(creep.attackDelay);
        const dealt = damageCreep(foe, creep.damage, creep);
        if (defended) recordHit(creep, foe.ix, foe.iy, dealt);
      } else {
        creep.attackCooldown -= 1;
      }
      return;
    }
    creep.attacking = false;
    creep.waypoints = [{ x: foe.ix, y: foe.iy }];
    creep.waypointIndex = 0;
    moveCreep(creep);
  };

  /**
   * A defender with nothing to fight walks home (issue #195). A bunker's
   * monster goes back in, to be sent out again, while its bunker stands; the
   * champion, and a monster whose bunker fell, waits there. A defender with no
   * home (a Mini, a zombie) stands where it is.
   */
  const goHome = (creep: Creep): void => {
    const home = creep.home;
    if (!home) return;
    if (screenDistanceSquared(creep.ix, creep.iy, home.ix, home.iy) <= 100) {
      const bunker = creep.homeBunker >= 0 ? bunkerById.get(creep.homeBunker) : undefined;
      if (bunker && bunker.building.hp > 0) {
        bunker.pool.set(creep.monsterId, (bunker.pool.get(creep.monsterId) ?? 0) + 1);
        creep.gone = true;
      }
      return;
    }
    creep.waypoints = [{ x: home.ix, y: home.iy }];
    creep.waypointIndex = 0;
    moveCreep(creep);
  };

  /** An attacker that can fight a defender at all (issue #195). */
  const fightsBack = (creep: Creep): boolean =>
    creep.behaviour === "attack" && !creep.explode && creep.damage > 0;

  /**
   * An attacker's fight with a defender (issue #195): the one it is on while
   * it lives, else the one that last hit it, else the nearest in its reach.
   * True when the tick went on the fight; false when there is none, and the
   * attacker goes back to the buildings.
   */
  const engage = (creep: Creep): boolean => {
    const usable = (other: Creep | undefined): other is Creep =>
      !!other &&
      other.friendly &&
      other.hp > 0 &&
      !other.gone &&
      canHit(creep.hitFlags, other.flags);
    let foe = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (!usable(foe)) {
      const by = creep.provokedBy >= 0 ? byCreepId.get(creep.provokedBy) : undefined;
      foe = usable(by) ? by : undefined;
    }
    creep.provokedBy = -1;
    if (!usable(foe) && defendersOut > 0) {
      const reach = creepReach(creep.range);
      foe = index
        .inRange(2 * Math.sqrt(reach), creep.x, creep.y, creep.hitFlags)
        .find(({ creep: other }) => {
          const squared = screenDistanceSquared(creep.ix, creep.iy, other.ix, other.iy);
          return squared < reach;
        })
        ?.creep;
    }
    if (!usable(foe)) {
      if (creep.targetCreep >= 0) loseTarget(creep);
      return false;
    }
    if (creep.targetCreep !== foe.id) {
      loseTarget(creep);
      creep.targetCreep = foe.id;
    }
    fight(creep, foe);
    return true;
  };

  /**
   * `findHealingTargets` (`CreepBase.as:606-657`): the nearest wounded ally
   * within 600 that can be healed, else the one it is already on while that
   * one is still wounded. Meanwhile it follows the nearest ally that can be
   * healed at all (`:615-624`). With nobody wounded it waits out
   * `_healerGiveUpTimer` a look at a time and then leaves (`:642-651`). A
   * yard with nothing left standing sends it home at once (`:610-611`).
   */
  const findHealingTargets = (creep: Creep): void => {
    if (!yard.buildings.some(isAttackableBuilding)) {
      creep.behaviour = "retreat";
      return;
    }
    const hits = index.inRange(HEAL_SEARCH, creep.x, creep.y, oldStyleTargets(1), creep.id);
    const current = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    const wounded = (other: Creep | undefined): boolean =>
      !!other && other.hp > 0 && other.hp < other.maxHp;
    if (!wounded(current)) {
      const follow = hits.find((hit) => !isAntiHeal(hit.creep.monsterId));
      if (follow) creep.targetCreep = follow.creep.id;
    }
    const pick = hits.find(
      ({ creep: other }) =>
        other.behaviour !== "retreat" && !isAntiHeal(other.monsterId) && other.hp < other.maxHp,
    );
    if (pick) {
      creep.targetCreep = pick.creep.id;
    } else if (!wounded(current)) {
      if (creep.giveUp > 0) creep.giveUp -= 1;
      else creep.behaviour = "retreat";
    }
  };

  /**
   * A healer, `k_sBHVR_HEAL` (`CreepBase.as:1302-1370`): C15 Zafreeti and C16
   * Vorg carry negative damage and spend it on their own side (issue #129).
   *
   * It re-looks when its patient dies, every 100 of its own frames while the
   * patient is whole, and every 120 while it is not healing; it closes to its
   * range and backs off to it again only past 1.25 of it squared (`:1317-1344`).
   * In range, each swing heals the patient by the damage's size, a champion by
   * a tenth, never past full health (`FIREBALL.as:150-159`), and only while
   * the patient is still wounded (`:1351-1361`). The heal lands on the tick it
   * is thrown, as every projectile does here (fidelity note 1).
   */
  const tickHealer = (creep: Creep): void => {
    const frame = tick - creep.born;
    let target = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (target && target.hp > 0) {
      const squared = screenDistanceSquared(creep.ix, creep.iy, target.ix, target.iy);
      const reach = creep.range * creep.range;
      if (target.hp >= target.maxHp && frame % 100 === 0) {
        creep.atTarget = false;
        creep.attacking = false;
        findHealingTargets(creep);
      } else if (!creep.attacking && frame % 120 === 0) {
        findHealingTargets(creep);
      } else if (squared < reach) {
        creep.atTarget = true;
      } else if (creep.attacking && squared > reach * 1.25) {
        creep.attacking = false;
        creep.atTarget = false;
      }
    } else {
      creep.targetCreep = -1;
      creep.atTarget = false;
      creep.attacking = false;
      findHealingTargets(creep);
    }
    if (creep.behaviour !== "heal") return;
    target = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (!target || target.hp <= 0) return;

    if (creep.atTarget) {
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += Math.trunc(creep.attackDelay);
        if (target.hp < target.maxHp) {
          creep.attacking = true;
          healCreep(creep, target);
        } else {
          creep.attacking = false;
        }
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

  /** One heal: its damage's size, a tenth on a champion, up to full (`FIREBALL.as:150-159`). */
  const healCreep = (healer: Creep, target: Creep): void => {
    const size = Math.abs(healer.damage) * (target.champion ? 0.1 : 1);
    const healed = Math.min(size, target.maxHp - target.hp);
    if (healed <= 0) return;
    target.hp += healed;
    if (target.champion) {
      championHp = target.hp;
      championsHp[target.monsterId] = target.hp;
    }
    recordHit(healer, target.ix, target.iy, -healed);
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
    if (creep.behaviour === "heal") {
      tickHealer(creep);
      return;
    }
    if (defended && fightsBack(creep) && engage(creep)) return;
    if (creep.monsterId === REZGHUL_ID) tickRaise(creep);

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

    // A ranged creep stops as soon as its target is inside its range, a circle
    // on screen around the building's anchor (`CreepBase.as:735-748`).
    if (!creep.atTarget && creep.range > 1) {
      const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
      if (aim && reachesBuilding(creep.ix, creep.iy, aim, creep.range)) creep.atTarget = true;
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
    const stats = towerStats(building.type, building.level, yard.kind);
    const damage = stats?.damage;
    if (stats?.range === undefined || damage === undefined) return;
    const range = tower.range;
    tower.fireTick -= 1;
    if (tower.fireTick > 0) return;
    tower.fireTick += (stats?.rate ?? 0) * TOWER_REARM_MULTIPLIER;

    const flags = towerTargets(building.type);
    const scan = towerScanPoint(building);
    const scanX = scan.x;
    const scanY = scan.y;
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
      visual.push({
        kind: "shot",
        tick,
        towerId: building.id,
        creepId: creep.id,
        ix: creep.ix,
        iy: creep.iy,
      });
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

    const stats = towerStats(building.type, building.level, yard.kind);
    const range = stats?.range ?? 0;
    if (range <= 0) return;
    // A bunker sends its defenders at anything attacking, air or ground
    // (`HOUSINGBUNKER.as:269-300`); the interceptor pick is the random draw.
    // Scanned from the middle of the footprint, like a tower (`HOUSINGBUNKER.as:156`).
    const scan = towerScanPoint(building);
    const found = index.inRange(range, scan.x, scan.y, oldStyleTargets(1));
    if (found.length === 0) return;

    const ids: string[] = [];
    for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
      // A healer has nothing to fight with, so it stays in (issue #195).
      if (count > 0 && monsterStat(monsterId, "damage", 1) > 0) ids.push(monsterId);
    }
    if (ids.length === 0) return;
    const monsterId = ids[rng.int(ids.length)] as string;
    bunker.pool.set(monsterId, (bunker.pool.get(monsterId) ?? 0) - 1);
    bunker.dispatched += 1;
    const level = clampLevel(options.defenderLevels ?? options.levels, monsterId);
    const defender = spawnCreep(
      monsterId,
      level,
      { x: building.x, y: building.y },
      true,
      "defend",
      building.id,
    );
    defender.targetCreep = (found[0] as { creep: Creep }).creep.id;
    // It chases nothing outside the bunker's own range, and walks back in (issue #195).
    defender.home = {
      ix: building.x,
      iy: building.y,
      centreX: scan.x,
      centreY: scan.y,
      leash: range,
    };
  };

  /** The caged champion comes out when an attacker first comes near its cage (issue #195). */
  const tickCage = (): void => {
    if (!cage || cageChampion || !options.defenderChampion) return;
    const scan = towerScanPoint(cage);
    if (!index.closest(CAGE_ALERT_RANGE, scan.x, scan.y, oldStyleTargets(1))) return;
    cageChampion = releaseChampion(cage, options.defenderChampion);
  };

  /* ── The tick ──────────────────────────────────────────────────────────── */

  const anyAttackerLeft = (): boolean =>
    creeps.some((creep) => !creep.friendly && !creep.gone && creep.hp > 0);

  /** Drops visual events older than the memory window; the list stays short. */
  const pruneVisual = (): void => {
    const oldest = tick - VISUAL_MEMORY_TICKS;
    let drop = 0;
    while (drop < visual.length && (visual[drop] as BattleVisualEvent).tick < oldest) drop += 1;
    if (drop > 0) visual.splice(0, drop);
  };

  const step = (): void => {
    if (finished) return;
    tick += 1;
    pruneVisual();
    if (tick >= retreatAt || (retreated && !anyAttackerLeft())) {
      finished = true;
      return;
    }

    index.rebuild(creeps);
    for (const trap of traps) tickTrap(trap);
    for (const tower of towers) tickTower(tower);
    for (const bunker of bunkers) tickBunker(bunker);
    if (defended) {
      tickCage();
      defendersOut = 0;
      for (const creep of creeps) if (creep.friendly && creep.hp > 0) defendersOut += 1;
    }
    for (const creep of creeps) tickCreep(creep);

    if (creeps.length > 0) {
      let write = 0;
      for (let read = 0; read < creeps.length; read += 1) {
        const creep = creeps[read] as Creep;
        if (creep.gone || creep.hp <= 0) {
          byCreepId.delete(creep.id);
          if (creep.homeBunker >= 0 && creep.hp <= 0) {
            addBunkerLoss(bunkerLosses, creep.homeBunker, creep.monsterId);
          }
          // Only a death zeroes the champion's health: one that retreated or
          // walked home keeps the health it left with, which the attack save
          // writes back verbatim as the attacker's champion.
          if (creep.champion && creep.hp <= 0) {
            if (creep.friendly) {
              defenderChampionHp = 0;
            } else {
              championHp = 0;
              championsHp[creep.monsterId] = 0;
            }
          }
          continue;
        }
        if (creep.champion && creep.friendly) {
          defenderChampionHp = creep.hp;
        } else if (creep.champion) {
          championHp = creep.hp;
          championsHp[creep.monsterId] = creep.hp;
        }
        creeps[write] = creep;
        write += 1;
      }
      creeps.length = write;
    }
    bornAtStepEnd();

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

  const creepSnapshots = (): CreepSnapshot[] =>
    creeps.map((creep) => ({
      id: creep.id,
      monsterId: creep.monsterId,
      level: creep.level,
      champion: creep.champion,
      friendly: creep.friendly,
      ix: creep.ix,
      iy: creep.iy,
      hp: creep.hp,
      maxHp: creep.maxHp,
      flying: creep.flying,
      state: creep.attacking ? "attacking" : "walking",
      targetBuilding: creep.targetBuilding,
      targetCreep: creep.targetCreep,
    }));

  const recentEvents = (sinceTick: number): BattleVisualEvent[] => {
    let start = 0;
    while (start < visual.length && (visual[start] as BattleVisualEvent).tick <= sinceTick) {
      start += 1;
    }
    return visual.slice(start);
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
    championsHp: { ...championsHp },
    towers: towers.map((tower) => ({ ...tower.report })),
    rngDraws: rng.count(),
    over: finished,
    bunkerLosses: bunkerLossRecord(bunkerLosses),
    bunkerGarrisons: garrisonsAfter(),
    defenderChampionHp,
  });

  /** {@link BattleState.bunkerGarrisons}: each supplied bunker's pool, plus its defenders out. */
  const garrisonsAfter = (): Record<number, Record<string, number>> => {
    const out: Record<number, Record<string, number>> = {};
    for (const bunker of bunkers) {
      if (!options.bunkers?.[bunker.building.id]) continue;
      const held = new Map<string, number>();
      if (bunker.building.hp > 0) {
        for (const [monsterId, count] of bunker.pool) held.set(monsterId, count);
      }
      for (const creep of creeps) {
        if (creep.homeBunker !== bunker.building.id || creep.hp <= 0 || creep.gone) continue;
        held.set(creep.monsterId, (held.get(creep.monsterId) ?? 0) + 1);
      }
      const garrison: Record<string, number> = {};
      for (const monsterId of [...held.keys()].sort()) {
        const count = held.get(monsterId) ?? 0;
        if (count > 0) garrison[monsterId] = count;
      }
      out[bunker.building.id] = garrison;
    }
    return out;
  };

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
    // A battle with a defence folds it in too (issue #195); one without folds
    // exactly what it always did, so the digests of such battles are unchanged.
    if (defended) {
      for (const creep of creeps) values.push(creep.id, creep.targetCreep);
      for (const bunker of bunkers) {
        values.push(bunker.building.id);
        for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
          values.push(monsterId.length, count);
        }
      }
      values.push(defenderChampionHp ?? -1);
    }
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
    creeps: creepSnapshots,
    recentEvents,
  };
};

/** Whether a building is one a creep could ever pick, for a caller's filter. */
export const isAttackableBuilding = (building: EngineBuilding): boolean =>
  isMainTarget(building.kind) && building.hp > 0;

/** Dead defenders per bunker id, then per monster id (issue #130). */
export type BunkerLossTally = Map<number, Map<string, number>>;

/**
 * One of a bunker's defenders died: it is gone from the garrison for good
 * (`CreepBase.as:1004-1030`, issue #130).
 */
export const addBunkerLoss = (
  tally: BunkerLossTally,
  bunkerId: number,
  monsterId: string,
): void => {
  const lost = tally.get(bunkerId) ?? new Map<string, number>();
  lost.set(monsterId, (lost.get(monsterId) ?? 0) + 1);
  tally.set(bunkerId, lost);
};

/** {@link BattleState.bunkerLosses} from a tally, in id order so both runtimes agree. */
export const bunkerLossRecord = (
  tally: BunkerLossTally,
): Record<number, Record<string, number>> => {
  const record: Record<number, Record<string, number>> = {};
  for (const id of [...tally.keys()].sort((one, other) => one - other)) {
    const lost = tally.get(id) as Map<string, number>;
    const byMonster: Record<string, number> = {};
    for (const monsterId of [...lost.keys()].sort()) {
      byMonster[monsterId] = lost.get(monsterId) as number;
    }
    record[id] = byMonster;
  }
  return record;
};

/** An id a stored bunker may still carry for a monster renamed since. */
const LEGACY_MONSTER_IDS: Readonly<Record<string, string>> = { C100: "C12" };

/**
 * Every bunker's garrison as {@link BattleOptions.bunkers} takes it, read off
 * the defender's stored `buildingdata` (issue #130).
 *
 * A bunker keeps what it holds on its own entry, `m = { monsterId: count }`
 * (`client/scripts/BUILDING22.as:674-679`, `Setup`), and the engine knows the
 * building by the id {@link buildEngineYard} gives it: the entry's `id`, else
 * its key. Counts are whole and above zero, of monsters the rules know; a Map
 * Room 3 main yard's per-creep lists count by their length, as the original
 * exported them (`BUILDING22.as:688-692`). Both sides of an attack read the
 * garrison here, so the client's battle and the server's replay dispatch the
 * same defenders.
 */
export const bunkerGarrisons = (
  buildingdata: CombatBuildingDataMap | readonly CombatBuildingData[] | null | undefined,
): Record<number, Roster> => {
  const garrisons: Record<number, Roster> = {};
  if (!buildingdata || typeof buildingdata !== "object") return garrisons;
  const entries: Array<[string, CombatBuildingData]> = Array.isArray(buildingdata)
    ? (buildingdata as readonly CombatBuildingData[]).map((data, index) => [String(index), data])
    : Object.entries(buildingdata as CombatBuildingDataMap);
  for (const [key, data] of entries) {
    if (!data || typeof data !== "object" || !isBunker(numberOf(data.t))) continue;
    const held = data["m"];
    if (!held || typeof held !== "object" || Array.isArray(held)) continue;
    const roster: Record<string, number> = {};
    for (const [raw, value] of Object.entries(held as Record<string, unknown>)) {
      const id = LEGACY_MONSTER_IDS[raw] ?? raw;
      const count = Array.isArray(value) ? value.length : Math.floor(numberOf(value));
      if (!isKnownMonster(id) || !(count > 0)) continue;
      roster[id] = (roster[id] ?? 0) + count;
    }
    if (Object.keys(roster).length === 0) continue;
    garrisons[Math.floor(numberOf(data.id ?? key))] = roster;
  }
  return garrisons;
};
