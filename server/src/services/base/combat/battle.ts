import type { CombatTargetKind } from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { MAX_CHECKPOINT_TICK, parseFlingLog } from "../attackCheckpoint.js";
import type { AttackSession } from "../attackSession.js";
import type { AbandonedDefender, AbandonedInput, AbandonedOutcome } from "./abandonedAttack.js";
import {
  fightableLog,
  foughtAcademy,
  wholeAmounts,
  withFrozenChampions,
  type LootAttacker,
  type ReplayedLoot,
} from "./attackLoot.js";
import { fallenIn } from "./bunkerGarrison.js";
import { stampPlays } from "./rulesStamp.js";

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
 * The older rules versions that already keep health whole, as Flash's does
 * (player report, Reii, 25 Nov 2026): patch 8.7's, `92ea2dbbfe06531c`, and
 * beta 9's with it, `723a6cab98c42278`. Both fight Krallen by patch 8.6's
 * rules too. An attack started on 8.7 and landed after beta 9 went live, or
 * on beta 9 before main's 8.7 was merged back, keeps both. Beta 9 as it went
 * live, `15bf255b01aafabc`, keeps both too: an attack started on it and
 * landed after patch 9.1's twig and pebble blast or beta 10's rebalance moved
 * the version. Patch 9.1 as it went live, `90eed38ba0369a60`, keeps both:
 * an attack started on it and landed after beta 10 went live. Beta 10
 * before main's 9.1 was merged back, `a332754d0da35501`, keeps both too.
 */
const WHOLE_HEALTH_RULES_SINCE_8_7: readonly string[] = [
  "92ea2dbbfe06531c",
  "723a6cab98c42278",
  "15bf255b01aafabc",
  "90eed38ba0369a60",
  "a332754d0da35501",
];

/**
 * The older rules versions that already fight Krallen by patch 8.6's rules
 * (no Mode, Flash's route and turns): 8.6's own, `cf287596a22ae2e0`, and
 * beta 9's with them, `22d6196bc811ac42`, and every version that keeps
 * health whole ({@link WHOLE_HEALTH_RULES_SINCE_8_7}). A rule gate must not
 * read "these rules or not" once a later change moves the version again: an
 * attack started on 8.6 and landed after whole health went live keeps its
 * 8.6 Krallen, without whole health (player report, Reii).
 */
const KRALLEN_RULES_SINCE_8_6: readonly string[] = [
  "cf287596a22ae2e0",
  "22d6196bc811ac42",
  ...WHOLE_HEALTH_RULES_SINCE_8_7,
];

/**
 * What the replay of an attack is handed, as plain data, or null when there
 * is no usable fling log to replay.
 *
 * @param flinglog - The log: a save's `flinglog` or a checkpoint's.
 * @param session - What the attack load recorded: the roster, the pools, the level,
 *   the attacker's academy and, for an attack started before the alliance power-ups
 *   were removed, Declare War (issue #201), which win over the rows.
 * @param defender - The defender's row.
 * @param attacker - The attacker's main save.
 * @param tick - The tick the battle ended at.
 * @param left - Whether the report says the attacker left (`AbandonedInput.left`):
 *   always for the finaliser; for a save, when its `left` says so.
 */
export const battleReplayInput = ({
  flinglog,
  session,
  defender,
  attacker,
  tick,
  left,
  descentYard,
}: {
  flinglog: unknown;
  session: AttackSession | null;
  defender: BattleDefender;
  attacker: BattleAttacker;
  tick: number;
  left?: boolean;
  /** The Descent yard fought, 1 to 13 (`AbandonedInput.descentYard`); absent outside the Descent. */
  descentYard?: number;
}): AbandonedInput | null => {
  const log = parseFlingLog(flinglog);
  if (!log) return null;
  const academy = foughtAcademy(session, attacker.academy);
  // Krallen has no Mode in an attack started under these rules (patch 8.7,
  // `hasMode`); one started under older rules, or with none recorded,
  // replays with the Mode its log carries, as it was fought.
  const rulesNow = stampPlays(session?.rules);
  const stampIn = (versions: readonly string[]): boolean =>
    typeof session?.rules === "string" && versions.includes(session.rules);
  const modelessKrallen = rulesNow || stampIn(KRALLEN_RULES_SINCE_8_6);
  const wholeHealth = rulesNow || stampIn(WHOLE_HEALTH_RULES_SINCE_8_7);
  const fighter: LootAttacker = {
    academy,
    champion: attacker.champion ?? null,
    catapult: attacker.catapult ?? null,
    buildingdata: attacker.buildingdata ?? null,
    resources: session?.attackerResources ?? null,
    brains: session?.championBrains ?? null,
    health: session?.championHealth ?? null,
    // Krallen's loot aura counts when it ran at the attack's start (owner,
    // 13 Nov 2026): a session without one gives her none.
    auraAt: session?.startedat ?? null,
    modelessKrallen,
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
      academy,
      champion: (attacker.champion ?? null) as AbandonedInput["attacker"]["champion"],
      siege: attacker.siege ?? null,
    },
    // Only what the attacker could have flung fights, as in the loot's own rule,
    // and each champion with the brain (#219) and health the attack froze,
    // never the log's.
    log: session?.entryHoused
      ? fightableLog(log, fighter, session.entryHoused)
      : withFrozenChampions(log, session?.championBrains, session?.championHealth, modelessKrallen),
    tick,
    // The countdown the client was served (issue #201): Declare War is gone, but
    // a session started while it ran still carries it.
    declareWar: session?.declareWar ?? false,
    ...(session?.attackerlevel !== undefined && { playerLevel: session.attackerlevel }),
    ...(left !== undefined && { left }),
    // The defence the attack load served (issue #195).
    ...(session?.defenderForces && { defence: session.defenderForces }),
    ...(descentYard !== undefined && { descentYard }),
    // Krallen keeps her route and turns only on a defender that reaches or
    // hits her (patch 8.6) only in an attack started under these rules.
    flashKrallen: modelessKrallen,
    // A monster's health stays whole, as Flash's does (player report, Reii,
    // 25 Nov 2026), only in an attack started under these rules or ones that
    // already kept it.
    wholeHealth,
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

/** One side's figures in a mismatch log line ({@link mismatchFigures}). */
export interface MismatchFigures {
  /** The attack's loot, whole units. */
  readonly loot: { r1: number; r2: number; r3: number; r4: number };
  /** Each flung champion's health after the battle, by type; null where the save has none. */
  readonly champions: Record<string, number | null>;
  /** Each caged (defending) champion's health after the battle, by type; null where the save has none. */
  readonly caged: Record<string, number | null>;
}

/**
 * The save's and the battle's figures behind {@link battleMismatches}'
 * `attackloot`, `attackerchampion` and `champion`, for the
 * `attack-replay-mismatch` log line (descent-aura, 24 Nov 2026): with the
 * numbers on both sides a remaining disagreement can be told apart (a loot
 * aura moves the loot, a fight the champions' health).
 */
export const mismatchFigures = (
  client: ClientBattle,
  server: AbandonedOutcome
): { sent: MismatchFigures; derived: MismatchFigures } => {
  const sentChampions: Record<string, number | null> = {};
  const derivedChampions: Record<string, number | null> = {};
  for (const type of server.championsFlung) {
    sentChampions[type] = championHpOf(client.attackerchampion, type) ?? null;
    const hp = server.attackerchampion?.find((champion) => champion.t === type)?.hp;
    derivedChampions[type] = hp === undefined ? null : Math.floor(hp);
  }
  const sentCaged: Record<string, number | null> = {};
  const derivedCaged: Record<string, number | null> = {};
  for (const caged of server.defenderChampions) {
    sentCaged[caged.t] = championHpOf(client.champion, caged.t) ?? null;
    derivedCaged[caged.t] = Math.floor(caged.hp);
  }
  const sent = wholeAmounts(client.attackloot);
  const { r1, r2, r3, r4 } = server.attackloot;
  return {
    sent: { loot: { r1: sent.r1, r2: sent.r2, r3: sent.r3, r4: sent.r4 }, champions: sentChampions, caged: sentCaged },
    derived: { loot: { r1, r2, r3, r4 }, champions: derivedChampions, caged: derivedCaged },
  };
};
