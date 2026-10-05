import type { CombatTargetKind } from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { MAX_CHECKPOINT_TICK, parseFlingLog } from "../attackCheckpoint.js";
import type { AttackSession } from "../attackSession.js";
import type { AbandonedDefender, AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import {
  fightableLog,
  wholeAmounts,
  withFrozenBrains,
  type LootAttacker,
  type ReplayedLoot,
} from "./attackLoot.js";
import { fallenIn } from "./bunkerGarrison.js";

/**
 * The battle an attack fought, as the server works it out (issue #23, C3).
 *
 * The attack save that ends an attack and the finaliser of one left without
 * a save both run the same replay: the fling log cut down to what the attacker
 * could have fought (`fightableLog`), over the pool and at the level the attack
 * load served (the session), up to the moment the attack ended, and derive
 * everything the battle changed from it: the defender's health, damage,
 * `destroyed` and fired traps, both sides' loot, the attacker's champions and
 * siege. The finaliser takes the moment from its checkpoint; the save from the
 * `tick` the client sends, its own battle clock, which bounds nothing more
 * than the attack's longest end already did.
 *
 * Pure: the callers read the rows and run the replay in a worker
 * (`replayRunner.ts`).
 */

/**
 * The tick a save's battle is replayed to: the client's clock, whole, never
 * past the attack's longest end (`MAX_CHECKPOINT_TICK`). A save without one is
 * replayed to that end, which is the most any battle could have done.
 *
 * @param sent - The save's `tick`, as parsed.
 */
export const battleTick = (sent: unknown): number => {
  const tick = Number(sent);
  return Number.isFinite(tick) && tick >= 0 ? Math.min(Math.floor(tick), MAX_CHECKPOINT_TICK) : MAX_CHECKPOINT_TICK;
};

/** The defender's row as the replay reads it, with the pool it draws from now. */
export interface BattleDefender {
  readonly type: string;
  readonly buildingdata: JsonObject | null | undefined;
  readonly buildinghealthdata: JsonObject | null | undefined;
  readonly resources: JsonObject | null | undefined;
  readonly height?: number;
  /** The engine's kind of yard, when the row's `type` does not say it (`AbandonedDefender.kind`). */
  readonly kind?: CombatTargetKind;
}

/** The attacker's main save as the replay reads it. */
export interface BattleAttacker extends LootAttacker {
  readonly siege?: JsonObject | null;
}

/**
 * What the replay of an attack is handed, as plain data, or null when there
 * is no usable fling log to replay.
 *
 * @param flinglog - The log: a save's `flinglog` or a checkpoint's.
 * @param session - What the attack load recorded: the roster, the pools, the level.
 * @param defender - The defender's row.
 * @param attacker - The attacker's main save.
 * @param tick - The tick the battle ended at.
 * @param declareWar - Whether the attacker's alliance has Declare War running.
 * @param left - Whether the report says the attacker left (`AbandonedInput.left`):
 *   always for the finaliser; for a save, when its `left` says so.
 */
export const battleReplayInput = ({
  flinglog,
  session,
  defender,
  attacker,
  tick,
  declareWar,
  left,
}: {
  flinglog: unknown;
  session: AttackSession | null;
  defender: BattleDefender;
  attacker: BattleAttacker;
  tick: number;
  declareWar: boolean;
  left?: boolean;
}): AbandonedInput | null => {
  const log = parseFlingLog(flinglog);
  if (!log) return null;
  const fighter: LootAttacker = {
    academy: attacker.academy ?? null,
    champion: attacker.champion ?? null,
    catapult: attacker.catapult ?? null,
    buildingdata: attacker.buildingdata ?? null,
    resources: session?.attackerResources ?? null,
    brains: session?.championBrains ?? null,
  };
  return {
    defender: {
      type: defender.type,
      buildingdata: (defender.buildingdata ?? {}) as AbandonedDefender["buildingdata"],
      buildinghealthdata: (defender.buildinghealthdata ?? null) as AbandonedDefender["buildinghealthdata"],
      resources: session?.defenderResources ?? (defender.resources as AbandonedDefender["resources"]),
      ...(defender.height !== undefined && { height: defender.height }),
      ...(defender.kind !== undefined && { kind: defender.kind }),
    },
    attacker: {
      academy: attacker.academy ?? null,
      champion: (attacker.champion ?? null) as AbandonedInput["attacker"]["champion"],
      siege: attacker.siege ?? null,
    },
    // Only what the attacker could have flung fights, as in the loot's own rule,
    // and each champion with the brain the attack froze, never the log's (#219).
    log: session?.entryHoused
      ? fightableLog(log, fighter, session.entryHoused)
      : withFrozenBrains(log, session?.championBrains),
    tick,
    declareWar,
    ...(session?.attackerlevel !== undefined && { playerLevel: session.attackerlevel }),
    ...(left !== undefined && { left }),
    // The defence the attack load served (issue #195).
    ...(session?.defenderForces && { defence: session.defenderForces }),
  };
};

/**
 * A replayed battle as the loot rule takes it (`attackLootOf`'s `fought`): the
 * gain, the loss as amounts, and what fell.
 *
 * @param outcome - The replay's outcome.
 */
export const foughtLoot = (outcome: AbandonedOutcome): ReplayedLoot => ({
  attackloot: outcome.attackloot,
  defenderLoss: wholeAmounts(
    Object.fromEntries(Object.entries(outcome.defenderDelta).map(([key, value]) => [key, -value]))
  ),
  fallen: [...fallenIn(outcome.buildinghealthdata)].sort((one, other) => one - other),
});

/** What the client's save said the battle did, for comparison only. */
export interface ClientBattle {
  readonly damage: unknown;
  readonly destroyed: unknown;
  readonly buildinghealthdata: unknown;
  /** The traps the save still lists: every trap it leaves out fired. */
  readonly buildingdata: unknown;
  readonly attackloot: unknown;
  /** The attacker's champions after the battle (issue #23, C1). */
  readonly attackerchampion?: unknown;
  /** The attacker's siege stock after the battle (issue #23, C1). */
  readonly attackersiege?: unknown;
  /** The defender's champions after the battle (issue #195). */
  readonly champion?: unknown;
}

const TRAP_TYPES: ReadonlySet<number> = new Set([24, 117]);

/** The trap ids of a stored `buildingdata` the save's copy leaves out. */
const trapsLeftOut = (stored: JsonObject | null | undefined, sent: unknown): number[] => {
  if (!sent || typeof sent !== "object") return [];
  const kept = sent as Record<string, unknown>;
  const fired: number[] = [];
  for (const [key, building] of Object.entries(stored ?? {})) {
    const entry = building as { t?: unknown; id?: unknown } | null;
    if (!entry || !TRAP_TYPES.has(Number(entry.t))) continue;
    if (!kept[key]) fired.push(Math.floor(Number(entry.id ?? key)));
  }
  return fired.sort((one, other) => one - other);
};

/** The health the save gives each champion type the battle flung. */
const championHpOf = (sent: unknown, type: number): number | undefined => {
  if (!Array.isArray(sent)) return undefined;
  const entry = sent.find((champion) => Number((champion as { t?: unknown } | null)?.t) === type);
  const hp = Number((entry as { hp?: unknown } | undefined)?.hp);
  return Number.isFinite(hp) ? Math.floor(hp) : undefined;
};

/** Each flung champion's health, the save's against the battle's. */
const sameChampions = (sent: unknown, server: AbandonedOutcome): boolean =>
  server.championsFlung.every((type) => {
    const derived = server.attackerchampion?.find((champion) => champion.t === type)?.hp;
    return derived === undefined || championHpOf(sent, type) === Math.floor(derived);
  });

/** A siege stock as quantities by weapon, the only part the battle changes. */
const siegeQuantities = (stock: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!stock || typeof stock !== "object") return out;
  for (const [weapon, entry] of Object.entries(stock as Record<string, unknown>)) {
    const quantity = Number((entry as { quantity?: unknown } | null)?.quantity);
    if (Number.isFinite(quantity)) out[weapon] = quantity;
  }
  return out;
};

const sameSiege = (sent: unknown, derived: unknown): boolean => {
  const one = siegeQuantities(sent);
  const other = siegeQuantities(derived);
  const weapons = new Set([...Object.keys(one), ...Object.keys(other)]);
  return [...weapons].every((weapon) => one[weapon] === other[weapon]);
};

const sameHealth = (sent: unknown, derived: Record<string, number>): boolean => {
  if (!sent || typeof sent !== "object") return Object.keys(derived).length === 0;
  const reported = sent as Record<string, unknown>;
  const keys = new Set([...Object.keys(reported), ...Object.keys(derived)]);
  for (const key of keys) {
    if (Math.floor(Number(reported[key] ?? Number.NaN)) !== Math.floor(derived[key] ?? Number.NaN)) return false;
  }
  return true;
};

/**
 * Where the client's save and the server's battle part company, by field:
 * `damage`, `destroyed`, `buildinghealthdata`, `firedTraps`, `attackloot`, and
 * the attacker's own row, `attackerchampion` (a flung champion's health) and
 * `attackersiege` (issue #23, C7), and the defender's caged champion,
 * `champion` (issue #195). Empty for an honest save, which fought the
 * same battle with the same engine. Recorded, never written; refused under
 * `COMBAT_SAVE_VALIDATION=reject` (`saveBattle.ts`).
 *
 * @param client - What the save sent.
 * @param server - The replay's outcome.
 * @param storedBuildingdata - The defender's `buildingdata` before the save.
 */
export const battleMismatches = (
  client: ClientBattle,
  server: AbandonedOutcome,
  storedBuildingdata: JsonObject | null | undefined
): string[] => {
  const fields: string[] = [];
  if (Math.floor(Number(client.damage)) !== Math.floor(server.damage)) fields.push("damage");
  if ((Number(client.destroyed) || 0) !== (server.destroyed ?? 0)) fields.push("destroyed");
  if (!sameHealth(client.buildinghealthdata, server.buildinghealthdata)) fields.push("buildinghealthdata");
  const fired = [...server.firedTraps].sort((one, other) => one - other);
  if (JSON.stringify(trapsLeftOut(storedBuildingdata, client.buildingdata)) !== JSON.stringify(fired)) {
    fields.push("firedTraps");
  }
  const sent = wholeAmounts(client.attackloot);
  if ((["r1", "r2", "r3", "r4"] as const).some((key) => sent[key] !== server.attackloot[key])) {
    fields.push("attackloot");
  }
  if (!sameChampions(client.attackerchampion, server)) fields.push("attackerchampion");
  if (!sameSiege(client.attackersiege, server.attackersiege)) fields.push("attackersiege");
  // Each caged champion's health, the save's against the battle's (issues #195, #310).
  if (server.defenderChampions.some((caged) => championHpOf(client.champion, caged.t) !== Math.floor(caged.hp))) {
    fields.push("champion");
  }
  return fields;
};
