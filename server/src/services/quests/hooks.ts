import { COSTS } from "../../game-data/buildingCosts.js";
import { footprintOf } from "../../game-data/buildingFootprints.js";
import { CATAPULT_HIT_RADIUS, CATAPULT_TARGETS, FIGHT_RULES, RESOURCE_BUILDINGS } from "../../game-data/quests.js";
import { BaseType } from "../../enums/Base.js";
import { Tribes } from "../../enums/Tribes.js";
import { TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import { addQuestEvents, questEvent, type QuestEvents } from "./state.js";

/**
 * What each server-seen action adds to quests (`game-data/quests.ts`
 * `QUEST_STATS`). Pure; the yard routes return these as `questEvents`, the
 * wrapper counts finished jobs itself, and the attack and friend code counts
 * through `record.ts`.
 */

/** A finished job, as far as {@link jobQuestEvents} reads one (a catch-up `CompletedJob`). */
export interface QuestJobLike {
  kind: string;
  id?: unknown;
  detail?: unknown;
}

/** Monsters that finished hatching among finished jobs: `hatch` and `hatch:<monster>`. */
export const jobQuestEvents = (jobs: readonly QuestJobLike[]): QuestEvents => {
  const sets: QuestEvents[] = [];
  for (const job of jobs) {
    if (job.kind !== "hatch") continue;
    const count = Math.max(0, Math.floor(Number((job.detail as { count?: unknown } | undefined)?.count) || 0));
    if (count > 0) sets.push(questEvent("hatch", typeof job.id === "string" ? job.id : null, count));
  }
  return addQuestEvents(...sets);
};

/** Monsters housed by an instant hatchery finish (`report.housed`, by id). */
export const housedQuestEvents = (housed: Readonly<Record<string, number>> | null | undefined): QuestEvents =>
  addQuestEvents(...Object.entries(housed ?? {}).map(([id, count]) => questEvent("hatch", id, Math.floor(Number(count) || 0))));

/** Whether building type `t` is a defensive building (a tower) for the upgrade quest. */
export const isDefensive = (t: number): boolean => COSTS[t]?.kind === "tower";

/**
 * An upgrade started (`sign` 1) or cancelled (`sign` -1) on building type `t`:
 * `upgradeResource` for a harvester, `upgradeDefence` for a tower.
 */
export const upgradeQuestEvents = (t: unknown, sign: 1 | -1 = 1): QuestEvents => {
  const type = Number(t);
  if (RESOURCE_BUILDINGS.includes(type)) return { upgradeResource: sign };
  if (isDefensive(type)) return { upgradeDefence: sign };
  return {};
};

/** The four resources an attack's loot credit names, as the loot stats count them. */
const LOOT_STATS = { r1: "lootR1", r2: "lootR2", r3: "lootR3", r4: "lootR4" } as const;

/**
 * An attack's loot (owner, decision 13): `lootR1`..`lootR4`, the battle's
 * credit BEFORE the attacker's storage cap, so a full storage still counts.
 */
export const lootQuestEvents = (credit: Readonly<Partial<Record<string, unknown>>> | null | undefined): QuestEvents => {
  const out: QuestEvents = {};
  for (const [key, stat] of Object.entries(LOOT_STATS)) {
    const value = Math.floor(Number(credit?.[key]));
    if (Number.isFinite(value) && value > 0) out[stat] = value;
  }
  return out;
};


/** One bomb from a fling log, where it landed. */
interface BombAt {
  x: number;
  y: number;
}

const bombsOf = (log: unknown): BombAt[] => {
  const events = (log as { events?: unknown } | null | undefined)?.events;
  if (!Array.isArray(events)) return [];
  const out: BombAt[] = [];
  for (const event of events) {
    const one = event as { kind?: unknown; x?: unknown; y?: unknown } | null;
    if (one?.kind !== "bomb") continue;
    const x = Number(one.x);
    const y = Number(one.y);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
  }
  return out;
};

type BuildingMap = Readonly<Record<string, { t?: unknown; X?: unknown; Y?: unknown } | null | undefined>> | null | undefined;

/**
 * Catapult bombs that landed on each catapult-quest building type
 * (`catapultHit:<type>`, one per bomb per type it landed on). PROVISIONAL: a
 * bomb counts when it lands within {@link CATAPULT_HIT_RADIUS} of the
 * building's footprint, an approximation of the battle's own blast reach.
 */
export const catapultQuestEvents = (log: unknown, buildingdata: BuildingMap): QuestEvents => {
  const bombs = bombsOf(log);
  if (bombs.length === 0) return {};
  const targets = Object.values(buildingdata ?? {}).flatMap((building) => {
    const t = Number(building?.t);
    const x = Number(building?.X);
    const y = Number(building?.Y);
    if (!CATAPULT_TARGETS.includes(t) || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const { w, h } = footprintOf(t);
    return [{ t, x, y, hw: w / 2, hh: h / 2 }];
  });
  const sets: QuestEvents[] = [];
  for (const bomb of bombs) {
    const hit = new Set<number>();
    for (const target of targets) {
      const dx = Math.max(0, Math.abs(bomb.x - target.x) - target.hw);
      const dy = Math.max(0, Math.abs(bomb.y - target.y) - target.hh);
      if (Math.hypot(dx, dy) <= CATAPULT_HIT_RADIUS) hit.add(target.t);
    }
    for (const t of hit) sets.push({ [`catapultHit:${t}`]: 1 });
  }
  const events = addQuestEvents(...sets);
  const total = Object.values(events).reduce((sum, n) => sum + n, 0);
  return total > 0 ? { ...events, catapultHit: total } : {};
};

/** The defender as the attack quests read it. */
export interface QuestDefender {
  type?: string | null;
  wmid?: number | null;
  buildingdata?: BuildingMap;
}

type HealthMap = Readonly<Record<string, unknown>> | null | undefined;

const fallenIn = (health: HealthMap, id: string): boolean => {
  const value = health?.[id];
  return value !== undefined && value !== null && Number(value) <= 0;
};

/** The tribe counter name of a Map Room 2 camp (`wmid` = tribe index × 10 + n), or null. */
export const campTribeOf = (defender: QuestDefender): string | null => {
  if (defender.type !== BaseType.TRIBE) return null;
  const tribe = Tribes[Math.floor(Number(defender.wmid) / 10)];
  return tribe ? tribe.toLowerCase() : null;
};

/** Whether this attack brought down the camp's Town Hall (standing when it began). */
const hallFell = (defender: QuestDefender, before: HealthMap, after: HealthMap): boolean =>
  Object.entries(defender.buildingdata ?? {}).some(([key, entry]) => {
    if (Number(entry?.t) !== TOWN_HALL_TYPE) return false;
    const id = String((entry as { id?: unknown }).id ?? key);
    return fallenIn(after, id) && !fallenIn(before, id);
  });

/** What an attack landing on another yard (a player's, a bot's or a Map Room 2 camp) adds for the attacker. */
export interface LandedQuestAttack {
  defender: QuestDefender;
  /** The yard's damage (0-100) before and after the attack. */
  damageBefore: number;
  damageAfter: number;
  /** `buildinghealthdata` as the attack began, and the battle's. */
  before?: HealthMap;
  after?: HealthMap;
  /** The fling log, for the catapult bombs. */
  log?: unknown;
  /** The battle's loot credit before the attacker's cap (decision 13). */
  loot?: Readonly<Partial<Record<string, unknown>>> | null;
}

/**
 * The attacker's quest events of a landed attack: `attackWin` when the yard
 * ends at least `FIGHT_RULES.winDamage` damaged and the attack added damage;
 * `tribeDestroy:<tribe>` when a Map Room 2 camp's Town Hall fell; catapult hits.
 */
export const attackQuestEvents = (attack: LandedQuestAttack): QuestEvents => {
  const sets: QuestEvents[] = [lootQuestEvents(attack.loot)];
  if (attack.damageAfter >= FIGHT_RULES.winDamage && attack.damageAfter > attack.damageBefore) sets.push({ attackWin: 1 });
  const tribe = campTribeOf(attack.defender);
  if (tribe && hallFell(attack.defender, attack.before, attack.after)) sets.push(questEvent("tribeDestroy", tribe));
  sets.push(catapultQuestEvents(attack.log, attack.defender.buildingdata));
  return addQuestEvents(...sets);
};

/** The defender's: `defenceWin` when the attack left the yard less than `FIGHT_RULES.holdDamage` damaged. */
export const defenceQuestEvents = (damageAfter: number): QuestEvents =>
  damageAfter < FIGHT_RULES.holdDamage ? { defenceWin: 1 } : {};
