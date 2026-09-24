import { hpLadder, maxHp } from "./stats.js";

/**
 * The shapes the Phase A bound model and the Phase B replay are written over.
 *
 * Two trees build these: the server's `attackContext.ts` out of a stored `Save`
 * row and a posted body, and the web client's Wild Monster Baiter out of a
 * `/base/load` response. Neither shape is spelled here — a save is JSON from a
 * Flash client this server cannot patch, and the shared module may import
 * nothing outside itself (`docs/design/server-combat.md` §3.2) — so the fields
 * are the ones both already read, and {@link toCombatYard} is the one place the
 * two absences that actually mean something are resolved: a missing `l` is
 * level 1 and a missing health entry is full health
 * (`client/scripts/BFOUNDATION.as:2975-2977`, `:3025`).
 *
 * Everything here is data. The rules live in `damagePercent.ts` and
 * `potential.ts`; the engine's own state lives in `engine.ts`.
 */

/* ── Resources ────────────────────────────────────────────────────────────── */

/** The four resources a yard holds, in the order every save spells them. */
export const RESOURCE_KEYS = ["r1", "r2", "r3", "r4"] as const;

/** `r1` twigs, `r2` pebbles, `r3` putty, `r4` goo. */
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

/** One figure per resource: a pool, a delta, a cap or a bound. */
export type ResourceAmounts = Record<ResourceKey, number>;

/** Zero of each resource. */
export const noAmounts = (): ResourceAmounts => ({ r1: 0, r2: 0, r3: 0, r4: 0 });

/**
 * A number out of a save, with the client's tolerance for a string.
 *
 * Flash writes some numbers as strings and the server has always taken them
 * either way; anything unreadable is 0 rather than `NaN`, because a `NaN` in a
 * bound would compare false against every check and wave the save through.
 */
export const numberOf = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Reads `r1..r4` out of anything a save carries them on. */
export const amountsOf = (blob: unknown): ResourceAmounts => {
  const source = (blob ?? {}) as Record<string, unknown>;
  return {
    r1: numberOf(source.r1),
    r2: numberOf(source.r2),
    r3: numberOf(source.r3),
    r4: numberOf(source.r4),
  };
};

/* ── The yard ─────────────────────────────────────────────────────────────── */

/**
 * The fields of one `buildingdata` entry the combat rules read.
 *
 * The same subset `web/src/game/yard/yardModel.ts` reads, minus everything
 * that only decides how a building is drawn. An index signature is kept because
 * the real record carries two dozen more keys and a caller should be able to
 * hand the parsed entry straight in.
 */
export interface CombatBuildingData {
  /** Yard units, origin at the plot centre. */
  readonly X?: unknown;
  readonly Y?: unknown;
  /** Building type id. */
  readonly t?: unknown;
  readonly id?: unknown;
  /** Level. Absent means 1 (`BFOUNDATION.as:2975-2977`, `:3043-3048`). */
  readonly l?: unknown;
  /** Fortification level, 0 when absent. */
  readonly fort?: unknown;
  /** Current health. Absent means full (`:3025`). */
  readonly hp?: unknown;
  /** Harvester: units banked in the building's own buffer. */
  readonly st?: unknown;
  /** Seconds left on the initial build; present means level 0. */
  readonly cB?: unknown;
  readonly [key: string]: unknown;
}

/** `buildingdata`, keyed by building id as a string. */
export type CombatBuildingDataMap = Readonly<Record<string, CombatBuildingData>>;

/** `buildinghealthdata`: current health keyed by building id. */
export type BuildingHealthMap = Readonly<Record<string, number>>;

/**
 * What kind of yard is being attacked, which decides whether `destroyed` exists.
 *
 * `BASE.SaveB` writes `destroyed` only for a wild monster camp or an outpost
 * (`client/scripts/BASE.as:3297-3308`); a main yard never carries one.
 */
export type CombatTargetKind = "main" | "outpost" | "wild" | "tribe";

/** One building, as the rules see it. */
export interface CombatBuilding {
  readonly id: number;
  readonly type: number;
  /** 1 or more once built; 0 while the initial build is still counting down. */
  readonly level: number;
  /** Yard units. */
  readonly x: number;
  readonly y: number;
  readonly fortification: number;
  /** `maxHp(type, level)`, 0 for a type with no health ladder. */
  readonly maxHp: number;
  /** Health at the reference point: the stored map, or full when it has none. */
  readonly hp: number;
  /** A harvester's banked buffer, `st`, which loot can also draw from. */
  readonly banked: number;
  /**
   * A trap that has already fired, or a type 53 past its expiry.
   *
   * Either one contributes to neither side of the damage percentage
   * (`BFOUNDATION.as:437-441`), so the two are one flag: what the sum cares
   * about is that the building is no longer counted, not why.
   */
  readonly spent: boolean;
}

/** The defender's yard at the reference point, plus what it is. */
export interface CombatYard {
  readonly kind: CombatTargetKind;
  /** Sorted by id, so every iteration over a yard is in one order (§3.4). */
  readonly buildings: readonly CombatBuilding[];
  /** The same buildings by id, for the health rules' lookups. */
  readonly byId: ReadonlyMap<number, CombatBuilding>;
}

/** What {@link toCombatYard} is handed. */
export interface CombatYardInput {
  readonly kind?: CombatTargetKind;
  readonly buildingdata?: CombatBuildingDataMap | null;
  readonly buildinghealthdata?: BuildingHealthMap | null;
  /** Ids whose trap has fired or whose type 53 has expired. */
  readonly spent?: Iterable<number>;
}

/**
 * A building's level, with the client's two defaults.
 *
 * `Export` omits the level when it is 1, and a building under its initial build
 * is level 0 with `cB` counting down (`BFOUNDATION.as:2975-2977`, `:3043-3048`).
 */
const levelOf = (data: CombatBuildingData): number => {
  const level = Math.floor(numberOf(data.l));
  if (level > 0) return level;
  return data.l === undefined && data.cB === undefined ? 1 : Math.max(0, level);
};

/**
 * Builds the yard the rules read out of a save's two building maps.
 *
 * One function rather than one per tree, because the two absences it resolves
 * are the two a reimplementation gets wrong: a level that is not written when
 * it is 1, and a health entry that is not written when the building is whole.
 * A yard built two ways would give the server and the Baiter two different
 * damage percentages for the same battle, which is the one thing
 * `docs/design/server-combat.md` §3.2 exists to prevent.
 */
export const toCombatYard = (input: CombatYardInput): CombatYard => {
  const health = input.buildinghealthdata ?? {};
  const spent = new Set(input.spent ?? []);
  const buildings: CombatBuilding[] = [];

  for (const [key, data] of Object.entries(input.buildingdata ?? {})) {
    if (!data || typeof data !== "object") continue;

    const id = Math.floor(numberOf(data.id ?? key));
    const type = Math.floor(numberOf(data.t));
    const level = levelOf(data);
    const ceiling = maxHp(type, level);
    const reported = health[String(id)];
    const stored = reported === undefined ? numberOf(data.hp ?? ceiling) : numberOf(reported);

    buildings.push({
      id,
      type,
      level,
      x: numberOf(data.X),
      y: numberOf(data.Y),
      fortification: Math.max(0, Math.floor(numberOf(data.fort))),
      maxHp: ceiling,
      // A type with no ladder reads 0 either way; clamping keeps a stored map
      // that outran a downgrade from making a building healthier than it is.
      hp: hpLadder(type).length === 0 ? 0 : Math.max(0, Math.min(ceiling, stored)),
      banked: Math.max(0, numberOf(data.st)),
      spent: spent.has(id),
    });
  }

  buildings.sort((one, other) => one.id - other.id);

  return {
    kind: input.kind ?? "main",
    buildings,
    byId: new Map(buildings.map((building) => [building.id, building])),
  };
};

/* ── The roster ───────────────────────────────────────────────────────────── */

/** Monster counts keyed by the id a roster spells (`C1`, `IC7`, …). */
export type Roster = Readonly<Record<string, number>>;

/** Academy levels keyed by monster id; an absent id is level 1. */
export type MonsterLevels = Readonly<Record<string, number>>;

/**
 * The attacker's champion while it is on the field.
 *
 * At most one per attack (`docs/design/server-combat.md` §3.10), matched to the
 * stored entry by `t` and read at its stored level, never the reported one.
 */
export interface ChampionOnField {
  /** `G1`..`G5`, the id the stat table is keyed by. */
  readonly id: string;
  readonly level: number;
  /** 0 to 3; the `bonus*` ladders are indexed by it (`champions/Krallen.as:25`). */
  readonly powerLevel: number;
}

/** One entry of a `champion` or `attackerchampion` list (`ChampionSchema.ts`). */
export interface ChampionEntry {
  /** Champion type, 1 to 5. */
  readonly t: number;
  readonly hp: number;
  /** Evolution level. */
  readonly l: number;
  readonly ft: number;
  readonly fd: number;
  readonly fb: number;
  /** Power level. */
  readonly pl: number;
  /** 0 active, 1 frozen, 2 juiced. */
  readonly status: number;
  readonly nm?: string;
  readonly [key: string]: unknown;
}

/* ── The attack context ───────────────────────────────────────────────────── */

/**
 * The attacker's pool, caps and standing, which the loot rules of §2.4 read.
 *
 * `caps` is `storageCap(A)` per resource — one figure repeated today, because
 * the server's cap is not per resource — already raised by Krallen's `buffs`
 * when she is on the field (`client/scripts/ATTACK.as:696-702`).
 */
export interface AttackerStanding {
  readonly pool: ResourceAmounts;
  readonly caps: ResourceAmounts;
  /** Player level, for the low-level loot bonus (`ATTACK.as:678-680`). */
  readonly playerLevel: number;
  /** `A.catapult`; 0 when the attacker owns none, so no bomb is available. */
  readonly catapultLevel: number;
  /** True when `A.siege` holds a Vacuum (§6, item 4). */
  readonly hasVacuum: boolean;
}

/**
 * Everything one attack save's rules are read against (§2.1).
 *
 * Derived once by the server's `attackContext.ts` before the audit runs, and by
 * the Baiter from the roster the player chose. Every field is already resolved:
 * the bound model does no lookups of its own and touches no clock.
 */
export interface AttackContext {
  /** `session.startedat` (`services/base/attackSession.ts:48-49`). */
  readonly startedAt: number;
  /** The server clock at the moment the save arrived, in unix seconds. */
  readonly now: number;
  /** `clamp(now - startedAt, 0, 540)`: Declare War plus the retreat grace. */
  readonly elapsedAttack: number;
  /** The seconds this save covers, `clamp(now - max(savetime, startedAt), …)`. */
  readonly elapsedSave: number;
  /** Academy levels, clamped as the client clamps (`CREATURES.as:75-81`). */
  readonly levels: MonsterLevels;
  /** Cumulative counts out of the attacker's cells this attack (§2.1). */
  readonly flung: Roster;
  /** The attacker's champion on the field, or null. */
  readonly champion: ChampionOnField | null;
  /** The defender's yard, countdowns advanced to `now` by `referenceYard`. */
  readonly yard: CombatYard;
  readonly attacker: AttackerStanding;
}

/**
 * The constants the bound model reads, a subset of `CombatConfig.ts` (§3.6).
 *
 * Passed in rather than imported so the module stays free of the server's
 * config, and so the Baiter can show a player what a nudge to one of them would
 * have refused. The defaults are {@link COMBAT_TOLERANCES}.
 */
export interface CombatTolerances {
  /** §2.3: the slack on the damage bound is 1%, never below this. */
  readonly damageSlackMin: number;
  readonly damageSlackFraction: number;
  /** §2.4: the most an attacker may gain over what the defender lost. */
  readonly lootGainRatio: number;
  /** §2.4: the largest looting multiplier against lootable damage. */
  readonly lootMultMax: number;
  /** §6 item 4: the Vacuum's untraced bonus, as a doubling of the allowance. */
  readonly vacuumLootSlack: number;
  /** §2.2: the points `damage` may differ by before it is a mismatch. */
  readonly damageTolerance: number;
}

/** The plan's figures (§3.6), so a caller may pass nothing and still be right. */
export const COMBAT_TOLERANCES: CombatTolerances = {
  damageSlackMin: 1000,
  damageSlackFraction: 0.01,
  lootGainRatio: 1.6,
  lootMultMax: 5,
  vacuumLootSlack: 2,
  damageTolerance: 1,
};

/* ── The verdict ──────────────────────────────────────────────────────────── */

/** Every rule the combat audit can report, as it appears on the wire (§3.9). */
export type CombatRule =
  | "malformed"
  | "unknownBuilding"
  | "healthRose"
  | "trapState"
  | "damageMismatch"
  | "destroyedMismatch"
  | "damageBudget"
  | "damageWithoutMonsters"
  | "lootExceedsLoss"
  | "lootExceedsDamage"
  | "lossExceedsPool"
  | "lootOverCap"
  | "bombSpend"
  | "attackerChampionMutated"
  | "rosterGrew"
  | "siegeGrew"
  | "defenderRosterGrew"
  | "championMutated"
  | "foreignKey"
  | "replayMismatch"
  | "replayTimeout";

/** One thing an attack save could not explain (§3.8). */
export interface CombatViolation {
  readonly rule: CombatRule;
  /** Building ids, the first {@link MAX_LISTED}. */
  readonly ids?: number[];
  readonly detail?: Record<string, unknown>;
  /**
   * Whether this rule refuses the save in `reject` mode.
   *
   * Decided by the rule and never by the mode, so one verdict serves both and
   * the log line can say which violations *would* have refused (§3.8).
   */
  readonly enforced: boolean;
}

/**
 * How many ids one violation lists.
 *
 * A forged save can name every building in a 575-entry yard; the log line and
 * the error body both want the evidence, not the census.
 */
export const MAX_LISTED = 20;

/** `ids` for a violation, trimmed and sorted so two runs read alike. */
export const listed = (ids: Iterable<number>): number[] =>
  [...ids].sort((one, other) => one - other).slice(0, MAX_LISTED);

/**
 * A reason the save is not readable at all, refused as a 400 rather than a 409.
 *
 * Only a broken or forged client sends one, so it never reaches the violation
 * list: the audit throws before it is worth bounding anything (§3.9).
 */
export interface MalformedIssue {
  /** What was wrong, in the words the error body carries. */
  readonly issue: string;
  readonly detail?: Record<string, unknown>;
}

/**
 * A blob the rules do not model, passed through rather than parsed.
 *
 * The defender's `monsters` carries housing, bunkers and hatchery state in a
 * shape the server treats as opaque (`docs/server-api.md:783`); the audit
 * clamps the counts it understands and copies the rest, so the type says only
 * that it is an object.
 */
export type CombatBlob = Readonly<Record<string, unknown>>;

/** The fields the server works out for itself rather than storing what arrived. */
export interface CombatDerived {
  /** `min(stored, submitted)` per id, only the ids below full (§2.2). */
  readonly health: BuildingHealthMap;
  /** The sum over the derived health (§2.2). */
  readonly damage: number;
  /** Wild monster camps and outposts only; undefined elsewhere. */
  readonly destroyed: 0 | 1 | undefined;
  /** Gains capped at the attacker's storage, bomb spend preserved (§2.4). */
  readonly attackloot: ResourceAmounts;
  /** The stored entries with `hp = min(stored, sent)` (§2.5). */
  readonly attackerChampion: readonly ChampionEntry[];
  /** The stored blob with every housed count at `min(stored, sent)` (§2.6). */
  readonly defenderMonsters: CombatBlob;
  /** Outside Map Room 2 only; the client sends none within it (§2.5). */
  readonly attackCreatures: CombatBlob | undefined;
}

/** What one audited attack save came to (§3.8). */
export interface CombatVerdict {
  readonly violations: readonly CombatViolation[];
  readonly derived: CombatDerived;
  readonly context: {
    readonly elapsedAttack: number;
    readonly elapsedSave: number;
    readonly flung: Roster;
    readonly potential: number;
    readonly drop: number;
  };
}

/* ── Phase B: the fling log and the replay outcome ────────────────────────── */

/**
 * One thing the attacker did, at a tick (§3.10).
 *
 * The Flash client cannot produce this; the web client's attack flow (issue
 * #32) adds it, and the shape is fixed here so the engine (WP4) and the flow
 * are written to one contract.
 */
export type FlingEvent =
  | {
      readonly kind: "fling";
      /** Fast ticks since attack start, non-decreasing across the log. */
      readonly t: number;
      /** Yard units, the same space as `buildingdata.X/Y`. */
      readonly x: number;
      readonly y: number;
      /** Drop radius, `max(200, bucketTotal / 4) / 2`; the server recomputes it. */
      readonly r: number;
      readonly monsters: Roster;
      readonly champion?: { readonly t: number; readonly l: number };
    }
  | {
      readonly kind: "bomb";
      readonly t: number;
      readonly x: number;
      readonly y: number;
      /** A {@link BombStats} id: `tw0`..`pu3`. */
      readonly id: string;
    }
  | {
      readonly kind: "siege";
      readonly t: number;
      readonly x: number;
      readonly y: number;
      readonly weapon: string;
    }
  | { readonly kind: "retreat"; readonly t: number };

/** The complete record of an attack, resent in full on every save (§3.10). */
export interface FlingLog {
  readonly v: 1;
  /** The `combatseed` the attack-mode `/base/load` returned. */
  readonly seed: number;
  readonly events: readonly FlingEvent[];
}

/** What a replay derives, which in `authoritative` mode is what is written (§2.8). */
export interface Outcome {
  readonly health: BuildingHealthMap;
  readonly damage: number;
  readonly destroyed: 0 | 1 | undefined;
  /** The defender's loss, as a negative delta per resource. */
  readonly defenderDelta: ResourceAmounts;
  /** The attacker's gain, before the storage cap. */
  readonly attackerLoot: ResourceAmounts;
  /** Ids of the traps that fired. */
  readonly firedTraps: readonly number[];
  /** The tick the battle ended on. */
  readonly ticks: number;
  /** `digest(state)` at every 800-tick checkpoint (§3.4). */
  readonly digests: readonly string[];
}
