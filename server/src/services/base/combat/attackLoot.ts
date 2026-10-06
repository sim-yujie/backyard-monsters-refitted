import {
  BOMBS,
  KRALLEN_ID,
  LOOT_GAIN_RATIO,
  LOW_LEVEL_LOOT_CEILING,
  RESOURCE_KEYS,
  championStat,
  lowLevelLootBonus,
  type BombStats,
  type BuildingHealthMap,
  type CombatBuildingDataMap,
  type FlingEvent,
  type FlingLog,
  type ResourceAmounts,
} from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";
import { mr1TribePool } from "../../maproom/v1/mr1TribeRules.js";
import type { EntryHoused } from "../../yard/attackRoster.js";
import { creditResources, type CreditResult, type CreditSave } from "../../yard/credit.js";
import { storageCap } from "../economy/resourceBudget.js";
import { parseFlingLog } from "../attackCheckpoint.js";
import type { AttackSession, ChampionBrains } from "../attackSession.js";
import { catapultLevelOf } from "./bombSpend.js";

/**
 * What an attack save may credit the attacker (issue #163).
 *
 * The web client fights the battle with the shared engine and reports the gain
 * as `attackloot` (`web/src/game/attack/attackSave.ts`); the server used to add
 * whatever arrived. Now the gain is capped by the same engine run on the
 * server, and only the save that ends the attack credits anything
 * (`baseSave.ts`), under the final lock, so the loot lands once.
 *
 * ## The cap on a Map Room 2 attack
 *
 * The cap is the server's own battle, handed in as `fought`: the save's replay
 * (`battle.ts`, run in a worker by `baseSave.ts`) or the finaliser's
 * (`finaliseAttack.ts`). Either replays the save's fling log over the
 * defender's yard as stored (the row is frozen while an attack runs: yard
 * actions and the owner's catch-up refuse it), the defence the attack load
 * served (bunkers, the caged champion, issue #195) and the pool it served
 * (kept in the attack session, because an outpost draws on its owner's main
 * pool, which is not frozen). The replay:
 *
 * - flings only what the attacker could have flung: each monster id at most
 *   what their yards housed at attack entry (the session's `entryHoused`),
 *   each champion one they own, once, at no more than its level, each bomb
 *   one their catapult unlocks and only the first of its resource
 *   ({@link fightableLog});
 * - uses the attacker's academy levels, as the client's roster does;
 * - stretches an outpost's tower range by its cell's height, the stored value
 *   the attack load served as `cellheight` (`cellHeight.ts`, issue #179);
 * - runs at the attacker's player level as the attack load served it (the
 *   session's `attackerlevel`), which is the level the client's engine ran at,
 *   so the low-level loot bonus (`ATTACK.as:678-680`) is the same on both
 *   sides and never the client's say (issue #167);
 * - runs the battle to the client's own battle clock, and never past its
 *   longest possible end, Declare War's countdown plus the retreat grace.
 *
 * An honest client ran the same engine over the same inputs to the same tick,
 * so it reports what the replay gives. The credit is the
 * smaller of the two, per resource: an honest attack is credited in full,
 * and no attack is credited more than the battle it could actually have
 * fought would have given it. The defender's loss is held between what the
 * attacker is credited and what the replay took ({@link attackLootOf}), so the
 * pool the next attack is capped by is never one this attack left untouched.
 *
 * A Map Room 1 or 2 attack save without a usable fling log is credited
 * nothing: the web client always sends one, and without it neither the loot
 * nor the monsters flung can be checked.
 *
 * ## Without a replay
 *
 * A Map Room 3 attack (its session records no roster, and the attacker's own
 * save says Map Room 3) has no web client and no log the server can trust, so
 * its gain is capped by what the defender holds — its pool plus its
 * harvesters' buffers — times the low-level bonus allowance, as Map Room 1
 * tribes are (`mr1TribeRules.ts`, issue #161). A session without a roster
 * from anyone else is credited nothing: every Map Room 1 and 2 attack load
 * records one (the load takes the attacker's stored Map Room since #165).
 *
 * ## The attacker's storage (issue #166)
 *
 * What the battle credits then meets the attacker's own storage, as in Flash:
 * `ATTACK.Loot` adds a gain to the attacker's pool only up to its cap, and
 * Krallen on the field raises that cap by her `buffs`
 * (`client/scripts/ATTACK.as:695-710`). The defender still loses the whole
 * amount — storage and harvesters are emptied before `ATTACK.Loot` is called
 * (`BSTORAGE.as:65-83`, `BRESOURCE.as:93-103`) — so the room cuts the
 * attacker's side alone, and {@link bankAttackLoot} applies it at the moment
 * the credit lands. Flash banked only what fit (`BASE.as:2859-2866` sends the
 * clamped `_savedDeltaLoot`), while the attack log and the HUD showed the
 * whole gain (`ATTACK.as:481-495`, `UI_TOP.as:955`).
 *
 * Pure: the caller reads the rows and writes the result.
 */

/** Whole amounts of `r1`..`r4`, 0 for anything missing, negative or not a number. */
export const wholeAmounts = (raw: unknown): ResourceAmounts => {
  const amounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  if (!raw || typeof raw !== "object") return amounts;
  const values = raw as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    const value = Math.floor(Number(values[key]));
    if (Number.isFinite(value) && value > 0) amounts[key] = value;
  }
  return amounts;
};

/**
 * A resource pool as the engine reads it (`buildEngineYard`): each of
 * `r1`..`r4` as a number, at least 0, fractions kept.
 */
export const poolAmounts = (raw: unknown): ResourceAmounts => {
  const amounts = { r1: 0, r2: 0, r3: 0, r4: 0 };
  if (!raw || typeof raw !== "object") return amounts;
  const values = raw as Record<string, unknown>;
  for (const key of RESOURCE_KEYS) {
    const value = Number(values[key]);
    if (Number.isFinite(value) && value > 0) amounts[key] = value;
  }
  return amounts;
};

/** What the replay needs of the defender's row. */
export interface LootDefender {
  type: string;
  buildingdata: CombatBuildingDataMap | null | undefined;
  buildinghealthdata: BuildingHealthMap | null | undefined;
  /** The pool the loot is drawn from now: the row's own, or its owner's for an outpost. */
  resources: JsonObject | null | undefined;
  /** The map cell's height, which stretches an outpost's tower range (`cellHeight.ts`). */
  height?: number;
}

/** What the replay needs of the attacker's main save, as it stood before this save. */
export interface LootAttacker {
  academy?: JsonObject | null;
  /** The attacker's champions: type, level, and power level (issue #202). */
  champion?: readonly { t: number; l: number; pl?: number }[] | null;
  catapult?: number | null;
  buildingdata?: JsonObject | null;
  /**
   * The attacker's pool when the attack began (the session's
   * `attackerResources`): a bomb costing more than it held of its resource is
   * not fought (issue #23, C3). Absent, affordability is not checked.
   */
  resources?: Partial<ResourceAmounts> | null;
  /**
   * The attacker's champions' brains as the attack froze them at launch (the
   * session's `championBrains`, issue #219): the only brains the replay
   * fights with. Absent, every champion fights with none.
   */
  brains?: ChampionBrains | null;
}

const bombById: ReadonlyMap<string, BombStats> = new Map(BOMBS.map((bomb) => [bomb.id, bomb]));

/** What a pool held of resource 1 to 4, 0 for anything unreadable. */
const heldOf = (pool: Partial<ResourceAmounts>, resource: number): number => {
  const value = Number(pool[`r${resource}` as keyof ResourceAmounts]);
  return Number.isFinite(value) ? value : 0;
};

/** Events in tick order, ties in the order sent, as `replay.ts` orders them. */
const ordered = (events: readonly FlingEvent[]): FlingEvent[] =>
  events
    .map((event, at) => ({ event, at }))
    .sort((one, other) => (one.event.t === other.event.t ? one.at - other.at : one.event.t - other.event.t))
    .map(({ event }) => event);

/**
 * The log cut down to a battle the attacker could have fought.
 *
 * The web client refuses every one of these before it logs an event
 * (`AttackSession.appendFling`, `championBlock`, the bomb picker), so an
 * honest log comes back unchanged. A bomb the attacker could not afford at
 * attack start is dropped too, when the caller knows that pool.
 *
 * @param log - The save's fling log.
 * @param attacker - The attacker's main save.
 * @param entryHoused - What each of the attacker's yards housed at attack entry.
 */
export const fightableLog = (log: FlingLog, attacker: LootAttacker, entryHoused: EntryHoused): FlingLog => {
  const left: Record<string, number> = {};
  for (const housed of Object.values(entryHoused)) {
    for (const [id, count] of Object.entries(housed)) left[id] = (left[id] ?? 0) + count;
  }

  const owned = new Map<number, { l: number; pl: number }>();
  for (const champion of attacker.champion ?? []) {
    if (!Number.isInteger(champion?.t) || !Number.isFinite(champion.l)) continue;
    const pl = Number(champion.pl);
    owned.set(champion.t, { l: champion.l, pl: Number.isFinite(pl) ? Math.max(0, Math.floor(pl)) : 0 });
  }
  const championsFlung = new Set<number>();

  const catapultLevel = catapultLevelOf({
    catapult: attacker.catapult ?? null,
    buildingdata: attacker.buildingdata ?? null,
  });
  const bombed = new Set<number>();

  const events: FlingEvent[] = [];
  for (const event of ordered(log.events)) {
    if (event.kind === "bomb") {
      const bomb = bombById.get(event.id);
      if (!bomb || bomb.catapultLevel > catapultLevel || bombed.has(bomb.resource)) continue;
      // `ResourceBombs.as:301-305`: one it could not pay for is never dropped.
      if (attacker.resources && bomb.cost > heldOf(attacker.resources, bomb.resource)) continue;
      bombed.add(bomb.resource);
      events.push(event);
      continue;
    }
    if (event.kind !== "fling") {
      events.push(event);
      continue;
    }

    const monsters: Record<string, number> = {};
    for (const [id, count] of Object.entries(event.monsters)) {
      const take = Math.min(count, left[id] ?? 0);
      if (take <= 0) continue;
      monsters[id] = take;
      left[id] = (left[id] ?? 0) - take;
    }

    // A champion the attacker owns, once, at no more than its stored level and
    // power level (issue #202); a log with no `pl` fights at its level alone.
    // Its Mode (issue #220) is the attacker's choice for this attack and rides
    // along as sent; a log with none fights it as Hybrid.
    // Its brain (issue #219) is never the log's: the session's frozen copy is
    // stamped on, or none.
    let champion: FlungChampion | undefined;
    const stored = event.champion ? owned.get(event.champion.t) : undefined;
    if (event.champion && stored !== undefined && !championsFlung.has(event.champion.t)) {
      championsFlung.add(event.champion.t);
      const { pl, s } = event.champion;
      champion = withFrozenBrain(
        {
          t: event.champion.t,
          l: Math.min(event.champion.l, stored.l),
          ...(pl !== undefined && { pl: Math.max(0, Math.min(pl, stored.pl)) }),
          ...(s !== undefined && { s }),
        },
        attacker.brains
      );
    }

    if (Object.keys(monsters).length === 0 && !champion) continue;
    const { champion: _sent, ...rest } = event;
    events.push({ ...rest, monsters, ...(champion && { champion }) });
  }

  return { v: 1, seed: log.seed, events };
};

/** A fling event's champion, as the replay fights it. */
type FlungChampion = NonNullable<Extract<FlingEvent, { kind: "fling" }>["champion"]>;

/**
 * A flung champion with the brain the attack froze at launch (issue #219):
 * the session's copy for its type, or none, whatever the log said.
 *
 * @param champion - The champion as the log flings it.
 * @param brains - The session's `championBrains`, if any.
 */
export const withFrozenBrain = (champion: FlungChampion, brains: ChampionBrains | null | undefined): FlungChampion => {
  const { b: _sent, ...rest } = champion;
  const brain = brains?.[String(champion.t)];
  return brain ? { ...rest, b: brain } : rest;
};

/**
 * A log whose every flung champion carries the frozen brain and nothing else
 * (`withFrozenBrain`), for a replay that does not cut the log down first.
 *
 * @param log - The log as sent.
 * @param brains - The session's `championBrains`, if any.
 */
export const withFrozenBrains = (log: FlingLog, brains: ChampionBrains | null | undefined): FlingLog => ({
  ...log,
  events: log.events.map((event) =>
    event.kind === "fling" && event.champion ? { ...event, champion: withFrozenBrain(event.champion, brains) } : event
  ),
});

/** What the server's replay of an attack gives each side, whole units. */
export interface ReplayedLoot {
  /** The attacker's gain. */
  attackloot: ResourceAmounts;
  /** What the defender lost. */
  defenderLoss: ResourceAmounts;
  /**
   * The buildings the battle brought down, by engine id, when the caller has
   * them: a fallen bunker loses its garrison (`bunkerGarrison.ts`, #130).
   */
  fallen?: readonly number[];
}

/** What an attack's save lands on each side. */
export interface AttackLoot {
  /** What the attacker is credited. */
  credit: ResourceAmounts;
  /** The most the attacker could have been credited. */
  cap: ResourceAmounts;
  /** The defender's delta, never positive. */
  defenderDelta: ResourceAmounts;
  /** How the cap was reached. */
  basis: "replay" | "no-log" | "no-roster" | "pool";
  /** Krallen's raise of the attacker's storage cap, as a fraction; 0 without her. */
  krallenBuff: number;
  /**
   * What the server's battle brought down, to its longest end, by engine id;
   * null when there was no replay. A bunker in it that the save also reports
   * fallen loses its garrison (`bunkerGarrison.ts`, #130).
   */
  fallen: readonly number[] | null;
}

/**
 * The loot an attack save that ends an attack lands (see the file comment).
 *
 * The defender's side is the client's own `resources` loss, kept between two
 * bounds: at least what the attacker is credited, because a unit of loot is
 * a unit the defender lost (storage hands over at most what it gives up,
 * `BSTORAGE.as:77-85`), so no attack can bank loot and leave the pool whole
 * for the next one; and at most what the replay's battle took, so no attack
 * can drain a pool it did not reach. The replay itself cannot be the figure:
 * it runs to the longest possible end, and a player who stopped earlier took
 * less. An honest client's loss is its own engine's, which lies between the
 * two, so it lands unchanged. A low-level attacker's gain carries the bonus
 * the defender never paid (`ATTACK.as:678-680`), so for them the floor is the
 * credit less that bonus.
 *
 * @param sent - The save's `attackloot`.
 * @param reported - The save's `resources`: the defender's delta as the client saw it.
 * @param flinglog - The save's `flinglog`, as parsed.
 * @param session - The attack session the save was bound to.
 * @param defender - The defender's row, with the pool it draws from now.
 * @param attacker - The attacker's main save as it stood before this save.
 * @param mapRoom3 - Whether the attacker's own save is on Map Room 3.
 * @param fought - The battle as the server fought it ({@link ReplayedLoot},
 *   `foughtLoot` in `battle.ts`): the save's replay to the client's clock
 *   (`baseSave.ts`) or the finaliser's (`finaliseAttack.ts`), each over the
 *   fightable log, the served defence, pool and level. Null only when there was
 *   nothing to replay (no roster, or no usable fling log).
 */
export const attackLootOf = ({
  sent,
  reported,
  flinglog,
  session,
  defender,
  attacker,
  mapRoom3,
  fought,
}: {
  sent: unknown;
  reported: unknown;
  flinglog: unknown;
  session: AttackSession | null;
  defender: LootDefender;
  attacker: LootAttacker;
  mapRoom3: boolean;
  fought: ReplayedLoot | null;
}): AttackLoot => {
  const asked = wholeAmounts(sent);
  const reportedLoss = wholeAmounts(negatedRaw(reported));
  const krallenBuff = krallenBuffOf(parseFlingLog(flinglog), attacker.champion);

  // Each gain is at most its loss times this (`withLowLevelBonus` truncates),
  // so a credit divided by it is never more than the loss that paid for it.
  const bonus = lowLevelLootBonus(session?.attackerlevel ?? LOW_LEVEL_LOOT_CEILING);

  const land = (
    cap: ResourceAmounts,
    maxLoss: ResourceAmounts | null,
    basis: AttackLoot["basis"],
    fallen: readonly number[] | null = null
  ): AttackLoot => {
    const credit = { r1: 0, r2: 0, r3: 0, r4: 0 };
    const defenderDelta = { r1: 0, r2: 0, r3: 0, r4: 0 };
    for (const key of RESOURCE_KEYS) {
      credit[key] = Math.min(asked[key], cap[key]);
      const loss = Math.max(reportedLoss[key], Math.floor(credit[key] / bonus));
      const lost = maxLoss ? Math.min(loss, maxLoss[key]) : loss;
      defenderDelta[key] = lost > 0 ? -lost : 0;
    }
    return { credit, cap, defenderDelta, basis, krallenBuff, fallen };
  };

  const none = { r1: 0, r2: 0, r3: 0, r4: 0 };
  if (session?.entryHoused) {
    if (!parseFlingLog(flinglog)) return land(none, none, "no-log");
    // Both callers replay every save with a usable log and a roster before
    // they get here, so a missing battle is a bug, never a save to credit.
    if (!fought) throw new Error("An attack save with a fling log reached the loot rule without the server's battle");
    return land(fought.attackloot, fought.defenderLoss, "replay", fought.fallen ?? null);
  }

  if (!mapRoom3) return land(none, none, "no-roster");

  const held = mr1TribePool({
    resources: defender.resources ?? {},
    buildingdata: (defender.buildingdata ?? {}) as JsonObject,
  } as Parameters<typeof mr1TribePool>[0]);
  const cap = { r1: 0, r2: 0, r3: 0, r4: 0 };
  for (const key of RESOURCE_KEYS) cap[key] = Math.floor(held[key] * LOOT_GAIN_RATIO);
  return land(cap, null, "pool");
};

/** Krallen's champion type, as a fling names it (`CHAMPIONCAGE.as:32`). */
const KRALLEN_TYPE = 5;

/**
 * How far Krallen raises the attacker's storage cap in this battle: her
 * `buffs` at the level she was flung at (`Krallen.as:33`), 0 when the log
 * flings no Krallen the attacker owns.
 *
 * Flash raises the cap only while she is on the field (`ATTACK.as:698-702`,
 * `CREEPS.krallen`); the log does not say which loot fell while she lived, so
 * a Krallen flung at any point raises the cap for the whole battle.
 *
 * @param log - The save's fling log, as parsed.
 * @param owned - The attacker's champions as they stood before the save.
 */
export const krallenBuffOf = (
  log: FlingLog | null,
  owned: readonly { t: number; l: number }[] | null | undefined
): number => {
  if (!log) return 0;
  const krallen = (owned ?? []).find((champion) => champion?.t === KRALLEN_TYPE);
  if (!krallen || !Number.isFinite(krallen.l)) return 0;
  for (const event of log.events) {
    if (event.kind !== "fling" || event.champion?.t !== KRALLEN_TYPE) continue;
    const level = Math.min(event.champion.l, krallen.l);
    return Math.max(0, championStat(KRALLEN_ID, "buffs", level));
  }
  return 0;
};

/**
 * The attacker's storage cap for attack loot: `storageCap` (silos, packing,
 * outposts, `BASE.as:4705-4826`) raised by Krallen's buff, `cap + cap * buff`
 * as `ATTACK.Loot` has it (`ATTACK.as:699-702`).
 */
export const attackerLootCap = (save: CreditSave, krallenBuff: number): number =>
  Math.floor(storageCap(save) * (1 + Math.max(0, krallenBuff)));

/**
 * Banks an attack's credit on the attacker's pool, each resource only up to
 * the room left under {@link attackerLootCap} (`ATTACK.as:703-710`): a pool at
 * or over the cap takes nothing and loses nothing.
 *
 * @param save - The attacker's main save; `resources` is replaced when anything lands.
 * @param credit - What the battle credits ({@link attackLootOf}, `creditableMR1Loot`).
 * @param krallenBuff - {@link krallenBuffOf}.
 * @returns What landed, and what did not fit.
 */
export const bankAttackLoot = (
  save: CreditSave,
  credit: ResourceAmounts,
  krallenBuff: number
): CreditResult => creditResources(save, credit, attackerLootCap(save, krallenBuff));

/** `r1`..`r4` of a delta with the sign turned, so its losses read as gains. */
const negatedRaw = (raw: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of RESOURCE_KEYS) out[key] = -Number((raw as Record<string, unknown>)[key]);
  return out;
};
