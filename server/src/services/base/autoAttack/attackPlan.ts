import { BOMBS, type BombStats, type FlingEvent, type FlingLog } from "../../../game-rules/combat/index.js";
import type { EntryHoused } from "../../yard/attackRoster.js";
import { MAX_CHECKPOINT_TICK, parseFlingLog } from "../attackCheckpoint.js";

/**
 * What an auto-attack repeats (issue #221): the player's last hand-played
 * attack on a Map Room 2 wild monster camp of the same tribe and level.
 *
 * A camp's yard is a fixture per tribe and level (`tribeSaveV2.ts`), so the
 * drops of one attack mean the same thing on every camp with that tribe and
 * level. The plan is the log the server itself fought when that attack landed
 * (`fightableLog`, so never more than the attacker had), and the tick it was
 * fought to, so a repeat ends or retreats exactly where the hand-played attack
 * did. Siege weapons are not repeated (owner, #221); everything else is kept
 * as it was fought, retreats included.
 *
 * The stored shape is `{ v: 1, tick, events }`. Events are kept verbatim, so a
 * field a later change adds to an event (a champion's mode, say) rides along.
 * Named plans (v2) are a `slot` beside the stored row, not a change here.
 *
 * Pure: `attackPlanStore.ts` keeps the plans, `autoAttack.ts` runs them.
 */

/** A recorded plan, as stored. */
export interface AttackPlan {
  readonly v: 1;
  /** The battle tick the hand-played attack was fought to. */
  readonly tick: number;
  /** The fought log's events, in its order, siege weapons left out. */
  readonly events: readonly FlingEvent[];
  /** Set when the attack used siege weapons, which the repeat leaves out. */
  readonly siege?: true;
}

/** The Map Room 2 tribe camps' `wmid`s: `tribeIndex * 10 + 1` (`tribeSaveV2.ts`). */
export const MR2_CAMP_WMIDS: ReadonlySet<number> = new Set([1, 11, 21, 31]);

/** The tribe's name for a camp `wmid`, in `Tribes` order (`enums/Tribes.ts`). */
export const TRIBE_NAMES: Readonly<Record<number, string>> = {
  1: "Legionnaire",
  11: "Kozu",
  21: "Abunakki",
  31: "Dreadnaut",
};

/** Which plans a camp shares: the same tribe and level. */
export interface CampKey {
  readonly wmid: number;
  readonly level: number;
}

/**
 * The camp key of a defender row, or null when the row is not a Map Room 2
 * wild monster camp.
 *
 * @param row - The defender's `type`, `wmid` and `level`.
 */
export const campKeyOf = (row: { type?: string | null; wmid?: number | null; level?: number | null }): CampKey | null => {
  if (row.type !== "tribe") return null;
  const wmid = Number(row.wmid);
  const level = Number(row.level);
  if (!MR2_CAMP_WMIDS.has(wmid) || !Number.isSafeInteger(level) || level < 1) return null;
  return { wmid, level };
};

/**
 * The plan a landed attack leaves: the log the server fought, without its
 * siege weapons, and the tick it was fought to. Null when nothing in it flung
 * a monster or a champion, which is nothing to repeat.
 *
 * @param fought - The log the server's replay fought (`fightableLog`).
 * @param tick - The tick the replay ran to.
 */
export const planFromFought = (fought: FlingLog, tick: number): AttackPlan | null => {
  const events = fought.events.filter((event) => event.kind !== "siege");
  const flings = events.some(
    (event) =>
      event.kind === "fling" &&
      (event.champion !== undefined || Object.values(event.monsters).some((count) => count > 0))
  );
  if (!flings) return null;
  const last = events.reduce((most, event) => Math.max(most, Math.floor(event.t)), 0);
  const whole = Number.isFinite(tick) ? Math.floor(tick) : MAX_CHECKPOINT_TICK;
  const siege = events.length < fought.events.length;
  return {
    v: 1,
    tick: Math.min(Math.max(whole, last), MAX_CHECKPOINT_TICK),
    events,
    ...(siege && { siege: true as const }),
  };
};

/**
 * Reads a stored plan back, with every event checked as a checkpoint's are
 * (`parseFlingLog`); anything unreadable is no plan.
 *
 * @param raw - The stored `plan` column.
 */
export const parseStoredPlan = (raw: unknown): AttackPlan | null => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== 1 || typeof value.tick !== "number") return null;
  const log = parseFlingLog({ v: 1, seed: 0, events: value.events });
  if (!log) return null;
  const plan = planFromFought(log, value.tick);
  return plan && value.siege === true ? { ...plan, siege: true } : plan;
};

/** What a plan needs the attacker to have. */
export interface PlanNeeds {
  /** Monsters, per id, summed over its drops. */
  readonly monsters: Readonly<Record<string, number>>;
  /** The champion types it flings, in its order. */
  readonly champions: readonly number[];
  /** The bombs it drops, by id, in its order. */
  readonly bombs: readonly string[];
  /** Whether it used siege weapons, which are not repeated. */
  readonly siege: boolean;
}

/**
 * What a plan needs.
 *
 * @param plan - The plan.
 */
export const planNeeds = (plan: AttackPlan): PlanNeeds => {
  const monsters: Record<string, number> = {};
  const champions: number[] = [];
  const bombs: string[] = [];
  for (const event of plan.events) {
    if (event.kind === "bomb") bombs.push(event.id);
    if (event.kind !== "fling") continue;
    for (const [id, count] of Object.entries(event.monsters)) {
      if (count > 0) monsters[id] = (monsters[id] ?? 0) + count;
    }
    if (event.champion && !champions.includes(event.champion.t)) champions.push(event.champion.t);
  }
  return {
    monsters,
    champions,
    bombs,
    siege: plan.siege === true,
  };
};

/** One of the attacker's champions, as their main save holds it. */
export interface OwnedChampion {
  readonly t: number;
  readonly l: number;
  readonly pl?: number;
  readonly hp?: number;
  readonly status?: number;
}

/** What the attacker has for a plan right now. */
export interface PlanSupply {
  /** What each of their yards in range houses (`catchUpArmiesForAttack`). */
  readonly housed: EntryHoused;
  readonly champions: readonly OwnedChampion[] | null | undefined;
  readonly catapultLevel: number;
  /** Their own resource pool. */
  readonly resources: Readonly<Record<string, number>> | null | undefined;
}

/** Something a plan needs that the attacker does not have. */
export type PlanShortfall =
  | { readonly kind: "monster"; readonly id: string; readonly need: number; readonly have: number }
  | { readonly kind: "champion"; readonly t: number; readonly reason: "none" | "hurt" | "away" }
  | { readonly kind: "bomb"; readonly id: string; readonly reason: "catapult" | "cost" | "unknown" };

const bombById: ReadonlyMap<string, BombStats> = new Map(BOMBS.map((bomb) => [bomb.id, bomb]));

/**
 * Everything a plan needs that the attacker lacks, in the plan's order:
 * monsters first, then champions, then bombs. Empty means it can run. No
 * partial attacks (owner, #221): one missing monster refuses the repeat.
 *
 * A champion is missing when they own none of its type, when it has no health
 * left, or when it is away (frozen, juiced: `status` other than 0), as the
 * army panel refuses it (`AttackSession.championBlock`). A bomb is missing when
 * their Catapult is too low for it or their pool cannot pay for it, the two
 * things `fightableLog` would drop it for.
 *
 * @param needs - {@link planNeeds}.
 * @param supply - What the attacker has.
 */
export const planShortfall = (needs: PlanNeeds, supply: PlanSupply): PlanShortfall[] => {
  const missing: PlanShortfall[] = [];

  const have: Record<string, number> = {};
  for (const housed of Object.values(supply.housed)) {
    for (const [id, count] of Object.entries(housed)) have[id] = (have[id] ?? 0) + count;
  }
  for (const [id, need] of Object.entries(needs.monsters)) {
    const held = have[id] ?? 0;
    if (held < need) missing.push({ kind: "monster", id, need, have: held });
  }

  for (const t of needs.champions) {
    const owned = (supply.champions ?? []).find((champion) => champion?.t === t);
    if (!owned) missing.push({ kind: "champion", t, reason: "none" });
    else if (!(Number(owned.hp) > 0)) missing.push({ kind: "champion", t, reason: "hurt" });
    else if (Number(owned.status ?? 0) !== 0) missing.push({ kind: "champion", t, reason: "away" });
  }

  // Each bomb is paid for as it is fired (`ResourceBombs.as:301-306`), so the
  // pool has to cover all of them together.
  const spent: Record<number, number> = {};
  for (const id of needs.bombs) {
    const bomb = bombById.get(id);
    if (!bomb) {
      missing.push({ kind: "bomb", id, reason: "unknown" });
      continue;
    }
    if (bomb.catapultLevel > supply.catapultLevel) {
      missing.push({ kind: "bomb", id, reason: "catapult" });
      continue;
    }
    const held = Number(supply.resources?.[`r${bomb.resource}`] ?? 0);
    const total = (spent[bomb.resource] ?? 0) + bomb.cost;
    if (!Number.isFinite(held) || total > held) {
      missing.push({ kind: "bomb", id, reason: "cost" });
      continue;
    }
    spent[bomb.resource] = total;
  }

  return missing;
};

/**
 * The log an auto-attack fights: the plan's events under a fresh seed, each
 * flung champion at the level and power level it has now (owner, #221).
 *
 * @param plan - The plan.
 * @param seed - The new attack's seed; a plan's seed is never reused.
 * @param champions - The attacker's champions now.
 */
export const planLog = (
  plan: AttackPlan,
  seed: number,
  champions: readonly OwnedChampion[] | null | undefined
): FlingLog => ({
  v: 1,
  seed,
  events: plan.events.map((event) => {
    if (event.kind !== "fling" || !event.champion) return event;
    const owned = (champions ?? []).find((champion) => champion?.t === event.champion!.t);
    if (!owned) return event;
    const pl = Number(owned.pl);
    const { pl: _old, ...rest } = event.champion;
    return {
      ...event,
      champion: { ...rest, l: owned.l, ...(Number.isInteger(pl) && pl > 0 && { pl }) },
    };
  }),
});
