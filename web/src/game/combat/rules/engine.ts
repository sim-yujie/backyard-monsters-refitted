import {
  CHAMPION_RETARGET_FRAMES,
  ENRAGE_INTERVAL,
  ENRAGE_RADIUS,
  FLAME_INTERVAL,
  FLAME_SHARE,
  FLYING_START_FRAME_SPREAD,
  FOMOR_BUFF_SEARCH,
  FOMOR_DRIFT,
  FOMOR_HEALED_FRAMES,
  FOMOR_ID,
  FOMOR_IDLE_FRAMES,
  FOMOR_LOOK_FRAMES,
  KORATH_DEFEND_FLYER_REACH,
  KORATH_FIREBALL_DIVISOR,
  KORATH_ID,
  KRALLEN_ID,
  LOOT_AURA_FRAMES,
  QUAKE_END_FRAME,
  QUAKE_FRAME_CYCLE,
  QUAKE_INNER_RANGES,
  QUAKE_RADIUS_RANGES,
  QUAKE_STRIKE_FRAME,
  QUAKE_SWINGS,
  START_FRAME_SPREAD,
  UNTARGETABLE_TYPES,
  championPower,
  enrageArmour,
  enrageMultiplier,
  fomorBuff,
  hasFireball,
  hasLootAura,
  hasQuake,
  krallenAuraRadius,
  linearAreaDamage,
  lootAuraBonus,
} from "./champions.js";
import { BRAIN_KEYS, brainBase } from "./brain.js";
import {
  DECOY_BUILDING_REACH,
  DECOY_FRAME_TICKS,
  decoyPlan,
  decoyStandPoint,
  decoyTouchesBuilding,
} from "./decoy.js";
import type { DecoyPlan } from "./decoy.js";
import { DESCENT_BURN_INTERVAL, burnsInDescent, descentBurnShare } from "./descentBurn.js";
import { DECOY, JARS, VACUUM } from "./siege.js";
import type { SiegeId } from "./siege.js";
import {
  JAR_CHECK_TICKS,
  JAR_FRAMES,
  JAR_TOWER_TYPES,
  jarFrame,
  jarShot,
  jarsPlan,
} from "./jars.js";
import {
  VACUUM_FRAME_TICKS,
  VACUUM_TARGET_TYPES,
  shootsHose,
  vacuumGain,
  vacuumHoseY,
  vacuumLootCap,
  vacuumPlan,
  vacuumTake,
} from "./vacuum.js";
import type { VacuumPlan } from "./vacuum.js";
import type { BrainKey, BrainWeights, ChampionLesson } from "./brain.js";
import { buildPathGrid, pointTarget } from "./grid.js";
import {
  cannotBeat,
  exposure,
  focusFeature,
  stanceBonus,
  stanceWeights,
  threatFeature,
  towerPerTick,
} from "./stance.js";
import type { ChampionStance, StanceWeights, TargetFeatures } from "./stance.js";
import { mulberry32 } from "./rng.js";
import { REZGHUL_ID, SPLIT_CHILD_ID } from "./potential.js";
import {
  ATTACK_COUNTDOWN_SECONDS,
  BEHAVIOUR_SPEED,
  RAID_MAX_SECONDS,
  BOMBS,
  type BombStats,
  bombParticleDamage,
  bombReaches,
  puttyReach,
  TICKS_PER_SECOND,
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
  championStatWithFood,
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
  RAILGUN_BEAM_RADIUS,
  RAILGUN_MUZZLE_DROP,
  RAILGUN_REACH,
  RAILGUN_SEGMENT,
  RAILGUN_SEGMENTS,
  RAILGUN_TYPE,
  BALTHAZAR_ID,
  KING_WORMZER_ID,
  KING_WORMZER_MULTIPLIER,
  SABNOX_ID,
  HOUSING_BUNKER_INTERCEPTORS,
  HOUSING_BUNKER_TARGETS,
  HOUSING_BUNKER_TYPE,
  QUAKE_ANIM_FRAMES,
  QUAKE_FRAME_TICKS,
  QUAKE_TOWER_TYPE,
  quakeDamage,
  AERIAL_DEFENSE_TYPE,
  AERIAL_SHOT_TICKS,
  aerialSalvo,
  LASER_DROP,
  LASER_PULSE_TICKS,
  LASER_TICKS,
  LASER_TYPE,
  laserEnd,
  laserPulse,
  laserSweep,
  type LaserSweep,
  TESLA_CHARGE_END,
  TESLA_LOOP_END,
  TESLA_TICKS_PER_FRAME,
  TESLA_TYPE,
  TESLA_WIND_END,
  TESLA_ZAP_FRAMES,
  SPURTZ_CULL_FRAMES,
  SPURTZ_CULL_ROLL,
  SPURTZ_CULL_TICKS,
  SPURTZ_HATCH_CHANCE,
  SPURTZ_ID,
  SPURTZ_LOOK,
  SPURTZ_MAX_TARGETS,
  SPURTZ_MUZZLE_RISE,
  SPURTZ_RELOOK_FRAMES,
  SPURTZ_SCALE_MIN,
  SPURTZ_SCALE_SPREAD,
  SPURTZ_SCATTER,
  SPURTZ_SHOT_TICKS,
  SPURTZ_START_ANGLE,
  SPURTZ_SWITCH_ANGLE,
  isSpurtzCannon,
  seriesAtan2Degrees,
  seriesCos,
  seriesSin,
  spurtzBlastRadius,
  turnSpurtzBarrel,
  beamHits,
  towerHealthScale,
  towerShotDamage,
  specialistMultiplier,
  ticks,
  towerRange,
  towerStats,
  HEAVY_TRAP_TYPE,
  heavyTrapFlyerDamageAt,
  trapDamageAt,
  trapStats,
  tripsTrap,
  isKnownMonster,
} from "./stats.js";
import {
  canHit,
  TARGETS_ATTACKERS,
  TARGETS_DEFENDERS,
  TARGETS_FLYING,
  TARGETS_GROUND,
  TARGETS_INVISIBLE,
  createCreepIndex,
  defenseFlags,
  findBuildingTarget,
  findChampionTarget,
  unlootedForKrallen,
  isBunker,
  isFlyingMovement,
  oldStyleTargets,
  towerTargets,
  shellBlastTargets,
  QUAKE_TARGETS,
  TRAP_TARGETS,
} from "./targeting.js";
import {
  distanceSquared,
  fromIso,
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
import type { ChampionScoring, CreepHit, CreepIndex } from "./targeting.js";
import { numberOf } from "./types.js";
import type {
  CombatBuildingData,
  CombatBuildingDataMap,
  FlingEvent,
  RaidEvent,
  MonsterLevels,
  MonsterRanks,
  ResourceAmounts,
  Roster,
} from "./types.js";
import {
  AIRBURST_BUILDING_RADIUS,
  AIRBURST_CREEP_RADIUS,
  BANDITO_ID,
  BANDITO_RADIUS,
  BLINK_HOPS,
  BOLT_ID,
  BOUNCE_RADIUS,
  BRAIN_ID,
  DAVE_ID,
  EYE_RA_ID,
  FANG_ID,
  FINK_ID,
  FINK_RADIUS,
  PROJECT_X_ID,
  PROJECT_X_RADIUS,
  TERATORN_ID,
  VENOM_INTERVAL_SECONDS,
  WORMZER_ID,
  WORMZER_RADIUS,
  airburstPercent,
  airburstRadius,
  banditoSpeedPercent,
  blinkRange,
  blinkRouteLimit,
  bounceCount,
  cloakDelaySeconds,
  daveRange,
  finkExtraTargets,
  projectXMultiplier,
  rankOf,
  venomShare,
  wormzerMultiplier,
} from "./specialMoves.js";

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
 * traps, towers, bunkers, then creeps, each by ascending id, after the Laser
 * beams still sweeping, oldest first (fidelity note 16).
 *
 * ## What is simulated
 *
 * Creeps with their six target groups and their specialist multipliers; the
 * pathing grid and the wall that gets in the way; ranged and melee swings;
 * Eye-ra's blast; Slimeattikus splitting as it dies; the healers; Rezghul
 * raising the dead; towers with
 * their acquire delay, re-arm and splash, the Railgun's beam, the Laser's
 * sweeping beam, the Aerial Defense's salvo and the Tesla's charge and zaps;
 * the two traps; bunkers dispatching
 * defenders; resource bombs; loot out of harvesters and storage, hit by hit,
 * and the share of the pool a fallen storage building gives up; the countdown
 * and the retreat; a wild monster raid on the player's own yard (note 17); and
 * the Spurtz Cannon's burst of shells and the Spurtz they hatch (note 18).
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
 *    that matters for damage. It does tunnel as Flash's does: underground and
 *    untargetable whenever it is not swinging ({@link tickBurrow}).
 * 6. **Only the closest target is routed to.** The client asks the grid for a
 *    route to the closest *and* the second closest and takes whichever answers
 *    first, because its flood is asynchronous (`MonsterBase.as:1163-1169`). The
 *    engine's flood answers within the tick, so it routes to the closest and
 *    the second is reported but unused.
 * 7. **Retreat removes a creep.** A creep with nothing left to attack, or one
 *    caught by the retreat at the end of the countdown, is taken off the field
 *    rather than walked to the edge (`ATTACK.as:237-240`). It deals no more
 *    damage either way.
 * 8. **Not modelled at all**, each because it is out of Map Room 2's scope:
 *    the Stronghold's four emitters (the siege weapons are, Inferno WP 6.5 to
 *    6.7, {@link BattleOptions.siege}), and the per-creep
 *    `_hitLimit`, even for a raid (note 17, owner decision 2026-10-06). A yard
 *    holding one of those buildings fires it as an ordinary single-target
 *    tower. The Monster Lab's moves (Brain's cloak, Bolt's blink, Fang's
 *    venom, Teratorn's bounces and the rest) are modelled since issue #352,
 *    with the owner's numbers (`docs/design/special-moves.md`).
 * 9. **The defence is supplied, and its rules are the owner's.** The defender's
 *    bunker blob is opaque to the server (§6 item 5), so
 *    {@link BattleOptions.bunkers} carries it, read off `buildingdata` by
 *    {@link bunkerGarrisons}; the caged champions come in as
 *    {@link BattleOptions.defenderChampions}. A bunker with no entry dispatches
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
 *    - The champion in the Champion Cage comes out at its stored health, at
 *      its level plus its food bonus, and fights on if the cage
 *      falls. When it comes out and what it chases are Flash's (note 14).
 *    - Towers, traps and bombs never hurt a defender.
 * 10. **Storage loot is not capped by the attacker's pool.** `ATTACK.Loot`
 *    clamps a gain to the attacker's storage cap (`ATTACK.as:696-710`); the cap
 *    is a property of the attacker's row, not the battle, so the audit derives
 *    it (§2.4 `lootOverCap`) and the engine reports the uncapped gain.
 * 11. **The looting property.** A creep loots at 0.5 and a resource
 *    specialist or a champion at 2 (`MonsterBase.as:260`, `CreepBase.as:224-226`,
 *    `ChampionBase.as:221`), Krallen included, whose `_lootMults` is never read
 *    (issue #178). Krallen's aura adds to it (note 12). The Vacuum's
 *    `lootBonus` is no looting property: it sucks the pool itself.
 * 12. **The champions' own behaviour (issue #222)**, from
 *    `com/monsters/monsters/champions/*.as` and the numbers in `champions.ts`:
 *    their target lists (`ChampionBase.findTarget`, Krallen's loot first) and
 *    100-frame look; Korath's fireball at flyers, his flame and his quake;
 *    Fomor's enrage aura, its following of wounded allies and its fireball's
 *    loot of 1; Krallen's loot aura; and the "Retreat" on a champion's own
 *    button, the `championRetreat` event. Only a ranged champion, or Korath
 *    with his fireball, can hit a flyer. A ground Fomor walks to the ally it
 *    follows by the grid, round walls, as Flash's `WaypointTo` does. Where the
 *    engine still parts from Flash: a champion that leaves walks straight back
 *    to its spawn point, and only so its aura lasts until it is off the field
 *    (otherwise note 7 holds); the flung Fomor's render-only first look on
 *    landing (`Fomor.as:13-16`) is not taken. A bunker's defenders still
 *    choose their quarry by the owner's rules of note 9; the caged champion
 *    by Flash's (note 14).
 * 13. **Modes (issue #220) are not Flash.** An attacking champion flung in
 *    Offensive or Defensive scores Flash's candidate lists rather than taking
 *    the closest (`stance.ts`); Hybrid, and a log that names no Mode, is the
 *    Flash champion. A defending champion has no Mode. The Mode's weights sit
 *    on the champion's learned brain (issue #219, `brain.ts`), which the log
 *    carries as the attack froze it; with `learn`, the battle also records
 *    each attacking champion's lesson, reading the field and changing nothing.
 * 14. **The caged champion defends as Flash's does (issue #260).** It waits in
 *    its cage at a random point (`CHAMPIONCAGE.as:623`, `:280-283`), off the
 *    field, and every {@link CAGE_LOOK_FRAMES} of its frames looks
 *    {@link CHAMPION_DEFEND_SCAN} around itself (`ChampionBase.tickBPen`,
 *    `:1055-1057`; `getTargetCreeps`, `:500-502`). It comes out at the nearest
 *    attacker it can hit, passing over one that is retreating and, unless it
 *    flies, an Eye-ra (`FindDefenseTargets`, `:504-534`). Out, it has no leash
 *    (`tickBDefend`, `:851-918`): it swings at its foe inside its range, keeps
 *    swinging until the foe is twice that away, and while it chases one it is
 *    not yet hitting looks again every {@link CHASE_LOOK_FRAMES} frames for a
 *    nearer one. When its foe dies it looks again from where it stands; with
 *    nobody left inside 800 it walks back to the cage (`changeModeCage`,
 *    `:295-303`), still looking every 200 frames, and goes back in when it
 *    gets there (`tickBCage`, `:1113-1137`), to come out again the same way.
 *    Where the engine parts from Flash: its frame count starts with the
 *    battle rather than with the yard's load; it walks straight at its foe
 *    and straight home, rather than pathing round walls or heading for where
 *    the foe is going (`interceptTarget`, `:462-498`); and back in the cage it
 *    stands where it stopped rather than pacing.
 *    A cage holding both a basic champion and a Krallen sends out both (issue
 *    #310): `SpawnGuardian` pens each at its own random point (`:619-655`;
 *    `CREATURES.addGuardian`, `:241-257`), so each waits, looks, fights and
 *    goes back in on its own, with its own health and tally, and both walk
 *    back to the same door.
 * 15. **The Tesla's frames are every second tick.** Its charge, zaps and
 *    wind-down run in an `ENTER_FRAME` handler (`BUILDING25.as:98`), so they
 *    count frames of the 40 fps stage, not loops, and skip catch-up frames
 *    (`GLOBAL._catchup`). The engine runs them on every second tick, which is
 *    a frame at the 80 loops a second it keeps ({@link TESLA_TICKS_PER_FRAME}).
 * 16. **The Laser's beam does not wobble with the clock.** Its length swings
 *    by a twentieth with `sin((duration / 4 + getTimer() / 1000) / 20)`
 *    (`LASER.as:104-105`), so in Flash it depends on how long the player had
 *    been running; the engine reads `getTimer()` as 0. Its beams tick at the
 *    start of a step rather than after the frame's loops (`EFFECTS.Tick`), so
 *    a beam pulses first on the tick after it is fired ({@link LASER_TYPE}).
 * 17. **Wild monster raids (issue #226, `docs/design/wild-raids.md` §6.2) and
 *    the Trojan Horse's army (issue #325, `docs/design/trojan-horse.md`
 *    §4-5).** A battle given {@link BattleOptions.raid} is a raid on the
 *    player's own yard, fought as a main yard and never as a wild camp. It
 *    takes `raid` events and nothing else, and no other battle takes them.
 *    Each wave spawns its raiders at the defender's own academy level for
 *    their type ({@link BattleOptions.defenderLevels}, an absent one level
 *    1), not Flash's level 0 (`CREATURES.as:243-255`), with plain stats
 *    otherwise: Flash's wild-raid x0.4 to x0.9 strength (`WMATTACK.as:729-753`)
 *    is the owner's to drop, and was dropped (owner decisions, 2026-10-05 and
 *    2026-10-06); the Trojan Horse keeps its own strength figure, x0.4 to
 *    x1.0 by the player's score, as {@link RaidEvent.strength} (absent, 1,
 *    so a wild raid is unchanged). They scatter in the disc the planner
 *    chose, with no recomputed radius. There is no hit limit (`_hitLimit`,
 *    `CreepBase.as:926-941`, dropped by owner decision 2026-10-06): a raider
 *    fights on like an attacker, until it dies or has nothing left to attack
 *    and retreats (note 7). There is no countdown: a wild raid's single wave
 *    lands at tick 0, so the raid ends as soon as no raider is left once one
 *    has come (`WMATTACK.as:331-347`); the Trojan Horse's army keeps landing
 *    for about 45.8 s, so {@link BattleOptions.raidSpawnsUntil} holds the
 *    fight open through the gaps between its spawns the way Flash's own horse
 *    did not (`BUILDING27.as:51-81`) — every wave must have landed, not only
 *    the field be empty. Either way {@link RAID_MAX_SECONDS} caps it. Flash
 *    also ended a wild raid when no raider was still attacking, looting or
 *    hunting; a raider with nothing left to attack retreats and is gone (note
 *    7), so the two agree. A spawn off the pathing grid has no route, so the
 *    raider walks straight at its target until a look from on the grid
 *    routes it.
 * 18. **The Spurtz Cannon (issue #313, `SpurtzCannon.as`).** Its burst, the
 *    shells' flight and the hatching are Flash's, and its shells, unlike
 *    note 1, are in the air until they land. Where it is not Flash: a shell
 *    flies straight along its heading from its first loop (the pooled
 *    `FIREBALL`'s leftover frame and direction are not reproduced); each
 *    landing's blast is that shell's own size, damage and point, where Flash
 *    borrows the newest shell's; a fallen cannon stops firing at once, where
 *    Flash's finishes its burst at half damage (both the owner's calls,
 *    2026-10-06). The jar is not modelled; the tower overdrive is (note 19). The cull
 *    goes on once the cannon has fallen. A hatched Spurtz walks straight at
 *    its foe, and an attacker that hits it does not make it turn on that
 *    attacker. Its level is the defender's for it from
 *    {@link BattleOptions.defenderLevels}, else 1. Its damage and kills go on
 *    its cannon's report row; Flash has no such report.
 * 19. **The shop's boosts (`STORE.as:2431-2500`, {@link BattleOptions.buffs}).**
 *    Tower Overdrive multiplies every defending tower's shot by 1.25, the
 *    Spurtz Cannon's shells too (`BUILDING20.as:27-31` and the other towers),
 *    before the shot is cut to a whole number. Monster Overdrive multiplies
 *    a side's monsters' and champions' damage by 1.25 (`MonsterDust.as`), the
 *    defensive buff takes 30% off every hit they take, on top of any other
 *    armour (`BeastMode.as`, `ArmorPropertyModifier`), and the speed buff makes
 *    them walk 1.5 times as fast and swing 1.5 times as often
 *    (`HyperSpeed.as`). The defender's boosts are its yard's; the attacker's
 *    are its main yard's, copied at attack start (`GLOBAL.as:816-822`,
 *    `MonsterBase.updateBuffs`, `:799-845`), and a wild raid has none. Where
 *    it is not Flash: a boost runs the whole battle if it was running when the
 *    battle began, where Flash's stops the moment it runs out.
 * 20. **Walls block a shot on foot, as Flash's do (owner decision
 *    2026-10-23).** An attacker on foot shoots a building only with no
 *    standing Wall between it and the building's anchor, the target aside
 *    (`PATHING.LineOfSight`, `PATHING.as:573-597`; `CreepBase.as:735-748`,
 *    `ChampionBase.as:424-438`); until then it keeps walking its route, round
 *    the walls or to the wall in its way. A flyer shoots over them. Against a
 *    defender a monster, and Fomor even in the air (`Fomor.as:34-46`), needs
 *    the same clear line unless within 50 screen px; other champions do not
 *    (`ChampionBase.as:1461`). A shot in flight never hits a wall, and towers
 *    and defenders shoot over walls as before. The flying monsters with a
 *    range heal rather than shoot, so Flash's check on them never bites.
 *
 * ## The random stream's order
 *
 * One stream. Before the first step each caged champion in turn draws its place
 * in its cage (four draws) and its start frame (one draw, and a second for a
 * flyer).
 * After that, drawn in the order the step runs: the bunkers' interceptor picks
 * (towers and traps draw nothing), then each creep in id order (its route's
 * scatter, a storage hit's resource pick), then the Slimeattikus Minis born at
 * the step's end.
 * An event draws when it is applied, before the next step: a fling draws each
 * creep's landing point in monster id order and then the champion's, followed
 * by the champion's start frame (one draw, and a second for a flyer). A raid
 * wave draws each raider's landing point in monster id order.
 */

/* ── Inputs ───────────────────────────────────────────────────────────────── */

/**
 * One thing the attacker did, at a tick.
 *
 * The union is `types.ts`'s {@link FlingEvent}, which is the §3.10 contract the
 * web client's attack flow (issue #32) builds against. The engine consumes it
 * directly rather than restating it, so the two cannot drift apart. A `siege`
 * event drops the Decoy, the Vacuum or the Jars at the attacker's level
 * ({@link BattleOptions.siege}); any other weapon, or one with no level, is
 * accepted and ignored (fidelity
 * note 8). A raid battle's waves are
 * the server's own {@link RaidEvent}s (fidelity note 17).
 */
export type AttackEvent = FlingEvent | RaidEvent;

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
  /**
   * The defender's levels: for the defenders a bunker sends out, which default
   * to the attacker's, and a Spurtz Cannon's Spurtz, which default to 1.
   */
  readonly defenderLevels?: MonsterLevels;
  /**
   * The attacker's Monster Lab ranks per monster id (issue #352): what its
   * flung monsters fight with. An absent id, or none at all, is rank 0, the
   * plain monster. A wild raid passes none.
   */
  readonly ranks?: MonsterRanks;
  /**
   * The defender's Lab ranks (issue #352): what a bunker's monsters fight
   * with. Never the attacker's; absent, they are rank 0.
   */
  readonly defenderRanks?: MonsterRanks;
  /**
   * The defender's champions in its Champion Cage (issues #195, #310): its
   * basic champion and its Krallen, each defending on its own, in the order
   * given. None, or an empty list, is no caged champion.
   */
  readonly defenderChampions?: readonly DefenderChampion[] | null;
  /**
   * Record each attacking champion's lesson for its learning brain (issue
   * #219, {@link BattleState.lessons}). Reads only: the battle, its random
   * stream and its checkpoints are the same with it or without it. The
   * server's landing replay sets it; nothing else needs to pay for it.
   */
  readonly learn?: boolean;
  /**
   * Fight a wild monster raid rather than an attack (fidelity note 17): the
   * raiders spawn at {@link defenderLevels} too, the player's own academy,
   * alongside their bunkers' defenders.
   */
  readonly raid?: boolean;
  /**
   * The last tick a raid wave is due (fidelity note 17): a raid does not end
   * merely because no raider is on the field, only once this tick is behind
   * it too (or {@link RAID_MAX_SECONDS}, whichever comes first) — set it to
   * the last wave's own tick, not one past it, so the caller's own
   * `runTo(tick); apply(event)` for that wave still lands first. Absent, 0:
   * every wave has already landed, as a wild raid's single wave at tick 0
   * does. The Trojan Horse's army spreads its waves to about 45.8 s
   * (`docs/design/trojan-horse.md` §5), so it sets this to its last spawn.
   */
  readonly raidSpawnsUntil?: number;
  /**
   * The shop's boosts each side fights with (fidelity note 19), as the server
   * read them off the yards at attack start. None, or a side without any,
   * fights exactly as it did before the boosts existed. A wild raid's
   * attacker never has any.
   */
  readonly buffs?: BattleBuffs;
  /**
   * The attacker's Siege Lab levels per weapon (Inferno WP 6.5 to 6.7): what a
   * `siege` event fights at. An absent weapon, or none at all, is level 0,
   * and its event is ignored, so a log from before the Decoy replays as it did.
   */
  readonly siege?: Readonly<Partial<Record<SiegeId, number>>>;
  /**
   * The Descent yard fought, 1 to 13 (Inferno WP 1.21): from yard 7 its burn
   * takes health from every surface monster (`descentBurn.ts`). Absent for
   * any fight outside the Descent, which then burns nothing.
   */
  readonly descentYard?: number;
}

/**
 * The boosts one side's shop items give it in a battle (fidelity note 19):
 * Tower Overdrive (`TOD`), Monster Overdrive (`MOD`), the Monster Defensive
 * Buff (`MDOD`) and the Monster Speed Buff (`MSOD`). Each is on or absent.
 */
export interface SideBuffs {
  /** Tower Overdrive: the side's towers do {@link TOWER_OVERDRIVE} times the damage. */
  readonly towerDamage?: boolean;
  /** Monster Overdrive: its monsters do {@link MONSTER_OVERDRIVE} times the damage. */
  readonly monsterDamage?: boolean;
  /** Monster Defensive Buff: its monsters take {@link MONSTER_ARMOUR_BUFF} off every hit. */
  readonly monsterArmour?: boolean;
  /** Monster Speed Buff: its monsters walk and swing {@link MONSTER_SPEED_BUFF} times as fast. */
  readonly monsterSpeed?: boolean;
}

/** Each side's boosts ({@link SideBuffs}); the attacker's towers never fire. */
export interface BattleBuffs {
  readonly attacker?: SideBuffs;
  readonly defender?: SideBuffs;
}

/** Tower Overdrive's damage multiplier (`BUILDING20.as:29-31`). */
export const TOWER_OVERDRIVE = 1.25;
/** Monster Overdrive's damage multiplier (`MonsterDust.k_value`). */
export const MONSTER_OVERDRIVE = 1.25;
/**
 * The Monster Defensive Buff's armour: the share of each hit shrugged off
 * (`BeastMode.k_value`).
 */
export const MONSTER_ARMOUR_BUFF = 0.3;
/** The Monster Speed Buff's move and swing multiplier (`HyperSpeed.k_value`). */
export const MONSTER_SPEED_BUFF = 1.5;

/** The champion a Champion Cage holds, as the defender's save keeps it (issue #195). */
export interface DefenderChampion {
  /** The champion type, `t` in the save (`G{t}`). */
  readonly t: number;
  /** Its level, `l`. */
  readonly l: number;
  /** The health it has now, which is what it comes out with. */
  readonly hp: number;
  /** Its power level, `pl`, 0 to 3, which gates its abilities. */
  readonly pl?: number;
  /** Its food-bonus rank, `fb`, 0 to 3, which picks its `bonus*` stats. */
  readonly fb?: number;
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
  /** The tick of its first shot, or null while it has not fired (issue #22). */
  firstShotTick: number | null;
  /** The tick it fell, or null while it stands (issue #22). */
  destroyedTick: number | null;
}

/** What one trap that went off did (issue #22). */
export interface TrapReport {
  readonly id: number;
  readonly type: number;
  /** The tick it went off. */
  readonly tick: number;
  /** Health it removed from creeps, attackers or not. */
  damageDealt: number;
  kills: number;
}

/**
 * What one bunker's garrison did (issue #22): the defenders it sent out, the
 * health they took off attackers and the attackers they finished. A creep a
 * defender leaves behind (a Slimeattikus Mini, a zombie) fights for nobody's
 * tally.
 */
export interface BunkerReport {
  readonly id: number;
  readonly level: number;
  sent: number;
  damageDealt: number;
  kills: number;
  /** The tick it fell, or null while it stands. */
  destroyedTick: number | null;
}

/** What one caged champion did once out (issues #22, #310), its flame included. */
export interface DefenderChampionReport {
  /** The champion type, as {@link DefenderChampion.t}. */
  readonly t: number;
  /**
   * Its health (issue #195): what it came out with less what it took, 0 when
   * it died, its stored health when it never came out.
   */
  hp: number;
  damageDealt: number;
  kills: number;
}

/**
 * One attacking monster type, or one champion, over the battle (issue #22).
 * Monsters are one row per monster id; each champion is its own row.
 */
export interface AttackerReport {
  /** The monster id, `C1`..`C19`, or the champion's `G1`..`G5`. */
  readonly monsterId: string;
  readonly champion: boolean;
  readonly level: number;
  /** Flung by the attacker. */
  sent: number;
  /** Born on the field rather than flung: Slimeattikus Minis and zombies. */
  spawned: number;
  /** Died, an Eye-ra's own blast included; one that walked home is not lost. */
  lost: number;
  /** Health it took off buildings, after fortification. */
  buildingDamage: number;
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
  /** Each trap that went off, in the order they did (issue #22). */
  readonly traps: readonly TrapReport[];
  /** Each bunker on the field at the start, by id (issue #22). */
  readonly bunkers: readonly BunkerReport[];
  /**
   * Each caged champion's health and tally (issues #22, #195, #310), in the
   * order {@link BattleOptions.defenderChampions} gave them; empty when there
   * is none to defend.
   */
  readonly defenderChampions: readonly DefenderChampionReport[];
  /** Every attacker row: monsters by id, then champions in the order flung (issue #22). */
  readonly attackers: readonly AttackerReport[];
  /**
   * What each attacking champion learned (issue #219, `brain.ts`), in the
   * order they were flung; present only for a battle run with
   * {@link BattleOptions.learn}. Not a checkpoint value.
   */
  readonly lessons?: readonly ChampionLesson[];
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
  /** Korath's flame (issue #222) or the Descent burn (Inferno WP 1.21) is on it. */
  readonly burning?: boolean;
  /** Inside Fomor's enrage aura: faster, and harder to hurt. */
  readonly enraged?: boolean;
  /** Under a putty bomb's boost: drawn with a pink glow. */
  readonly puttied?: boolean;
  /** Inside Krallen's loot aura. */
  readonly lootBoosted?: boolean;
  /** Korath standing in his quake. */
  readonly quaking?: boolean;
  /** Its Monster Lab rank, 1 to 3; absent at rank 0 (issue #352). */
  readonly rank?: number;
  /** A Brain that cannot be targeted: drawn see-through (issue #352). */
  readonly invisible?: boolean;
  /** A Wormzer tunnelling: drawn as nothing but its dirt, and untargetable. */
  readonly burrowed?: boolean;
  /** A Bolt in mid-blink, flickering and untargetable (issue #352). */
  readonly blinking?: boolean;
  /** Fang's venom stacks on it; absent when it is not poisoned (issue #352). */
  readonly poisonStacks?: number;
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
      /**
       * The Railgun's beam (issue #261): the line it hurt along, from its
       * muzzle to 1,600 screen px on, in yard units. Absent for other towers.
       */
      readonly beam?: BeamLine;
      /**
       * The Laser's beam (issue #267): from its origin, below the tower, to
       * the target's point when it fired, in yard units. The beam sweeps on
       * from there for {@link LASER_TICKS} ticks ({@link laserSweep},
       * {@link laserEnd}); its pulses arrive as `hurt`s. Absent for other towers.
       */
      readonly sweep?: BeamLine;
      /**
       * A Spurtz Cannon's shell (issue #313): from its muzzle to the ground
       * point it goes off at, in yard units, landing on `landTick`. It hurts
       * whatever is round it then, not `creepId`, which is only what the
       * barrel aimed at. Absent for other towers.
       */
      readonly lob?: LobLine;
    }
  | {
      /** A Tesla Tower began to charge (issue #266); its zaps follow as shots. */
      readonly kind: "charge";
      readonly tick: number;
      readonly towerId: number;
    }
  | {
      /**
       * A Tesla Tower stopped zapping and winds down (drawing only). `rearmBy`
       * is the latest tick its next charge can begin if a target is still in
       * reach, its charge spent; null when it stopped for want of a target.
       */
      readonly kind: "coilRest";
      readonly tick: number;
      readonly towerId: number;
      readonly rearmBy: number | null;
    }
  | {
      /**
       * A Monster Bunker's door opens or shuts (drawing only), as the Flash
       * one's `TickFast` drove it (`BUILDING22.as:433-455`).
       */
      readonly kind: "bunkerDoor";
      readonly tick: number;
      readonly buildingId: number;
      readonly open: boolean;
    }
  | {
      /** A bunker sent a monster out: a Monster Bunker's shutters roll up (drawing only). */
      readonly kind: "release";
      readonly tick: number;
      readonly buildingId: number;
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
      /**
       * A ranked splash went off (issue #352): a Fink's, Wormzer's or Bandito's
       * swing, or a Project X's death blast, `moveId` the monster's id; or an
       * Eye-ra's blast, ranked or not. Round the striker's yard point, `radius`
       * screen px; `hits` is how many it reached.
       */
      readonly kind: "splash";
      readonly tick: number;
      readonly creepId: number;
      readonly moveId: string;
      readonly ix: number;
      readonly iy: number;
      readonly radius: number;
      readonly hits: number;
    }
  | {
      /** A Bolt hopped (issue #352): `hop` of {@link BLINK_HOPS}, now at `ix`, `iy`. */
      readonly kind: "blink";
      readonly tick: number;
      readonly creepId: number;
      readonly hop: number;
      readonly ix: number;
      readonly iy: number;
    }
  | {
      /** A Teratorn's fireball jumped between buildings (issue #352), yard points. */
      readonly kind: "bounce";
      readonly tick: number;
      readonly creepId: number;
      readonly fromBuildingId: number;
      readonly toBuildingId: number;
      readonly fromIx: number;
      readonly fromIy: number;
      readonly toIx: number;
      readonly toIy: number;
      /** Health the jump took off, after fortification. */
      readonly amount: number;
    }
  | {
      /** Korath's quake landed (issue #222): a ring on the ground, `radius` screen px. */
      readonly kind: "quake";
      readonly tick: number;
      readonly creepId: number;
      readonly ix: number;
      readonly iy: number;
      readonly radius: number;
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

/** A beam's line, yard units at both ends. */
export interface BeamLine {
  readonly fromIx: number;
  readonly fromIy: number;
  readonly toIx: number;
  readonly toIy: number;
}

/**
 * A Spurtz Cannon shell's flight (issue #313): a {@link BeamLine} from the
 * muzzle to where it goes off, when it does, and its graphic's scale, which
 * sizes its blast ({@link spurtzBlastRadius}) and the Spurtz it may hatch.
 */
export interface LobLine extends BeamLine {
  readonly landTick: number;
  readonly scale: number;
}

/**
 * The siege weapon on the field (Inferno WP 6.8), for the renderer and the
 * attack screen's siege button. Reads only; the battle is unchanged by it.
 */
export interface SiegeSnapshot {
  /** The weapon holding Flash's one siege slot (`SiegeWeapons.activeWeaponID`), or null. */
  readonly active: SiegeId | null;
  /** The Decoy until it blows up: its drop point in yard units and its clock. */
  readonly decoy: {
    readonly x: number;
    readonly y: number;
    readonly droppedAt: number;
    readonly landsAt: number;
    readonly explodesAt: number;
    readonly range: number;
  } | null;
  /** The Vacuum's hose until it lets go: the building it hangs over and its health. */
  readonly vacuum: {
    readonly buildingId: number;
    readonly droppedAt: number;
    readonly endsAt: number;
    readonly health: number;
    readonly durability: number;
    /** The resource its last frame took (1-4), for the balls drawn up it; null when none. */
    readonly took: number | null;
  } | null;
  /**
   * Every jar still on a tower, its strip included: `health` is null before
   * it lands and once it breaks; `frame` is its cell of the 23-cell strip.
   */
  readonly jars: readonly {
    readonly buildingId: number;
    readonly landsAt: number;
    readonly frame: number;
    readonly breaking: boolean;
    readonly health: number | null;
    readonly durability: number;
  }[];
}

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
  /** The siege weapon on the field right now (Inferno WP 6.8); a fresh copy per call. */
  siege(): SiegeSnapshot;
}

/* ── Internals ────────────────────────────────────────────────────────────── */

/** `decoy`: a defender the Decoy holds ({@link BattleOptions.siege}). */
type Behaviour = "attack" | "defend" | "bunker" | "heal" | "retreat" | "decoy";

/** A building an Eye-ra's blast reached, and the health it took. */
type BlastHit = readonly [EngineBuilding, number];

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
  /**
   * `_movement == "burrow"` (Wormzer): it tunnels while it is not swinging
   * ({@link tickBurrow}), and underground it is `invisible`.
   */
  burrows: boolean;
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
  /**
   * The Spurtz Cannon that hatched it (issue #313), by building id, or -1.
   * Such a Spurtz fights as Flash's does rather than by the bunker rules.
   */
  hatchedBy: number;
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
  /* What issue #222's champion abilities need; every other creep keeps the defaults. */
  /** A champion's power level as its class reads it (`championPower`), else 0. */
  power: number;
  /** A champion's `_frameNumber`: drawn at spawn, one up per tick, 0 again when Korath quakes. */
  frame: number;
  /** Korath's `_attackNum`: swings since his last quake. */
  hits: number;
  /** Its Monster Lab rank, 0 to 3 (issue #352); 0 is the plain monster. */
  rank: number;
  /** Wormzer's `m_lastTarget`: its last splash's target ({@link splashKey}); -1 for none. */
  lastSplash: number;
  /**
   * A Brain that is cloaked or a Wormzer underground: it carries
   * `TARGETS_INVISIBLE` in `flags` (issue #352).
   */
  invisible: boolean;
  /** The tick a cloaked, arrived Brain shows itself; -1 until it has arrived. */
  cloakEnds: number;
  /** Hops a Bolt's blink has left; 0 when it is not blinking. */
  blinkHops: number;
  /** The screen px each hop covers. */
  blinkStep: number;
  /** Fang's venom: stacks on this creep, 0 when it is not poisoned. */
  venomStacks: number;
  /** Damage one stack does a bite (the first Fang's, as `DOTEffect` keeps `_initialDPS`). */
  venomDps: number;
  /** Ticks since the last bite of the venom. */
  venomTick: number;
  /** The Fang that poisoned it, or null; credits the venom's kills. */
  venomBy: Creep | null;
  /** Korath standing in his quake. */
  quaking: boolean;
  /** The flame on this creep, per {@link FLAME_INTERVAL} ticks; 0 when it is not burning. */
  burnDps: number;
  /** The flame's `_curTick`. */
  burnTick: number;
  /** The creep that lit the flame, or null; read only by the report (issue #22). */
  burnBy: Creep | null;
  /** An enraged creep's speed and swing-rate multiplier; 1 when it is not enraged. */
  enrage: number;
  /** Its armour: what share of each hit it shrugs off; 0 for all but the enraged. */
  armour: number;
  /** The Fomor whose aura enraged it, by creep id, or -1. */
  enragedBy: number;
  /** Putty boost: speed and swing-rate multiplier, 1 without one; apart from `enrage`. */
  puttySpeed: number;
  /** A putty bomb's armour share; 0 without one. */
  puttyArmour: number;
  /** The tick the putty boost ends on; 0 when there is none. */
  puttyUntil: number;
  /** What Krallen's aura adds to its looting property; 0 when it is not in it. */
  lootBonus: number;
  /** The Krallen whose aura it is in, by creep id, or -1. */
  lootBuffedBy: number;
  /** A Fomor's or a Krallen's aura, with the creeps it is holding; null for the rest. */
  aura: Aura | null;
  /** Fomor following a wounded ally (`k_sBHVR_BUFF`) rather than attacking. */
  support: boolean;
  /** The ally it follows (`_helpCreep`), by creep id, or -1. */
  helpCreep: number;
  /** `_hasTarget` while it follows one. */
  hasHelpTarget: boolean;
  /** A flying Fomor's waypoint is its ally's own point, which moves with it. */
  followHelper: boolean;
  /** Where a champion walks back to when it leaves (`_spawnPoint`, `ChampionBase.as:115`). */
  spawnX: number;
  spawnY: number;
  /** A defender with nobody to fight, walking home or waiting there (Flash's `cage`). */
  homing: boolean;
  /**
   * A flying champion's `_looking`: `findTarget` sets it and, for a flyer,
   * nothing but a defender's aggro clears it (`ChampionBase.as:569`, `:903`),
   * so its own 100-frame look never runs (`:804`).
   */
  looking: boolean;
  /**
   * A defending burrower walking up to a foe it took within
   * {@link DEFEND_SURFACE_SQUARED}: Flash's `_doDefenseBurrow` false
   * (`CreepBase.as:580-585`), so it stays above ground on that chase.
   */
  surfaceChase: boolean;
  /**
   * An attacking champion's Mode as weights (issue #220, `stance.ts`); null
   * for every other creep and for a Hybrid champion, which picks as Flash's.
   */
  weights: StanceWeights | null;
}

/** A {@link ChampionLesson} as the battle builds it (issue #219). */
interface LessonRecord {
  readonly t: number;
  readonly monsterId: string;
  picks: number;
  readonly credit: Record<BrainKey, number>;
  dealt: number;
  /** Its damage per tick at full swing, as flung. */
  readonly perTick: number;
  readonly flungAt: number;
  /** When it left the field alive (called back, walked home), or null. */
  leftAt: number | null;
  readonly startHp: number;
}

/** An aura's own state: `AOEEnrage`'s counter and list, or `ProximityLootBuff`'s list. */
interface Aura {
  /** `m_rangeCheckCounter`; Krallen's aura goes by her frame instead. */
  counter: number;
  /** The creeps it holds, in the order it took them. */
  members: Creep[];
}

/** What every creep starts with for issue #222's abilities. */
const NO_ABILITIES = {
  power: 0,
  frame: 0,
  hits: 0,
  rank: 0,
  lastSplash: -1,
  invisible: false,
  cloakEnds: -1,
  blinkHops: 0,
  blinkStep: 0,
  venomStacks: 0,
  venomDps: 0,
  venomTick: 0,
  venomBy: null,
  quaking: false,
  burnDps: 0,
  burnTick: 0,
  burnBy: null,
  enrage: 1,
  armour: 0,
  enragedBy: -1,
  puttySpeed: 1,
  puttyArmour: 0,
  puttyUntil: 0,
  lootBonus: 0,
  lootBuffedBy: -1,
  aura: null,
  support: false,
  helpCreep: -1,
  hasHelpTarget: false,
  followHelper: false,
  spawnX: 0,
  spawnY: 0,
  homing: false,
  looking: false,
  surfaceChase: false,
  weights: null,
} as const;

interface DefenderHome {
  readonly ix: number;
  readonly iy: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly leash: number;
}

/** The caged champion in its cage (issue #260): where it stands, and what it looks for. */
interface CagePen {
  readonly ix: number;
  readonly iy: number;
  /** {@link rangePointOf} the above, which it looks from. */
  readonly x: number;
  readonly y: number;
  /** Its `_frameNumber`, which goes on counting in there. */
  frame: number;
  readonly flying: boolean;
  readonly hitFlags: number;
}

/** One champion the cage holds (issue #310), from its supply to the end of the battle. */
interface CageSlot {
  readonly caged: DefenderChampion;
  /** The champion once it has first come out, whether in its cage or not. */
  champion: Creep | null;
  /** Where it waits while it is in its cage; null while it is out (issue #260). */
  pen: CagePen | null;
  /** Its health and report tally (issue #22). */
  readonly report: DefenderChampionReport;
}

interface Tower {
  readonly building: EngineBuilding;
  readonly report: TowerReport;
  /** What it reaches, in yard units, the cell's height applied (`towerRange`). */
  readonly range: number;
  fireTick: number;
  targets: number[];
  /** Its `_frameNumber`, counted every tick from the start of the battle. */
  frame: number;
  /**
   * Its `_fireStage`. The Aerial Defense's: 1 while it reloads, 2 while it
   * fires a salvo. The Tesla's: 0 idle, 1 charging, 2 zapping, 3 winding down.
   * The Quake Tower's: 0 idle, 1 winding up.
   */
  stage: number;
  /** Shots fired in the salvo under way, or zaps in the charge. */
  shotsFired: number;
  /** The creep the Tesla's zaps go at, its `_laserTarget`; -1 for none. */
  zapTarget: number;
  /** The Tesla's strip cell, `_animTick`, which times its charge and wind-down. */
  charge: number;
  /** A Spurtz Cannon's gun (issue #313); null for every other tower. */
  gun: SpurtzGun | null;
  /**
   * A Quake Tower's own `_frameNumber`, counted only while it winds up
   * ({@link QUAKE_TOWER_TYPE}); its wind-up is `stage` 1 and its strip cell
   * `charge`.
   */
  quakeFrame: number;
  /** `_targetVacuum`: it fires at the Vacuum's hose (Inferno WP 6.6). */
  onHose: boolean;
}

/**
 * One tower's Candy Jar (Inferno WP 6.7, `BTOWER._jarHealth`,
 * `_jarAnimation`). `health` is null while it falls and once it is broken;
 * `breaking` is its strip playing on from `frame` (`KillJar`).
 */
interface Jar {
  readonly building: EngineBuilding;
  readonly landsAt: number;
  readonly durability: number;
  health: number | null;
  frame: number;
  breaking: boolean;
}

/** A Spurtz Cannon's barrel, aim and brood (issue #313, `SpurtzCannon.as`). */
interface SpurtzGun {
  /** `_barrelRotation`, degrees. */
  barrel: number;
  /** `_angleToTarget`, degrees. */
  aim: number;
  /** `_targetCreeps`, nearest first; a creep stays in it after it dies. */
  targets: Creep[];
  /** `_targetCreepIndex`. */
  index: number;
  /** `_target`, or null. */
  target: Creep | null;
  /** `_spurts`: the Spurtz it hatched, while they live. */
  readonly hatched: Creep[];
}

/** A Spurtz Cannon's shell in the air (issue #313), a `FIREBALL` at a point. */
interface SpurtzShell {
  readonly tower: Tower;
  /** Where it is, on screen. */
  x: number;
  y: number;
  /** The point it was fired at, on screen. */
  readonly toX: number;
  readonly toY: number;
  /** Its move a loop, on screen: half its `speed` along its heading. */
  readonly stepX: number;
  readonly stepY: number;
  /** That move's length, `_maxSpeed * _acceleration`. */
  readonly step: number;
  /** Its `_maxSpeed`: it lands once what is left is within this. */
  readonly speed: number;
  /** `int(damage * scale)`, fixed when it was fired. */
  readonly damage: number;
  /** Its graphic's scale, which sizes the blast. */
  readonly scale: number;
}

/** A Laser Tower's beam still sweeping (issue #267), `LASER` in Flash. */
interface LaserBeam {
  readonly tower: Tower;
  readonly sweep: LaserSweep;
  /** `int(damage * scale)`, fixed when it was fired. */
  readonly damage: number;
  readonly splash: number;
  /** `_duration`, loops it has swept. */
  duration: number;
  /** `_frameNumber`, which times its pulses. */
  frame: number;
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
  /** Whether its door is open, for the drawing ({@link BattleVisualEvent} `bunkerDoor`). */
  doorOpen: boolean;
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
 * How far around itself the caged champion looks for an attacker, in cartesian
 * units: `getTargetCreeps` (`ChampionBase.as:500-502`, `Korath.as:117-124`).
 */
export const CHAMPION_DEFEND_SCAN = 800;

/** Its frames between looks in its cage or on the way back (`ChampionBase.as:1055`, `:1134`). */
export const CAGE_LOOK_FRAMES = 200;

/** Its frames between looks while it chases a foe it is not yet hitting (`ChampionBase.as:879`). */
export const CHASE_LOOK_FRAMES = 60;

/** The Champion Cage's building type (`CHAMPIONCAGE`, `YARD_PROPS.as:5993`). */
const CHAMPION_CAGE_TYPE = 114;

/** How far a defender looks for an attacker to chase (`CreepBase.as:1531-1556`). */
const DEFEND_SEARCH = 400;

/**
 * A defending burrower that takes a fresh foe closer than this (120 screen
 * px, squared) walks up to it instead of tunnelling (`CreepBase.as:580-585`).
 */
const DEFEND_SURFACE_SQUARED = 14400;

/** The reach a creep fights another at: its range, and never less than `DEFENSE_RANGE_SQUARED`. */
const creepReach = (range: number): number => Math.max(range * range, 2500);

/**
 * Two creeps this close, 50 screen px squared, fight with walls between them:
 * a defender that reaches an attacker sets it on (`CreepBase.as:1111`).
 */
const CLOSE_FIGHT_SQUARED = 2500;

/**
 * The creeps one can fight (issue #195): the other side, on the ground, and in
 * the air too unless it is a ground creep that swings in melee.
 */
const fightFlags = (friendly: boolean, flying: boolean, range: number): number =>
  (friendly ? TARGETS_ATTACKERS : TARGETS_DEFENDERS) |
  TARGETS_GROUND |
  (flying || range > 1 ? TARGETS_FLYING : 0);

/**
 * A champion's {@link fightFlags}, narrowed: only a ranged champion can hit a
 * flyer (`ChampionBase.canShootCreep`, `:404-409`; `Fomor.as:19`), and Korath
 * once he has his fireball (`Korath.as:117-133`). `power` is as its class reads it.
 */
const championReach = (id: string, level: number, power: number, flags: number): number => {
  let reach = flags;
  if (championMode(id, "attack", level) !== "ranged") reach &= ~TARGETS_FLYING;
  if (hasFireball(id, level, power)) reach |= TARGETS_FLYING;
  return reach;
};

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

/** Monster ids in reading order: by prefix, then by number, so `C2` comes before `C10`. */
const compareIds = (one: string, other: string): number => {
  const prefixOne = one.replace(/\d+$/, "");
  const prefixOther = other.replace(/\d+$/, "");
  if (prefixOne !== prefixOther) return prefixOne < prefixOther ? -1 : 1;
  return Number(one.slice(prefixOne.length)) - Number(other.slice(prefixOther.length));
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
  /** Spurtz Cannon shells in the air, in the order fired (issue #313, `FIREBALLS`). */
  const spurtzShells: SpurtzShell[] = [];
  /** Spurtz hatched this step, on their feet at its end: screen points, whole. */
  const pendingSpurtz: Array<{ readonly tower: Tower; readonly x: number; readonly y: number }> =
    [];
  const firedTraps: number[] = [];
  const destroyedIds: number[] = [];
  /*
   * The report's tallies (issue #22). Outputs only: nothing the battle decides
   * reads them, and they are in neither a checkpoint nor the digest.
   */
  const trapReports: TrapReport[] = [];
  const bunkerReports = new Map<number, BunkerReport>();
  const towerReports = new Map<number, TowerReport>();
  /** Monster rows by monster id, champion rows in the order flung. */
  const monsterRows = new Map<string, AttackerReport>();
  const championRows: AttackerReport[] = [];
  /** Each attacker's row, by creep id. */
  const attackerRowOf = new Map<number, AttackerReport>();
  /** Shots, hits, hurts and deaths for the renderer, pruned each step; not simulation state. */
  const visual: BattleVisualEvent[] = [];

  const loot: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const defenderLoss: ResourceAmounts = { r1: 0, r2: 0, r3: 0, r4: 0 };

  let tick = 0;
  /** How many creeps carry a putty boost; lets the tick skip the scan. */
  let puttied = 0;
  /*
   * Each side's shop boosts (fidelity note 19). A creep is the defender's when
   * it is friendly; a wild raid's raiders have none of the player's.
   */
  const attackerBuffs: SideBuffs = (options.raid ? undefined : options.buffs?.attacker) ?? {};
  const defenderBuffs: SideBuffs = options.buffs?.defender ?? {};
  const buffsOf = (creep: Creep): SideBuffs => (creep.friendly ? defenderBuffs : attackerBuffs);
  /** Tower Overdrive on the defender's towers' damage, 1 without it. */
  const towerBoost = defenderBuffs.towerDamage ? TOWER_OVERDRIVE : 1;
  /** Monster Overdrive (`MonsterDust.as`), on a creep as it joins the field. */
  const boostDamage = (creep: Creep): void => {
    if (buffsOf(creep).monsterDamage) creep.damage *= MONSTER_OVERDRIVE;
  };
  let nextCreepId = 1;
  let creepsFlung = 0;
  let creepsKilled = 0;
  let championHp: number | null = null;
  const championsHp: Record<string, number> = {};
  /** Each attacking champion's lesson as it builds, by creep id; empty unless `learn`. */
  const lessons = new Map<number, LessonRecord>();
  /**
   * Whether this battle has a defence at all; without one no fight-back code
   * runs (issue #195). A Spurtz Cannon is one, for the Spurtz it hatches (#313).
   */
  const defended =
    (options.defenderChampions?.length ?? 0) > 0 ||
    Object.keys(options.bunkers ?? {}).length > 0 ||
    yard.buildings.some((building) => isSpurtzCannon(building.type));
  let finished = false;
  let retreated = false;
  const raid = options.raid === true;

  // A raid has no countdown, only its cap (fidelity note 17).
  const countdown = raid
    ? Number.POSITIVE_INFINITY
    : ticks(options.declareWar === true ? DECLARE_WAR_COUNTDOWN_SECONDS : ATTACK_COUNTDOWN_SECONDS);
  const retreatAt = raid ? ticks(RAID_MAX_SECONDS) : countdown + ticks(RETREAT_GRACE_SECONDS);
  // Every wave must have landed, not only the field be empty (fidelity note 17).
  const raidSpawnsUntil = options.raidSpawnsUntil ?? 0;
  const playerLevel = options.playerLevel ?? 20;
  const storageHitScalar = storageScalar(yard.kind);
  const wildMonsterAttack = isWildMonsterAttack(yard.kind);
  // The Descent burn's share of full health a burn (Inferno WP 1.21); 0 burns nothing.
  const descentBurn = descentBurnShare(options.descentYard);

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
      bunkers.push({ building, pool, dispatched: 0, tickNumber: 0, doorOpen: false });
      bunkerReports.set(building.id, {
        id: building.id,
        level: building.level,
        sent: 0,
        damageDealt: 0,
        kills: 0,
        destroyedTick: null,
      });
      continue;
    }
    // `BTOWER.canAttack` (`:159-161`): a tower being built, upgraded or fortified is silent.
    if (building.busy) continue;
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
        firstShotTick: null,
        destroyedTick: null,
      },
      // `Props()` seeds the fire tick with `rate`, not `rate * 2` (`BTOWER.as:112`).
      fireTick: stats.rate ?? 0,
      targets: [],
      frame: 0,
      // `BUILDING115.as:34`, `BUILDING25.as:32`.
      stage: building.type === AERIAL_DEFENSE_TYPE ? 1 : 0,
      shotsFired: 0,
      zapTarget: -1,
      charge: 0,
      gun: isSpurtzCannon(building.type)
        ? { barrel: 0, aim: 0, targets: [], index: 0, target: null, hatched: [] }
        : null,
      quakeFrame: 0,
      onHose: false,
    });
  }

  for (const tower of towers) towerReports.set(tower.building.id, tower.report);

  /** Laser beams still sweeping, oldest first; each outlives its tower (`LASERS.as`). */
  const laserBeams: LaserBeam[] = [];

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

  /** The supplied caged champions with health to come out with (issue #310). */
  const cagedWithHealth = (options.defenderChampions ?? []).filter((caged) => caged.hp > 0);
  /**
   * The Champion Cage and the champions it holds (issues #195, #310): the
   * first cage by id, and only when a champion was supplied for it.
   */
  const cage =
    cagedWithHealth.length > 0
      ? (yard.buildings
          .filter((building) => building.type === CHAMPION_CAGE_TYPE)
          .sort((one, other) => one.id - other.id)[0] ?? null)
      : null;
  /** One slot per caged champion, in the order supplied; their pens are set below. */
  const cageSlots: CageSlot[] = cage
    ? cagedWithHealth.map((caged) => ({
        caged,
        champion: null,
        pen: null,
        report: { t: caged.t, hp: cagedHealth(caged), damageDealt: 0, kills: 0 },
      }))
    : [];
  /** The slot of a caged champion's creep, or undefined for any other creep. */
  const cageSlotOf = (creep: Creep): CageSlot | undefined => {
    for (const slot of cageSlots) if (slot.champion === creep) return slot;
    return undefined;
  };
  /**
   * Where it walks back to: `changeModeCage` paths to the cage's anchor plus
   * (50, 60) on screen (`ChampionBase.as:299-301`), in yard units.
   */
  const cageDoor: Cart | null = cage
    ? { x: cage.sy + 60 + (cage.sx + 50) / 2, y: cage.sy + 60 - (cage.sx + 50) / 2 }
    : null;
  /** Defenders on the field as this step's creeps move; attackers skip the scan when none is. */
  let defendersOut = 0;

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

  /**
   * `MonsterBase.lootingMultiplier`: the looting property with Krallen's aura
   * on it (`LootingMultiplier`, issue #222), which adds rather than multiplies.
   */
  const lootOf = (creep: Creep): number =>
    creep.lootBonus > 0 ? creep.lootMultiplier + creep.lootBonus : creep.lootMultiplier;

  /**
   * `multiplier` is the hitter's looting property, or 1 when the hit came from
   * something that is not a monster: a fallen building's own fall, and a
   * projectile or a blast that lands as a `DummyTarget` (issue #222).
   */
  const takeLoot = (building: EngineBuilding, amount: number, multiplier: number): void => {
    if (amount <= 0 || !isLootable(building.type)) return;
    if (STORAGE_TYPES.includes(building.type)) {
      const picked = pickStored();
      if (picked === null) return;
      const key = `r${picked}` as keyof ResourceAmounts;
      const wanted = Math.trunc(amount * multiplier);
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
    const wanted = Math.trunc(amount * multiplier);
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
    const fallen = towerReports.get(building.id) ?? bunkerReports.get(building.id);
    if (fallen) fallen.destroyedTick = tick;
    if (building.type === HOUSING_BUNKER_TYPE) housingBunkerFalls(building.id);
    if (byAttacker) {
      // The client empties a harvester when it falls (`BRESOURCE.as:129-134`).
      if (building.stored > 0) takeLoot(building, building.stored, 1);
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
   *
   * `byAttacker` is a blow with an attacker behind it: one by a creep, or the
   * Decoy's from a `DummyTarget`, which loots and fells like a creep's.
   */
  const damageBuilding = (
    building: EngineBuilding,
    raw: number,
    creep: Creep | null,
    lootMultiplier = creep ? lootOf(creep) : 1,
    byAttacker = creep !== null,
  ): number => {
    if (building.hp <= 0 || raw <= 0) return 0;
    const dealt = fortifiedDamage(raw, building.fortification, 0);
    const applied = Math.min(dealt, building.hp);
    if (creep) {
      const row = attackerRowOf.get(creep.id);
      if (row) row.buildingDamage += applied;
    }
    if (creep && lessons.size > 0) {
      const lesson = lessons.get(creep.id);
      if (lesson) lesson.dealt += applied;
    }
    building.hp -= dealt;
    if (building.hp > 0) {
      if (byAttacker) takeLoot(building, dealt, lootMultiplier);
      return applied;
    }
    // The killing hit on storage still makes the pick it made before issue
    // #167 and throws it away, so the random stream every later bunker pick
    // reads is the one it was, and the fall changes the loot and nothing else.
    if (byAttacker && STORAGE_TYPES.includes(building.type)) pickStored();
    destroy(building, byAttacker);
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

  /**
   * The report's credit for a defender's blow (issue #22): to the bunker that
   * sent it or to the caged champion. Nobody else's blows are tallied here;
   * towers and traps keep their own.
   */
  const creditDefender = (striker: Creep, applied: number, killed: boolean): void => {
    let tally: { damageDealt: number; kills: number } | null | undefined = null;
    if (striker.homeBunker >= 0) tally = bunkerReports.get(striker.homeBunker);
    else if (striker.champion) tally = cageSlotOf(striker)?.report;
    // A hatched Spurtz's work goes on its cannon's row (issue #313).
    else if (striker.hatchedBy >= 0) tally = towerReports.get(striker.hatchedBy);
    if (!tally) return;
    tally.damageDealt += applied;
    if (killed) tally.kills += 1;
  };

  /**
   * An attacker joins its report row (issue #22): its monster id's, or a row
   * of its own for a champion. `flung` says whether the attacker flung it.
   */
  const joinRow = (creep: Creep, flung: boolean): void => {
    if (creep.friendly) return;
    let row = creep.champion ? undefined : monsterRows.get(creep.monsterId);
    if (!row) {
      row = {
        monsterId: creep.monsterId,
        champion: creep.champion,
        level: creep.level,
        sent: 0,
        spawned: 0,
        lost: 0,
        buildingDamage: 0,
      };
      if (creep.champion) championRows.push(row);
      else monsterRows.set(creep.monsterId, row);
    }
    if (flung) row.sent += 1;
    else row.spawned += 1;
    attackerRowOf.set(creep.id, row);
  };

  /** An attacker's death on its report row (issue #22). */
  const countLost = (creep: Creep): void => {
    const row = attackerRowOf.get(creep.id);
    if (row) row.lost += 1;
  };

  /**
   * `by` is who the blow turns (issue #195); `striker` is who dealt it, for
   * the report (issue #22), and is the same creep wherever a creep strikes.
   */
  const damageCreep = (
    creep: Creep,
    raw: number,
    by: Creep | null = null,
    striker: Creep | null = null,
  ): number => {
    if (creep.hp <= 0) return 0;
    // A defender's blow turns the attacker on it (issue #195), and its aggro
    // ends a flying champion's look (`ChampionBase.as:903`, issue #222).
    if (by && by.friendly && !creep.friendly) {
      creep.provokedBy = by.id;
      creep.looking = false;
    }
    // An enraged creep's armour, `1 - armor` off every hit (issue #222).
    // A putty boost is its own armour; the two combine as 1-(1-a)(1-b).
    if (creep.armour > 0) raw *= 1 - creep.armour;
    if (creep.puttyArmour > 0) raw *= 1 - creep.puttyArmour;
    // The Monster Defensive Buff is armour of its own too (`BeastMode.as`).
    if (buffsOf(creep).monsterArmour) raw *= 1 - MONSTER_ARMOUR_BUFF;
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
    const killed = creep.hp <= 0;
    if (killed) {
      creep.hp = 0;
      creep.gone = true;
      if (!creep.friendly) {
        creepsKilled += 1;
        countLost(creep);
      }
      recordDeath(creep);
      onDeath(creep);
    }
    if (striker && striker.friendly && !creep.friendly) creditDefender(striker, applied, killed);
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
    if (creep.rank > 0 && creep.monsterId === PROJECT_X_ID) projectXBlast(creep);
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
      joinRow(mini, false);
    }
  };

  /** Splits waiting for the end of the step (issue #129). */
  const bornAtStepEnd = (): void => {
    const waiting = pendingSplits.splice(0);
    for (const { parent, count } of waiting) splitOnDeath(parent, count);
    const risen = pendingZombies.splice(0);
    for (const { corpse, raiser } of risen) raise(corpse, raiser);
    const hatching = pendingSpurtz.splice(0);
    for (const { tower, x, y } of hatching) hatchSpurtz(tower, x, y);
  };

  /**
   * `spawnSpurtzAt` (`SpurtzCannon.as:246-253`, issue #313): a Spurtz where a
   * shell landed, a disposable defender at the defender's level for it, that
   * looks for its foe at once. `CREATURES.Spawn` files no report row for it.
   */
  const hatchSpurtz = (tower: Tower, screenX: number, screenY: number): void => {
    const gun = tower.gun;
    if (!gun) return;
    const spurtz = spawnCreep(
      SPURTZ_ID,
      clampLevel(options.defenderLevels, SPURTZ_ID),
      { x: screenX / 2 + screenY, y: screenY - screenX / 2 },
      true,
      "defend",
    );
    spurtz.disposable = true;
    spurtz.hatchedBy = tower.building.id;
    // `targetMode` 0: it fights ground attackers only (`CreepBase.as:663`).
    spurtz.hitFlags = oldStyleTargets(0);
    gun.hatched.push(spurtz);
    lookForSpurtzFoe(spurtz);
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
      -1,
      1,
      rankOf(corpse.friendly ? options.defenderRanks : options.ranks, corpse.monsterId),
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
    joinRow(zombie, false);
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
    /** The Trojan Horse's strength figure (`BUILDING27.as:54-64`); 1 for every other spawn. */
    strength = 1,
    /** Its Monster Lab rank (issue #352); 0 for a raider and for every spawned helper. */
    rank = 0,
  ): Creep => {
    const movement = monsterMovement(monsterId);
    const flying = isFlyingMovement(movement);
    const health = Math.trunc(monsterStat(monsterId, "health", level) * strength);
    const targetGroup = monsterStat(monsterId, "targetGroup", level) || TARGET_GROUP.ALL;
    const cart = rangePointOf(at.x, at.y);
    // D.A.V.E.'s rockets are a rank's gift: it reaches 140, 180 or 220 and is
    // ranged, which lets it hit the air (`DAVERockets.as:6-17`).
    const range =
      rank > 0 && monsterId === DAVE_ID ? daveRange(rank) : monsterRange(monsterId, level);
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
      damage: Math.trunc(monsterStat(monsterId, "damage", level) * strength),
      range,
      attackDelay: monsterAttackDelay(monsterId, level),
      targetGroup,
      flying,
      ignoreWalls: movement === "burrow" || movement === "jump",
      burrows: movement === "burrow",
      explode: monsterStat(monsterId, "explode", level) > 0,
      lootMultiplier: lootingMultiplier(targetGroup, false),
      // Balthazar sheds both its flying and its ground flag (`Balthazar.as:10-15`).
      flags:
        monsterId === BALTHAZAR_ID
          ? defenseFlags(friendly, flying, false) & ~(TARGETS_FLYING | TARGETS_GROUND)
          : defenseFlags(friendly, flying, false),
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
      hatchedBy: -1,
      rechargeAt: 0,
      // A bunker's defender chases anything attacking, air or ground (`HOUSINGBUNKER.as:269-300`).
      hitFlags: friendly
        ? oldStyleTargets(1)
        : fightFlags(false, flying, range),
      home: null,
      provokedBy: -1,
      ...NO_ABILITIES,
      rank,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    boostDamage(creep);
    return creep;
  };

  /**
   * What a champion brings onto the field beyond its stats (issue #222): its
   * power level as its class reads it, its `_frameNumber` drawn from the
   * battle's stream (one draw below 7, and a flying champion's second below
   * 1,000, `ChampionBase.as:228`, `:237`), the point it walks back to when it
   * leaves (`_spawnPoint`, the landing point rounded down to hundreds on
   * screen, `ChampionBase.as:115`), its aura, and Korath's reach into the air.
   * The caged champion brings the frame it drew in its cage instead.
   */
  const equipChampion = (creep: Creep, power: number, at: Cart, frame?: number): void => {
    const id = creep.monsterId;
    creep.power = championPower(id, power);
    creep.frame = frame ?? startFrame(creep.flying);
    const screen = screenPointOf(at.x, at.y);
    const spawnSx = Math.trunc(screen.x / 100) * 100;
    const spawnSy = Math.trunc(screen.y / 100) * 100;
    // `screenPointOf` undone, as in {@link dropPoint}.
    creep.spawnX = spawnSy + spawnSx / 2;
    creep.spawnY = spawnSy - spawnSx / 2;
    if (id === FOMOR_ID || hasLootAura(id, creep.level, creep.friendly)) {
      creep.aura = { counter: 0, members: [] };
    }
    creep.hitFlags = championReach(id, creep.level, creep.power, creep.hitFlags);
  };

  /** A champion's `_frameNumber` at spawn (`ChampionBase.as:228`, `:237`). */
  const startFrame = (flying: boolean): number => {
    const frame = Math.trunc(rng.float() * START_FRAME_SPREAD);
    return flying ? Math.trunc(rng.float() * FLYING_START_FRAME_SPREAD) : frame;
  };

  const spawnChampion = (
    type: number,
    level: number,
    at: Cart,
    power = 0,
    foodBonus = 0,
    stance?: ChampionStance,
    brain?: Partial<BrainWeights>,
  ): Creep | null => {
    const id = championByType(type);
    if (!id) return null;
    // At its level plus its food bonus, as the cage card shows it
    // (`ChampionBase.as:123-155`); a log with no `fb` gives 0, which adds
    // nothing. Its power level gates its abilities alone (issue #202).
    const health = championStatWithFood(id, "health", level, foodBonus);
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
      baseSpeed: championStatWithFood(id, "speed", level, foodBonus) / 4,
      damage: championStatWithFood(id, "damage", level, foodBonus),
      range: championStatWithFood(id, "range", level, foodBonus) || 1,
      attackDelay: championAttackDelay(id, level),
      targetGroup: championStat(id, "targetGroup", level) || TARGET_GROUP.ALL,
      flying,
      ignoreWalls: false,
      burrows: false,
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
      hatchedBy: -1,
      rechargeAt: 0,
      hitFlags: fightFlags(false, flying, championStatWithFood(id, "range", level, foodBonus) || 1),
      home: null,
      provokedBy: -1,
      ...NO_ABILITIES,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    boostDamage(creep);
    equipChampion(creep, power, at);
    // Its Mode's tilt on its learned brain, as the log froze it (issues #220, #219).
    creep.weights = stanceWeights(stance, brainBase(brain));
    if (options.learn) {
      lessons.set(creep.id, {
        t: type,
        monsterId: id,
        picks: 0,
        credit: { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 },
        dealt: 0,
        perTick: creep.damage / Math.max(1, swingDelay(creep)),
        flungAt: tick,
        leftAt: null,
        startHp: creep.hp,
      });
    }
    championHp = creep.hp;
    championsHp[id] = creep.hp;
    joinRow(creep, true);
    return creep;
  };

  /**
   * The caged champion comes out for the first time (issues #195, #260): from
   * where it stood in its cage, at its health (the stored one, less any
   * Decoy blast it took in there), its stats at its level plus its food
   * bonus, with the frame it counted in there.
   */
  const releaseChampion = (
    caged: DefenderChampion,
    at: CagePen,
    health: number,
  ): Creep | null => {
    const id = championByType(caged.t);
    if (!id) return null;
    const level = Math.max(1, Math.floor(caged.l));
    const power = caged.pl ?? 0;
    const food = caged.fb ?? 0;
    const maxHp = championStatWithFood(id, "health", level, food);
    const flying = isFlyingMovement(championMode(id, "movement", level));
    const range = championStatWithFood(id, "range", level, food) || 1;
    const creep: Creep = {
      id: nextCreepId,
      monsterId: id,
      level,
      champion: true,
      friendly: true,
      ix: at.ix,
      iy: at.iy,
      x: at.x,
      y: at.y,
      hp: Math.min(health, maxHp),
      maxHp,
      baseSpeed: championStatWithFood(id, "speed", level, food) / 4,
      damage: championStatWithFood(id, "damage", level, food),
      range,
      attackDelay: championAttackDelay(id, level),
      targetGroup: TARGET_GROUP.ALL,
      flying,
      ignoreWalls: false,
      burrows: false,
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
      hatchedBy: -1,
      rechargeAt: 0,
      hitFlags: fightFlags(true, flying, range),
      home: null,
      provokedBy: -1,
      ...NO_ABILITIES,
    };
    nextCreepId += 1;
    creeps.push(creep);
    byCreepId.set(creep.id, creep);
    boostDamage(creep);
    equipChampion(creep, power, { x: at.ix, y: at.iy }, at.frame);
    return creep;
  };

  /**
   * Where the caged champion stands in its cage before it first comes out
   * (issue #260), and what it looks with. `SpawnGuardian` jitters the cage's
   * anchor 20 either way on screen and `PointInCage` steps 40 to 80 into the
   * cage on both yard axes, through `GRID`'s rounding (`CHAMPIONCAGE.as:623`,
   * `:630`, `:280-283`; `GRID.as:135-145`); the champion then draws its frame.
   */
  const penOf = (building: EngineBuilding, caged: DefenderChampion): CagePen | null => {
    const id = championByType(caged.t);
    if (!id) return null;
    const level = Math.max(1, Math.floor(caged.l));
    const jitterX = building.sx - 20 + rng.float() * 40;
    const jitterY = building.sy - 20 + rng.float() * 40;
    const gridX = Math.ceil(jitterX * 0.5 + jitterY);
    const gridY = Math.ceil(jitterY - jitterX * 0.5);
    const inX = gridX + 40 + rng.float() * 40;
    const inY = gridY + 40 + rng.float() * 40;
    const screenX = Math.floor(inX - inY);
    const screenY = Math.floor((inX + inY) * 0.5);
    // `screenPointOf` undone, as in {@link dropPoint}.
    const ix = screenY + screenX / 2;
    const iy = screenY - screenX / 2;
    const flying = isFlyingMovement(championMode(id, "movement", level));
    const range = championStatWithFood(id, "range", level, caged.fb ?? 0) || 1;
    return {
      ix,
      iy,
      ...rangePointOf(ix, iy),
      frame: startFrame(flying),
      flying,
      hitFlags: championReach(
        id,
        level,
        championPower(id, caged.pl ?? 0),
        fightFlags(true, flying, range),
      ),
    };
  };
  // Each in turn, as `SpawnGuardian` pens each with its own draws (issue #310).
  if (cage) for (const slot of cageSlots) slot.pen = penOf(cage, slot.caged);

  const fling = (event: FlingDrop): void => {
    const ids = Object.keys(event.monsters).sort();
    // The log's own `r` is ignored: §3.10 makes the radius a function of the
    // payload, so the server recomputes it and a mismatch is the client's bug.
    const radius = scatterRadius(flingCost(event, options.levels));
    for (const monsterId of ids) {
      const count = Math.max(0, Math.floor(event.monsters[monsterId] ?? 0));
      const level = clampLevel(options.levels, monsterId);
      const rank = rankOf(options.ranks, monsterId);
      for (let spawned = 0; spawned < count; spawned += 1) {
        joinRow(
          spawnCreep(
            monsterId,
            level,
            dropPoint(event.x, event.y, radius),
            false,
            "attack",
            -1,
            1,
            rank,
          ),
          true,
        );
        creepsFlung += 1;
      }
    }
    if (event.champion) {
      // Its level plus its food bonus's `bonus*` ladders; its power level
      // gates its abilities (issue #202).
      spawnChampion(
        event.champion.t,
        event.champion.l,
        dropPoint(event.x, event.y, radius),
        event.champion.pl ?? 0,
        event.champion.fb ?? 0,
        event.champion.s,
        event.champion.b,
      );
    }
  };

  /**
   * A raid wave (fidelity note 17): each raider at the defender's own academy
   * level for its type ({@link BattleOptions.defenderLevels}, an absent one
   * level 1), scattered in the disc the planner chose, in monster id order as
   * a fling lands its creeps, at the wave's own strength
   * ({@link RaidEvent.strength}, absent 1).
   */
  const raidWave = (event: RaidEvent): void => {
    const radius = Math.max(0, event.r);
    const strength = event.strength ?? 1;
    for (const monsterId of Object.keys(event.monsters).sort()) {
      const count = Math.max(0, Math.floor(event.monsters[monsterId] ?? 0));
      const level = clampLevel(options.defenderLevels, monsterId);
      const at = (): Cart => dropPoint(event.x, event.y, radius);
      for (let spawned = 0; spawned < count; spawned += 1) {
        spawnCreep(monsterId, level, at(), false, "attack", -1, strength);
        creepsFlung += 1;
      }
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
   * Putty bombs carry no damage; they enrage the attacker's own creeps (see
   * {@link puttyBomb}).
   */
  /** Ticks from drop to the first blob landing: 1 s fall delay plus the shortest flight. */
  const PUTTY_LAND_TICKS = Math.round(1.3 * TICKS_PER_SECOND);
  const puttyPending: { at: number; spec: BombStats; targets: Creep[] }[] = [];

  /**
   * A putty bomb (`ResourceBomb.as:126-139`, `:170-185`; `Enrage.as`). Whom it
   * reaches is fixed now: the attacker's live creeps within `radius / 2` of the
   * drop, the ring the player aims with. Flash lists every creep there; the
   * remake keeps it to the attacker's side. The boost itself lands with the
   * first blob.
   */
  const puttyBomb = (event: BombDrop, spec: BombStats): void => {
    const reach = puttyReach(spec);
    const targets: Creep[] = [];
    for (const creep of creeps) {
      if (creep.friendly || creep.gone || creep.hp <= 0) continue;
      if (Math.hypot(creep.ix - event.x, creep.iy - event.y) <= reach) targets.push(creep);
    }
    puttyPending.push({ at: tick + PUTTY_LAND_TICKS, spec, targets });
  };

  /** Lands due putty bombs and ends boosts that have run out. */
  const tickPutty = (): void => {
    for (let at = 0; at < puttyPending.length; at += 1) {
      const pending = puttyPending[at] as (typeof puttyPending)[number];
      if (pending.at > tick) continue;
      puttyPending.splice(at, 1);
      at -= 1;
      for (const creep of pending.targets) {
        // One putty boost at a time: no stacking.
        if (creep.gone || creep.hp <= 0 || creep.puttyUntil > 0) continue;
        creep.puttySpeed = pending.spec.speed ?? 1;
        creep.puttyArmour = pending.spec.damageMult ?? 0;
        creep.puttyUntil = tick + Math.round((pending.spec.speedlength ?? 0) * TICKS_PER_SECOND);
        puttied += 1;
      }
    }
    if (puttied === 0) return;
    for (const creep of creeps) {
      if (creep.puttyUntil > 0 && tick >= creep.puttyUntil) {
        creep.puttySpeed = 1;
        creep.puttyArmour = 0;
        creep.puttyUntil = 0;
        puttied -= 1;
      }
    }
  };

  const bomb = (event: BombDrop): void => {
    const spec = BOMBS.find((one) => one.id === event.id);
    if (!spec) return;
    if (spec.damage <= 0) {
      puttyBomb(event, spec);
      return;
    }
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

  /* ── The Decoy (Inferno WP 6.5, `decoy.ts`) ────────────────────────────── */

  /**
   * The Decoy on the field, or null. `pulled` is Flash's `_attractedCreeps`;
   * `before` is what each creep it holds was doing, to go back to.
   */
  let decoy: {
    readonly plan: DecoyPlan;
    /** The drop point in yard units, as the event gave it. */
    readonly at: { readonly x: number; readonly y: number };
    readonly droppedAt: number;
    /** The drop point on screen. */
    readonly drop: Cart;
    readonly pulled: Set<number>;
    readonly before: Map<number, Behaviour>;
  } | null = null;

  /**
   * A `siege` event: the Decoy, the Vacuum or the Jars at the attacker's
   * level drops now. Flash keeps one siege weapon live at a time
   * (`SiegeWeapons.activeWeaponID`), so one dropped while another is still
   * out is ignored, as is any other weapon.
   */
  const siege = (event: Extract<AttackEvent, { kind: "siege" }>): void => {
    if (decoy || vacuum || jarDrop) return;
    if (event.weapon === VACUUM.id) {
      startVacuum();
      return;
    }
    if (event.weapon === JARS.id) {
      startJars(screenOf(event.x, event.y));
      return;
    }
    if (event.weapon !== DECOY.id) return;
    const plan = decoyPlan(options.siege?.decoy ?? 0, tick);
    if (!plan) return;
    decoy = {
      plan,
      at: { x: event.x, y: event.y },
      droppedAt: tick,
      drop: screenOf(event.x, event.y),
      pulled: new Set(),
      before: new Map(),
    };
  };

  /**
   * `getDefendingCreepsInRange` (`Decoy.as:332-357`): a defender on the field
   * within the range of the drop, on screen. Flash looks only in `CREATURES`,
   * the defending side, so the attacker's own champion is never in it; of the
   * caged champions it looks only at the basic one (`CREATURES._guardian`,
   * `:341-345`), so the Krallen is not either. This is what the blast hits.
   */
  const decoyReaches = (creep: Creep, drop: Cart, range: number): boolean => {
    if (!creep.friendly || creep.hp <= 0 || creep.gone || creep.monsterId === KRALLEN_ID) {
      return false;
    }
    const at = screenPointOf(creep.ix, creep.iy);
    const dx = at.x - drop.x;
    const dy = at.y - drop.y;
    return dx * dx + dy * dy <= range * range;
  };

  /**
   * Who the Decoy pulls (`updateDecoy`, `Decoy.as:241-262`): of that list only
   * a `CreepBase` (`:246`). A champion is a `ChampionBase`, which is not one
   * (`ChampionBase.as:24`), so the basic champion is never pulled, in its cage
   * or out of it; only the blast reaches it (owner, 28 Oct: "refer to flash").
   */
  const decoyPulls = (creep: Creep, drop: Cart, range: number): boolean =>
    !creep.champion && decoyReaches(creep, drop, range);

  /**
   * The basic champion waiting in its cage within the range, measured from
   * where it stands in there: `getDefendingCreepsInRange` lists
   * `CREATURES._guardian` whatever it is doing (`Decoy.as:341-345`), so the
   * blast reaches it there too (`:283-289`). Not the Krallen.
   */
  const cagedInReach = (drop: Cart, range: number): { slot: CageSlot; away: number }[] => {
    const found: { slot: CageSlot; away: number }[] = [];
    for (const slot of cageSlots) {
      const pen = slot.pen;
      if (!pen || championByType(slot.caged.t) === KRALLEN_ID) continue;
      const at = screenPointOf(pen.ix, pen.iy);
      const away = Math.hypot(at.x - drop.x, at.y - drop.y);
      if (away <= range) found.push({ slot, away });
    }
    return found;
  };

  /**
   * The blast on a champion in its cage: off its health where it stands, the
   * Monster Defensive Buff taken off as on the field. It comes out later with
   * what is left. One brought to nothing dies in there: its pen goes, so it
   * never comes out.
   */
  const damageCaged = (slot: CageSlot, raw: number): void => {
    const dealt = defenderBuffs.monsterArmour ? raw * (1 - MONSTER_ARMOUR_BUFF) : raw;
    const hp = Math.max(0, slot.report.hp - dealt);
    slot.report.hp = hp;
    if (slot.champion) slot.champion.hp = hp;
    if (hp <= 0) slot.pen = null;
  };

  /** `changeModeDecoy`: it stops fighting and walks to stand by the Decoy. */
  const pullToDecoy = (creep: Creep, drop: Cart, before: Map<number, Behaviour>): void => {
    if (creep.behaviour !== "decoy") before.set(creep.id, creep.behaviour);
    creep.behaviour = "decoy";
    creep.targetCreep = -1;
    creep.attacking = false;
    creep.atTarget = false;
    creep.homing = false;
    const stand = decoyStandPoint(rng, screenPointOf(creep.ix, creep.iy), drop, creep.flying);
    // `screenPointOf` undone: screen (a, d) is yard (d + a / 2, d - a / 2).
    creep.waypoints = [{ x: stand.y + stand.x / 2, y: stand.y - stand.x / 2 }];
    creep.waypointIndex = 0;
  };

  /** `detractCreep` and `findDefenseTargets`: back to defending, looking afresh. */
  const releaseFromDecoy = (creep: Creep, before: Map<number, Behaviour>): void => {
    creep.behaviour = before.get(creep.id) ?? "defend";
    before.delete(creep.id);
    creep.targetCreep = -1;
    creep.attacking = false;
    creep.atTarget = false;
    creep.waypoints = [];
    creep.waypointIndex = 0;
  };

  /** A defender the Decoy holds (`tickBDecoy`): it walks to its spot and stands. */
  const tickDecoyed = (creep: Creep): void => {
    creep.attacking = false;
    moveCreep(creep);
  };

  /**
   * `ejectDefendersFromBunkers` (`Decoy.as:229-239`, `BUILDING22.EjectCreeps`,
   * `:195-239`): a standing bunker the range touches sends out one of each
   * kind it still holds, each frame, already held by the Decoy. As with the
   * bunker's own sending, a healer stays in (issue #195). Only a Monster
   * Bunker: Flash ejects from a `BUILDING22` alone (`Decoy.as:234`), so a
   * Housing Bunker keeps its monsters in.
   */
  const ejectForDecoy = (drop: Cart, range: number, before: Map<number, Behaviour>): void => {
    for (const bunker of bunkers) {
      const building = bunker.building;
      if (building.hp <= 0 || building.type === HOUSING_BUNKER_TYPE) continue;
      const at = screenOf(building.x, building.y);
      const dx = at.x - drop.x;
      const dy = at.y + building.middle - drop.y;
      if (!decoyTouchesBuilding(range, dx, dy, propsSizeOf(building.type))) continue;
      const stats = towerStats(building.type, building.level, yard.kind);
      const leash = stats?.range ?? 0;
      const scan = towerScanPoint(building);
      for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
        if (count <= 0 || monsterStat(monsterId, "damage", 1) <= 0) continue;
        bunker.pool.set(monsterId, count - 1);
        bunker.dispatched += 1;
        const sentBy = bunkerReports.get(building.id);
        if (sentBy) sentBy.sent += 1;
        visual.push({ kind: "release", tick, buildingId: building.id });
        const level = clampLevel(options.defenderLevels ?? options.levels, monsterId);
        const defender = spawnCreep(
          monsterId,
          level,
          { x: building.x, y: building.y },
          true,
          "defend",
          building.id,
          1,
          rankOf(options.defenderRanks, monsterId),
        );
        if (leash > 0) {
          defender.home = {
            ix: building.x,
            iy: building.y,
            centreX: scan.x,
            centreY: scan.y,
            leash,
          };
        }
        pullToDecoy(defender, drop, before);
      }
    }
  };

  /**
   * `onDeactivation` (`Decoy.as:278-305`): `DealLinearAEDamage` over the range
   * (`Targeting.as:340-389`) at the defenders it reaches and at every building
   * but a mushroom, or one nothing can target, closer than
   * {@link DECOY_BUILDING_REACH} of the range, each measured on screen to its
   * anchor. A building takes it from a `DummyTarget`: it loots at 1, and a fall
   * is the attacker's. Then everyone it held goes back to defending.
   */
  const explodeDecoy = (): void => {
    const live = decoy;
    if (!live) return;
    decoy = null;
    const { drop, before } = live;
    const { range, damage } = live.plan;
    const hit = creeps.filter((creep) => decoyReaches(creep, drop, range));
    const reach = range * DECOY_BUILDING_REACH;
    for (const creep of hit) {
      const at = screenPointOf(creep.ix, creep.iy);
      const dealt = linearAreaDamage(damage, range, 0, Math.hypot(at.x - drop.x, at.y - drop.y));
      if (dealt !== undefined && !creep.gone) damageCreep(creep, dealt);
    }
    for (const { slot, away } of cagedInReach(drop, range)) {
      const dealt = linearAreaDamage(damage, range, 0, away);
      if (dealt !== undefined) damageCaged(slot, dealt);
    }
    for (const building of yard.buildings) {
      if (building.hp <= 0 || building.kind === "mushroom") continue;
      if (UNTARGETABLE_TYPES.includes(building.type)) continue;
      const at = screenOf(building.x, building.y);
      const away = Math.hypot(at.x - drop.x, at.y - drop.y);
      if (away >= reach) continue;
      const dealt = linearAreaDamage(damage, range, 0, away);
      if (dealt !== undefined) damageBuilding(building, dealt, null, 1, true);
    }
    for (const creep of creeps) {
      if (creep.friendly && creep.behaviour === "decoy") releaseFromDecoy(creep, before);
    }
  };

  /**
   * The Decoy's frame (`Decoy.onEnterFrame`, `updateDecoy`): from the tick it
   * lands, every {@link DECOY_FRAME_TICKS}, it pulls the defenders newly in
   * range, lets go of the ones no longer in it, and empties the bunkers it
   * touches. It blows up on its tick whatever the frame.
   */
  const tickDecoy = (): void => {
    const live = decoy;
    if (!live || tick < live.plan.landsAt) return;
    if (tick >= live.plan.explodesAt) {
      explodeDecoy();
      return;
    }
    if ((tick - live.plan.landsAt) % DECOY_FRAME_TICKS !== 0) return;
    const { drop, pulled, before } = live;
    const range = live.plan.range;
    const held = new Set<number>();
    for (const creep of creeps) {
      if (!decoyPulls(creep, drop, range)) continue;
      held.add(creep.id);
      if (!pulled.has(creep.id)) {
        pulled.add(creep.id);
        pullToDecoy(creep, drop, before);
      }
    }
    for (const id of pulled) {
      if (held.has(id)) continue;
      pulled.delete(id);
      const creep = byCreepId.get(id);
      if (creep) releaseFromDecoy(creep, before);
    }
    ejectForDecoy(drop, range, before);
  };

  /** Whether a landed Decoy reaches `building` (`BUILDING22.DecoyInRange`, `:241-254`). */
  const decoyOver = (building: EngineBuilding): boolean => {
    const live = decoy;
    if (!live || tick < live.plan.landsAt || tick >= live.plan.explodesAt) return false;
    const at = screenOf(building.x, building.y);
    const dx = at.x - live.drop.x;
    const dy = at.y + building.middle - live.drop.y;
    return decoyTouchesBuilding(live.plan.range, dx, dy, propsSizeOf(building.type));
  };

  /**
   * The Monster Bunkers' doors, once a frame (drawing only, {@link BattleVisualEvent}
   * `bunkerDoor`): as `BUILDING22.TickFast` (`:433-455`), a door is open while
   * its bunker has monsters, in or out, and has attackers in its range, monsters
   * out, or a Decoy over it, and shut otherwise. Only a change is told.
   */
  const tickBunkerDoors = (): void => {
    if (tick % 2 !== 0) return;
    let out: Map<number, number> | null = null;
    for (const bunker of bunkers) {
      const building = bunker.building;
      if (building.type === HOUSING_BUNKER_TYPE) continue;
      let open = false;
      if (building.hp > 0) {
        if (!out) {
          out = new Map();
          for (const creep of creeps) {
            if (creep.homeBunker < 0 || creep.gone || creep.hp <= 0) continue;
            out.set(creep.homeBunker, (out.get(creep.homeBunker) ?? 0) + 1);
          }
        }
        const outside = out.get(building.id) ?? 0;
        let inside = 0;
        for (const count of bunker.pool.values()) inside += count;
        if (outside > 0) open = true;
        else if (inside > 0) {
          const range = towerStats(building.type, building.level, yard.kind)?.range ?? 0;
          const scan = towerScanPoint(building);
          open =
            (range > 0 && index.inRange(range, scan.x, scan.y, oldStyleTargets(1)).length > 0) ||
            decoyOver(building);
        }
      }
      if (open === bunker.doorOpen) continue;
      bunker.doorOpen = open;
      visual.push({ kind: "bunkerDoor", tick, buildingId: building.id, open });
    }
  };

  /* ── The Vacuum (Inferno WP 6.6, `vacuum.ts`) ──────────────────────────── */

  /**
   * The Vacuum's hose on the field, or null: `Vacuum.hose` while the Vacuum
   * is the active weapon. `health` is `_vacuumHealth`; `sucked` is
   * `_vacuumCurrTime - _vacuumStartTime` in ticks; `looted` and `cap` are
   * `_amountLooted` and `_totalPossibleLoot`.
   */
  let vacuum: {
    readonly plan: VacuumPlan;
    readonly target: EngineBuilding;
    readonly droppedAt: number;
    readonly cap: number;
    health: number;
    sucked: number;
    looted: number;
    /** The resource its last frame took (1-4), null when it took nothing. */
    took: number | null;
  } | null = null;

  /**
   * `Vacuum.activate` and `ApplyVacuum`: it latches onto the Town Hall (or the
   * Resource Outpost) wherever it was dropped. With no such building, or a
   * fallen one, Flash's activation never gets going, so nothing happens.
   */
  const startVacuum = (): void => {
    const plan = vacuumPlan(options.siege?.vacuum ?? 0, tick);
    const target = yard.buildings.find((building) => VACUUM_TARGET_TYPES.includes(building.type));
    if (!plan || !target || target.hp <= 0) return;
    const cap = vacuumLootCap(target.type, yard.resources);
    vacuum = {
      plan,
      target,
      droppedAt: tick,
      cap,
      health: plan.durability,
      sucked: 0,
      looted: 0,
      took: null,
    };
  };

  /**
   * `BTOWER.canShootVacuumHose` (`BTOWER.as:163-169`): a hose is out, this
   * tower is one that can shoot it, and the hose is within its range of the
   * tower's `_position`, a plain distance on screen. The hose is where its
   * 2 s tween has it now ({@link vacuumHoseY}).
   */
  const hoseInReach = (tower: Tower): boolean => {
    const hose = vacuum;
    const building = tower.building;
    if (!hose || !shootsHose(building.type)) return false;
    const x = hose.target.sx - building.sx;
    const y = vacuumHoseY(hose.target.sy, tick - hose.droppedAt) - building.sy;
    return Math.sqrt(x * x + y * y) <= tower.range;
  };

  /**
   * A tower's `Fire` at the hose. A Tesla names no creep and starts to charge
   * ({@link armCoil}); its zaps then hit the hose. A shell with no blast hits
   * it for `int(damage * scale)` (`PROJECTILE.as:44-50`, `FIREBALL.as:168-174`).
   * A shell with a blast, the Aerial Defense's, bursts where the hose is and
   * hits the creeps round it, and the hose for 0 (`PROJECTILE.Splash`, `:64-69`).
   */
  const shootHose = (tower: Tower, damage: number, splash: number, flags: number): void => {
    const hose = vacuum;
    const building = tower.building;
    if (!hose) return;
    if (building.type === TESLA_TYPE) {
      armCoil(tower, -1);
      return;
    }
    countShot(tower.report);
    const shot = towerShotDamage(damage, building.hp, building.maxHp);
    if (splash <= 0) {
      hose.health -= shot;
      return;
    }
    const at = fromIso(hose.target.sx, vacuumHoseY(hose.target.sy, tick - hose.droppedAt));
    for (const hit of index.inRange(splash, at.x, at.y, flags)) {
      const dealt = Math.max((shot / splash) * (splash - hit.dist), shot / 5);
      const health = hit.creep.hp;
      tower.report.damageDealt += damageCreep(hit.creep, dealt);
      if (health > 0 && hit.creep.hp <= 0) tower.report.kills += 1;
    }
  };

  /**
   * `VacuumLoot` (`VacuumHose.as:81-142`): unless it has taken its cap, it
   * picks one of the pool's non-empty resources at random and takes `amount`
   * of it, or what is left, to the attacker whole, no storage scalar. Against
   * a wild monster attack the attacker gets a fifth.
   */
  const suck = (hose: NonNullable<typeof vacuum>, amount: number): void => {
    hose.took = null;
    if (hose.looted > hose.cap) return;
    const picked = pickStored();
    if (picked === null) return;
    const key = `r${picked}` as keyof ResourceAmounts;
    const taken = vacuumTake(yard.resources[key], amount);
    if (taken > 0) hose.took = picked;
    yard.resources[key] -= taken;
    defenderLoss[key] += taken;
    const credited = wildMonsterAttack ? Math.trunc(taken / WILD_MONSTER_LOOT_DIVISOR) : taken;
    creditLoot(picked, credited);
    hose.looted += credited;
  };

  /**
   * The hose's frame (`Vacuum.onEnterFrame`, `VacuumHose.tick`, `:266-289`):
   * every {@link VACUUM_FRAME_TICKS} after the drop it sucks what is due since
   * the last. It lets go when its timer runs out, whatever the frame, and on
   * a frame once the building under it has fallen or its health is gone.
   */
  const tickVacuum = (): void => {
    const hose = vacuum;
    if (!hose) return;
    if (tick >= hose.plan.endsAt) {
      vacuum = null;
      return;
    }
    const elapsed = tick - hose.droppedAt;
    if (elapsed <= 0 || elapsed % VACUUM_FRAME_TICKS !== 0) return;
    if (hose.target.hp <= 0 || hose.health <= 0) {
      vacuum = null;
      return;
    }
    const amount = vacuumGain(hose.plan.rate, hose.sucked, elapsed);
    hose.sucked = elapsed;
    suck(hose, amount);
  };

  /* ── The Jars (Inferno WP 6.7, `jars.ts`) ──────────────────────────────── */

  /** Each jarred tower's jar by building id, until its strip ends (`RemoveJar`). */
  const jars = new Map<number, Jar>();

  /** The Jars while they are the active weapon (`Jars._targets`), or null. */
  let jarDrop: { readonly droppedAt: number; readonly jars: readonly Jar[] } | null = null;

  /**
   * `Jars.onActivation` (`Jars.as:190-200`, `:219-230`): a jar on every tower
   * the drop's range touches (`BASE.GetBuildingOverlap`, the Decoy's test),
   * fallen or busy ones too, each untargetable from now (`ApplyJar`). Only
   * `JAR_TOWER_TYPES` (owner): the Stronghold fights on.
   */
  const startJars = (drop: Cart): void => {
    const plan = jarsPlan(options.siege?.jars ?? 0, tick);
    if (!plan) return;
    const held: Jar[] = [];
    for (const building of yard.buildings) {
      if (!JAR_TOWER_TYPES.includes(building.type) || isBunker(building.type)) continue;
      const at = screenOf(building.x, building.y);
      const dx = at.x - drop.x;
      const dy = at.y + building.middle - drop.y;
      if (!decoyTouchesBuilding(plan.range, dx, dy, propsSizeOf(building.type))) continue;
      const jar: Jar = {
        building,
        landsAt: plan.landsAt,
        durability: plan.durability,
        health: null,
        frame: 0,
        breaking: false,
      };
      building.jarred = true;
      jars.set(building.id, jar);
      held.push(jar);
    }
    jarDrop = { droppedAt: tick, jars: held };
  };

  /** A tower's jar while it is landed and whole (`isJard`), or null. */
  const jarOn = (building: EngineBuilding): Jar | null => {
    const jar = jars.size > 0 ? jars.get(building.id) : undefined;
    return jar && jar.health !== null ? jar : null;
  };

  /** `KillJar` (`BTOWER.as:316-322`): it breaks, and its strip plays on. */
  const killJar = (jar: Jar): void => {
    jar.health = null;
    if (jars.get(jar.building.id) === jar) jar.breaking = true;
  };

  /**
   * `UpdateJar` (`BTOWER.as:284-298`), where every `BTOWER.Fire` begins: a
   * landed jar's strip cell from its health. Returns the jar, or null.
   */
  const crackJar = (building: EngineBuilding): Jar | null => {
    const jar = jarOn(building);
    if (jar && jar.health !== null) jar.frame = jarFrame(jar.health, jar.durability);
    return jar;
  };

  /**
   * A shot the tower fires while its jar is on hits the jar instead, which
   * breaks at 0 (each tower's `Fire`, `isJard`). False for a tower whose shots
   * never touch its jar; it fires as ever. A Spurtz Cannon's jar breaks at its
   * next {@link tickJar}, not here (`SpurtzCannon.shootJar`).
   */
  const hitJar = (tower: Tower, jar: Jar, damage: number): boolean => {
    const building = tower.building;
    if (jar.health === null) return false;
    const dealt = jarShot(building.type, damage, building.hp, building.maxHp);
    if (dealt === null) return false;
    countShot(tower.report);
    jar.health -= dealt;
    if (jar.health <= 0 && !isSpurtzCannon(building.type)) killJar(jar);
    return true;
  };

  /**
   * `TickJar` (`BTOWER.as:300-308`), at the end of every tower's
   * `TickAttack`, standing or not: a jar at 0 breaks, a breaking one moves on
   * a cell, and at the strip's end it is gone and the tower can be attacked
   * again (`RemoveJar`).
   */
  const tickJar = (jar: Jar): void => {
    if (jar.health !== null && jar.health <= 0) killJar(jar);
    if (jar.breaking) jar.frame += 1;
    if (jar.frame < JAR_FRAMES) return;
    jar.building.jarred = false;
    jars.delete(jar.building.id);
  };

  /**
   * The jars before the towers fire: the last tick's `TickJar` for each but a
   * Spurtz Cannon's (its own loop runs it, {@link tickSpurtzCannon}), then
   * the landing a second after the drop (`JarLanded`, which comes before the
   * check on the same tick), then `Jars.update` every second after the drop:
   * once the jars' health adds up to nothing, every one breaks and the Jars
   * stop being the active weapon. With no jar at all the sum is `NaN`, so
   * they never stop.
   */
  const tickJars = (): void => {
    if (jars.size === 0 && !jarDrop) return;
    for (const jar of jars.values()) {
      if (!isSpurtzCannon(jar.building.type)) tickJar(jar);
    }
    const drop = jarDrop;
    if (!drop) return;
    let left = 0;
    for (const jar of drop.jars) {
      if (tick === jar.landsAt && !jar.breaking) jar.health = jar.durability;
      left += jar.health ?? 0;
    }
    const elapsed = tick - drop.droppedAt;
    if (elapsed % JAR_CHECK_TICKS !== 0 || drop.jars.length === 0 || left > 0) return;
    for (const jar of drop.jars) killJar(jar);
    jarDrop = null;
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
    let chosen: EngineBuilding | null;
    if (creep.champion) {
      // A champion's own lists (`ChampionBase.findTarget`, `Krallen.findTarget`, issue #222).
      // Scored by its Mode when it has one (issue #220).
      const scoring = creep.weights ? stanceScoring(creep, creep.weights) : undefined;
      const lesson = lessons.size > 0 ? lessons.get(creep.id) : undefined;
      chosen = lesson
        ? findAndLearn(creep, lesson, scoring)
        : findChampionTarget(
            yard,
            creep.x,
            creep.y,
            targetContext,
            creep.monsterId === KRALLEN_ID,
            scoring,
          );
    } else {
      const result = findBuildingTarget(yard, creep.x, creep.y, creep.targetGroup, targetContext);
      if (result.fellThrough && creep.targetGroup !== TARGET_GROUP.TOWERS) {
        creep.targetGroup = TARGET_GROUP.ALL;
      }
      chosen = result.closest;
    }
    if (!chosen) {
      // Nothing left to attack: `changeModeRetreat` (`MonsterBase.as:1089`).
      creep.behaviour = "retreat";
      return false;
    }
    routeTo(creep, chosen);
    return true;
  };

  /**
   * What a champion's Mode makes of each candidate (issue #220, `stance.ts`),
   * read off the field as it looks. The allies on each building and the
   * towers' fire at it are summed in id order, and only when a weight reads
   * them.
   */
  const stanceScoring = (champion: Creep, weights: StanceWeights): ChampionScoring => {
    const readsFire = weights.threat !== 0 || weights.margin > 0;
    const field = fieldFor(champion, weights.focus !== 0, readsFire);
    return {
      bonus: (building) => stanceBonus(weights, field.features(building, weights.threat !== 0)),
      skip: (building) =>
        weights.margin > 0 &&
        field.liveTower(building) &&
        cannotBeat(field.shareAt(building), weights.margin),
    };
  };

  /** A champion with no Mode weights picks as Flash's: nothing added, nothing left out. */
  const FLASH_SCORING: ChampionScoring = { bonus: () => 0, skip: () => false };

  /**
   * A champion's pick, as {@link findTarget} makes it, while its lesson
   * watches (issue #219): every candidate the pick weighs is read, and when
   * there were two or more, the chosen one's features less their mean go on
   * the lesson's credit. The pick itself is the one made without the lesson: a
   * champion with no weights is scored at no bonus, which takes the closest as
   * the plain path does, ties in the same order.
   */
  const findAndLearn = (
    creep: Creep,
    lesson: LessonRecord,
    scoring: ChampionScoring | undefined,
  ): EngineBuilding | null => {
    const field = fieldFor(creep, true, true);
    const sums: Record<BrainKey, number> = { tower: 0, loot: 0, finish: 0, focus: 0, threat: 0 };
    let count = 0;
    const base = scoring ?? FLASH_SCORING;
    const chosen = findChampionTarget(
      yard,
      creep.x,
      creep.y,
      targetContext,
      creep.monsterId === KRALLEN_ID,
      {
        bonus: base.bonus,
        skip: base.skip,
        seen: (building) => {
          const features = field.features(building, true);
          for (const key of BRAIN_KEYS) sums[key] += features[key];
          count += 1;
        },
      },
    );
    if (chosen && count >= 2) {
      const features = field.features(chosen, true);
      for (const key of BRAIN_KEYS) lesson.credit[key] += features[key] - sums[key] / count;
      lesson.picks += 1;
    }
    return chosen;
  };

  /**
   * The field as a champion reads it when it looks: the features of each
   * candidate (`stance.ts`), and the share of its health a building would cost
   * it. The allies on each building and the towers' fire at it are summed in
   * id order, and only when asked for.
   */
  const fieldFor = (champion: Creep, readsAllies: boolean, readsFire: boolean) => {
    const allies = new Map<number, number>();
    if (readsAllies) {
      for (const other of creeps) {
        if (other === champion || other.friendly || other.gone || other.hp <= 0) continue;
        if (other.targetBuilding < 0) continue;
        allies.set(other.targetBuilding, (allies.get(other.targetBuilding) ?? 0) + 1);
      }
    }
    const fire = new Map<number, number>();
    /** The damage per tick of every live tower that covers `building` and can hit the champion. */
    const fireAt = (building: EngineBuilding): number => {
      if (!readsFire) return 0;
      const known = fire.get(building.id);
      if (known !== undefined) return known;
      const at = towerScanPoint(building);
      let perTick = 0;
      for (const tower of towers) {
        const gun = tower.building;
        if (gun.hp <= 0 || gun.jarred) continue;
        if (!canHit(towerTargets(gun.type), champion.flags)) continue;
        const scan = towerScanPoint(gun);
        if (distanceSquared(scan.x, scan.y, at.x, at.y) >= tower.range * tower.range) continue;
        const stats = towerStats(gun.type, gun.level, yard.kind);
        perTick += towerPerTick(
          gun.type,
          gun.level,
          stats?.damage ?? 0,
          stats?.rate ?? 0,
          TOWER_REARM_MULTIPLIER,
          gun.hp,
          gun.maxHp,
        );
      }
      fire.set(building.id, perTick);
      return perTick;
    };
    const liveTower = (building: EngineBuilding): boolean =>
      building.hp > 0 &&
      building.kind === "tower" &&
      !isBunker(building.type) &&
      !building.jarred &&
      !building.busy;
    const delay = Math.max(1, swingDelay(champion));
    /** The share of its health taking `building` down would cost it. */
    const shareAt = (building: EngineBuilding): number =>
      exposure(
        fireAt(building),
        building.hp,
        fortifiedDamage(champion.damage, building.fortification, 0) / delay,
        champion.hp,
      );
    /** A candidate's features; its threat only when asked, being the costly one. */
    const features = (building: EngineBuilding, withThreat: boolean): TargetFeatures => ({
      tower: liveTower(building) ? 1 : 0,
      loot: unlootedForKrallen(building) ? 1 : 0,
      finish: building.maxHp > 0 ? 1 - building.hp / building.maxHp : 0,
      focus: focusFeature(allies.get(building.id) ?? 0),
      threat: withThreat ? threatFeature(shareAt(building)) : 0,
      stay: building.id === champion.targetBuilding ? 1 : 0,
    });
    return { features, liveTower, shareAt };
  };

  /** Sets a creep on its way to a building: straight for a flyer, by the grid on foot. */
  const routeTo = (creep: Creep, chosen: EngineBuilding): void => {
    creep.targetBuilding = chosen.id;
    if (creep.champion && creep.flying) creep.looking = true;
    creep.waypointIndex = 0;
    if (creep.flying) {
      creep.waypoints = [{ x: chosen.x, y: chosen.y }];
      // Under 170 screen px from `_position` (`ChampionBase.as:662`).
      const at = screenPointOf(creep.ix, creep.iy);
      creep.atTarget = distanceSquared(at.x, at.y, chosen.sx, chosen.sy) < 170 * 170;
      return;
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

  /**
   * The ticks to the next swing: `int(attackDelay)`, with an enraged creep's
   * delay divided by its multiplier (`Enrage.as:23`, `DivisionModifier`).
   */
  const swingDelay = (creep: Creep): number => {
    let boost = creep.enrage * creep.puttySpeed;
    // The Monster Speed Buff divides the delay too (`HyperSpeed.as`, `DivisionModifier`).
    if (buffsOf(creep).monsterSpeed) boost *= MONSTER_SPEED_BUFF;
    // A ranked Bandito spins faster: 1, 1.5, 2 x (`BanditoAOEDamageSpin.as:23`, issue #352).
    if (creep.rank > 0 && creep.monsterId === BANDITO_ID) {
      boost *= banditoSpeedPercent(creep.rank) / 100;
    }
    return Math.trunc(boost === 1 ? creep.attackDelay : creep.attackDelay / boost);
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
        recordHit(creep, other.ix, other.iy, strikeCreep(creep, other, null));
        if (creep.rank > 0) onAttack(creep, creep.damage, other, null);
        if (creep.monsterId === KING_WORMZER_ID) {
          kingWormzerSplash(creep, creep.damage, other, null);
        }
      }
      return;
    }
    if (!target || target.hp <= 0) return;
    // Korath counts every swing towards his quake (`Korath.as:78`).
    if (creep.monsterId === KORATH_ID && creep.champion) creep.hits += 1;
    const multiplier = specialistMultiplier(creep.targetGroup, target.kind);
    // Fomor's fireball lands as a `DummyTarget`, which loots at 1 (`FIREBALL.as:165`,
    // `BFOUNDATION.as:528-533`), not at its own 2 (issue #222); so does Sabnox's.
    const fireball =
      (creep.champion && creep.monsterId === FOMOR_ID) ||
      (!creep.champion && creep.monsterId === SABNOX_ID);
    const looting = fireball ? 1 : lootOf(creep);
    recordHit(
      creep,
      target.x,
      target.y,
      damageBuilding(target, creep.damage * multiplier, creep, looting),
    );
    if (creep.rank > 0) onAttack(creep, creep.damage * multiplier, null, target);
    if (creep.monsterId === KING_WORMZER_ID) {
      kingWormzerSplash(creep, creep.damage * multiplier, null, target);
    }
    // Krallen moves on from a harvester she has drained (`ChampionBase.as:836-840`).
    if (
      creep.champion &&
      creep.monsterId === KRALLEN_ID &&
      isLootable(target.type) &&
      !unlootedForKrallen(target)
    ) {
      findTarget(creep);
    }
  };

  /**
   * One blow at another creep. Korath's at a flyer is his fireball, a quarter
   * of his damage (`Korath.as:72-75`, `:110-115`); his others are blows that
   * count towards his quake (`:78`); both leave his flame on what they hit
   * (`:87`, `:155-160`). `by` is who the blow turns, for issue #195.
   */
  const strikeCreep = (creep: Creep, foe: Creep, by: Creep | null): number => {
    if (!(creep.champion && creep.monsterId === KORATH_ID)) {
      return damageCreep(foe, creep.damage, by, creep);
    }
    if (foe.flying && hasFireball(KORATH_ID, creep.level, creep.power)) {
      // The flame catches as the fireball lands, before its damage (`FIREBALL.as:138-149`).
      burn(foe, creep);
      return damageCreep(foe, Math.trunc(creep.damage / KORATH_FIREBALL_DIVISOR), by, creep);
    }
    creep.hits += 1;
    const dealt = damageCreep(foe, creep.damage, by, creep);
    burn(foe, creep);
    return dealt;
  };

  /** `addFlameDOT`: a flame of a tenth of Korath's damage, unless one burns already. */
  const burn = (foe: Creep, korath: Creep): void => {
    if (foe.hp <= 0 || foe.burnDps > 0) return;
    foe.burnDps = korath.damage * FLAME_SHARE;
    foe.burnTick = 0;
    foe.burnBy = korath;
  };

  /**
   * The flame's tick, `CStatusEffect.tick`, which runs before its creep acts
   * (`MonsterBase.as:516-536`). Every {@link FLAME_INTERVAL} ticks it takes its
   * damage, through the creep's armour, from no one. True when it killed.
   */
  const tickBurn = (creep: Creep): boolean => {
    creep.burnTick += 1;
    if (creep.burnTick < FLAME_INTERVAL) return false;
    creep.burnTick -= FLAME_INTERVAL;
    damageCreep(creep, creep.burnDps, null, creep.burnBy);
    return creep.hp <= 0;
  };

  /** Whether the Descent's burn is on this creep (Inferno WP 1.21). */
  const descentBurning = (creep: Creep): boolean =>
    descentBurn > 0 && burnsInDescent(creep.monsterId);

  /**
   * The Descent burn's tick (Inferno WP 1.21), beside the flame's: every
   * {@link DESCENT_BURN_INTERVAL} ticks the creep has been on the field it
   * loses its share of full health, through its armour, from no one. True
   * when it killed.
   */
  const tickDescentBurn = (creep: Creep): boolean => {
    const age = tick - creep.born;
    if (age <= 0 || age % DESCENT_BURN_INTERVAL !== 0) return false;
    damageCreep(creep, creep.maxHp * descentBurn);
    return creep.hp <= 0;
  };

  /**
   * What a splash can reach (`Targeting.getTargetsInRange`, `getBuildingsInRange`):
   * a building that stands and is a target at all.
   */
  const splashable = (building: EngineBuilding): boolean =>
    building.hp > 0 &&
    building.kind !== "decoration" &&
    building.kind !== "immovable" &&
    building.kind !== "enemy" &&
    building.kind !== "trap" &&
    !UNTARGETABLE_TYPES.includes(building.type);

  /** A splash's target: a creep or a building, with its distance from the splash. */
  interface SplashTarget {
    readonly creep: Creep | null;
    readonly building: EngineBuilding | null;
    readonly dist: number;
  }

  /**
   * `AOEDamage.getAllTargets` (`AOEDamage.as:34-57`): every ground creep of
   * the other side and, for an attacker, every building, within `radius` of
   * the striker, nearest first (`sortOn dist`; a tie goes creeps before
   * buildings, then by id, which Flash leaves to the sort). A defender's
   * monsters never splash buildings (`:36-39`), and nor does a splash that
   * leaves them out with `buildings` false. `skipCreep` and `skipBuilding` are
   * the initial target when it is left out.
   */
  const splashTargets = (
    striker: Creep,
    radius: number,
    skipCreep: Creep | null,
    skipBuilding: EngineBuilding | null,
    buildings = true,
  ): SplashTarget[] => {
    const found: SplashTarget[] = [];
    const side = striker.friendly ? TARGETS_ATTACKERS : TARGETS_DEFENDERS;
    for (const hit of index.inRange(radius, striker.x, striker.y, side | TARGETS_GROUND)) {
      if (hit.creep.id === striker.id || hit.creep === skipCreep || hit.creep.gone) continue;
      found.push({ creep: hit.creep, building: null, dist: hit.dist });
    }
    if (!striker.friendly && buildings) {
      for (const building of yard.buildings) {
        if (building === skipBuilding || !splashable(building)) continue;
        const squared = Math.trunc(distanceSquared(striker.x, striker.y, building.cx, building.cy));
        if (squared >= radius * radius) continue;
        found.push({ creep: null, building, dist: Math.sqrt(squared) });
      }
    }
    return found.sort((one, other) => {
      if (one.dist !== other.dist) return one.dist - other.dist;
      if (!!one.creep !== !!other.creep) return one.creep ? -1 : 1;
      const oneId = one.creep?.id ?? one.building?.id ?? 0;
      return oneId - (other.creep?.id ?? other.building?.id ?? 0);
    });
  };

  /**
   * `Targeting.DealLinearAEDamage` over `targets` (`Targeting.as:340-389`):
   * what `linearAreaDamage` gives at each one's distance. A building takes it
   * as from a `DummyTarget`, so it loots at 1 (as the quake does).
   */
  const dealSplash = (
    striker: Creep,
    damage: number,
    radius: number,
    inner: number,
    targets: readonly SplashTarget[],
  ): void => {
    for (const { creep, building, dist } of targets) {
      const dealt = linearAreaDamage(damage, radius, inner, dist);
      if (dealt === undefined) continue;
      if (building) damageBuilding(building, dealt, striker, 1);
      else if (creep && !creep.gone) damageCreep(creep, dealt, null, striker);
    }
  };

  /** Which target a splash last went off for, as Wormzer's `m_lastTarget` compares them. */
  const splashKey = (foe: Creep | null, building: EngineBuilding | null): number =>
    building ? building.id : -2 - (foe?.id ?? 0);

  /**
   * `CreepBase.attacked` (`CreepBase.as:750-760`): the hit's own abilities,
   * handed the target and the damage it was dealt. A ranked Fink splashes
   * `rank` more targets (`Fink.as:10`, `AOEDamageOnAttack`: radius 60, full
   * damage inside it, the target left out); a ranked Wormzer splashes
   * everything within 100 for the swing times its rank, the target included,
   * once per target in a row (`Wormzer.as:14`, `AOEDamageOnAttackOncePerTarget`).
   */
  const onAttack = (
    creep: Creep,
    damage: number,
    foe: Creep | null,
    building: EngineBuilding | null,
  ): void => {
    if (creep.monsterId === FINK_ID) {
      const targets = splashTargets(creep, FINK_RADIUS, foe, building);
      targets.length = Math.min(targets.length, finkExtraTargets(creep.rank));
      dealSplash(creep, damage, FINK_RADIUS, FINK_RADIUS, targets);
      noteSplash(creep, FINK_RADIUS, targets.length);
    } else if (creep.monsterId === WORMZER_ID) {
      const key = splashKey(foe, building);
      if (key === creep.lastSplash) return;
      creep.lastSplash = key;
      const targets = splashTargets(creep, WORMZER_RADIUS, null, null);
      dealSplash(creep, damage * wormzerMultiplier(creep.rank), WORMZER_RADIUS, 0, targets);
      noteSplash(creep, WORMZER_RADIUS, targets.length);
    } else if (creep.monsterId === BANDITO_ID) {
      // The whirlwind: the other side's ground monsters within 60, the target left
      // out, no cap, full damage (`Bandito.as:15`, `BanditoAOEDamageSpin`:
      // `includeInitialTarget` false). No building, the owner's choice (2026-10-20).
      const targets = splashTargets(creep, BANDITO_RADIUS, foe, null, false);
      dealSplash(creep, damage, BANDITO_RADIUS, BANDITO_RADIUS, targets);
      noteSplash(creep, BANDITO_RADIUS, targets.length);
    } else if (creep.monsterId === FANG_ID) {
      if (foe) poison(foe, creep);
    } else if (creep.monsterId === TERATORN_ID) {
      if (building) bounceFireball(creep, building, damage);
    }
  };

  /** The renderer's note of a splash (issue #352); not simulation state. */
  const noteSplash = (creep: Creep, radius: number, hits: number): void => {
    visual.push({
      kind: "splash",
      tick,
      creepId: creep.id,
      moveId: creep.monsterId,
      ix: creep.ix,
      iy: creep.iy,
      radius,
      hits,
    });
  };

  /**
   * King Wormzer's splash on every hit, ranked or not ({@link KING_WORMZER_ID}):
   * the buildings within {@link WORMZER_RADIUS}, the swing times
   * {@link KING_WORMZER_MULTIPLIER}, once per target in a row. No monster is
   * hurt, and a defender's splash finds no building.
   */
  const kingWormzerSplash = (
    creep: Creep,
    damage: number,
    foe: Creep | null,
    building: EngineBuilding | null,
  ): void => {
    const key = splashKey(foe, building);
    if (key === creep.lastSplash) return;
    creep.lastSplash = key;
    const targets = splashTargets(creep, WORMZER_RADIUS, null, null).filter(
      (target) => target.building !== null,
    );
    dealSplash(creep, damage * KING_WORMZER_MULTIPLIER, WORMZER_RADIUS, 0, targets);
    noteSplash(creep, WORMZER_RADIUS, targets.length);
  };

  /**
   * `PoisonOnAttack.onAttack` (`PoisonOnAttack.as:12`, `DOTEffect.as`): a bite
   * on a creep leaves one venom on it, and each further bite adds a stack. The
   * venom's strength is the first Fang's damage times its rank's share, and it
   * never runs out. A building takes none (`param1 is MonsterBase`).
   */
  const poison = (foe: Creep, fang: Creep): void => {
    if (foe.hp <= 0 || foe.gone) return;
    if (foe.venomStacks === 0) {
      foe.venomDps = fang.damage * venomShare(fang.rank);
      foe.venomTick = 0;
      foe.venomBy = fang;
    }
    foe.venomStacks += 1;
  };

  /**
   * The venom's bite, ahead of its creep acting like the flame's: every
   * {@link VENOM_INTERVAL_SECONDS} it takes stacks times the stack's damage,
   * through the creep's armour, from no one. True when it killed.
   */
  const tickVenom = (creep: Creep): boolean => {
    creep.venomTick += 1;
    if (creep.venomTick < ticks(VENOM_INTERVAL_SECONDS)) return false;
    creep.venomTick = 0;
    damageCreep(creep, creep.venomStacks * creep.venomDps, null, creep.venomBy);
    return creep.hp <= 0;
  };

  /**
   * `FIREBALL.FindGlaiveTarget` (`FIREBALL.as:269-340`): after the fireball
   * lands, a ranked Teratorn's jumps on `rank` times, each to the nearest
   * other building within 100 screen px of the last (not a wall, mushroom,
   * decoration, immovable, enemy, trap or jarred tower), or, when none is, to
   * the nearest standing wall that close; it skips back to the one before only
   * when another stands. Each jump is half the last, and loots as a
   * `DummyTarget` does (1).
   */
  const bounceFireball = (creep: Creep, first: EngineBuilding, damage: number): void => {
    let from = first;
    let previous: EngineBuilding | null = null;
    let dealt = damage;
    for (let jump = 0; jump < bounceCount(creep.rank); jump += 1) {
      dealt *= 0.5;
      const originX = from.sx;
      const originY = from.sy + from.middle;
      const near: { building: EngineBuilding; dist: number }[] = [];
      const gather = (allowed: (building: EngineBuilding) => boolean): void => {
        for (const building of yard.buildings) {
          if (building === from || !allowed(building)) continue;
          const dist = Math.trunc(
            Math.sqrt(
              distanceSquared(originX, originY, building.sx, building.sy + building.middle),
            ),
          );
          if (dist <= BOUNCE_RADIUS) near.push({ building, dist });
        }
      };
      gather(glaiveable);
      // With no building that close it jumps to a standing wall (`FIREBALL.as:294-307`).
      if (near.length === 0) gather((building) => building.kind === "wall" && building.hp > 0);
      near.sort((one, other) => one.dist - other.dist || one.building.id - other.building.id);
      if (near[0]?.building === previous) near.shift();
      const next = near[0]?.building;
      if (!next) return;
      const amount = damageBuilding(next, dealt, creep, 1);
      visual.push({
        kind: "bounce",
        tick,
        creepId: creep.id,
        fromBuildingId: from.id,
        toBuildingId: next.id,
        fromIx: from.x,
        fromIy: from.y,
        toIx: next.x,
        toIy: next.y,
        amount,
      });
      previous = from;
      from = next;
    }
  };

  /** A building a fireball may jump to (`FIREBALL.as:279`). */
  const glaiveable = (building: EngineBuilding): boolean =>
    building.hp > 0 &&
    building.kind !== "wall" &&
    building.kind !== "mushroom" &&
    building.kind !== "decoration" &&
    building.kind !== "immovable" &&
    building.kind !== "enemy" &&
    building.kind !== "trap" &&
    !(building.kind === "tower" && building.jarred) &&
    !UNTARGETABLE_TYPES.includes(building.type);

  /** A foe a defender can no longer see: a cloaked Brain, or a Bolt mid-blink (issue #352). */
  const unseen = (foe: Creep): boolean => foe.invisible || foe.blinkHops > 0;

  /**
   * `AOEDamageOnDeath` (`ProjectX.as:14`, `AOEDamageOnDeath.as:12-15`): a ranked
   * Project X's last act is a blast of 60 round it, for its damage times the
   * rank, on everything of the other side on the ground and, if it is an
   * attacker, every building.
   */
  const projectXBlast = (creep: Creep): void => {
    const targets = splashTargets(creep, PROJECT_X_RADIUS, null, null);
    dealSplash(creep, creep.damage * projectXMultiplier(creep.rank), PROJECT_X_RADIUS, 0, targets);
    noteSplash(creep, PROJECT_X_RADIUS, targets.length);
  };

  /**
   * A ranked Eye-ra's airburst (`CreepBase.airburst`, `:1735-1790`). Its swing
   * is worth the rank's percentage more (120, 130, 140: the Lab screen's); the
   * building it aims at takes all of it, every other building within 60 of it
   * takes a share falling to nothing at the edge, and the enemy creeps within
   * 90 do alike, both radii stretched by the same percentage. Flash's creep
   * loop reads a stale point and reaches almost no one; here it reaches
   * whoever stands in the circle, which is what the code means.
   */
  const airburst = (creep: Creep, originX: number, originY: number): void => {
    const boosted = (creep.damage * airburstPercent(creep.rank)) / 100;
    const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    const struck: BlastHit[] = [];
    if (aim && aim.hp > 0) struck.push([aim, damageBuilding(aim, boosted, creep)]);
    const buildingRadius = airburstRadius(AIRBURST_BUILDING_RADIUS, creep.rank);
    const buildingReach = buildingRadius * buildingRadius;
    for (const building of yard.buildings) {
      if (building === aim || building.hp <= 0) continue;
      if (building.kind === "decoration" || building.kind === "enemy") continue;
      if (building.kind === "trap") continue;
      const squared = distanceSquared(originX, originY, building.cx, building.cy);
      if (squared >= buildingReach) continue;
      const share = (boosted * (buildingReach - squared)) / buildingReach;
      struck.push([building, damageBuilding(building, Math.trunc(share), creep)]);
    }
    noteBlast(creep, originX, originY, buildingRadius, struck);
    const creepRadius = airburstRadius(AIRBURST_CREEP_RADIUS, creep.rank);
    const creepCircle = creepRadius * creepRadius;
    const foe = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    for (const other of creeps) {
      if (!other.friendly || other.gone || other.hp <= 0) continue;
      const squared = screenDistanceSquared(creep.ix, creep.iy, other.ix, other.iy);
      if (squared >= creepCircle) continue;
      const share = (boosted * (creepCircle - squared)) / creepCircle;
      damageCreep(other, other === foe ? boosted : Math.trunc(share), null, creep);
    }
  };

  /**
   * What an Eye-ra's blast shows: a hit on every building it reached, for the
   * flash and the red number, then a ring the blast's size. Drawing only. A
   * blast with no wall in it used to leave nothing on screen but the creep's
   * splat, so the Eye-ra seemed to vanish (fix/eyera-nowalls).
   */
  const noteBlast = (
    creep: Creep,
    originX: number,
    originY: number,
    radius: number,
    struck: readonly BlastHit[],
  ): void => {
    for (const [building, amount] of struck) {
      visual.push({
        kind: "hit",
        tick,
        creepId: creep.id,
        buildingId: building.id,
        creepTargetId: -1,
        ix: creep.ix,
        iy: creep.iy,
        targetIx: building.x,
        targetIy: building.y,
        ranged: false,
        flying: creep.flying,
        amount,
      });
    }
    // The blast is a circle in cartesian; on screen it is twice as wide as it
    // is tall, with a half-width of the radius times root two.
    visual.push({
      kind: "splash",
      tick,
      creepId: creep.id,
      moveId: creep.monsterId,
      ix: originX,
      iy: originY,
      radius: Math.round(radius * Math.SQRT2),
      hits: struck.length,
    });
  };

  /** Eye-ra's blast: radius 60 in cartesian, linear in the squared distance. */
  const explodeCreep = (creep: Creep): void => {
    const originX = creep.x - 5;
    const originY = creep.y - 5;
    if (creep.rank > 0 && creep.monsterId === EYE_RA_ID) {
      airburst(creep, originX, originY);
      creep.hp = 0;
      creep.gone = true;
      countLost(creep);
      recordDeath(creep);
      onDeath(creep);
      return;
    }
    // The building it walked to takes the whole blast, as a ranked airburst's
    // does. Flash's own test, below, measures to the building's anchor corner,
    // so an Eye-ra that came at any other side blew up and hurt nothing: about
    // two blasts in five on a yard with no walls (fix/eyera-nowalls).
    const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    const struck: BlastHit[] = [];
    if (aim && aim.hp > 0) struck.push([aim, damageBuilding(aim, creep.damage, creep)]);
    for (const building of yard.buildings) {
      if (building === aim) continue;
      if (building.hp <= 0 || building.kind === "decoration" || building.kind === "enemy") continue;
      // `tmpPointB.add(tmpPointC)` at `CreepBase.as:797` discards its result, so
      // the `_middle` offset the client meant to apply never reaches the test.
      const squared = distanceSquared(originX, originY, building.cx, building.cy);
      if (squared >= 3600) continue;
      const dealt = damageBuilding(
        building,
        Math.round(creep.damage * ((3600 - squared) / 3600)),
        creep,
      );
      struck.push([building, dealt]);
    }
    noteBlast(creep, originX, originY, 60, struck);
    creep.hp = 0;
    creep.gone = true;
    countLost(creep);
    recordDeath(creep);
    onDeath(creep);
  };

  const moveCreep = (creep: Creep): void => {
    let speed = creep.baseSpeed;
    // Enraged: `MultiplicationPropertyModifier` on its speed (`Enrage.as:22`, issue #222).
    if (creep.enrage !== 1) speed *= creep.enrage;
    // A putty bomb's boost, on top of Fomor's (`ResourceBomb.as:170-185`).
    if (creep.puttySpeed !== 1) speed *= creep.puttySpeed;
    // The Monster Speed Buff (`HyperSpeed.k_moveSpeedModifier`).
    if (buffsOf(creep).monsterSpeed) speed *= MONSTER_SPEED_BUFF;
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
    stepCreep(creep, waypoint.x, waypoint.y, speed);
  };

  /** `speed` screen px towards a yard point, as {@link moveCreep} takes them. */
  const stepCreep = (creep: Creep, toX: number, toY: number, speed: number): void => {
    const deltaX = toX - creep.ix;
    const deltaY = toY - creep.iy;
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
    if (!target || target.hp <= 0 || target.gone || !leashed(target) || unseen(target)) {
      // A Balthazar passes over an Eye-ra (`CreepBase.as:667-671`).
      const found = index
        .inRange(DEFEND_SEARCH, creep.x, creep.y, creep.hitFlags)
        .find(
          (hit) =>
            leashed(hit.creep) &&
            !(creep.monsterId === BALTHAZAR_ID && hit.creep.monsterId === EYE_RA_ID),
        )?.creep;
      if (!found) {
        if (creep.blinkHops > 0) stopBlink(creep);
        creep.targetCreep = -1;
        creep.atTarget = false;
        creep.attacking = false;
        creep.homing = true;
        goHome(creep);
        return;
      }
      creep.targetCreep = found.id;
      target = found;
      if (creep.burrows) {
        const squared = screenDistanceSquared(creep.ix, creep.iy, found.ix, found.iy);
        creep.surfaceChase = squared < DEFEND_SURFACE_SQUARED;
      }
    }
    creep.homing = false;
    fight(creep, target);
  };

  /**
   * A hatched Spurtz (issue #313): `tickBDefend` with no home
   * (`CreepBase.as:1038-1068`). It fights its foe while that one lives, looks
   * again when it dies, and while it is not swinging looks again every
   * {@link SPURTZ_RELOOK_FRAMES} of its frames. With nobody to fight it
   * stands where it is until its cannon culls it.
   */
  const tickSpurtz = (creep: Creep): void => {
    let foe = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (creep.targetCreep >= 0 && (!foe || foe.hp <= 0 || foe.gone)) {
      creep.targetCreep = -1;
      creep.atTarget = false;
      creep.attacking = false;
      foe = lookForSpurtzFoe(creep);
    } else if (foe && !creep.attacking && (tick - creep.born) % SPURTZ_RELOOK_FRAMES === 0) {
      foe = lookForSpurtzFoe(creep);
    }
    if (!foe) {
      creep.attacking = false;
      return;
    }
    fight(creep, foe);
  };

  /**
   * `findDefenseTargets` for a Spurtz (`CreepBase.as:660-694`): the nearest
   * attacker it can hit within {@link SPURTZ_LOOK} that is not retreating,
   * else the foe it has while that one lives, else none.
   */
  const lookForSpurtzFoe = (creep: Creep): Creep | undefined => {
    const found = index
      .inRange(SPURTZ_LOOK, creep.x, creep.y, creep.hitFlags)
      .find((hit) => hit.creep.behaviour !== "retreat" && !hit.creep.gone)?.creep;
    if (found) {
      creep.targetCreep = found.id;
      return found;
    }
    const held = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    if (held && held.hp > 0 && !held.gone && !unseen(held)) return held;
    creep.targetCreep = -1;
    return undefined;
  };

  /**
   * One tick of a fight between two creeps: a swing inside the reach, else a
   * step straight at the foe. `DEFENSE_RANGE_SQUARED` is 2,500, measured on
   * screen like the range `canShootCreep` also accepts (`CreepBase.as:1543`,
   * `:723-727`).
   */
  /**
   * `canShootCreep` for an attacker turned on a defender: a monster
   * (`CreepBase.as:720-733`) or Fomor, flying or not (`Fomor.as:34-46`, the
   * only champion `ChampionBase.as:1461` asks it of), needs a clear line past
   * the walls (`PATHING.LineOfSight`) unless the two are close. Any other
   * champion strikes from its range (`:1461`). A defender never asks.
   */
  const seesFoe = (creep: Creep, foe: Creep, squared: number): boolean =>
    (creep.champion && creep.monsterId !== FOMOR_ID) ||
    squared < CLOSE_FIGHT_SQUARED ||
    grid.lineOfSight(creep.x, creep.y, foe.x, foe.y, -1);

  /**
   * `canShootBuilding` and `canHitBuilding` (`CreepBase.as:735-748`,
   * `ChampionBase.as:424-438`): the building in range and, for a creep on foot,
   * no standing wall between it and the building's anchor but the target
   * itself (`PATHING.LineOfSight`). A flyer shoots over walls
   * (`ChampionBase.as:432-434`; a flying monster strikes from where it circles
   * in, `MonsterBase.as:1121-1158`). Short of that, a walker keeps to its route.
   */
  const canShootBuilding = (creep: Creep, building: EngineBuilding, range: number): boolean =>
    reachesBuilding(creep.ix, creep.iy, building, range) &&
    (creep.flying || grid.lineOfSight(creep.x, creep.y, building.cx, building.cy, building.id));

  const fight = (creep: Creep, foe: Creep): void => {
    const squared = screenDistanceSquared(creep.ix, creep.iy, foe.ix, foe.iy);
    // A defending Korath reaches a flyer from twice his range (`ChampionBase.as:876`).
    const range =
      creep.friendly && foe.flying && creep.champion && creep.monsterId === KORATH_ID
        ? creep.range * KORATH_DEFEND_FLYER_REACH
        : creep.range;
    creep.atTarget =
      squared < creepReach(range) && (creep.friendly || seesFoe(creep, foe, squared));
    // A defending Bolt blinks at its foe; an attacker's blink ends when it turns to fight.
    const blinks = creep.friendly && creep.rank > 0 && creep.monsterId === BOLT_ID;
    if (creep.blinkHops > 0 && (creep.atTarget || !blinks)) stopBlink(creep);
    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += swingDelay(creep);
        const dealt = strikeCreep(creep, foe, creep);
        if (defended) recordHit(creep, foe.ix, foe.iy, dealt);
        if (creep.rank > 0) onAttack(creep, creep.damage, foe, null);
      } else {
        creep.attackCooldown -= 1;
      }
      return;
    }
    creep.attacking = false;
    creep.waypoints = [{ x: foe.ix, y: foe.iy }];
    creep.waypointIndex = 0;
    if (blinks && tickBlink(creep)) return;
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
      other.targetable &&
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
        creep.attackCooldown += swingDelay(creep);
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

  /* ── Champion abilities (issue #222) ───────────────────────────────────── */

  /** `_tmpPoint` to `_tmpPoint`, on screen, squared: `GLOBAL.QuickDistance`'s space for creeps. */
  const apartSquared = (one: Creep, other: Creep): number =>
    screenDistanceSquared(one.ix, one.iy, other.ix, other.iy);

  /** A creep's `_tmpPoint` to a building's `_position`, on screen, squared. */
  const toBuildingSquared = (creep: Creep, building: EngineBuilding): number => {
    const at = screenPointOf(creep.ix, creep.iy);
    return distanceSquared(at.x, at.y, building.sx, building.sy);
  };

  /** Whether a champion's aura is live: `inBattleState` (`MonsterBase.as:350-352`). */
  const inBattle = (creep: Creep): boolean =>
    !creep.gone && creep.hp > 0 && (creep.friendly ? !creep.homing : creep.behaviour === "attack");

  /**
   * `AOEEnrage.tick` (`components/abilities/AOEEnrage.as:56-73`): every
   * {@link ENRAGE_INTERVAL} ticks, while Fomor fights, every creep of its side
   * within {@link ENRAGE_RADIUS} but itself is enraged, and every one it
   * enraged that is no longer there calms down. Out of battle it lets every
   * one go. One enrage at a time: a creep already enraged is left as it is.
   */
  const tickEnrage = (fomor: Creep, aura: Aura): void => {
    aura.counter += 1;
    if (aura.counter < ENRAGE_INTERVAL) return;
    aura.counter = 0;
    const kept = new Set<Creep>();
    if (inBattle(fomor)) {
      const side = fomor.friendly ? TARGETS_DEFENDERS : TARGETS_ATTACKERS;
      const flags = side | TARGETS_GROUND | TARGETS_FLYING | TARGETS_INVISIBLE;
      const buff = fomorBuff(fomor.level, fomor.power);
      const near = index.inRange(ENRAGE_RADIUS, fomor.x, fomor.y, flags, fomor.id);
      for (const { creep: other } of near) {
        if (other.gone) continue;
        kept.add(other);
        if (other.enragedBy >= 0) continue;
        other.enrage = enrageMultiplier(buff);
        other.armour = enrageArmour(buff);
        other.enragedBy = fomor.id;
        aura.members.push(other);
      }
    }
    letGo(fomor, aura, kept);
  };

  /** Lets go of every creep an aura holds that `kept` does not name. */
  const letGo = (owner: Creep, aura: Aura, kept: ReadonlySet<Creep>): void => {
    aura.members = aura.members.filter((member) => {
      if (kept.has(member)) return true;
      if (member.enragedBy === owner.id) {
        member.enrage = 1;
        member.armour = 0;
        member.enragedBy = -1;
      }
      if (member.lootBuffedBy === owner.id) {
        member.lootBonus = 0;
        member.lootBuffedBy = -1;
      }
      return false;
    });
  };

  /**
   * `ProximityLootBuff.tick` (`components/abilities/ProximityLootBuff.as:33-58`):
   * while Krallen attacks, on every {@link LOOT_AURA_FRAMES}th of her frames,
   * every other attacker within her `buffRadius` on screen gains her
   * {@link lootAuraBonus} on its looting property, and every one she gave it
   * to that has strayed out loses it.
   */
  const tickLootAura = (krallen: Creep, aura: Aura): void => {
    if (krallen.behaviour !== "attack" || krallen.frame % LOOT_AURA_FRAMES !== 0) return;
    const radius = krallenAuraRadius(krallen.level);
    const reach = radius * radius;
    const near = (other: Creep): boolean => apartSquared(krallen, other) < reach;
    for (const other of creeps) {
      if (other === krallen || other.friendly || other.gone || other.hp <= 0) continue;
      if (!near(other) || other.lootBuffedBy >= 0) continue;
      other.lootBonus = lootAuraBonus(krallen.level);
      other.lootBuffedBy = krallen.id;
      aura.members.push(other);
    }
    letGo(krallen, aura, new Set(aura.members.filter(near)));
  };

  /** A champion's components, which tick before it acts (`MonsterBase.as:516-536`). */
  const tickAura = (creep: Creep): void => {
    const aura = creep.aura;
    if (!aura) return;
    if (creep.monsterId === FOMOR_ID) tickEnrage(creep, aura);
    else tickLootAura(creep, aura);
  };

  /**
   * `Korath.doQuakeCheck` (`Korath.as:167-190`): three swings in and with his
   * swing ready, he stands for his quake instead of swinging; it lands on frame
   * 48 and he is done on frame 72. True while he stands.
   */
  const quakeCheck = (creep: Creep): boolean => {
    if (creep.quaking) {
      const frame = creep.frame % QUAKE_FRAME_CYCLE;
      if (frame === QUAKE_STRIKE_FRAME) {
        creep.hits = 0;
        quake(creep);
      } else if (frame === QUAKE_END_FRAME) {
        creep.quaking = false;
      }
    } else if (
      creep.attackCooldown <= 0 &&
      creep.hits >= QUAKE_SWINGS &&
      hasQuake(creep.monsterId, creep.level, creep.power)
    ) {
      creep.quaking = true;
      creep.frame = 0;
    }
    return creep.quaking;
  };

  /**
   * `Korath.quake` (`Korath.as:192-209`): `DealLinearAEDamage` over two and a
   * half of his ranges, full inside one and a half. It reaches the other
   * side's creeps on the ground, measured as creeps are, and when he attacks
   * every building but the untargetable, measured on screen to its anchor as
   * `getBuildingsInRange` does (`Targeting.as:151-173`). A building takes it
   * from a `DummyTarget`, so it loots at 1.
   */
  const quake = (creep: Creep): void => {
    const radius = creep.range * QUAKE_RADIUS_RANGES;
    const inner = creep.range * QUAKE_INNER_RANGES;
    const side = creep.friendly ? TARGETS_ATTACKERS : TARGETS_DEFENDERS;
    const flags = side | TARGETS_GROUND | TARGETS_INVISIBLE;
    for (const hit of index.inRange(radius, creep.x, creep.y, flags)) {
      const dealt = linearAreaDamage(creep.damage, radius, inner, hit.dist);
      if (dealt !== undefined && !hit.creep.gone) damageCreep(hit.creep, dealt, null, creep);
    }
    if (!creep.friendly) {
      for (const building of yard.buildings) {
        if (building.hp <= 0 || UNTARGETABLE_TYPES.includes(building.type)) continue;
        const squared = Math.trunc(toBuildingSquared(creep, building));
        if (squared >= radius * radius) continue;
        const dealt = linearAreaDamage(creep.damage, radius, inner, Math.sqrt(squared));
        if (dealt !== undefined) damageBuilding(building, dealt, creep, 1);
      }
    }
    visual.push({ kind: "quake", tick, creepId: creep.id, ix: creep.ix, iy: creep.iy, radius });
  };

  /** A building `findBuffTargets` counts as still standing (`Fomor.as:53-57`). */
  const standsForFomor = (building: EngineBuilding): boolean =>
    building.hp > 0 &&
    building.kind !== "decoration" &&
    building.kind !== "immovable" &&
    building.kind !== "enemy";

  /**
   * `Fomor.findBuffTargets` (`Fomor.as:48-115`): the nearest ally within 1,500
   * that is wounded and not a healer, else the one it already follows while
   * that one is still wounded. It follows that ally; with none, it goes back
   * to attacking buildings, and with no building left it leaves.
   *
   * The ally is looked for among the attackers only: a fight with a defender
   * is issue #195's, which comes first, so `_targetCreep` is never live here.
   */
  const findBuffTargets = (creep: Creep): void => {
    if (!yard.buildings.some(standsForFomor)) {
      creep.behaviour = "retreat";
      return;
    }
    const hits = index.inRange(FOMOR_BUFF_SEARCH, creep.x, creep.y, oldStyleTargets(1), creep.id);
    let first = 0;
    while (first < hits.length) {
      const other = (hits[first] as CreepHit<Creep>).creep;
      if (!other.gone && other.behaviour !== "heal" && other.hp !== other.maxHp) break;
      first += 1;
    }
    const ally = hits[first]?.creep;
    const helper = creep.helpCreep >= 0 ? byCreepId.get(creep.helpCreep) : undefined;
    if (ally) {
      creep.helpCreep = ally.id;
      followAlly(creep, ally);
    } else if (helper && helper.hp > 0 && helper.hp < helper.maxHp) {
      followAlly(creep, helper);
    } else {
      backToBuildings(creep);
      return;
    }
    creep.support = true;
    creep.hasHelpTarget = true;
  };

  /**
   * Fomor heads for its ally. Flying, its waypoint is the ally's own
   * `_tmpPoint`, which moves with it (`Fomor.as:74-76`); on foot it asks the
   * grid for a route to where the ally was (`WaypointTo`, `:79`), so a wall
   * is walked round or, where the route runs into one, taken on, exactly as
   * {@link routeTo} does on the way to a building.
   */
  const followAlly = (creep: Creep, ally: Creep): void => {
    creep.waypointIndex = 0;
    creep.followHelper = creep.flying;
    if (creep.flying) {
      creep.waypoints = [{ x: ally.ix, y: ally.iy }];
      return;
    }
    const route = grid.path(
      {
        fromX: creep.ix,
        fromY: creep.iy,
        target: pointTarget(ally.ix, ally.iy),
        ignoreWalls: creep.ignoreWalls,
      },
      rng,
    );
    if (route.blockedBy >= 0) {
      const wall = buildingOf(route.blockedBy);
      if (wall && wall.hp > 0) creep.targetBuilding = wall.id;
    }
    creep.waypoints =
      route.waypoints.length > 1 ? route.waypoints.slice(1) : [{ x: ally.ix, y: ally.iy }];
  };

  /** `ChampionBase.changeModeAttack` (`:288-293`): back to buildings. */
  const backToBuildings = (creep: Creep): void => {
    creep.support = false;
    creep.hasHelpTarget = false;
    creep.followHelper = false;
    creep.atTarget = false;
    creep.targetCreep = -1;
    findTarget(creep);
  };

  /** Fomor drops its ally and its building (`Fomor.as:262-268`, `:314-320`). */
  const dropSupport = (creep: Creep): void => {
    creep.attacking = false;
    creep.atTarget = false;
    creep.targetCreep = -1;
    creep.helpCreep = -1;
    creep.targetBuilding = -1;
    creep.followHelper = false;
  };

  /** Fomor heads for a building: straight in the air, by the grid on foot. */
  const headFor = (creep: Creep, building: EngineBuilding): void => {
    creep.followHelper = false;
    if (creep.flying) {
      creep.waypoints = [{ x: building.x, y: building.y }];
      creep.waypointIndex = 0;
      creep.targetBuilding = building.id;
      return;
    }
    routeTo(creep, building);
  };

  /**
   * `ChampionBase.move` for a following Fomor (`:1399-1416`): a building in
   * reach stops it where it is; else it walks its waypoints, the moving one
   * included.
   */
  const supportMove = (creep: Creep): void => {
    const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    if (
      !creep.atTarget &&
      aim &&
      aim.hp > 0 &&
      canShootBuilding(creep, aim, creep.range)
    ) {
      creep.atTarget = true;
      return;
    }
    if (creep.followHelper && creep.waypointIndex < creep.waypoints.length) {
      const ally = byCreepId.get(creep.helpCreep);
      if (ally) creep.waypoints[creep.waypointIndex] = { x: ally.ix, y: ally.iy };
    }
    moveCreep(creep);
  };

  /**
   * `Fomor.tickBBuff` (`Fomor.as:159-341`): stay with the ally, take on the
   * building it is on, and shoot that building whenever both are in range.
   * It looks again when the ally dies, when the ally is whole on a frame
   * divisible by 20, every 100 frames and every 120 while idle.
   */
  const supportThink = (creep: Creep): void => {
    const frame = creep.frame;
    const range = creep.range;
    const reach = range * range;
    const stillSupporting = (): boolean => creep.support && creep.behaviour === "attack";
    if (frame % FOMOR_LOOK_FRAMES === 0 && !creep.attacking) {
      findBuffTargets(creep);
      if (!stillSupporting()) return;
    }
    if (creep.hasHelpTarget && creep.helpCreep >= 0) {
      const ally = byCreepId.get(creep.helpCreep);
      if (ally && ally.targetBuilding >= 0) creep.targetBuilding = ally.targetBuilding;
      const allyAim = ally && ally.targetBuilding >= 0 ? buildingOf(ally.targetBuilding) : null;
      if (!ally || ally.hp <= 0 || (ally.hp === ally.maxHp && frame % FOMOR_HEALED_FRAMES === 0)) {
        creep.hasHelpTarget = false;
        creep.attacking = false;
        creep.atTarget = false;
        if (!ally || ally.hp <= 0) creep.helpCreep = -1;
        findBuffTargets(creep);
        if (!stillSupporting()) return;
      } else if (
        apartSquared(creep, ally) < reach &&
        allyAim &&
        toBuildingSquared(creep, allyAim) < reach
      ) {
        creep.atTarget = true;
      } else if (!creep.attacking && frame % FOMOR_IDLE_FRAMES === 0) {
        findBuffTargets(creep);
        if (!stillSupporting()) return;
      } else if (creep.attacking && apartSquared(creep, ally) > reach * FOMOR_DRIFT * FOMOR_DRIFT) {
        creep.attacking = false;
        creep.atTarget = false;
      } else if (creep.waypointIndex >= creep.waypoints.length && !creep.atTarget) {
        const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
        if (aim && canShootBuilding(creep, aim, range)) creep.atTarget = true;
        else if (aim) headFor(creep, aim);
      }
    } else if (creep.hasHelpTarget) {
      const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
      if (aim && aim.hp > 0) {
        if (canShootBuilding(creep, aim, range)) {
          creep.atTarget = true;
        } else {
          creep.atTarget = false;
          creep.attacking = false;
        }
      } else {
        dropSupport(creep);
        findBuffTargets(creep);
        if (!stillSupporting()) return;
      }
    } else {
      dropSupport(creep);
      findBuffTargets(creep);
      if (!stillSupporting()) return;
    }

    if (!creep.atTarget) {
      creep.attacking = false;
      return;
    }
    if (creep.attackCooldown > 0) {
      creep.attackCooldown -= 1;
      return;
    }
    creep.attackCooldown += swingDelay(creep);
    const ally = creep.helpCreep >= 0 ? byCreepId.get(creep.helpCreep) : undefined;
    const allyAim = ally && ally.targetBuilding >= 0 ? buildingOf(ally.targetBuilding) : null;
    const ownAim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
    if ((allyAim && allyAim.hp > 0) || (ownAim && ownAim.hp > 0)) {
      if (ally) creep.targetBuilding = ally.targetBuilding;
      const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
      if (aim && toBuildingSquared(creep, aim) < reach) {
        creep.attacking = true;
        swing(creep);
      } else if (aim) {
        creep.attacking = false;
        creep.atTarget = false;
        headFor(creep, aim);
      } else {
        dropSupport(creep);
        findBuffTargets(creep);
      }
    } else {
      dropSupport(creep);
      creep.hasHelpTarget = false;
      findBuffTargets(creep);
    }
  };

  /**
   * Champions that left the field with an aura still holding creeps
   * (issue #222). Flash walks a champion back to its `_spawnPoint` and only
   * drops it when it gets there (`ChampionBase.as:1139-1144`); until then its
   * components still tick. Krallen's aura only works while she attacks, so
   * what it gave stays given until she is off the field; Fomor's lets every
   * creep go at its next look. Nothing else about it is simulated: it has left
   * the fight with the health it had (fidelity note 7).
   */
  const leaving: Creep[] = [];

  const startLeaving = (creep: Creep): void => {
    const aura = creep.aura;
    if (!aura || aura.members.length === 0) return;
    creep.behaviour = "retreat";
    creep.attacking = false;
    creep.atTarget = false;
    creep.waypoints = [{ x: creep.spawnX, y: creep.spawnY }];
    creep.waypointIndex = 0;
    leaving.push(creep);
  };

  /** Each leaving champion: its components, then `tickBRetreat`, then `move()`. */
  const tickLeaving = (): void => {
    if (leaving.length === 0) return;
    let write = 0;
    for (let read = 0; read < leaving.length; read += 1) {
      const creep = leaving[read] as Creep;
      const aura = creep.aura as Aura;
      tickAura(creep);
      if (creep.atTarget || aura.members.length === 0) {
        letGo(creep, aura, new Set());
        continue;
      }
      moveCreep(creep);
      leaving[write] = creep;
      write += 1;
    }
    leaving.length = write;
  };

  /**
   * `Invisibility.tick` (`Invisibility.as:18-34`): a ranked Brain with a
   * target to walk to cloaks, which takes `TARGETS_INVISIBLE` into its flags so
   * only what reaches the invisible (the trap, Fomor's aura, Korath's quake)
   * can see it. Once it has arrived it stays cloaked for the rank's delay, then
   * shows itself until it has to walk again. So towers, bunker monsters and
   * caged champions leave it alone while it is cloaked, as Flash's `BTOWER`
   * skips an `invisible` creep (`BTOWER.as:208`). Flash also sets its aggro
   * range to 1, but nothing in Flash reads that, so it changes nothing here.
   */
  const tickCloak = (creep: Creep): void => {
    if (creep.invisible) {
      if (!creep.atTarget) {
        creep.cloakEnds = -1;
      } else if (creep.cloakEnds >= 0) {
        if (tick >= creep.cloakEnds) {
          creep.invisible = false;
          creep.flags &= ~TARGETS_INVISIBLE;
          creep.cloakEnds = -1;
        }
      } else {
        creep.cloakEnds = tick + ticks(cloakDelaySeconds(creep.rank));
      }
    } else if ((creep.targetBuilding >= 0 || creep.targetCreep >= 0) && !creep.atTarget) {
      creep.invisible = true;
      creep.flags |= TARGETS_INVISIBLE;
    }
  };

  /**
   * `MonsterBase.renderBurrow` (`MonsterBase.as:625-691`): an attacking
   * burrower is underground whenever its `_speed` is above 0, and `move()`
   * zeroes that only while it is `_attacking` (`CreepBase.as:1456-1471`). So it
   * digs in as it sets off, tunnels to its target, pops up to swing and goes
   * back under for the next. Underground it is `invisible` (`:663`), which
   * takes `TARGETS_INVISIBLE` into its flags, so no tower picks it, no
   * defender or bunker sees it, and only what reaches the invisible (a trap,
   * the cannon's blast, the Laser, the Railgun) hurts it. Run after its tick,
   * so it surfaces on the tick it starts to swing. A defender tunnels too
   * while it chases a foe (`_doDefenseBurrow`, `:657`), except up to one it
   * took close by ({@link DEFEND_SURFACE_SQUARED}); walking home it goes
   * above ground, as Flash's `changeModeBunker` does (`CreepBase.as:419`).
   * A retreating attacker stays up (`MonsterBase.as:763-766`).
   */
  const tickBurrow = (creep: Creep): void => {
    const chasing = creep.friendly
      ? creep.behaviour === "defend" &&
        !creep.homing &&
        creep.targetCreep >= 0 &&
        !creep.surfaceChase
      : creep.behaviour === "attack";
    const under = chasing && !creep.attacking;
    if (under === creep.invisible) return;
    creep.invisible = under;
    if (under) creep.flags |= TARGETS_INVISIBLE;
    else creep.flags &= ~TARGETS_INVISIBLE;
  };

  /** Ends a blink: the creep can be shot again. */
  const stopBlink = (creep: Creep): void => {
    creep.blinkHops = 0;
    creep.targetable = true;
  };

  /**
   * `Blink.tick` (`Blink.as:35-79`): while a ranked Bolt is not at its target,
   * has fewer than rank*5 waypoints of route left and the end of it is within
   * rank*150 screen px, it blinks: untargetable, it jumps a tenth of the way
   * to the last waypoint each tick for ten ticks and then counts as arrived.
   * It does not walk meanwhile. True when this tick was a hop or the blink's
   * start. A defender's route is the one step to its foe ({@link fight}), so a
   * bunker's Bolt blinks at a foe within its range (owner, 2026-10-20).
   */
  const tickBlink = (creep: Creep): boolean => {
    const last = creep.waypoints[creep.waypoints.length - 1];
    const left = creep.waypoints.length - creep.waypointIndex;
    const within =
      !creep.atTarget &&
      !!last &&
      left > 0 &&
      left < blinkRouteLimit(creep.rank) &&
      screenDistanceSquared(creep.ix, creep.iy, last.x, last.y) <=
        blinkRange(creep.rank) * blinkRange(creep.rank);
    if (!within || !last) {
      if (creep.blinkHops > 0) stopBlink(creep);
      return false;
    }
    if (creep.blinkHops === 0) {
      creep.blinkHops = BLINK_HOPS;
      creep.blinkStep =
        Math.sqrt(screenDistanceSquared(creep.ix, creep.iy, last.x, last.y)) / BLINK_HOPS;
      creep.targetable = false;
      creep.attacking = false;
      return true;
    }
    stepCreep(creep, last.x, last.y, creep.blinkStep);
    creep.blinkHops -= 1;
    visual.push({
      kind: "blink",
      tick,
      creepId: creep.id,
      hop: BLINK_HOPS - creep.blinkHops,
      ix: creep.ix,
      iy: creep.iy,
    });
    if (creep.blinkHops === 0) {
      stopBlink(creep);
      creep.atTarget = true;
    }
    return true;
  };

  const tickCreep = (creep: Creep): void => {
    if (creep.hp <= 0 || creep.gone) return;
    if (creep.behaviour === "retreat") {
      creep.gone = true;
      return;
    }
    // The flame and the auras tick before their creep acts, and a champion's
    // frame counts up in `tickState` before its behaviour reads it (issue #222).
    if (creep.burnDps > 0 && tickBurn(creep)) return;
    if (descentBurning(creep) && tickDescentBurn(creep)) return;
    if (creep.venomStacks > 0 && tickVenom(creep)) return;
    if (creep.rank > 0 && creep.monsterId === BRAIN_ID) tickCloak(creep);
    if (creep.champion) {
      tickAura(creep);
      creep.frame += 1;
      if (creep.monsterId === KORATH_ID && quakeCheck(creep)) {
        moveCreep(creep);
        return;
      }
    }
    if (creep.friendly) {
      if (creep.behaviour === "decoy") tickDecoyed(creep);
      else if (creep.champion) tickCageChampion(creep);
      else if (creep.hatchedBy >= 0) tickSpurtz(creep);
      else tickDefender(creep);
      return;
    }
    if (creep.behaviour === "heal") {
      tickHealer(creep);
      return;
    }
    if (defended && fightsBack(creep) && engage(creep)) return;
    if (creep.support) {
      // `move()`, then `tickBBuff` (`MonsterBase.tick`, `Fomor.as:22-32`).
      supportMove(creep);
      supportThink(creep);
      return;
    }
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
    // A champion looks again every 100 of its frames, a flyer never once it has
    // looked (`ChampionBase.as:804`, issue #222); a monster every 150 ticks.
    const lookAgain = creep.champion
      ? !creep.looking && creep.frame % CHAMPION_RETARGET_FRAMES === 0
      : (tick + creep.phase) % RETARGET_TICKS === 0;
    if (hunting && !creep.attacking && lookAgain) {
      hunting = findTarget(creep);
    }
    if (hunting && creep.targetBuilding < 0) hunting = findTarget(creep);
    if (!hunting) return;
    // A Bolt that blinks spends the tick on its hop (issue #352).
    if (creep.rank > 0 && creep.monsterId === BOLT_ID && tickBlink(creep)) return;

    // A ranged creep stops as soon as its target is inside its range, a circle
    // on screen around the building's anchor, with no wall in the way on foot
    // (`CreepBase.as:735-748`).
    if (!creep.atTarget && creep.range > 1) {
      const aim = creep.targetBuilding >= 0 ? buildingOf(creep.targetBuilding) : null;
      if (aim && canShootBuilding(creep, aim, creep.range)) creep.atTarget = true;
    }

    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += swingDelay(creep);
        swing(creep);
      } else {
        creep.attackCooldown -= 1;
      }
    } else {
      creep.attacking = false;
    }
    // Fomor looks for a wounded ally every 100 frames (`Fomor.as:117-126`).
    if (
      creep.champion &&
      creep.monsterId === FOMOR_ID &&
      creep.behaviour === "attack" &&
      creep.frame % FOMOR_LOOK_FRAMES === 0
    ) {
      findBuffTargets(creep);
      if (creep.support && creep.behaviour === "attack") {
        supportThink(creep);
        supportMove(creep);
        return;
      }
    }
    moveCreep(creep);
  };

  /* ── Towers, traps and bunkers ─────────────────────────────────────────── */

  /** Where a tower looks from and how far, squared, with what it may hit. */
  interface TowerScan {
    readonly flags: number;
    readonly x: number;
    readonly y: number;
    readonly reach: number;
  }

  const scanOf = (tower: Tower): TowerScan => {
    const scan = towerScanPoint(tower.building);
    return {
      flags: towerTargets(tower.building.type),
      x: scan.x,
      y: scan.y,
      reach: tower.range * tower.range,
    };
  };

  /** The targets it holds that it may still shoot: alive, hittable and in range. */
  const liveTargets = (tower: Tower, scan: TowerScan): Creep[] => {
    const live: Creep[] = [];
    for (const id of tower.targets) {
      const creep = byCreepId.get(id);
      if (!creep || creep.hp <= 0 || !creep.targetable) continue;
      if (!canHit(scan.flags, creep.flags)) continue;
      if (distanceSquared(scan.x, scan.y, creep.x, creep.y) >= scan.reach) continue;
      live.push(creep);
    }
    return live;
  };

  /** `FindTargets(count, 1)`: the nearest `count` in range (`BTOWER.as:382-427`). */
  const findTowerTargets = (tower: Tower, scan: TowerScan, count: number): void => {
    const found = index.inRange(tower.range, scan.x, scan.y, scan.flags);
    tower.targets = found.slice(0, count).map((hit) => hit.creep.id);
  };

  /** One shot on a tower's report, and the tick of its first (issue #22). */
  const countShot = (report: TowerReport): void => {
    report.shots += 1;
    if (report.firstShotTick === null) report.firstShotTick = tick;
  };

  const tickTower = (tower: Tower): void => {
    const building = tower.building;
    tower.frame += 1;
    // A Spurtz Cannon culls and finishes its burst even once it has fallen (issue #313).
    if (tower.gun) {
      tickSpurtzCannon(tower, tower.gun);
      return;
    }
    if (building.hp <= 0) return;
    const stats = towerStats(building.type, building.level, yard.kind);
    const base = stats?.damage;
    if (stats?.range === undefined || base === undefined) return;
    // Tower Overdrive (fidelity note 19): on the shot before it is cut to a whole number.
    const damage = towerBoost === 1 ? base : base * towerBoost;
    if (building.type === AERIAL_DEFENSE_TYPE) {
      tickSalvo(tower, damage, stats.rate ?? 0, stats.splash ?? 0);
      return;
    }
    // A Quake Tower winding up does nothing else, its fire tick standing still.
    if (building.type === QUAKE_TOWER_TYPE && tower.stage === 1) {
      windQuake(tower, damage);
      return;
    }
    rearm(tower, damage, stats.rate ?? 0, stats.splash ?? 0);
    if (building.type === TESLA_TYPE) tickZaps(tower, damage, stats.rate ?? 0);
  };

  /** `BTOWER.TickAttack` (`BTOWER.as:171-229`): count down, then find targets or fire. */
  const rearm = (tower: Tower, damage: number, rate: number, splash: number): void => {
    const building = tower.building;
    tower.fireTick -= 1;
    if (tower.fireTick > 0) return;
    tower.fireTick += rate * TOWER_REARM_MULTIPLIER;

    // On the Vacuum's hose it shoots nothing else till the hose is gone (`BTOWER.as:197-204`).
    if (tower.onHose) {
      if (vacuum) shootHose(tower, damage, splash, towerTargets(building.type));
      else tower.onHose = false;
      return;
    }
    const scan = scanOf(tower);
    const live = liveTargets(tower, scan);
    if (live.length === 0) {
      // With nobody to shoot, the hose if it can reach it (`:181-185`).
      if (hoseInReach(tower)) {
        tower.onHose = true;
        tower.fireTick = TOWER_ACQUIRE_TICKS;
        return;
      }
      findTowerTargets(tower, scan, 1);
      // Every re-acquire path resets the fire tick to 30 (`BTOWER.as:184`, `:189`, `:220`).
      tower.fireTick = TOWER_ACQUIRE_TICKS;
      return;
    }

    // Every tower's shot is worth less as it is hurt (issue #264, `towerHealthScale`):
    // `int(damage * scale)`, but the Railgun's beam is not truncated (`BUILDING118.as:195`).
    const shot = towerShotDamage(damage, building.hp, building.maxHp);
    for (const creep of live) {
      // A landed jar takes the shot instead (Inferno WP 6.7, `BTOWER.Fire`, `isJard`).
      const jar = crackJar(building);
      if (building.type === TESLA_TYPE) {
        armCoil(tower, creep.id);
        continue;
      }
      if (building.type === QUAKE_TOWER_TYPE) {
        // `INFERNOQUAKETOWER.Fire` (`:128-135`): the wind-up starts. Its jar
        // takes the blow at the end of it ({@link windQuake}).
        tower.stage = 1;
        tower.charge = 0;
        continue;
      }
      if (jar && hitJar(tower, jar, damage)) continue;
      countShot(tower.report);
      if (building.type === LASER_TYPE) {
        fireLaser(tower, creep, shot, splash);
        continue;
      }
      if (building.type === RAILGUN_TYPE) {
        fireRailgun(tower, creep, damage * towerHealthScale(building.hp, building.maxHp));
        continue;
      }
      // The Magma Tower's fireball is such a shell (`INFERNO_MAGMA_TOWER.as:56-79`):
      // one target, no splash. Its `FlameEffect` (`:81-89`) is a listener
      // nothing ever adds, so a creep it hits does not burn.
      fireShell(tower, creep, shot, splash, shellBlastTargets(building.type));
    }
  };

  /**
   * One tick of a Quake Tower's wind-up (`INFERNOQUAKETOWER.TickAttack`,
   * `:107-122`), and its quake on the tick after the strip's last cell
   * (`DelayedFire`, `:137-159`): a landed jar takes the blow instead.
   */
  const windQuake = (tower: Tower, damage: number): void => {
    tower.quakeFrame += 1;
    const step =
      tower.quakeFrame % QUAKE_FRAME_TICKS === 0 || tower.charge >= QUAKE_ANIM_FRAMES - 4;
    if (!step) return;
    if (tower.charge < QUAKE_ANIM_FRAMES) {
      tower.charge += 1;
      return;
    }
    tower.stage = 0;
    const jar = jarOn(tower.building);
    if (jar && hitJar(tower, jar, damage)) return;
    quakeTower(tower, Math.trunc(damage));
  };

  /**
   * `INFERNOQUAKETOWER.Quake` (`:161-189`): every creep on the ground or unseen
   * within the range of the scan point takes {@link quakeDamage}. The tower's
   * health does not weaken it. A Vacuum hose within range of the tower's
   * `_position` takes `int(power / range * (range - d))`, `d` the tower to the
   * Town Hall the hose is on (`:183-187`), with no floor.
   */
  const quakeTower = (tower: Tower, power: number): void => {
    countShot(tower.report);
    const scan = towerScanPoint(tower.building);
    for (const hit of index.inRange(tower.range, scan.x, scan.y, QUAKE_TARGETS)) {
      const creep = hit.creep;
      const before = creep.hp;
      const dealt = quakeDamage(power, tower.range, hit.dist, creep.hp);
      tower.report.damageDealt += damageCreep(creep, dealt);
      if (before > 0 && creep.hp <= 0) tower.report.kills += 1;
    }
    const hose = vacuum;
    if (!hose) return;
    const building = tower.building;
    const x = hose.target.sx - building.sx;
    const y = vacuumHoseY(hose.target.sy, tick - hose.droppedAt) - building.sy;
    if (Math.sqrt(x * x + y * y) >= tower.range) return;
    const hallY = hose.target.sy - building.sy;
    const hall = Math.sqrt(x * x + hallY * hallY);
    hose.health -= Math.trunc((power / tower.range) * (tower.range - hall));
  };

  /** A shell at `creep` carrying `shot`, then its blast, if it has one. */
  const fireShell = (
    tower: Tower,
    creep: Creep,
    shot: number,
    splash: number,
    flags: number,
  ): void => {
    visual.push({
      kind: "shot",
      tick,
      towerId: tower.building.id,
      creepId: creep.id,
      ix: creep.ix,
      iy: creep.iy,
    });
    const before = creep.hp;
    tower.report.damageDealt += damageCreep(creep, shot);
    if (before > 0 && creep.hp <= 0) tower.report.kills += 1;
    if (splash <= 0) return;
    // `DealLinearAEDamage` over the blast, with its floor of a fifth (`:340-389`),
    // of what the shell carries.
    for (const hit of index.inRange(splash, creep.x, creep.y, flags, creep.id)) {
      const linear = (shot / splash) * (splash - hit.dist);
      const dealt = Math.max(linear, shot / 5);
      const health = hit.creep.hp;
      tower.report.damageDealt += damageCreep(hit.creep, dealt);
      if (health > 0 && hit.creep.hp <= 0) tower.report.kills += 1;
    }
  };

  /**
   * A Spurtz Cannon's loop (issue #313, `SpurtzCannon.TickAttack`,
   * `SpurtzCannon.as:109-118`): its `TickFast` cull, standing or not, then
   * `BTOWER.TickAttack`'s reload, the barrel, the aim and a shot. Flash's goes
   * on turning and firing out its burst once it has fallen; ours stops dead,
   * the owner's call (2026-10-06).
   */
  const tickSpurtzCannon = (tower: Tower, gun: SpurtzGun): void => {
    const building = tower.building;
    cullSpurtz(tower, gun);
    if (building.hp <= 0) return;
    const stats = towerStats(building.type, building.level, yard.kind);
    const base = stats?.damage;
    if (stats?.range === undefined || base === undefined) return;
    const damage = towerBoost === 1 ? base : base * towerBoost;

    tower.fireTick -= 1;
    if (tower.fireTick <= 0) {
      tower.fireTick += (stats.rate ?? 0) * TOWER_REARM_MULTIPLIER;
      const scan = scanOf(tower);
      const live = liveTargets(tower, scan).length > 0;
      // `FindTargets` keeps the list it had when it finds nobody (`BTOWER.as:395-426`).
      const found = index.inRange(tower.range, scan.x, scan.y, scan.flags);
      if (found.length > 0) {
        gun.targets = found.slice(0, SPURTZ_MAX_TARGETS).map((hit) => hit.creep);
        tower.targets = gun.targets.map((creep) => creep.id);
      } else {
        tower.targets = [];
      }
      if (!live) {
        tower.fireTick = TOWER_ACQUIRE_TICKS;
      } else if (gun.targets.length > 0) {
        // `Fire` on every target held: each takes the nearest ten again and
        // aims at the one it was handed, so the last of them wins (`:83-91`).
        gun.target = gun.targets[gun.targets.length - 1] as Creep;
        gun.index = 0;
        tower.shotsFired = 0;
        aimSpurtz(tower, gun);
        crackJar(building);
      }
    }
    // `BTOWER.TickAttack` ends with `TickJar`, before the Spurtz's own shot (Inferno WP 6.7).
    const own = jars.size > 0 ? jars.get(building.id) : undefined;
    if (own) tickJar(own);

    // `updateTarget` (`:120-131`): only the first in the list has to be alive.
    const first = gun.targets[0];
    if (!first || first.hp <= 0 || first.gone) {
      gun.target = null;
    } else if (
      Math.abs(gun.aim - gun.barrel) <= SPURTZ_SWITCH_ANGLE &&
      gun.targets.length > 1
    ) {
      gun.index = (gun.index + 1) % gun.targets.length;
      gun.target = gun.targets[gun.index] as Creep;
      aimSpurtz(tower, gun);
    }
    if (!gun.target) return;
    gun.barrel = turnSpurtzBarrel(gun.barrel, gun.aim);
    if (
      tower.fireTick % SPURTZ_SHOT_TICKS === 0 &&
      tower.shotsFired < (stats.shots ?? 0) &&
      (Math.abs(gun.aim - gun.barrel) <= SPURTZ_START_ANGLE || tower.shotsFired > 0)
    ) {
      // A landed jar takes it, and the burst does not count it (`shootJar`, `:173-201`).
      const jar = jarOn(building);
      if (jar) hitJar(tower, jar, damage);
      else shootSpurtz(tower, gun, gun.target, damage, stats.speed ?? 0);
    }
  };

  /** `setAngleToTarget` (`:141-144`): from just above the anchor to where the target is drawn. */
  const aimSpurtz = (tower: Tower, gun: SpurtzGun): void => {
    if (!gun.target) return;
    const at = screenPointOf(gun.target.ix, gun.target.iy);
    gun.aim = seriesAtan2Degrees(
      tower.building.sy + SPURTZ_MUZZLE_RISE - Math.trunc(at.y),
      tower.building.sx - Math.trunc(at.x),
    );
  };

  /**
   * `shoot` (`:173-191`): a shell down the barrel as far as the target is,
   * scattered, from the muzzle; `FIREBALLS.Spawn2` then the random scale.
   */
  const shootSpurtz = (
    tower: Tower,
    gun: SpurtzGun,
    target: Creep,
    damage: number,
    speed: number,
  ): void => {
    const building = tower.building;
    const at = screenPointOf(target.ix, target.iy);
    const dx = Math.trunc(at.x) - building.sx;
    const dy = Math.trunc(at.y) - building.sy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // `barrel + 180` degrees: its cosine and sine are the barrel's, negated.
    const radians = gun.barrel * (Math.PI / 180);
    const scatter = distance * SPURTZ_SCATTER;
    const toX = building.sx - seriesCos(radians) * distance + (rng.float() * scatter * 2 - scatter);
    const toY = building.sy - seriesSin(radians) * distance + (rng.float() * scatter * 2 - scatter);
    const fromX = building.sx;
    const fromY = building.sy - SPURTZ_MUZZLE_RISE;
    const scale = rng.float() * SPURTZ_SCALE_SPREAD + SPURTZ_SCALE_MIN;
    // It flies at `speed * 0.5` along its heading; `atan2(0, 0)` is 0, along +x.
    const headX = toX - fromX;
    const headY = toY - fromY;
    const length = Math.sqrt(headX * headX + headY * headY);
    const step = speed * 0.5;
    const shell: SpurtzShell = {
      tower,
      x: fromX,
      y: fromY,
      toX,
      toY,
      stepX: length > 0 ? (headX / length) * step : step,
      stepY: length > 0 ? (headY / length) * step : 0,
      step,
      speed,
      damage: towerShotDamage(damage, building.hp, building.maxHp),
      scale,
    };
    spurtzShells.push(shell);
    tower.shotsFired += 1;
    countShot(tower.report);
    // It lands on the first loop its distance left is within `speed`; the first
    // of those loops is this one (`FIREBALLS.Tick` runs after the towers).
    const flight = step > 0 ? Math.max(1, Math.ceil((length - speed) / step)) : 1;
    // Where it goes off, which falls short of where it was fired by up to `speed`.
    const landX = fromX + shell.stepX * flight;
    const landY = fromY + shell.stepY * flight;
    visual.push({
      kind: "shot",
      tick,
      towerId: building.id,
      creepId: target.id,
      ix: landX / 2 + landY,
      iy: landY - landX / 2,
      lob: {
        fromIx: fromX / 2 + fromY,
        fromIy: fromY - fromX / 2,
        toIx: landX / 2 + landY,
        toIy: landY - landX / 2,
        landTick: tick + flight - 1,
        scale,
      },
    });
  };

  /**
   * `FIREBALLS.Tick` for the Spurtz shells, after the towers, in the order
   * they were fired (`FIREBALL.as:92-141`): each moves, and lands once its
   * distance left, less this move, is within its `speed`.
   */
  const tickSpurtzShells = (): void => {
    if (spurtzShells.length === 0) return;
    let write = 0;
    for (let read = 0; read < spurtzShells.length; read += 1) {
      const shell = spurtzShells[read] as SpurtzShell;
      const left = Math.sqrt((shell.toX - shell.x) ** 2 + (shell.toY - shell.y) ** 2);
      shell.x += shell.stepX;
      shell.y += shell.stepY;
      if (left - shell.step <= shell.speed) {
        landSpurtzShell(shell);
        continue;
      }
      spurtzShells[write] = shell;
      write += 1;
    }
    spurtzShells.length = write;
  };

  /**
   * `collidedWithTarget` (`SpurtzCannon.as:226-244`). Flash's blast borrows
   * the cannon's most recent shell, `_projectile`, for its size, its damage
   * and the height on screen it goes off at; ours is the landing shell's own,
   * the owner's call (2026-10-06). Ground attackers inside take
   * `DealLinearAEDamage` with its floor of a fifth, in whole points
   * (`Targeting.as:340-389`); then half the time a Spurtz hatches.
   */
  const landSpurtzShell = (shell: SpurtzShell): void => {
    const tower = shell.tower;
    const radius = spurtzBlastRadius(shell.scale);
    const centre = fromIso(shell.x, shell.y);
    const report = tower.report;
    for (const hit of index.inRange(radius, centre.x, centre.y, oldStyleTargets(0))) {
      const dist = Math.trunc(hit.dist);
      if (radius < dist) continue;
      const linear = Math.trunc((shell.damage / radius) * (radius - dist));
      const dealt = Math.max(linear, Math.trunc(shell.damage / 5));
      const before = hit.creep.hp;
      report.damageDealt += damageCreep(hit.creep, dealt);
      if (before > 0 && hit.creep.hp <= 0) report.kills += 1;
    }
    if (rng.float() > SPURTZ_HATCH_CHANCE) {
      pendingSpurtz.push({ tower, x: Math.trunc(shell.x), y: Math.trunc(shell.y) });
    }
  };

  /**
   * `killSpurts` (`SpurtzCannon.as:98-107`), from its `TickFast`: once a 40 fps
   * frame, standing or not, each Spurtz past {@link SPURTZ_CULL_FRAMES} frames
   * dies if it has nobody to fight, else one time in ten.
   */
  const cullSpurtz = (tower: Tower, gun: SpurtzGun): void => {
    if (tower.frame % SPURTZ_CULL_TICKS !== 0) return;
    for (let at = gun.hatched.length - 1; at >= 0; at -= 1) {
      const spurtz = gun.hatched[at] as Creep;
      if (
        tick - spurtz.born > SPURTZ_CULL_FRAMES &&
        (rng.float() > SPURTZ_CULL_ROLL || spurtz.targetCreep < 0) &&
        spurtz.hp > 0
      ) {
        spurtz.hp = 0;
        spurtz.gone = true;
        recordDeath(spurtz);
        onDeath(spurtz);
      }
      if (spurtz.hp <= 0 || spurtz.gone) gun.hatched.splice(at, 1);
    }
  };

  /**
   * The Aerial Defense Tower's reload and salvo (issue #265,
   * {@link AERIAL_DEFENSE_TYPE}, `BUILDING115.as:40-96`).
   */
  const tickSalvo = (tower: Tower, damage: number, rate: number, splash: number): void => {
    const building = tower.building;
    const salvo = aerialSalvo(building.level);
    if (tower.stage === 1) {
      tower.fireTick -= 1;
      if (tower.fireTick > 0) return;
      tower.stage = 2;
      tower.shotsFired = 0;
      tower.fireTick += rate * TOWER_REARM_MULTIPLIER;
    }
    const scan = scanOf(tower);
    // The Vacuum's hose comes before any creep (`BUILDING115.as:61-69`, Inferno WP 6.6).
    if (hoseInReach(tower)) {
      tower.onHose = true;
      tower.fireTick = TOWER_ACQUIRE_TICKS;
    } else if (liveTargets(tower, scan).length === 0) {
      tower.onHose = false;
      findTowerTargets(tower, scan, salvo);
      tower.fireTick = TOWER_ACQUIRE_TICKS;
    }
    // Flash fires at a hose that is gone and throws; ours goes back to its creeps.
    if (!vacuum) tower.onHose = false;
    if (!tower.onHose && tower.targets.length === 0) return;
    if (tower.shotsFired >= salvo) {
      tower.stage = 1;
      return;
    }
    if (tower.frame % AERIAL_SHOT_TICKS !== 0) return;
    if (tower.onHose) {
      tower.shotsFired += 1;
      shootHose(tower, damage, splash, scan.flags);
      return;
    }
    const aim = tower.targets[tower.shotsFired % tower.targets.length] as number;
    const creep = byCreepId.get(aim);
    // A target found dead costs the frame its shot; the tower looks again (`:84-93`).
    if (!creep || creep.hp <= 0) {
      findTowerTargets(tower, scan, salvo);
      return;
    }
    tower.shotsFired += 1;
    const jar = crackJar(building);
    if (jar && hitJar(tower, jar, damage)) return;
    countShot(tower.report);
    const shot = towerShotDamage(damage, building.hp, building.maxHp);
    fireShell(tower, creep, shot, splash, scan.flags);
  };

  /**
   * The Tesla's `Fire` (`BUILDING25.as:84-96`): it names its target, and an
   * idle coil starts to charge ({@link TESLA_TYPE}, issue #266).
   */
  const armCoil = (tower: Tower, creepId: number): void => {
    tower.zapTarget = creepId;
    if (tower.stage !== 0) return;
    tower.stage = 1;
    visual.push({ kind: "charge", tick, towerId: tower.building.id });
  };

  /**
   * The Tesla leaves its zaps for the wind-down (drawing only, {@link BattleVisualEvent}
   * `coilRest`). Spent, it can charge again once the wind-down is over, a cell
   * every second frame, at the first `Fire` after, one a reload apart.
   */
  const restCoil = (tower: Tower, rate: number, spent: boolean): void => {
    tower.stage = 3;
    const windTicks = ((TESLA_WIND_END - tower.charge) * 2 + 1) * TESLA_TICKS_PER_FRAME;
    const reload = Math.max(rate * TOWER_REARM_MULTIPLIER, TOWER_ACQUIRE_TICKS);
    visual.push({
      kind: "coilRest",
      tick,
      towerId: tower.building.id,
      rearmBy: spent ? tick + windTicks + reload : null,
    });
  };

  /** The Tesla's `TickFast`, once a frame: charge, zaps, wind-down (`BUILDING25.as:98-203`). */
  const tickZaps = (tower: Tower, damage: number, rate: number): void => {
    if (tower.frame % TESLA_TICKS_PER_FRAME !== 0) return;
    const frame = tower.frame / TESLA_TICKS_PER_FRAME;
    if (tower.stage === 1) {
      tower.charge += 1;
      if (tower.charge === TESLA_CHARGE_END) {
        tower.stage = 2;
        tower.shotsFired = 0;
      }
      return;
    }
    if (tower.stage === 3) {
      if (frame % 2 !== 0) return;
      tower.charge += 1;
      if (tower.charge === TESLA_WIND_END) {
        tower.charge = 0;
        tower.stage = 0;
      }
      return;
    }
    if (tower.stage !== 2) return;
    tower.charge += 1;
    if (tower.charge === TESLA_LOOP_END) tower.charge = TESLA_CHARGE_END;
    if (frame % TESLA_ZAP_FRAMES !== 0) return;
    const building = tower.building;
    const target = byCreepId.get(tower.zapTarget);
    // It zaps the creep it named wherever that is now; a dead one takes nothing.
    // Named none, it zaps the Vacuum's hose while it can reach it (`:137-152`).
    const zapsHose = tower.onHose && tower.zapTarget < 0 && hoseInReach(tower);
    // With anything to zap, a landed jar takes the zap first (`:130-136`, Inferno WP 6.7).
    const jar = tower.targets.length > 0 || tower.onHose ? jarOn(building) : null;
    if (jar) {
      hitJar(tower, jar, damage);
    } else if ((tower.targets.length > 0 || tower.onHose) && target && target.hp > 0) {
      countShot(tower.report);
      visual.push({
        kind: "shot",
        tick,
        towerId: building.id,
        creepId: target.id,
        ix: target.ix,
        iy: target.iy,
      });
      tower.report.damageDealt += damageCreep(
        target,
        towerShotDamage(damage, building.hp, building.maxHp),
      );
      if (target.hp <= 0) tower.report.kills += 1;
    } else if (zapsHose && vacuum) {
      countShot(tower.report);
      vacuum.health -= towerShotDamage(damage, building.hp, building.maxHp);
    }
    tower.shotsFired += 1;
    if (tower.shotsFired >= rate) {
      restCoil(tower, rate, true);
      return;
    }
    // On the hose it stays on it while it can reach it, else it looks for creeps
    // (`:161-173`); one whose creep is gone turns to the hose if it can (`:174-177`).
    if (tower.onHose) {
      if (hoseInReach(tower)) return;
      findTowerTargets(tower, scanOf(tower), 1);
      if (tower.targets.length === 0) restCoil(tower, rate, false);
      return;
    }
    if (target && target.hp > 0 && target.targetable) return;
    if (hoseInReach(tower)) {
      tower.onHose = true;
      return;
    }
    const scan = scanOf(tower);
    findTowerTargets(tower, scan, 1);
    if (tower.targets.length === 0) restCoil(tower, rate, false);
  };


  /**
   * The Railgun's shot (issue #261): a beam at `aim` and on past it that hurts
   * every ground creep on its line by `dealt`, its damage already scaled by its
   * own health ({@link RAILGUN_TYPE}, `BUILDING118.as:133-198`).
   */
  const fireRailgun = (tower: Tower, aim: Creep, dealt: number): void => {
    const building = tower.building;
    // On screen, as `Fire` works: the muzzle, then 50 segments along the bearing.
    const fromX = building.sx;
    const fromY = building.sy + RAILGUN_MUZZLE_DROP;
    // It aims at the target's `x`/`y`, its graphic, drawn at `int(_tmpPoint)`
    // (`GameObject.as:126-132`, `MonsterBase.as:614-616`).
    const target = screenPointOf(aim.ix, aim.iy);
    // `cos(atan2(dy, dx))` and `sin(atan2(dy, dx))` are the unit vector along
    // `(dx, dy)`, taken with `sqrt` alone (§3.4 rule 3); `atan2(0, 0)` is 0,
    // straight along +x.
    const dx = Math.trunc(target.x) - fromX;
    const dy = Math.trunc(target.y) - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    const alongX = length > 0 ? dx / length : 1;
    const alongY = length > 0 ? dy / length : 0;
    const toX = fromX + alongX * RAILGUN_SEGMENT * RAILGUN_SEGMENTS;
    const toY = fromY + alongY * RAILGUN_SEGMENT * RAILGUN_SEGMENTS;
    visual.push({
      kind: "shot",
      tick,
      towerId: building.id,
      creepId: aim.id,
      ix: aim.ix,
      iy: aim.iy,
      beam: {
        fromIx: fromX / 2 + fromY,
        fromIy: fromY - fromX / 2,
        toIx: toX / 2 + toY,
        toIy: toY - toX / 2,
      },
    });
    const muzzle = fromIso(fromX, fromY);
    for (const hit of index.inRange(RAILGUN_REACH, muzzle.x, muzzle.y, TRAP_TARGETS)) {
      const at = screenPointOf(hit.creep.ix, hit.creep.iy);
      if (!beamHits(fromX, fromY, toX, toY, at.x, at.y, RAILGUN_BEAM_RADIUS)) continue;
      const before = hit.creep.hp;
      tower.report.damageDealt += damageCreep(hit.creep, dealt);
      if (before > 0 && hit.creep.hp <= 0) tower.report.kills += 1;
    }
  };

  /**
   * The Laser's shot (issue #267, {@link LASER_TYPE}): a beam from below the
   * tower that starts short of `aim` and sweeps across it. It hurts nothing
   * now; {@link tickLaserBeams} pulses it from the next tick on.
   */
  const fireLaser = (tower: Tower, aim: Creep, damage: number, splash: number): void => {
    const building = tower.building;
    // `EFFECTS.Laser(x, y + 35, target.x, target.y, ...)`, all `int` (`BUILDING23.as:65`).
    const fromX = building.sx;
    const fromY = building.sy + LASER_DROP;
    const target = screenPointOf(aim.ix, aim.iy);
    const toX = Math.trunc(target.x);
    const toY = Math.trunc(target.y);
    visual.push({
      kind: "shot",
      tick,
      towerId: building.id,
      creepId: aim.id,
      ix: aim.ix,
      iy: aim.iy,
      sweep: {
        fromIx: fromX / 2 + fromY,
        fromIy: fromY - fromX / 2,
        toIx: toX / 2 + toY,
        toIy: toY - toX / 2,
      },
    });
    laserBeams.push({
      tower,
      sweep: laserSweep(fromX, fromY, toX, toY),
      damage,
      splash,
      duration: 0,
      frame: 0,
    });
  };

  /**
   * `LASERS.Tick`, once a loop (`LASER.as:71-172`): each beam turns, and
   * every {@link LASER_PULSE_TICKS} of its frames pulses what is round its
   * end; past {@link LASER_TICKS} it is gone.
   */
  const tickLaserBeams = (): void => {
    if (laserBeams.length === 0) return;
    let write = 0;
    for (let read = 0; read < laserBeams.length; read += 1) {
      const beam = laserBeams[read] as LaserBeam;
      if (beam.duration > LASER_TICKS) continue;
      laserBeams[write] = beam;
      write += 1;
      beam.duration += 1;
      const pulse = beam.frame % LASER_PULSE_TICKS === 0;
      beam.frame += 1;
      if (!pulse) continue;
      const end = laserEnd(beam.sweep, beam.duration);
      if (!end) continue;
      const at = fromIso(end.x, end.y);
      const report = beam.tower.report;
      for (const hit of index.inRange(beam.splash, at.x, at.y, TRAP_TARGETS)) {
        const before = hit.creep.hp;
        report.damageDealt += damageCreep(
          hit.creep,
          laserPulse(beam.damage, beam.splash, hit.dist),
        );
        if (before > 0 && hit.creep.hp <= 0) report.kills += 1;
      }
    }
    laserBeams.length = write;
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
    // A Heavy Trap only goes off for the big creatures (issue #259).
    if (!watching.some((hit) => tripsTrap(building.type, hit.creep.monsterId))) return;

    // `Explode` hits everything inside `size`, not just what tripped it.
    let touched = 0;
    let dealt = 0;
    let kills = 0;
    for (const hit of index.inRange(spec.size, building.cx, building.cy, TRAP_TARGETS)) {
      if (hit.creep.hp <= 0) continue;
      touched += 1;
      dealt += damageCreep(hit.creep, trapDamageAt(building.type, hit.dist));
      if (hit.creep.hp <= 0) kills += 1;
    }
    // A Heavy Trap's second pass, over the flyers at half (`BHEAVYTRAP.as:68-82`, issue #259).
    if (building.type === HEAVY_TRAP_TYPE) {
      for (const hit of index.inRange(spec.size, building.cx, building.cy, oldStyleTargets(2))) {
        if (hit.creep.hp <= 0) continue;
        touched += 1;
        dealt += damageCreep(hit.creep, heavyTrapFlyerDamageAt(hit.dist));
        if (hit.creep.hp <= 0) kills += 1;
      }
    }
    if (touched === 0) return;
    building.fired = true;
    building.hp = 0;
    firedTraps.push(building.id);
    trapReports.push({ id: building.id, type: building.type, tick, damageDealt: dealt, kills });
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
    // (`BUILDING22.as:340-354`); the interceptor pick is the random draw.
    // Scanned from the middle of the footprint, like a tower (`BUILDING22.as:90`).
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
    sendFromBunker(bunker, monsterId, (found[0] as { creep: Creep }).creep, range, scan);
  };

  /**
   * A Housing Bunker's turn ({@link HOUSING_BUNKER_TYPE}): every 30 ticks, a
   * Balthazar or Sabnox after each flyer in range, then everything it still
   * holds at the nearest walker. A bunker keeps its healers in (issue #195).
   */
  const tickHousingBunker = (bunker: Bunker): void => {
    const building = bunker.building;
    if (building.hp <= 0) return;
    bunker.tickNumber += 1;
    if (bunker.tickNumber % 30 !== 0 || building.busy) return;
    if (![...bunker.pool.values()].some((count) => count > 0)) return;
    const range = towerStats(building.type, building.level, yard.kind)?.range ?? 0;
    if (range <= 0) return;
    // Scanned from the middle of the footprint, like a tower (`HOUSINGBUNKER.as:156`).
    const scan = towerScanPoint(building);
    const nearest = (flags: number): Creep[] => {
      const found: Creep[] = [];
      const hits = index.inRange(range, scan.x, scan.y, flags);
      for (let at = 0; at < hits.length && at < HOUSING_BUNKER_TARGETS; at += 1) {
        const creep = (hits[at] as { creep: Creep }).creep;
        if (creep.behaviour !== "retreat" && !creep.gone) found.push(creep);
      }
      return found;
    };
    const walkers = nearest(oldStyleTargets(0));
    const canIntercept = HOUSING_BUNKER_INTERCEPTORS.some((id) => (bunker.pool.get(id) ?? 0) > 0);
    const flyers = canIntercept ? nearest(oldStyleTargets(2)) : [];
    for (const flyer of flyers) {
      const monsterId = HOUSING_BUNKER_INTERCEPTORS.find((id) => (bunker.pool.get(id) ?? 0) > 0);
      if (!monsterId) break;
      sendFromBunker(bunker, monsterId, flyer, range, scan);
    }
    const walker = walkers[0];
    if (!walker) return;
    for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
      if (monsterStat(monsterId, "damage", 1) <= 0) continue;
      for (let sent = 0; sent < count; sent += 1) {
        sendFromBunker(bunker, monsterId, walker, range, scan);
      }
    }
  };

  /**
   * One of a bunker's monsters out at `foe`. It chases nothing outside the
   * bunker's own range, and walks back in (issue #195).
   */
  const sendFromBunker = (
    bunker: Bunker,
    monsterId: string,
    foe: Creep,
    range: number,
    scan: Cart,
  ): void => {
    const building = bunker.building;
    bunker.pool.set(monsterId, (bunker.pool.get(monsterId) ?? 0) - 1);
    bunker.dispatched += 1;
    const sentBy = bunkerReports.get(building.id);
    if (sentBy) sentBy.sent += 1;
    visual.push({ kind: "release", tick, buildingId: building.id });
    const level = clampLevel(options.defenderLevels ?? options.levels, monsterId);
    const defender = spawnCreep(
      monsterId,
      level,
      { x: building.x, y: building.y },
      true,
      "defend",
      building.id,
      1,
      rankOf(options.defenderRanks, monsterId),
    );
    defender.targetCreep = foe.id;
    defender.home = {
      ix: building.x,
      iy: building.y,
      centreX: scan.x,
      centreY: scan.y,
      leash: range,
    };
  };

  /**
   * A Housing Bunker fell: every monster it houses dies, those it never sent
   * and those out fighting (`HOUSINGBUNKER.as:116-127`), each counted against it.
   */
  const housingBunkerFalls = (id: number): void => {
    const bunker = bunkerById.get(id);
    if (!bunker) return;
    for (const [monsterId, count] of [...bunker.pool.entries()].sort()) {
      for (let lost = 0; lost < count; lost += 1) addBunkerLoss(bunkerLosses, id, monsterId);
    }
    bunker.pool.clear();
    for (const creep of creeps) {
      if (creep.homeBunker === id && !creep.gone && creep.hp > 0) creep.hp = 0;
    }
  };

  /**
   * A caged champion in its cage (issue #260): it counts its frame and every
   * {@link CAGE_LOOK_FRAMES} looks around itself (`tickBPen`,
   * `ChampionBase.as:1055-1057`), and comes out at what it finds. One that got
   * back from a fight goes in first, and does not look that frame
   * (`tickBCage`, `:1114-1133`). Each of the cage's champions does this on its
   * own, in the order supplied (issue #310).
   */
  const tickCageSlot = (slot: CageSlot): void => {
    const out = slot.champion;
    if (!slot.pen && out && out.homing && out.atTarget && out.hp > 0 && !out.gone) {
      goInCage(slot, out);
      return;
    }
    const pen = slot.pen;
    if (!pen) return;
    const frame = pen.frame + 1;
    const foe =
      frame % CAGE_LOOK_FRAMES === 0
        ? defenceTarget(pen.x, pen.y, pen.hitFlags, pen.flying)
        : undefined;
    if (!foe) {
      pen.frame = frame;
      return;
    }
    // Its own tick this step counts the frame, as `tickState` does before `tickBPen`.
    let champion = slot.champion;
    if (champion) {
      champion.frame = pen.frame;
      champion.targetable = true;
      // Back in its place, so the creeps still step in id order.
      const after = creeps.findIndex((creep) => creep.id > (champion as Creep).id);
      creeps.splice(after < 0 ? creeps.length : after, 0, champion);
      byCreepId.set(champion.id, champion);
    } else {
      champion = releaseChampion(slot.caged, pen, slot.report.hp);
    }
    slot.pen = null;
    if (!champion) return;
    slot.champion = champion;
    champion.born = tick;
    champion.homing = false;
    champion.attacking = false;
    champion.atTarget = false;
    takeFoe(champion, foe);
  };

  const tickCage = (): void => {
    for (const slot of cageSlots) tickCageSlot(slot);
  };

  /**
   * A caged champion goes back in (issue #260): off the field, where it
   * stopped, with the health it has and the frame it is on. It lets go of
   * whatever its aura held.
   */
  const goInCage = (slot: CageSlot, creep: Creep): void => {
    slot.pen = {
      ix: creep.ix,
      iy: creep.iy,
      x: creep.x,
      y: creep.y,
      // This is its tick: `tickState` counts the frame before `tickBCage` sends it in.
      frame: creep.frame + 1,
      flying: creep.flying,
      hitFlags: creep.hitFlags,
    };
    slot.report.hp = creep.hp;
    if (creep.aura) letGo(creep, creep.aura, new Set());
    creep.targetCreep = -1;
    creep.atTarget = false;
    creep.attacking = false;
    creep.waypoints = [];
    // Still in this step's index: hidden, so no scan finds it there.
    creep.targetable = false;
    const at = creeps.indexOf(creep);
    if (at >= 0) creeps.splice(at, 1);
    byCreepId.delete(creep.id);
  };

  /**
   * `FindDefenseTargets`' pick (`ChampionBase.as:504-516`): the nearest
   * attacker within {@link CHAMPION_DEFEND_SCAN} that it can hit, passing over
   * one that is retreating and, for a champion on the ground, an Eye-ra.
   */
  const defenceTarget = (
    x: number,
    y: number,
    flags: number,
    flying: boolean,
  ): Creep | undefined =>
    index
      .inRange(CHAMPION_DEFEND_SCAN, x, y, flags)
      .find(
        ({ creep }) => creep.behaviour !== "retreat" && (flying || creep.monsterId !== EYE_RA_ID),
      )?.creep;

  /** The caged champion's foe while it lives, else undefined. */
  const liveFoe = (creep: Creep): Creep | undefined => {
    const foe = creep.targetCreep >= 0 ? byCreepId.get(creep.targetCreep) : undefined;
    return foe && foe.hp > 0 && !foe.gone && !unseen(foe) ? foe : undefined;
  };

  /** `interceptTarget`: on to a new foe, swinging at once if already in range (`:482-485`). */
  const takeFoe = (creep: Creep, foe: Creep): void => {
    creep.targetCreep = foe.id;
    const squared = screenDistanceSquared(creep.ix, creep.iy, foe.ix, foe.iy);
    if (squared < creep.range * creep.range) creep.atTarget = true;
  };

  /**
   * `FindDefenseTargets` (`ChampionBase.as:504-545`) for the caged champion
   * out of its cage: the nearest foe around it, else the one it has while that
   * one lives, else back to the cage.
   */
  const lookForFoe = (creep: Creep): void => {
    const found = defenceTarget(creep.x, creep.y, creep.hitFlags, creep.flying);
    if (found) {
      creep.homing = false;
      takeFoe(creep, found);
      return;
    }
    if (liveFoe(creep)) {
      creep.homing = false;
      return;
    }
    if (creep.homing) return;
    // `changeModeCage` (`:295-303`).
    creep.targetCreep = -1;
    creep.atTarget = false;
    creep.attacking = false;
    creep.homing = true;
  };

  /** A step straight at a point: the cage, or a foe where it stands now. */
  const walkTo = (creep: Creep, to: Cart): void => {
    creep.attacking = false;
    creep.waypoints = [to];
    creep.waypointIndex = 0;
    moveCreep(creep);
  };

  /**
   * The caged champion out of its cage (issue #260): `tickBDefend`
   * (`ChampionBase.as:851-918`) while it has a foe, and on its way back
   * `tickBCage` (`:1113-1137`), which only looks. No leash: it chases a foe
   * wherever it goes.
   */
  const tickCageChampion = (creep: Creep): void => {
    // The tick it came out, `tickBPen` found its foe and `move()` only sets off.
    if (creep.born === tick) {
      const foe = liveFoe(creep);
      if (foe && !creep.atTarget) walkTo(creep, { x: foe.ix, y: foe.iy });
      return;
    }
    if (creep.homing) {
      if (creep.frame % CAGE_LOOK_FRAMES === 0) lookForFoe(creep);
      if (creep.homing) {
        walkTo(creep, cageDoor as Cart);
        return;
      }
    }
    let foe = liveFoe(creep);
    if (!foe) {
      creep.atTarget = false;
      creep.attacking = false;
      lookForFoe(creep);
      foe = liveFoe(creep);
    } else {
      const squared = screenDistanceSquared(creep.ix, creep.iy, foe.ix, foe.iy);
      const range = creep.range;
      const reach = range * KORATH_DEFEND_FLYER_REACH;
      if (squared < range * range) {
        creep.atTarget = true;
      } else if (creep.monsterId === KORATH_ID && foe.flying && squared < reach * reach) {
        // Korath reaches a flyer from twice his range (`:876-877`).
        creep.atTarget = true;
      } else if (!creep.attacking && creep.frame % CHASE_LOOK_FRAMES === 0) {
        lookForFoe(creep);
        foe = liveFoe(creep);
      } else if (creep.attacking && squared > 4 * range * range) {
        // It swings on at a foe that backs off, until it is twice its range away (`:882-887`).
        creep.attacking = false;
        creep.atTarget = false;
        lookForFoe(creep);
        foe = liveFoe(creep);
      }
    }
    if (!foe || creep.homing) {
      walkTo(creep, cageDoor as Cart);
      return;
    }
    if (creep.atTarget) {
      creep.attacking = true;
      if (creep.attackCooldown <= 0) {
        creep.attackCooldown += swingDelay(creep);
        recordHit(creep, foe.ix, foe.iy, strikeCreep(creep, foe, creep));
      } else {
        creep.attackCooldown -= 1;
      }
      return;
    }
    walkTo(creep, { x: foe.ix, y: foe.iy });
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
    tickLaserBeams();
    for (const trap of traps) tickTrap(trap);
    tickJars();
    for (const tower of towers) tickTower(tower);
    tickSpurtzShells();
    for (const bunker of bunkers) {
      if (bunker.building.type === HOUSING_BUNKER_TYPE) tickHousingBunker(bunker);
      else tickBunker(bunker);
    }
    if (defended) {
      tickCage();
      defendersOut = 0;
      for (const creep of creeps) if (creep.friendly && creep.hp > 0) defendersOut += 1;
    }
    tickPutty();
    tickDecoy();
    tickBunkerDoors();
    tickVacuum();
    for (const creep of creeps) {
      tickCreep(creep);
      if (creep.burrows) tickBurrow(creep);
    }
    tickLeaving();

    if (creeps.length > 0) {
      let write = 0;
      for (let read = 0; read < creeps.length; read += 1) {
        const creep = creeps[read] as Creep;
        if (creep.gone || creep.hp <= 0) {
          byCreepId.delete(creep.id);
          // A champion whose aura still holds creeps walks off first (issue #222).
          if (creep.champion) startLeaving(creep);
          if (creep.homeBunker >= 0 && creep.hp <= 0) {
            addBunkerLoss(bunkerLosses, creep.homeBunker, creep.monsterId);
          }
          // Only a death zeroes the champion's health: one that retreated or
          // walked home keeps the health it left with, which the attack save
          // writes back verbatim as the attacker's champion.
          // A lesson's span ends when its champion leaves alive (issue #219).
          const lesson = lessons.size > 0 ? lessons.get(creep.id) : undefined;
          if (lesson && creep.hp > 0 && lesson.leftAt === null) lesson.leftAt = tick;
          if (creep.champion && creep.hp <= 0) {
            if (creep.friendly) {
              const slot = cageSlotOf(creep);
              if (slot) slot.report.hp = 0;
            } else {
              championHp = 0;
              championsHp[creep.monsterId] = 0;
            }
          }
          continue;
        }
        if (creep.champion && creep.friendly) {
          const slot = cageSlotOf(creep);
          if (slot) slot.report.hp = creep.hp;
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
    if (creepsFlung > 0 && !anyAttackerLeft() && (retreated || (raid && tick > raidSpawnsUntil))) {
      finished = true;
    }
  };

  const apply = (event: AttackEvent): void => {
    if (finished) return;
    // Raid waves in a raid battle only, and nothing else there (fidelity note 17).
    if ((event.kind === "raid") !== raid) return;
    if (event.kind === "raid") raidWave(event);
    else if (event.kind === "fling") fling(event);
    else if (event.kind === "bomb") bomb(event);
    else if (event.kind === "siege") siege(event);
    else if (event.kind === "retreat") {
      retreated = true;
      for (const creep of creeps) {
        if (!creep.friendly) creep.gone = true;
      }
    } else if (event.kind === "championRetreat") {
      // Flash's "Retreat" on the champion's own button (`CHAMPIONBUTTON.as:98-103`,
      // issue #222): that champion leaves with the health it has, the attack goes on.
      const id = championByType(event.c);
      for (const creep of creeps) {
        if (creep.champion && !creep.friendly && creep.monsterId === id) creep.gone = true;
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
      burning: creep.burnDps > 0 || descentBurning(creep),
      enraged: creep.enragedBy >= 0,
      puttied: creep.puttyUntil > 0,
      lootBoosted: creep.lootBuffedBy >= 0,
      quaking: creep.quaking,
      ...(creep.rank > 0 ? { rank: creep.rank } : {}),
      ...(creep.invisible && !creep.burrows ? { invisible: true } : {}),
      ...(creep.invisible && creep.burrows ? { burrowed: true } : {}),
      ...(creep.blinkHops > 0 ? { blinking: true } : {}),
      ...(creep.venomStacks > 0 ? { poisonStacks: creep.venomStacks } : {}),
    }));

  const recentEvents = (sinceTick: number): BattleVisualEvent[] => {
    let start = 0;
    while (start < visual.length && (visual[start] as BattleVisualEvent).tick <= sinceTick) {
      start += 1;
    }
    return visual.slice(start);
  };

  const siegeSnapshot = (): SiegeSnapshot => ({
    active: decoy ? DECOY.id : vacuum ? VACUUM.id : jarDrop ? JARS.id : null,
    decoy: decoy && {
      x: decoy.at.x,
      y: decoy.at.y,
      droppedAt: decoy.droppedAt,
      landsAt: decoy.plan.landsAt,
      explodesAt: decoy.plan.explodesAt,
      range: decoy.plan.range,
    },
    vacuum: vacuum && {
      buildingId: vacuum.target.id,
      droppedAt: vacuum.droppedAt,
      endsAt: vacuum.plan.endsAt,
      health: vacuum.health,
      durability: vacuum.plan.durability,
      took: vacuum.took,
    },
    jars: [...jars.values()].map((jar) => ({
      buildingId: jar.building.id,
      landsAt: jar.landsAt,
      frame: jar.frame,
      breaking: jar.breaking,
      health: jar.health,
      durability: jar.durability,
    })),
  });

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
    traps: trapReports.map((trap) => ({ ...trap })),
    bunkers: [...bunkerReports.values()]
      .sort((one, other) => one.id - other.id)
      .map((bunker) => ({ ...bunker })),
    defenderChampions: cageSlots.map((slot) => ({ ...slot.report })),
    attackers: [
      ...[...monsterRows.values()].sort((one, other) => compareIds(one.monsterId, other.monsterId)),
      ...championRows,
    ].map((row) => ({ ...row })),
    ...(options.learn ? { lessons: lessonsNow() } : {}),
  });

  /** {@link BattleState.lessons}: each lesson as it stands, its span cut at now. */
  const lessonsNow = (): ChampionLesson[] =>
    [...lessons.values()].map((lesson) => ({
      t: lesson.t,
      picks: lesson.picks,
      credit: { ...lesson.credit },
      dealt: lesson.dealt,
      potential: lesson.perTick * Math.max(0, (lesson.leftAt ?? tick) - lesson.flungAt),
      startHp: lesson.startHp,
      endHp: Math.max(0, championsHp[lesson.monsterId] ?? 0),
    }));

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
      // Each caged champion's health, or -1 for none: one folds as it always did (issue #310).
      if (cageSlots.length === 0) values.push(-1);
      for (const slot of cageSlots) values.push(slot.report.hp);
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
    siege: siegeSnapshot,
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

/**
 * A yard's housed monsters as its Housing Bunkers' garrisons (Inferno plan WP
 * 1.6), by building id, as {@link BattleOptions.bunkers} takes them.
 *
 * On an Inferno yard the Housing Bunkers are the housing: `HOUSING.Populate`
 * puts each housed monster, the save's `monsters`, in a standing one
 * (`client/scripts/HOUSING.as:201-235`). Flash draws the bunker at random for
 * each monster; this deals them out in turn instead, monster ids in order and
 * bunkers by id, so the split is even and the same on every run. A bunker
 * whose `buildinghealthdata` entry is 0 is down and takes none. Counts are
 * read as {@link bunkerGarrisons} reads a bunker's own.
 *
 * @param buildingdata - The yard's stored buildings.
 * @param monsters - The yard's housed monsters, `{ monsterId: count }`.
 * @param buildinghealthdata - The yard's stored health, by building id.
 */
export const housedGarrisons = (
  buildingdata: CombatBuildingDataMap | readonly CombatBuildingData[] | null | undefined,
  monsters: unknown,
  buildinghealthdata?: Readonly<Record<string, unknown>> | null,
): Record<number, Roster> => {
  const garrisons: Record<number, Record<string, number>> = {};
  if (!buildingdata || typeof buildingdata !== "object") return garrisons;
  if (!monsters || typeof monsters !== "object" || Array.isArray(monsters)) return garrisons;
  const entries: Array<[string, CombatBuildingData]> = Array.isArray(buildingdata)
    ? (buildingdata as readonly CombatBuildingData[]).map((data, index) => [String(index), data])
    : Object.entries(buildingdata as CombatBuildingDataMap);
  const houses: number[] = [];
  for (const [key, data] of entries) {
    if (!data || typeof data !== "object") continue;
    if (Math.floor(numberOf(data.t)) !== HOUSING_BUNKER_TYPE) continue;
    const id = Math.floor(numberOf(data.id ?? key));
    const health = buildinghealthdata?.[String(id)];
    if (health !== undefined && !(numberOf(health) > 0)) continue;
    houses.push(id);
  }
  if (houses.length === 0) return garrisons;
  houses.sort((one, other) => one - other);
  const counts = new Map<string, number>();
  for (const [raw, value] of Object.entries(monsters as Record<string, unknown>)) {
    const id = LEGACY_MONSTER_IDS[raw] ?? raw;
    const count = Array.isArray(value) ? value.length : Math.floor(numberOf(value));
    if (!isKnownMonster(id) || !(count > 0)) continue;
    counts.set(id, (counts.get(id) ?? 0) + count);
  }
  let turn = 0;
  for (const id of [...counts.keys()].sort()) {
    for (let dealt = 0; dealt < (counts.get(id) as number); dealt += 1) {
      const house = houses[turn % houses.length] as number;
      const garrison = (garrisons[house] ??= {});
      garrison[id] = (garrison[id] ?? 0) + 1;
      turn += 1;
    }
  }
  return garrisons;
};
