import type { BaseLoadResponse } from "@/api/types";
import {
  ATTACK_COUNTDOWN_SECONDS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  TICKS_PER_SECOND,
  buildEngineYard,
  buildingClass,
  championByType,
  createBattle,
  damagePercent,
  dropRadius,
  flingCost,
  healthOf,
  toCombatYard,
  type BuildingClass,
  type Battle,
  type BattleState,
  type BombDrop,
  type CombatTargetKind,
  type CombatYard,
  type FlingDrop,
  type FlingEvent,
  type FlingLog,
  type ResourceAmounts,
  type Roster,
} from "@/game/combat/rules";
import { hasDeclareWar } from "./attackEntry";
import type { AttackTarget } from "./attackTarget";

/**
 * One attack, from the moment the enemy yard opens to the moment it is over.
 *
 * The session is the thing every attack panel reads and the one thing that
 * writes the fling log (`docs/design/attack-flow.md` §F2, §F5, §F6, §5.4). It
 * owns the target the map handed over, the attack load that came back, the
 * engine {@link Battle} built from the enemy yard, the attack clock, and the
 * {@link FlingLog} the save will carry. It knows nothing about the DOM or about
 * PixiJS: the scene drives it once a frame with {@link advance}, the panels
 * subscribe with {@link subscribe} and read {@link state}, and the input layer
 * appends events with {@link appendFling}, {@link appendBomb} and
 * {@link appendSiege}.
 *
 * ## The clock
 *
 * The attack clock runs in *battle* time, not wall time: `elapsedSeconds` is
 * `battle.tick / 80`. A frame at 2x advances the target tick twice as far, so
 * the countdown and the creeps speed up together and nothing is skipped (§F5,
 * "two speeds, 1x and 2x, no pause"). The countdown is 300 s, or 420 s when
 * the attacker's alliance holds Declare War (`stats.ts`), and the engine's own
 * hard retreat lands 120 s after that.
 *
 * ## Ending
 *
 * The engine ends a battle only on its countdown (`engine.ts` `step`). §F6
 * adds two earlier ends the engine cannot see, because they depend on what the
 * attacker still has rather than on the field: nothing alive, nothing left to
 * send and no tool pending is `exhausted`; 100% damage is `destroyed`. So is
 * a yard with nothing left standing that a creep could attack, which is how
 * Flash's `ATTACK.Tick` ended an attack (`client/scripts/ATTACK.as:276-291`):
 * the percentage counts a trap that never fired at full health, so a flyer
 * army that flattens a trapped camp stops short of 100 while the field is, to
 * the attacker, finished. The session checks all of these after every advance.
 * A Retreat is `retreat`, and the countdown running out is `expired`.
 *
 * None of the automatic ends counts before the player's first action — a
 * drop, a bomb or a siege weapon (issue #79). A yard that opens already flat
 * has nothing standing at tick 0, and without this guard the attack would end
 * and the end screen would save it before anything was sent. Flash ticked
 * the same check from the first frame (`ATTACK.as:282-291`); this is a
 * deliberate departure. Only the countdown running out and a Retreat end an
 * attack the player never touched, and the end screen saves neither
 * ({@link hasActed}).
 *
 * ## The state machine
 *
 * `idle` (constructed) → `loaded` ({@link load}: the battle exists, the clock
 * is at zero) → `running` ({@link start}) → `ended` (any of the four reasons).
 * Events may be appended while `loaded` or `running`; the first fling while
 * `loaded` starts the clock rather than being refused, so an input layer that
 * fires before the scene's own `start()` does no harm.
 */

/** Where the session is in its life. */
export type AttackPhase = "idle" | "loaded" | "running" | "ended";

/**
 * Why an attack ended (§F6, §F7). `left` is the player leaving the attack
 * screen — a reload, a closed tab, navigating away — which ends the battle
 * where it stands (issue #138).
 */
export type AttackEndReason = "destroyed" | "exhausted" | "expired" | "retreat" | "left";

/** The two battle speeds, as ticks advanced per real second over 80. */
export type AttackSpeed = 1 | 2;

/** A fling before the session stamps its tick and radius. */
export interface FlingInput {
  /** Drop centre, yard units — the same space as `buildingdata.X/Y`. */
  readonly x: number;
  readonly y: number;
  readonly monsters: Roster;
  /**
   * The champion to send with this drop. One per drop; across the attack, one
   * ordinary champion plus Krallen (see `AttackSession.championBlock`).
   */
  readonly champion?: { readonly t: number; readonly l: number };
}

/** Krallen's champion type, the one champion Flash let go alongside another. */
export const KRALLEN_TYPE = 5;

/**
 * Why a champion cannot be sent right now, or null when it can.
 *
 * - `unknown`: the attacker does not own a champion of that type.
 * - `hurt`: its health is zero.
 * - `away`: frozen in the Champion Chamber, juiced, or otherwise not active.
 * - `flung`: it has already been sent this attack.
 * - `oneChampion`: another ordinary champion holds the attack's one ordinary
 *   slot. Krallen never hits this.
 */
export type ChampionBlockReason = "unknown" | "hurt" | "away" | "flung" | "oneChampion";

/** A resource bomb before the session stamps its tick. */
export interface BombInput {
  readonly x: number;
  readonly y: number;
  /** A `BombStats` id: `tw0`..`pu3`. */
  readonly id: string;
}

/** A siege weapon before the session stamps its tick. */
export interface SiegeInput {
  readonly x: number;
  readonly y: number;
  readonly weapon: string;
}

/** What the panels read. Rebuilt on every {@link state} call; never mutated. */
export interface AttackSessionState {
  readonly phase: AttackPhase;
  /** Set once `phase` is `ended`, null before. */
  readonly endReason: AttackEndReason | null;
  /** Battle ticks elapsed. */
  readonly tick: number;
  /** `tick / 80`. */
  readonly elapsedSeconds: number;
  /** 300, or 420 under Declare War. */
  readonly countdownSeconds: number;
  /** Seconds left on the countdown, floored at 0. */
  readonly remainingSeconds: number;
  /**
   * Seconds left before the engine's hard retreat, which is the countdown
   * plus the 120 s grace. Equal to `remainingSeconds + 120` until the
   * countdown runs out, then counts the grace down on its own.
   */
  readonly hardStopSeconds: number;
  readonly declareWar: boolean;
  readonly speed: AttackSpeed;
  /** `damagePercent()` over the enemy yard right now, 0 to 100. */
  readonly damagePercent: number;
  /** Buildings at zero health so far. */
  readonly buildingsDestroyed: number;
  /** What the attacker has gained, before the storage cap. */
  readonly loot: ResourceAmounts;
  readonly creepsFlung: number;
  readonly creepsAlive: number;
  readonly creepsKilled: number;
  /** Housed monsters still in range and not yet flung, by id. */
  readonly remaining: Roster;
  /** True while any champion could still be sent (`AttackSession.championBlock`). */
  readonly championAvailable: boolean;
  /** Every flung champion's health by type, zero for a death; empty when none was flung. */
  readonly championsHp: Readonly<Record<number, number>>;
  /** Bombs and siege weapons WP4 reports as still usable (see `setUnusedTools`). */
  readonly unusedTools: number;
  /** Whether the player has dropped, bombed or sieged yet (issue #79). */
  readonly acted: boolean;
  /** How many events the fling log holds. */
  readonly eventCount: number;
}

/** A change listener; called with the fresh state. */
export type AttackSessionListener = (state: AttackSessionState) => void;

export interface AttackSessionOptions {
  readonly target: AttackTarget;
  /**
   * The combat seed. Minted at random when absent (§7, Q1): once the server
   * returns a `combatseed` on the attack load, the scene reads that instead
   * and the field written to the log is the same one.
   */
  readonly seed?: number;
  /**
   * The attacker's player level, for the engine's low-level loot bonus. Read
   * off the load's `attackerlevel` when absent, which is the level the
   * server's loot replay runs at (issue #167).
   */
  readonly playerLevel?: number;
  /**
   * Whether Declare War lengthens the countdown. Read off the load's
   * `attpowerups` when absent ({@link hasDeclareWar}).
   */
  readonly declareWar?: boolean;
}

/** A random 32-bit seed for a battle the server has not seeded (§7, Q1). */
export const mintSeed = (): number => {
  const buffer = new Uint32Array(1);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buffer);
    return buffer[0] ?? 0;
  }
  return Math.floor(Math.random() * 0x1_0000_0000);
};

/**
 * Whether the attacker's running alliance powerups include Declare War; the
 * map's range gate reads the same list (`attackEntry.ts`).
 */
export { hasDeclareWar };

/** The load's `attackerlevel`, when it is a whole level of 1 or more. */
export const servedLevel = (raw: unknown): number | undefined =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 1 ? raw : undefined;

/**
 * The load's `cellheight`, when it is a whole height of 0 or more; 0 otherwise,
 * which leaves every tower at its table range (`towerRange`).
 */
export const servedHeight = (raw: unknown): number =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : 0;

/**
 * The target kind as the rules module spells it. The two agree by name, but a
 * Map Room 1 tribe, which the map hands over as `wild`, is the rules' `tribe`:
 * Flash's lower loot for a wild monster camp is Map Room 2's alone
 * (`BSTORAGE.as:77`, `:111`, `:117`).
 */
export const combatKind = (target: Pick<AttackTarget, "kind" | "mapversion">): CombatTargetKind =>
  target.kind === "wild" && target.mapversion === 1 ? "tribe" : target.kind;

/** Housed monsters minus what has been flung, only the positive counts. */
const subtractRoster = (housed: Roster, flung: Roster): Roster => {
  const left: Record<string, number> = {};
  for (const [id, count] of Object.entries(housed)) {
    const remaining = count - (flung[id] ?? 0);
    if (remaining > 0) left[id] = remaining;
  }
  return left;
};

/**
 * The building classes a creep never attacks on purpose, which is what Flash's
 * end-of-attack check left out of "something is still standing"
 * (`client/scripts/ATTACK.as:278`).
 */
const UNTARGETED_CLASSES: ReadonlySet<BuildingClass> = new Set<BuildingClass>([
  "mushroom",
  "wall",
  "trap",
  "enemy",
  "decoration",
  "cage",
]);

const rosterEmpty = (roster: Roster): boolean =>
  Object.values(roster).every((count) => count <= 0);

export class AttackSession {
  readonly target: AttackTarget;
  readonly seed: number;

  private phase: AttackPhase = "idle";
  private endReason: AttackEndReason | null = null;
  private response: BaseLoadResponse | null = null;
  private battle_: Battle | null = null;
  private combatYard: CombatYard | null = null;
  private declareWar_: boolean;
  private countdownSeconds: number;
  private speed_: AttackSpeed = 1;
  /** Fractional target tick; the battle runs to its floor. */
  private targetTick = 0;
  private readonly events: FlingEvent[] = [];
  private flung: Record<string, number> = {};
  /** Champion types flung so far this attack. */
  private readonly championsFlung = new Set<number>();
  private unusedTools = 0;
  /** Set by the first drop, bomb or siege; until then no automatic end applies (#79). */
  private acted = false;
  private readonly listeners = new Set<AttackSessionListener>();
  /** The last quarter-second the listeners heard about, to rate-limit `advance`. */
  private lastNotifiedQuarter = -1;
  private readonly playerLevel: number | undefined;

  constructor(options: AttackSessionOptions) {
    this.target = options.target;
    this.seed = options.seed ?? mintSeed();
    this.playerLevel = options.playerLevel;
    this.declareWar_ = options.declareWar ?? false;
    this.countdownSeconds = this.declareWar_
      ? DECLARE_WAR_COUNTDOWN_SECONDS
      : ATTACK_COUNTDOWN_SECONDS;
    // The load may have been handed over pre-fetched (View yard → Attack).
    if (options.target.load) this.load(options.target.load, options.declareWar);
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────── */

  /**
   * Builds the battle from the attack load's enemy yard. `idle` → `loaded`.
   *
   * The engine's yard is its own copy; the response is not mutated. Called at
   * most once — a second load is a programming error, since the fling log and
   * the seed belong to the first.
   */
  load(response: BaseLoadResponse, declareWar?: boolean): void {
    if (this.phase !== "idle") throw new Error("AttackSession: already loaded");
    this.response = response;
    this.declareWar_ = declareWar ?? hasDeclareWar(response.attpowerups);
    this.countdownSeconds = this.declareWar_
      ? DECLARE_WAR_COUNTDOWN_SECONDS
      : ATTACK_COUNTDOWN_SECONDS;

    const kind = combatKind(this.target);
    const buildingdata = response.buildingdata ?? {};
    const yard = buildEngineYard({
      buildingdata,
      buildinghealthdata: response.buildinghealthdata ?? null,
      resources: response.resources ?? null,
      kind,
      height: servedHeight(response.cellheight),
    });
    this.combatYard = toCombatYard({
      kind,
      buildingdata,
      buildinghealthdata: response.buildinghealthdata ?? null,
    });
    const playerLevel = this.playerLevel ?? servedLevel(response.attackerlevel);
    this.battle_ = createBattle(yard, {
      seed: this.seed,
      levels: this.target.roster.levels,
      declareWar: this.declareWar_,
      ...(playerLevel === undefined ? {} : { playerLevel }),
    });
    this.phase = "loaded";
    this.notify();
  }

  /** Starts the clock. `loaded` → `running`; a no-op in any other phase. */
  start(): void {
    if (this.phase !== "loaded") return;
    this.phase = "running";
    this.notify();
  }

  /**
   * Advances the battle by a frame's worth of real time at the current speed.
   *
   * Listeners hear about it at most four times a battle-second, plus whenever
   * the phase changes, so a DOM panel is not rebuilt sixty times a second for
   * a countdown that changes once.
   */
  advance(deltaSeconds: number): void {
    const battle = this.battle_;
    if (this.phase !== "running" || !battle) return;

    this.targetTick += Math.max(0, deltaSeconds) * TICKS_PER_SECOND * this.speed_;
    // Sixty frames of 1/60 s sum to 79.999…, not 80; the nudge keeps a whole
    // second of frames worth a whole second of ticks.
    battle.runTo(Math.floor(this.targetTick + 1e-6));
    this.checkEnd(battle);

    if (this.phase !== "running") return;
    const quarter = Math.floor((battle.tick / TICKS_PER_SECOND) * 4);
    if (quarter !== this.lastNotifiedQuarter) {
      this.lastNotifiedQuarter = quarter;
      this.notify();
    }
  }

  /**
   * Ends the attack by choice (§F7). Appends the `retreat` event, which the
   * engine turns into every attacking creep leaving the field, and ends the
   * session at once with reason `retreat`. Idempotent once ended.
   */
  retreat(): void {
    const battle = this.battle_;
    if (this.phase === "ended" || this.phase === "idle" || !battle) return;
    const event: FlingEvent = { kind: "retreat", t: battle.tick };
    battle.apply(event);
    this.events.push(event);
    this.end("retreat");
  }

  /**
   * Ends the attack where it stands because the player is leaving the attack
   * screen (issue #138): the battle stops at this tick with everything that
   * happened standing, as if it had ended there. Unlike {@link retreat} no
   * event is logged — the creeps are not called back, the clock simply stops.
   * Idempotent once ended.
   */
  leave(): void {
    if (this.phase === "ended" || this.phase === "idle" || !this.battle_) return;
    this.end("left");
  }

  /* ── Events ─────────────────────────────────────────────────────────── */

  /**
   * Appends a fling: stamps the tick and the drop radius, hands it to the
   * battle, and spends the roster. Returns the event as logged.
   *
   * Refuses, by throwing, a count above what is still housed, a champion
   * {@link championBlock} refuses, an empty drop, or a drop after the attack
   * ended — each is a
   * caller's bug, not a player's, and the army panel clamps before it gets
   * here (§F2 "after a drop").
   */
  appendFling(input: FlingInput): FlingDrop {
    const battle = this.requireLive("fling");
    const remaining = this.remaining();
    let total = 0;
    for (const [id, count] of Object.entries(input.monsters)) {
      if (count < 0 || !Number.isInteger(count)) {
        throw new RangeError(`AttackSession: bad count ${count} for ${id}`);
      }
      if (count > (remaining[id] ?? 0)) {
        throw new RangeError(`AttackSession: ${count} ${id} exceeds the ${remaining[id] ?? 0} left`);
      }
      total += count;
    }
    if (input.champion) {
      const blocked = this.championBlock(input.champion.t);
      if (blocked) {
        throw new Error(`AttackSession: champion ${input.champion.t} cannot be flung (${blocked})`);
      }
    } else if (total === 0) {
      throw new RangeError("AttackSession: an empty fling");
    }

    // The champion's own bucket widens the zone too (`ATTACK.as:645-653`, #143).
    const bucket = flingCost(input, this.target.roster.levels);
    const event: FlingDrop = {
      kind: "fling",
      t: battle.tick,
      x: input.x,
      y: input.y,
      r: dropRadius(bucket),
      monsters: { ...input.monsters },
      ...(input.champion ? { champion: { ...input.champion } } : {}),
    };
    battle.apply(event);
    this.events.push(event);
    for (const [id, count] of Object.entries(input.monsters)) {
      if (count > 0) this.flung[id] = (this.flung[id] ?? 0) + count;
    }
    if (input.champion) this.championsFlung.add(input.champion.t);
    this.acted = true;
    this.afterEvent(battle);
    return event;
  }

  /** Appends a resource bomb at the current tick and hands it to the battle. */
  appendBomb(input: BombInput): BombDrop {
    const battle = this.requireLive("bomb");
    const event: BombDrop = { kind: "bomb", t: battle.tick, x: input.x, y: input.y, id: input.id };
    battle.apply(event);
    this.events.push(event);
    this.acted = true;
    this.afterEvent(battle);
    return event;
  }

  /**
   * Appends a siege weapon at the current tick. The engine accepts and
   * ignores it today (`engine.ts` fidelity note 8); the log carries it so a
   * later engine replays it (§F4).
   */
  appendSiege(input: SiegeInput): Extract<FlingEvent, { kind: "siege" }> {
    const battle = this.requireLive("siege");
    const event = {
      kind: "siege" as const,
      t: battle.tick,
      x: input.x,
      y: input.y,
      weapon: input.weapon,
    };
    battle.apply(event);
    this.events.push(event);
    this.acted = true;
    this.afterEvent(battle);
    return event;
  }

  /**
   * How many bombs and siege weapons the attacker could still use, reported
   * by the pickers (WP4). While it is above zero the attack does not end as
   * `exhausted` on an empty field, because there is still something to send
   * (§F6). Zero until something reports otherwise.
   */
  setUnusedTools(count: number): void {
    const next = Math.max(0, Math.floor(count));
    if (next === this.unusedTools) return;
    this.unusedTools = next;
    if (this.battle_) this.checkEnd(this.battle_);
    this.notify();
  }

  /* ── Speed ──────────────────────────────────────────────────────────── */

  setSpeed(speed: AttackSpeed): void {
    if (speed === this.speed_) return;
    this.speed_ = speed;
    this.notify();
  }

  get speed(): AttackSpeed {
    return this.speed_;
  }

  /* ── Reading ────────────────────────────────────────────────────────── */

  /** The running battle, or null before {@link load}. */
  battle(): Battle | null {
    return this.battle_;
  }

  /** The attack load the enemy yard was built from, or null before {@link load}. */
  attackLoad(): BaseLoadResponse | null {
    return this.response;
  }

  /** The fling log as it stands: the §3.10 shape, resent in full on every save. */
  flingLog(): FlingLog {
    return { v: 1, seed: this.seed, events: [...this.events] };
  }

  /**
   * Whether the player has done anything yet: a drop, a bomb or a siege
   * weapon. Until then no automatic end applies, and an attack that ends
   * anyway (the countdown, or a Retreat) has nothing worth saving (#79).
   */
  hasActed(): boolean {
    return this.acted;
  }

  /** Housed monsters in range minus what has been flung. */
  remaining(): Roster {
    return subtractRoster(this.target.roster.monsters, this.flung);
  }

  /**
   * Each flung champion's health as the save should report it, by type; empty
   * when none was flung.
   *
   * The engine's figure is 0 only for a death; a champion that retreated or
   * walked home keeps the health it left with (`engine.ts` `step`), which is
   * what `attackerchampion` writes back over the attacker's stored champion.
   */
  championsHpAfter(): Readonly<Record<number, number>> {
    return this.championsHpOf(this.battle_?.state() ?? null);
  }

  /**
   * Why the champion of type `t` cannot be sent now, or null when it can.
   *
   * Flash's rule (`client/scripts/UI_TOP.as:328-356`): the army list offers
   * the first healthy, active ordinary champion in the save's order and skips
   * any other ("User is initializing combat with more than one normal
   * champ."), and offers Krallen, type 5, on top of it. Each offered champion
   * has its own `Send`, disabled for good once it is flung
   * (`CHAMPIONBUTTON.as:65-70`, `CREEPS._flungGuardian`, cleared only when the
   * attack is torn down, `CREEPS.as:353-355`). So one ordinary champion and
   * Krallen may both fight in one attack, each sent once, and a dead or
   * retreated champion does not free its slot.
   */
  championBlock(t: number): ChampionBlockReason | null {
    const champions = this.target.roster.champions;
    const entry = champions.find((champion) => champion.t === t);
    if (!entry) return "unknown";
    if (entry.hp <= 0) return "hurt";
    if (entry.status !== 0) return "away";
    if (this.championsFlung.has(t)) return "flung";
    if (t === KRALLEN_TYPE) return null;
    for (const flung of this.championsFlung) {
      if (flung !== KRALLEN_TYPE) return "oneChampion";
    }
    const offered = champions.find(
      (champion) => champion.t !== KRALLEN_TYPE && champion.hp > 0 && champion.status === 0,
    );
    return offered?.t === t ? null : "oneChampion";
  }

  /** Whether any champion could still be sent. */
  championAvailable(): boolean {
    return this.target.roster.champions.some((champion) => this.championBlock(champion.t) === null);
  }

  state(): AttackSessionState {
    const battle = this.battle_;
    const battleState: BattleState | null = battle ? battle.state() : null;
    const tick = battleState?.tick ?? 0;
    const elapsed = tick / TICKS_PER_SECOND;
    const remainingSeconds = Math.max(0, this.countdownSeconds - elapsed);
    const hardStopSeconds = Math.max(
      0,
      this.countdownSeconds + RETREAT_GRACE_SECONDS - elapsed,
    );
    return {
      phase: this.phase,
      endReason: this.endReason,
      tick,
      elapsedSeconds: elapsed,
      countdownSeconds: this.countdownSeconds,
      remainingSeconds,
      hardStopSeconds,
      declareWar: this.declareWar_,
      speed: this.speed_,
      damagePercent: battleState ? this.damageOf(battleState) : 0,
      buildingsDestroyed: battleState?.destroyedIds.length ?? 0,
      loot: battleState?.loot ?? { r1: 0, r2: 0, r3: 0, r4: 0 },
      creepsFlung: battleState?.creepsFlung ?? 0,
      creepsAlive: battleState?.creepsAlive ?? 0,
      creepsKilled: battleState?.creepsKilled ?? 0,
      remaining: this.remaining(),
      championAvailable: this.championAvailable(),
      championsHp: this.championsHpOf(battleState),
      unusedTools: this.unusedTools,
      acted: this.acted,
      eventCount: this.events.length,
    };
  }

  /**
   * Hears about every change. Returns the unsubscribe. The listener is not
   * called on subscribe; read {@link state} for the opening picture.
   */
  subscribe(listener: AttackSessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /* ── Internals ──────────────────────────────────────────────────────── */

  /** The engine's per-id champion health, re-keyed by type for the save. */
  private championsHpOf(battleState: BattleState | null): Record<number, number> {
    const byType: Record<number, number> = {};
    for (const t of this.championsFlung) {
      const id = championByType(t);
      const hp = id === undefined ? undefined : battleState?.championsHp[id];
      byType[t] = hp ?? 0;
    }
    return byType;
  }

  private requireLive(what: string): Battle {
    const battle = this.battle_;
    if (!battle || this.phase === "idle") throw new Error(`AttackSession: ${what} before load`);
    if (this.phase === "ended") throw new Error(`AttackSession: ${what} after the attack ended`);
    // An input layer that fires before the scene's start() starts the clock.
    if (this.phase === "loaded") this.phase = "running";
    return battle;
  }

  private afterEvent(battle: Battle): void {
    this.checkEnd(battle);
    this.notify();
  }

  private damageOf(battleState: BattleState): number {
    return this.damageFor(battleState.health, battleState.firedTraps);
  }

  /**
   * `damagePercent()` over the enemy yard for a health map other than the
   * engine's: the battle layer's, which holds back what a bomb's particles
   * have not brought down yet (#148). Changes nothing.
   */
  damageFor(health: Readonly<Record<string, number>>, firedTraps: readonly number[]): number {
    const yard = this.combatYard;
    if (!yard) return 0;
    return damagePercent(yard, health, new Set(firedTraps));
  }

  /**
   * Whether anything a creep could still attack is standing.
   *
   * Flash's `ATTACK.Tick` ended the attack the moment no building outside
   * these six classes had health left (`client/scripts/ATTACK.as:276-291`,
   * `_loc10_`), whatever was still alive on the field or housed at home. A
   * trap, a wall, a decoration, a cage, a mushroom and an enemy are the things
   * `findTarget` never chooses on purpose (`MonsterBase.as:1074`), so a yard
   * with only those left has nothing an attacker can change.
   */
  private targetStanding(battleState: BattleState): boolean {
    const yard = this.combatYard;
    if (!yard) return false;
    for (const building of yard.buildings) {
      if (UNTARGETED_CLASSES.has(buildingClass(building.type))) continue;
      if (healthOf(building, battleState.health) > 0) return true;
    }
    return false;
  }

  /**
   * §F6's rule, in the order the design lists it, once the player has acted.
   * Before that only the countdown running out ends the attack (#79).
   */
  private checkEnd(battle: Battle): void {
    if (this.phase !== "running") return;
    const battleState = battle.state();

    if (!this.acted) {
      if (battleState.over) this.end("expired");
      return;
    }

    if (this.damageOf(battleState) >= 100 || !this.targetStanding(battleState)) {
      this.end("destroyed");
      return;
    }
    const nothingToSend =
      rosterEmpty(this.remaining()) && !this.championAvailable() && this.unusedTools === 0;
    if (battleState.creepsAlive === 0 && nothingToSend) {
      this.end("exhausted");
      return;
    }
    if (battleState.over) this.end("expired");
  }

  private end(reason: AttackEndReason): void {
    if (this.phase === "ended") return;
    this.phase = "ended";
    this.endReason = reason;
    this.notify();
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.state();
    for (const listener of this.listeners) listener(snapshot);
  }
}
