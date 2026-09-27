import {
  RESOURCE_KEYS,
  TICKS_PER_SECOND,
  buildEngineYard,
  championByType,
  createBattle,
  damagePercent,
  derivedDestroyed,
  toCombatYard,
  type BuildingHealthMap,
  type CombatBuildingDataMap,
  type CombatTargetKind,
  type FlingEvent,
  type FlingLog,
  type ResourceAmounts,
  type Roster,
} from "../../../game-rules/combat/index.js";
import { BaseType } from "../../../enums/Base.js";
import type { ChampionData } from "../../../schemas/ChampionSchema.js";
import type { JsonObject } from "../../../types/JsonObject.js";

/**
 * The result of an attack its attacker left without saving (issue #138),
 * worked out by the server from the last checkpoint (`attackCheckpoint.ts`).
 *
 * The web client fights the battle with the shared engine and reports the
 * outcome in its final save (`web/src/game/attack/attackSave.ts`). When that
 * save never comes, this runs the same engine over the same inputs — the
 * defender's yard, the attacker's academy levels, the client's seed and its
 * fling log — up to the tick the client last reported, and derives the same
 * keys the save would have carried, the same way: the engine battle is built
 * as `AttackSession.load` builds it, every event is applied at its own tick
 * as `AttackSession` applied it live, and the damage is summed over the yard
 * as loaded, as the session's readout sums it. The battle ends at that tick:
 * nothing the creeps would have done after it counts, because the attack
 * ended when the attacker left.
 *
 * Pure: the caller reads the rows and writes the result (`finaliseAttack.ts`).
 */

/** What the replay needs of the defender's row. */
export interface AbandonedDefender {
  type: string;
  buildingdata: CombatBuildingDataMap | null | undefined;
  buildinghealthdata: BuildingHealthMap | null | undefined;
  /** The pool the attack load served: the owner's for an outpost, the row's own otherwise. */
  resources: Partial<ResourceAmounts> | null | undefined;
}

/** What the replay needs of the attacker's main save. */
export interface AbandonedAttacker {
  academy: JsonObject | null | undefined;
  champion: ChampionData[] | null | undefined;
  siege: JsonObject | null | undefined;
}

export interface AbandonedInput {
  defender: AbandonedDefender;
  attacker: AbandonedAttacker;
  log: FlingLog;
  /** The tick the attacker was last seen at: the checkpoint's. */
  tick: number;
  declareWar: boolean;
}

/** Everything the attack save would have carried, derived. */
export interface AbandonedOutcome {
  /** The tick the battle was run to. */
  tick: number;
  buildinghealthdata: Record<string, number>;
  damage: number;
  destroyed: 0 | 1 | undefined;
  firedTraps: number[];
  /** `attackloot`: the gain, whole units. */
  attackloot: ResourceAmounts;
  /** `resources`: the defender's loss as a negative delta, whole units. */
  defenderDelta: ResourceAmounts;
  /** Monsters flung, per id, from the log. */
  flung: Record<string, number>;
  /** `attackerchampion`, or undefined when the attacker has none. */
  attackerchampion: ChampionData[] | undefined;
  /** `attackersiege`, or undefined when the attacker has none. */
  attackersiege: JsonObject | undefined;
  attackreport: string;
}

/** The web client's name for the kind of yard (`AttackTargetKind`). */
export const combatKindOf = (type: string): CombatTargetKind => {
  if (type === BaseType.TRIBE) return "wild";
  if (type === BaseType.OUTPOST) return "outpost";
  return "main";
};

/** Academy levels as `rosterInRange` reads them (`web/src/game/attack/attackEntry.ts`). */
export const academyLevels = (academy: JsonObject | null | undefined): Record<string, number> => {
  const levels: Record<string, number> = {};
  for (const [id, entry] of Object.entries(academy ?? {})) {
    if (typeof entry?.level === "number") levels[id] = entry.level;
  }
  return levels;
};

/** Events in tick order, ties in the order sent, as `replay.ts` orders them. */
const ordered = (events: readonly FlingEvent[]): FlingEvent[] =>
  events
    .map((event, at) => ({ event, at }))
    .sort((one, other) => (one.event.t === other.event.t ? one.at - other.at : one.event.t - other.event.t))
    .map(({ event }) => event);

const whole = (amounts: ResourceAmounts, sign: 1 | -1): ResourceAmounts => {
  const out = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) out[key] = sign * Math.floor(Math.max(0, amounts[key]));
  return out;
};

/** What the log says was flung, summed per id (`attackSave.ts` `flungOf`). */
export const flungOf = (events: readonly FlingEvent[]): Record<string, number> => {
  const flung: Record<string, number> = {};
  for (const event of events) {
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) {
      if (count > 0) flung[id] = (flung[id] ?? 0) + count;
    }
  }
  return flung;
};

/** The siege inventory less one per siege event (`attackSave.ts` `attackerSiegeAfter`). */
export const siegeAfter = (
  siege: JsonObject | null | undefined,
  events: readonly FlingEvent[]
): JsonObject | undefined => {
  if (!siege) return undefined;
  const out: JsonObject = { ...siege };
  for (const event of events) {
    if (event.kind !== "siege") continue;
    const entry = out[event.weapon];
    if (typeof entry !== "object" || entry === null) continue;
    if (typeof entry.quantity !== "number") continue;
    out[event.weapon] = { ...entry, quantity: Math.max(0, entry.quantity - 1) };
  }
  return out;
};

/** `m:ss` of a tick, the attack clock's own spelling. */
const clockOf = (tick: number): string => {
  const seconds = Math.max(0, Math.floor(tick / TICKS_PER_SECOND));
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)}:${rest < 10 ? "0" : ""}${rest}`;
};

const at = (x: number, y: number) => `at (${Math.round(x)}, ${Math.round(y)})`;

/** One report line per event, as the client's `reportLine` writes them, ids for names. */
const reportLine = (event: FlingEvent): string => {
  const when = clockOf(event.t);
  switch (event.kind) {
    case "fling": {
      const parts = Object.entries(event.monsters)
        .filter(([, count]) => count > 0)
        .map(([id, count]) => `${count} ${id}`);
      if (event.champion) parts.push(`the champion (G${event.champion.t})`);
      return `${when} Flung ${parts.join(", ")} ${at(event.x, event.y)}`;
    }
    case "bomb":
      return `${when} Fired a ${event.id} bomb ${at(event.x, event.y)}`;
    case "siege":
      return `${when} Deployed ${event.weapon} ${at(event.x, event.y)}`;
    case "retreat":
      return `${when} Retreated`;
  }
};

/**
 * Replays an abandoned attack to the tick its attacker was last seen at.
 *
 * @param input - The rows as stored, the checkpointed log and its tick.
 * @returns What the attack save would have written.
 */
export const replayAbandonedAttack = (input: AbandonedInput): AbandonedOutcome => {
  const { defender, attacker, log, declareWar } = input;
  const kind = combatKindOf(defender.type);
  const buildingdata = defender.buildingdata ?? {};
  const events = ordered(log.events);
  const lastEvent = events.reduce((last, event) => Math.max(last, Math.floor(event.t)), 0);
  const end = Math.max(Math.floor(input.tick), lastEvent);

  const battle = createBattle(
    buildEngineYard({
      buildingdata,
      buildinghealthdata: defender.buildinghealthdata ?? null,
      resources: defender.resources ?? null,
      kind,
    }),
    { seed: log.seed, levels: academyLevels(attacker.academy), declareWar }
  );

  const championsFlung = new Set<number>();
  for (const event of events) {
    battle.runTo(Math.max(0, Math.floor(event.t)));
    battle.apply(event);
    if (event.kind === "fling" && event.champion) championsFlung.add(event.champion.t);
  }
  battle.runTo(end);

  const state = battle.state();
  const combatYard = toCombatYard({
    kind,
    buildingdata,
    buildinghealthdata: defender.buildinghealthdata ?? null,
  });
  const percent = damagePercent(combatYard, state.health, new Set(state.firedTraps));
  const damage = Math.round(percent * 100) / 100;

  // Each flung champion's health as the battle left it, a death as 0
  // (`AttackSession.championsHpAfter`); an unflung champion is untouched.
  const champions = attacker.champion ?? [];
  const attackerchampion =
    champions.length === 0
      ? undefined
      : champions.map((champion) => {
          if (!championsFlung.has(champion.t)) return { ...champion };
          const id = championByType(champion.t);
          const hp = id === undefined ? undefined : state.championsHp[id];
          return { ...champion, hp: Math.max(0, Math.floor(hp ?? 0)) };
        });

  const loot = whole(state.loot, 1);
  const lines = log.events.map(reportLine);
  lines.push(`${clockOf(state.tick)} Left the attack`);
  lines.push(
    `Result: ${Math.floor(percent)}% damage, ${state.destroyedIds.length} buildings destroyed, ` +
      `looted ${loot.r1} twigs, ${loot.r2} pebbles, ${loot.r3} putty, ${loot.r4} goo.`
  );

  return {
    tick: state.tick,
    buildinghealthdata: { ...state.health },
    damage,
    destroyed: derivedDestroyed(damage, kind),
    firedTraps: [...state.firedTraps],
    attackloot: loot,
    defenderDelta: whole(state.defenderLoss, -1),
    flung: flungOf(log.events),
    attackerchampion,
    attackersiege: siegeAfter(attacker.siege, log.events),
    attackreport: lines.join("\n"),
  };
};

/** One of the attacker's cells: its base id and its whole housing blob. */
export interface SourceCell {
  baseid: string;
  m: JsonObject;
}

/**
 * Takes what was flung out of the attacker's cells, first cell first, the way
 * `monsterUpdateOf` does (`web/src/game/attack/attackSave.ts`), but over the
 * housing as stored now rather than as the client loaded it.
 *
 * @param cells - The source cells, in the checkpoint's order.
 * @param flung - Monsters flung, per id.
 * @returns Each cell's new blob, and anything the cells could not pay for.
 */
export const spendFlung = (
  cells: readonly SourceCell[],
  flung: Roster
): { updates: SourceCell[]; unpaid: Record<string, number> } => {
  const left: Record<string, number> = { ...flung };
  const updates = cells.map((cell) => {
    const stored = cell.m["housed"];
    const housed: Record<string, unknown> =
      typeof stored === "object" && stored !== null ? { ...stored } : {};
    for (const [id, count] of Object.entries(housed)) {
      const owed = left[id] ?? 0;
      if (owed <= 0 || typeof count !== "number") continue;
      const taken = Math.min(count, owed);
      housed[id] = count - taken;
      left[id] = owed - taken;
    }
    return { baseid: cell.baseid, m: { ...cell.m, housed } };
  });

  const unpaid: Record<string, number> = {};
  for (const [id, count] of Object.entries(left)) if (count > 0) unpaid[id] = count;
  return { updates, unpaid };
};

/** `buildingdata` as the save would send it: the stored map less the traps that fired. */
export const buildingDataWithout = (
  buildingdata: JsonObject | null | undefined,
  firedTraps: readonly number[]
): JsonObject => {
  const fired = new Set(firedTraps.map(String));
  const out: JsonObject = {};
  for (const [key, building] of Object.entries(buildingdata ?? {})) {
    if (!fired.has(key)) out[key] = building;
  }
  return out;
};
