import { damagePercent, derivedDestroyed } from "./damagePercent.js";
import { createDigest } from "./digest.js";
import { createBattle } from "./engine.js";
import { ATTACK_MAX_SECONDS, ticks } from "./stats.js";
import { toCombatYard } from "./types.js";
import { buildEngineYard } from "./yard.js";
import type { BattleOptions, BattleState, TowerReport } from "./engine.js";
import type {
  BuildingHealthMap,
  CombatBuildingDataMap,
  CombatTargetKind,
  FlingEvent,
  FlingLog,
  MonsterLevels,
  ResourceAmounts,
  Roster,
} from "./types.js";

/**
 * Running a fling log against a yard, and proving two runtimes agree about it.
 *
 * This is the entry point `docs/design/server-combat.md` §2.8 names: give it
 * the defender's `buildingdata`, the log the attacking client sent (§3.10) and
 * the session's seed, and it returns the outcome the server writes — the health
 * map, the damage percentage, `destroyed`, both resource deltas, the fired
 * traps and the champion's remaining health — with no field taken from the
 * client. It is also what the Wild Monster Baiter calls to show a player what
 * their yard does to a roster, and what `bench.test.ts` times.
 *
 * ## Checkpoints
 *
 * Every 800 ticks — ten seconds — the engine's whole state is folded into a
 * digest (§3.4 rule 5). A golden fixture commits the list; the same fixture
 * runs under Vitest on Node and under `bun:test` on Bun and both must produce
 * it. A mismatch names the ten-second window the two runtimes parted company
 * in, which is the difference between a bug you can find and one you can only
 * stare at.
 *
 * ## The damage percentage is not recomputed here
 *
 * `damagePercent()` already implements `getBuildingSaveData`'s sum over a
 * `CombatYard` (`damagePercent.ts`, `BFOUNDATION.as:433-468`). The replay
 * builds that yard from the same `buildingdata` it simulated over and hands it
 * the health map the battle produced, so there is exactly one implementation of
 * the rule and the replay's `damage` is the same number the audit derives.
 */

/** How often the engine's state is folded into a digest. */
export const CHECKPOINT_TICKS = 800;

/** What {@link replayAttack} is handed. */
export interface ReplayInput {
  readonly buildingdata: CombatBuildingDataMap;
  readonly buildinghealthdata?: BuildingHealthMap | null;
  readonly resources?: Partial<ResourceAmounts> | null;
  readonly kind?: CombatTargetKind;
  readonly log: FlingLog;
  /** The seed to run with; the log's `seed` when absent. */
  readonly seed?: number;
  readonly levels?: MonsterLevels;
  readonly playerLevel?: number;
  readonly declareWar?: boolean;
  readonly bunkers?: Readonly<Record<number, Roster>>;
  readonly defenderLevels?: MonsterLevels;
  /** Ticks to keep simulating after the last event; the default is the whole attack. */
  readonly tailTicks?: number;
}

/** One checkpoint: the tick it was taken at and the digest of the state. */
export interface Checkpoint {
  readonly tick: number;
  readonly digest: string;
}

/** Everything the server writes, derived from the replay alone. */
export interface ReplayOutcome {
  /** Ticks simulated. */
  readonly ticks: number;
  /** `buildinghealthdata`: every building below full health. */
  readonly health: BuildingHealthMap;
  /** `damage`, the percentage `getBuildingSaveData` computes. */
  readonly damage: number;
  /** `destroyed`, for an outpost or a wild monster camp only. */
  readonly destroyed: 0 | 1 | undefined;
  /** `attackloot` before the attacker's storage cap is applied. */
  readonly attackloot: ResourceAmounts;
  /** What the defender lost, which is `resources` on the save. */
  readonly defenderLoss: ResourceAmounts;
  readonly firedTraps: readonly number[];
  readonly destroyedIds: readonly number[];
  readonly championHp: number | null;
  readonly creepsFlung: number;
  readonly creepsKilled: number;
  readonly towers: readonly TowerReport[];
  readonly checkpoints: readonly Checkpoint[];
  /** The digest of the final state, which is the one a fixture asserts first. */
  readonly digest: string;
  /** Draws taken from the random stream; a divergence shows here first. */
  readonly rngDraws: number;
}

/** The digest of one engine checkpoint. */
export const digestState = (values: readonly number[]): string => {
  const digest = createDigest();
  digest.pushAll(values);
  return digest.hex();
};

/**
 * Events in the order the engine must see them.
 *
 * A log is required to be non-decreasing in `t` (§3.10), but a replay must not
 * depend on a client honouring that: an out-of-order log would otherwise give
 * two servers two answers. The sort is stable on `t`, so events sharing a tick
 * keep the order the client sent them in, which is the order it rendered them.
 */
const ordered = (events: readonly FlingEvent[]): FlingEvent[] =>
  events
    .map((event, at) => ({ event, at }))
    .sort((one, other) =>
      one.event.t === other.event.t ? one.at - other.at : one.event.t - other.event.t,
    )
    .map(({ event }) => event);

/**
 * Replay a fling log over a yard and derive the outcome.
 *
 * The yard is built twice from the same `buildingdata`: once as the mutable
 * {@link buildEngineYard} the battle is fought over, and once as the
 * `CombatYard` the damage percentage is summed over. Neither input is mutated;
 * the engine's copy is its own.
 */
export const replayAttack = (input: ReplayInput): ReplayOutcome => {
  const yard = buildEngineYard({
    buildingdata: input.buildingdata,
    buildinghealthdata: input.buildinghealthdata ?? null,
    resources: input.resources ?? null,
    kind: input.kind ?? "main",
  });

  const options: BattleOptions = {
    seed: input.seed ?? input.log.seed,
    ...(input.levels ? { levels: input.levels } : {}),
    ...(input.playerLevel === undefined ? {} : { playerLevel: input.playerLevel }),
    ...(input.declareWar === undefined ? {} : { declareWar: input.declareWar }),
    ...(input.bunkers ? { bunkers: input.bunkers } : {}),
    ...(input.defenderLevels ? { defenderLevels: input.defenderLevels } : {}),
  };

  const battle = createBattle(yard, options);
  const events = ordered(input.log.events);
  const checkpoints: Checkpoint[] = [];
  let nextCheckpoint = CHECKPOINT_TICKS;

  const advanceTo = (target: number): void => {
    while (battle.tick < target && !battle.over()) {
      battle.runTo(Math.min(nextCheckpoint, target));
      if (battle.tick >= nextCheckpoint) {
        checkpoints.push({ tick: battle.tick, digest: digestState(battle.checkpoint()) });
        nextCheckpoint += CHECKPOINT_TICKS;
      }
    }
  };

  let last = 0;
  for (const event of events) {
    const at = Math.max(0, Math.floor(event.t));
    advanceTo(at);
    battle.apply(event);
    last = Math.max(last, at);
  }

  // Keep simulating after the last event, because the damage a fling does lands
  // long after the fling: the default is the whole attack window, and a caller
  // that wants a shorter tail says so.
  const tail = input.tailTicks ?? ticks(ATTACK_MAX_SECONDS);
  advanceTo(last + tail);

  const state: BattleState = battle.state();
  const health = state.health;
  const fired = new Set(state.firedTraps);
  const combatYard = toCombatYard({
    kind: input.kind ?? "main",
    buildingdata: input.buildingdata,
    buildinghealthdata: health,
    spent: fired,
  });
  const damage = damagePercent(combatYard, health, fired);

  return {
    ticks: state.tick,
    health,
    damage,
    destroyed: derivedDestroyed(damage, combatYard.kind),
    attackloot: state.loot,
    defenderLoss: state.defenderLoss,
    firedTraps: state.firedTraps,
    destroyedIds: state.destroyedIds,
    championHp: state.championHp,
    creepsFlung: state.creepsFlung,
    creepsKilled: state.creepsKilled,
    towers: state.towers,
    checkpoints,
    digest: digestState(battle.checkpoint()),
    rngDraws: state.rngDraws,
  };
};
