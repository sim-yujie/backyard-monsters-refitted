import { isLootable, VICTORY_THRESHOLD } from "./stats.js";
import {
  COMBAT_TOLERANCES,
  listed,
  type BuildingHealthMap,
  type CombatBuilding,
  type CombatTolerances,
  type CombatViolation,
  type CombatYard,
  type MalformedIssue,
} from "./types.js";

/**
 * The damage percentage, and the health map it is a summary of (§2.2).
 *
 * `damage` is not a figure the server has to believe: it is a pure function of
 * the yard's health, and the client computes it in one place
 * (`client/scripts/BFOUNDATION.as:433-468`). So does this, and the same
 * function serves three callers — the web client's victory popup, the Wild
 * Monster Baiter's report and the server's attack audit — which is the point of
 * the shared module. A fourth implementation would be a fourth answer.
 *
 * Health itself is the other half. It can only fall during an attack: repairs
 * are cancelled the moment a building takes damage
 * (`BFOUNDATION.as:1964-2015`), so there is no honest way for a reported value
 * to sit above the stored one. {@link auditHealth} clamps every entry to the
 * stored figure, reports what it clamped, and hands back both the map the
 * server writes and the two totals the bound model of `potential.ts` needs.
 */

/* ── The types the sum treats specially ───────────────────────────────────── */

/**
 * Yard mushrooms, which the client's loop skips outright.
 *
 * `getBuildingSaveData` excludes `BMUSHROOM` before anything else
 * (`BFOUNDATION.as:434`), and `BUILDING7 extends BMUSHROOM`.
 */
export const MUSHROOM_TYPE = 7;

/**
 * The two wall types, which absorb damage but are not in the percentage.
 *
 * `BUILDING17` and `BUILDING18` are the only `BWALL` subclasses, and the sum
 * skips `BWALL` on both sides (`:444-451`). They still carry a health entry, so
 * they are in the `drop` the damage bound is read against (§2.3).
 */
export const WALL_TYPES: readonly number[] = [17, 18];

/**
 * The two trap types: `BUILDING24` and `BUILDING117`, the latter a heavy trap.
 *
 * A trap that has fired is written into the health map as 0 and contributes to
 * neither side of the sum (`:437-441`).
 */
export const TRAP_TYPES: readonly number[] = [24, 117];

/**
 * The type whose entry expires on a timer and then stops counting.
 *
 * The client drops a type 53 whose `_expireTime` has passed exactly as it drops
 * a fired trap (`:437-441`). Whether one has expired is a clock reading, so the
 * caller resolves it into {@link CombatBuilding.spent} rather than this file.
 */
export const EXPIRING_TYPE = 53;

export const isWall = (type: number): boolean => WALL_TYPES.includes(type);
export const isTrap = (type: number): boolean => TRAP_TYPES.includes(type);

/**
 * Whether a building has stopped counting towards either side of the sum.
 *
 * Three ways a trap reaches that state and the sum cannot tell them apart: the
 * reference already had it fired, the save dropped it from `buildingdata`
 * (`handlers/buildingDataHandler.ts:46-58`), or the save left it in with 0
 * health, which §2.2 reads as fired. A type 53 past its expiry is the same
 * case, resolved by the caller into {@link CombatBuilding.spent} because only
 * the caller may read a clock.
 */
export const isSpent = (
  building: CombatBuilding,
  health: BuildingHealthMap,
  dropped?: ReadonlySet<number>,
): boolean => {
  if (building.spent) return true;
  if (!isTrap(building.type) && building.type !== EXPIRING_TYPE) return false;
  if (dropped?.has(building.id) === true) return true;
  return health[String(building.id)] === 0;
};

/**
 * Whether a building is on both sides of the damage percentage.
 *
 * Mushrooms are skipped, walls are skipped, a spent trap or expired type 53 is
 * skipped, and a type with no health ladder has nothing to contribute.
 */
export const countsTowardDamage = (
  building: CombatBuilding,
  health: BuildingHealthMap,
  dropped?: ReadonlySet<number>,
): boolean =>
  building.type !== MUSHROOM_TYPE &&
  !isWall(building.type) &&
  building.maxHp > 0 &&
  !isSpent(building, health, dropped);

/* ── The percentage ───────────────────────────────────────────────────────── */

/** A building's health out of a map, where an absent entry means full. */
export const healthOf = (building: CombatBuilding, health: BuildingHealthMap): number => {
  const reported = health[String(building.id)];
  return reported === undefined ? building.maxHp : reported;
};

/**
 * `100 - 100 / totalMax * total` over the yard, as the client computes it.
 *
 * The map carries only the buildings below full health, which is what
 * `getBuildingSaveData` writes (`BFOUNDATION.as:452-455`) and what
 * {@link clampHealth} produces; every id it does not name is whole. An empty
 * yard is 0 rather than a division by zero, because a yard with nothing in it
 * has lost nothing.
 */
export const damagePercent = (
  yard: CombatYard,
  health: BuildingHealthMap,
  dropped?: ReadonlySet<number>,
): number => {
  let total = 0;
  let totalMax = 0;

  for (const building of yard.buildings) {
    if (!countsTowardDamage(building, health, dropped)) continue;
    total += healthOf(building, health);
    totalMax += building.maxHp;
  }

  if (totalMax <= 0) return 0;
  return 100 - (100 / totalMax) * total;
};

/**
 * `destroyed`, which is `damage` past the victory threshold and nothing else.
 *
 * `BASE.SaveB` writes the key only for a wild monster camp or an outpost
 * (`client/scripts/BASE.as:3297-3308`); a main yard and a Map Room 1 tribe
 * carry none, so this returns undefined for them and the server writes nothing.
 */
export const derivedDestroyed = (damage: number, kind: CombatYard["kind"]): 0 | 1 | undefined => {
  if (kind !== "outpost" && kind !== "wild") return undefined;
  return damage >= VICTORY_THRESHOLD ? 1 : 0;
};

/* ── The clamp ────────────────────────────────────────────────────────────── */

/** What {@link auditHealth} is handed. */
export interface HealthAuditInput {
  /** The defender's yard at the reference point: `hp` is the stored health. */
  readonly yard: CombatYard;
  /** `T.buildinghealthdata`. */
  readonly submitted?: BuildingHealthMap | null;
  /**
   * Ids the save dropped from `buildingdata`, which is how a trap reports that
   * it fired (`handlers/buildingDataHandler.ts:46-58`).
   */
  readonly droppedTraps?: Iterable<number>;
  /** `T.damage`, for the mismatch line; the server writes its own either way. */
  readonly reportedDamage?: number | undefined;
  /** `T.destroyed`, likewise. */
  readonly reportedDestroyed?: number | undefined;
  readonly tolerances?: CombatTolerances;
}

/** The health map the server writes, the two totals, and what it had to say. */
export interface HealthAudit {
  /** `min(stored, submitted)` per id, carrying only the ids below full. */
  readonly health: BuildingHealthMap;
  /** The percentage over that map (§2.2). */
  readonly damage: number;
  readonly destroyed: 0 | 1 | undefined;
  /** Health lost across every building, **walls included** (§2.3's `drop`). */
  readonly drop: number;
  /** The part of `drop` that fell on harvesters and storage (§2.4). */
  readonly lootableDrop: number;
  readonly violations: readonly CombatViolation[];
  /** Reasons to refuse the save as a 400 before bounding anything (§3.9). */
  readonly malformed: readonly MalformedIssue[];
}

/**
 * `min(stored, submitted)` per building, as the map the server writes.
 *
 * A building the save does not name keeps its **stored** value rather than
 * healing to full: the save is a snapshot of the yard, but a client that omits
 * a damaged building is either wrong or trying, and neither is a reason to
 * repair it (§2.2). Only entries below full are emitted, which is the
 * convention `getBuildingSaveData` writes and {@link damagePercent} reads.
 */
export const clampHealth = (
  yard: CombatYard,
  submitted: BuildingHealthMap | null | undefined,
): BuildingHealthMap => {
  const sent = submitted ?? {};
  const health: Record<string, number> = {};

  for (const building of yard.buildings) {
    const key = String(building.id);
    const reported = sent[key];
    const value = reported === undefined ? building.hp : Math.min(building.hp, reported);
    if (value < building.maxHp) health[key] = value;
  }

  return health;
};

/**
 * The health rules of §2.2 in one pass, plus the two totals §2.3 and §2.4 need.
 *
 * Never stops at the first violation: `log` mode exists to say everything one
 * save got wrong, so a week of production lines can show which bounds fire on
 * honest play (§3.6). `malformed` is separate from the violations because it is
 * a 400 rather than a 409 — only a broken client sends a health value that is
 * not an integer in range, and there is nothing worth bounding once it has.
 */
export const auditHealth = (input: HealthAuditInput): HealthAudit => {
  const { yard } = input;
  const submitted = input.submitted ?? {};
  const tolerances = input.tolerances ?? COMBAT_TOLERANCES;
  const dropped = new Set(input.droppedTraps ?? []);

  const violations: CombatViolation[] = [];
  const malformed: MalformedIssue[] = [];
  const unknown: number[] = [];
  const rose: number[] = [];
  const roseDetail: Record<string, { stored: number; sent: number }> = {};
  const trapState: number[] = [];

  for (const [key, raw] of Object.entries(submitted)) {
    const id = Math.floor(Number(key));
    const building = Number.isFinite(id) ? yard.byId.get(id) : undefined;

    if (!building) {
      unknown.push(Number.isFinite(id) ? id : 0);
      continue;
    }

    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0 || value > building.maxHp) {
      malformed.push({
        issue: "health is not an integer within the building's range",
        detail: { id, sent: raw, max: building.maxHp },
      });
      continue;
    }

    if (value > building.hp) {
      rose.push(id);
      roseDetail[key] = { stored: building.hp, sent: value };
    }
  }

  // A trap the save dropped from `buildingdata` says it fired, so the health
  // map must agree with it: 0, or nothing at all (§2.2).
  for (const id of dropped) {
    const reported = submitted[String(id)];
    if (reported !== undefined && Number(reported) !== 0) trapState.push(id);
  }

  const health = clampHealth(yard, submitted);

  let drop = 0;
  let lootableDrop = 0;

  for (const building of yard.buildings) {
    const left = healthOf(building, health);
    const fell = Math.max(0, building.hp - left);
    drop += fell;
    if (isLootable(building.type)) lootableDrop += fell;
  }

  const damage = damagePercent(yard, health, dropped);
  const destroyed = derivedDestroyed(damage, yard.kind);

  if (unknown.length > 0) {
    violations.push({
      rule: "unknownBuilding",
      ids: listed(unknown),
      detail: { count: unknown.length },
      enforced: true,
    });
  }

  if (rose.length > 0) {
    const ids = listed(rose);
    violations.push({
      rule: "healthRose",
      ids,
      detail: Object.fromEntries(ids.map((id) => [id, roseDetail[String(id)]])),
      enforced: true,
    });
  }

  if (trapState.length > 0) {
    violations.push({ rule: "trapState", ids: listed(trapState), enforced: false });
  }

  // The client logs an `int()` of the same float it saves, so a point of
  // difference is rounding rather than a claim (`BFOUNDATION.as:468`, `:525`).
  const sentDamage = input.reportedDamage;
  if (sentDamage !== undefined && Math.abs(sentDamage - damage) > tolerances.damageTolerance) {
    violations.push({
      rule: "damageMismatch",
      detail: { sent: sentDamage, derived: damage },
      enforced: false,
    });
  }

  const sentDestroyed = input.reportedDestroyed;
  if (sentDestroyed !== undefined && destroyed !== undefined && sentDestroyed !== destroyed) {
    violations.push({
      rule: "destroyedMismatch",
      detail: { sent: sentDestroyed, derived: destroyed },
      enforced: false,
    });
  }

  return { health, damage, destroyed, drop, lootableDrop, violations, malformed };
};
