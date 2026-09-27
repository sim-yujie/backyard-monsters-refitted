import {
  BOMBS,
  type BombStats,
  type CombatViolation,
} from "../../../game-rules/combat/index.js";
import type { JsonObject } from "../../../types/JsonObject.js";

/**
 * What the resource bombs an attack fired cost the attacker (issue #90).
 *
 * Flash took a bomb's cost off the attacker the moment it was dropped
 * (`ResourceBombs.BombDrop`, `client/scripts/com/monsters/effects/ResourceBombs.as:292-329`)
 * and folded it into `attackloot` as a negative delta (`BASE.as:2859-2866`),
 * so the server's `attackLootHandler` charged it without knowing it was there.
 * The web client reports `attackloot` as the gain alone and records every bomb
 * in the fling log instead (`docs/design/server-combat.md` §3.10), so the
 * charge is worked out here, from the log and the shared rules' own bomb table,
 * rather than from any figure the client sends.
 *
 * The log is the complete record of the attack and is resent in full on every
 * save, so it is charged once, on the save that carries `over`
 * (`baseSave.ts`). A Flash save sends no log and is charged nothing here: its
 * bomb spend is already inside its `attackloot`.
 *
 * The checks are the ones Flash made before it let a bomb go
 * (`ResourceBombs.as:292-315`) and §2.4's `bombSpend` rule, each reported as a
 * `bombSpend` violation with the reason in its detail:
 *
 * - `unknownBomb`: the id is not in {@link BOMBS}; there is no cost to charge.
 * - `catapultLevel`: the tier needs a higher catapult than the attacker owns.
 * - `secondBomb`: firing one bomb spends every bomb of that resource
 *   (`:310-314`), so a second of the same resource is one Flash never fired.
 * - `unaffordable`: the cost is more than the attacker held of that resource
 *   (`:301-305` compares it with the attacker's stored pool, not with loot).
 *
 * Pure: the caller decides what the mode does with the violations, and every
 * bomb the table knows is charged whichever way that goes, never taking a pool
 * below zero.
 */

/** The resource keys a bomb can spend: 1 twigs, 2 pebbles, 3 putty. */
const BOMB_RESOURCE_KEYS = ["r1", "r2", "r3"] as const;
type BombResourceKey = (typeof BOMB_RESOURCE_KEYS)[number];

/** `buildingdata.t` of the Catapult (`client/scripts/BUILDING51.as`). */
export const CATAPULT_TYPE = 51;

/** One bomb from the log, with what it costs. */
export interface BombCharge {
  readonly id: string;
  /** Fast ticks since attack start, as the log has it. */
  readonly t: number;
  readonly key: BombResourceKey;
  readonly cost: number;
}

/** The attacker as a bomb reads them. */
export interface BombAttacker {
  /** The attacker's stored pool; only `r1`..`r3` are read. */
  readonly resources: JsonObject | null | undefined;
  readonly catapultLevel: number;
}

/** What the log's bombs come to. */
export interface BombSpend {
  /** Every bomb the table knows, in log order. */
  readonly charges: readonly BombCharge[];
  /** The total per resource, before any floor at zero. */
  readonly spend: Readonly<Record<BombResourceKey, number>>;
  readonly violations: readonly CombatViolation[];
}

const byId: ReadonlyMap<string, BombStats> = new Map(BOMBS.map((bomb) => [bomb.id, bomb]));

const stored = (resources: JsonObject | null | undefined, key: string): number => {
  const value = Number(resources?.[key]);
  return Number.isFinite(value) ? value : 0;
};

const violation = (detail: Record<string, unknown>): CombatViolation => ({
  rule: "bombSpend",
  detail,
  enforced: true,
});

/**
 * The bomb events of a submitted `flinglog`, or null when it is not a log.
 *
 * Only the bombs are read. The rest of the log is the business of the combat
 * audit (#23); here an unreadable log is reported so `reject` mode can refuse
 * it, since a client that could dodge the charge by mangling its log would
 * make the charge optional.
 */
const bombEventsOf = (log: unknown): { id: string; t: number }[] | null => {
  if (typeof log !== "object" || log === null) return null;
  const events = (log as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const bombs: { id: string; t: number }[] = [];
  for (const event of events) {
    if (typeof event !== "object" || event === null) return null;
    const { kind, id, t } = event as { kind?: unknown; id?: unknown; t?: unknown };
    if (kind !== "bomb") continue;
    if (typeof id !== "string") return null;
    bombs.push({ id, t: typeof t === "number" ? t : 0 });
  }
  return bombs;
};

/**
 * Works out what the bombs in `log` cost `attacker`.
 *
 * @param log The submitted `flinglog`, parsed; undefined when none was sent.
 * @param attacker The attacker's stored pool and catapult level.
 * @returns The charges, the total per resource and anything Flash would not have fired.
 */
export const bombSpendOf = (log: unknown, attacker: BombAttacker): BombSpend => {
  const spend: Record<BombResourceKey, number> = { r1: 0, r2: 0, r3: 0 };
  const charges: BombCharge[] = [];
  const violations: CombatViolation[] = [];

  if (log === undefined || log === null) return { charges, spend, violations };

  const events = bombEventsOf(log);
  if (events === null) {
    violations.push({ rule: "malformed", detail: { issue: "flinglog is not a fling log" }, enforced: true });
    return { charges, spend, violations };
  }

  const fired = new Set<BombResourceKey>();

  for (const { id, t } of events) {
    const bomb = byId.get(id);
    const key = bomb ? BOMB_RESOURCE_KEYS[bomb.resource - 1] : undefined;
    if (!bomb || !key) {
      violations.push(violation({ reason: "unknownBomb", id, t }));
      continue;
    }

    if (bomb.catapultLevel > attacker.catapultLevel) {
      violations.push(
        violation({ reason: "catapultLevel", id, t, needs: bomb.catapultLevel, has: attacker.catapultLevel })
      );
    }

    if (fired.has(key)) violations.push(violation({ reason: "secondBomb", id, t, resource: key }));

    const pool = stored(attacker.resources, key) - spend[key];
    if (bomb.cost > pool) {
      violations.push(violation({ reason: "unaffordable", id, t, resource: key, cost: bomb.cost, pool }));
    }

    fired.add(key);
    spend[key] += bomb.cost;
    charges.push({ id, t, key, cost: bomb.cost });
  }

  return { charges, spend, violations };
};

/**
 * Takes a {@link BombSpend} off the attacker's pool, never below zero.
 *
 * @param spend What the bombs cost.
 * @param resources The attacker's stored pool, left as it is.
 * @returns A new pool with the spend taken off, so the ORM sees a new value.
 */
export const chargeBombSpend = (
  spend: BombSpend["spend"],
  resources: JsonObject | null | undefined
): JsonObject => {
  const pool: JsonObject = { ...(resources ?? {}) };
  for (const key of BOMB_RESOURCE_KEYS) {
    if (spend[key] <= 0) continue;
    pool[key] = Math.max(0, stored(pool, key) - spend[key]);
  }
  return pool;
};

/**
 * The attacker's catapult level, as the web client reads it
 * (`web/src/game/attack/attackEntry.ts`, `ownCatapultLevel`): the save's
 * `catapult` field or the highest finished Catapult in the yard, whichever is
 * higher. A Catapult still under construction (`cB` set) fires nothing.
 *
 * @param save The attacker's main save.
 */
export const catapultLevelOf = (save: {
  catapult?: number | null;
  buildingdata?: JsonObject | null;
}): number => {
  const saved = typeof save.catapult === "number" && save.catapult > 0 ? save.catapult : 0;
  let built = 0;
  for (const row of Object.values(save.buildingdata ?? {})) {
    if (typeof row !== "object" || row === null || row.t !== CATAPULT_TYPE) continue;
    if (row.cB !== undefined) continue;
    built = Math.max(built, typeof row.l === "number" ? row.l : 1);
  }
  return Math.max(saved, built);
};
