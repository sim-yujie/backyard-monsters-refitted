import type { BaseLoadResponse } from "@/api/types";
import {
  ATTACK_COUNTDOWN_SECONDS,
  DECLARE_WAR_COUNTDOWN_SECONDS,
  RETREAT_GRACE_SECONDS,
  TICKS_PER_SECOND,
  buildEngineYard,
  createBattle,
  damagePercent,
  dropRadius,
  bucketCost,
  toCombatYard,
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
 * send and no tool pending is `exhausted`; 100% damage is `destroyed`. The
 * session checks both after every advance. A Retreat is `retreat`, and the
 * countdown running out is `expired`.
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

/** Why an attack ended (§F6, §F7). */
export type AttackEndReason = "destroyed" | "exhausted" | "expired" | "retreat";

/** The two battle speeds, as ticks advanced per real second over 80. */
export type AttackSpeed = 1 | 2;

/** A fling before the session stamps its tick and radius. */
export interface FlingInput {
  /** Drop centre, yard units — the same space as `buildingdata.X/Y`. */
  readonly x: number;
  readonly y: number;
  readonly monsters: Roster;
  /** The champion to send with this drop; at most one per attack. */
  readonly champion?: { readonly t: number; readonly l: number };
}

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
  /** True while a champion could still be sent: one exists, is healthy, and none was flung. */
  readonly championAvailable: boolean;
  /** The champion's health on the field, or null when none was flung. */
  readonly championHp: number | null;
  /** Bombs and siege weapons WP4 reports as still usable (see `setUnusedTools`). */
  readonly unusedTools: number;
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
  /** The attacker's player level, for the engine's low-level loot bonus. */
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
 * Whether the attacker's running alliance powerups include Declare War.
 *
 * `attpowerups` is `runningPowerups()`'s list, `{ id, endtime }` per active
 * powerup (`server/src/services/alliance/powerups.ts:170-179`), and Declare
 * War's id is `ap_declarewar` (`server/src/enums/Alliance.ts`).
 */
export const hasDeclareWar = (powerups: readonly unknown[] | undefined): boolean =>
  (powerups ?? []).some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { id?: unknown }).id === "ap_declarewar",
  );

/** The target kind as the rules module spells it; the two agree by name. */
const combatKind = (kind: AttackTarget["kind"]): CombatTargetKind => kind;

/** Housed monsters minus what has been flung, only the positive counts. */
const subtractRoster = (housed: Roster, flung: Roster): Roster => {
  const left: Record<string, number> = {};
  for (const [id, count] of Object.entries(housed)) {
    const remaining = count - (flung[id] ?? 0);
    if (remaining > 0) left[id] = remaining;
  }
  return left;
};

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
  private championFlung = false;
  private unusedTools = 0;
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

    const kind = combatKind(this.target.kind);
    const buildingdata = response.buildingdata ?? {};
    const yard = buildEngineYard({
      buildingdata,
      buildinghealthdata: response.buildinghealthdata ?? null,
      resources: response.resources ?? null,
      kind,
    });
    this.combatYard = toCombatYard({
      kind,
      buildingdata,
      buildinghealthdata: response.buildinghealthdata ?? null,
    });
    this.battle_ = createBattle(yard, {
      seed: this.seed,
      levels: this.target.roster.levels,
      declareWar: this.declareWar_,
      ...(this.playerLevel === undefined ? {} : { playerLevel: this.playerLevel }),
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

  /* ── Events ─────────────────────────────────────────────────────────── */

  /**
   * Appends a fling: stamps the tick and the drop radius, hands it to the
   * battle, and spends the roster. Returns the event as logged.
   *
   * Refuses, by throwing, a count above what is still housed, a second
   * champion, an empty drop, or a drop after the attack ended — each is a
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
      if (this.championFlung) throw new Error("AttackSession: the champion was already flung");
      if (!this.championAvailable()) throw new Error("AttackSession: no champion to fling");
    } else if (total === 0) {
      throw new RangeError("AttackSession: an empty fling");
    }

    const bucket = bucketCost(input.monsters, this.target.roster.levels);
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
    if (input.champion) this.championFlung = true;
    this.afterEvent(battle);
    return event;
  }

  /** Appends a resource bomb at the current tick and hands it to the battle. */
  appendBomb(input: BombInput): BombDrop {
    const battle = this.requireLive("bomb");
    const event: BombDrop = { kind: "bomb", t: battle.tick, x: input.x, y: input.y, id: input.id };
    battle.apply(event);
    this.events.push(event);
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

  /** Housed monsters in range minus what has been flung. */
  remaining(): Roster {
    return subtractRoster(this.target.roster.monsters, this.flung);
  }

  /** Whether a champion could still be sent: healthy, active, and not yet flung. */
  championAvailable(): boolean {
    if (this.championFlung) return false;
    return this.target.roster.champions.some(
      (champion) => champion.hp > 0 && champion.status === 0,
    );
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
      championHp: battleState?.championHp ?? null,
      unusedTools: this.unusedTools,
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
    const yard = this.combatYard;
    if (!yard) return 0;
    return damagePercent(yard, battleState.health, new Set(battleState.firedTraps));
  }

  /** §F6's rule, in the order the design lists it. */
  private checkEnd(battle: Battle): void {
    if (this.phase !== "running") return;
    const battleState = battle.state();

    if (this.damageOf(battleState) >= 100) {
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
