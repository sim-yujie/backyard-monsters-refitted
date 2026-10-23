import { costOf, type CostStep } from "../../game-data/buildingCosts.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { BaseType } from "../../enums/Base.js";
import { BUILDABLE_TYPES, buildGates } from "../yard/build.js";
import { STARTER_BUILDINGS } from "../yard/starterBase.js";
import { planOneUpgrade } from "../yardplanner/startUpgrades.js";
import { pointsForBuild, pointsForUpgrade, TOWN_HALL_TYPE } from "../yardplanner/costs.js";
import { BEGINNER_TOP_HALL, coreStyleWalls, yardStyleOf } from "./yardStyle.js";

/**
 * A bot's build order (`docs/design/bot-neighbours.md` §4.2 step 1, issue #237).
 *
 * A bot's yard is the yard a player would have after a run of builds and
 * upgrades from the starter base (`yard/starterBase.ts`), picked one at a time
 * from what the rules allow at that moment and weighted by the bot's persona.
 * The run is seeded and never looks at the target, so "the yard at points P"
 * is a pure function of (seed, persona, P), and the yard at P is always a
 * prefix of the yard at any larger P': growth (§4.4) is the same run carried
 * further, never a building moved or removed.
 *
 * ## Legal actions
 *
 * The server's own gates decide: a build passes `buildGates` (`yard/build.ts`:
 * the build menu, `quantity[hall]`, the `re` list), an upgrade passes
 * `planOneUpgrade` (`yardplanner/startUpgrades.ts`: maximum level, the `re`
 * list) against a pool too deep to run short and no worker busy, because a bot
 * is not charged for what it builds (§4.4) and every simulated job is finished
 * at once. The candidates are screened first with the same rules on an index
 * of counts and levels, which is cheap; the one action picked is then put
 * through the real gates, and a refusal there is a bug that throws.
 *
 * The Map Room is built at level 1 and never upgraded: a level 2 Map Room
 * moves a yard to Map Room 2 (`yard/mapRoom.ts`), and bots live on Map Room 1.
 *
 * ## Points and level
 *
 * Each finished build earns `pointsForBuild(costs[0])` and each upgrade
 * `pointsForUpgrade(costs[from])` (`catchUpBuildings.ts`), and base value is a
 * tenth of every counted building's last step (`baseValueOf`,
 * `economy/resourceBudget.ts`). Level is `calculateBaseLevel` over the two.
 * The starter base is free, as it is for a player: no points, only its value.
 *
 * ## Hitting a level
 *
 * The run never takes an action that would jump over a whole level band (land
 * two or more levels up) while a smaller one is available, so every level is
 * passed through on the way. {@link yardAtPoints} then takes actions while the
 * empire points are under the target, and stops early rather than take one
 * that would carry the yard past the target's level. Either way the yard
 * ends at the target's level, and the cut point only ever moves forward as the
 * target grows, which is what keeps the prefix property.
 *
 * ## Banking points
 *
 * Points also count what a player earns by collecting from harvesters: half
 * of every resource banked after the tutorial (`yard/bank.ts`). A player
 * banks what they spend, so each action earns {@link BANK_SHARE} of its
 * resource cost on top ({@link bankPoints}). Without it a bot of a level would
 * carry about one Town Hall more than a player of that level (bot-yard-facts
 * report, 2026-10-23).
 *
 * ## The build plan (owner decisions, 2026-10-23)
 *
 * A bot builds as a real player does, Town Hall by Town Hall. At each hall it
 * runs through the stages of {@link PLAN_ORDER}, its persona's order: every
 * Twig Snapper and Pebble Shiner the hall allows first, then the Putty
 * Squishers, Goo Factories and silos, then the towers, the other buildings,
 * the walls and traps and the upgrades, in an order that leans the persona's
 * way. Each action is taken from the earliest stage that has one, now and
 * then ({@link STAGE_SLIP}) from the stage after it, so two bots of one level
 * are not built the same. Inside a stage a new building weighs more than an
 * upgrade, and an upgrade goes to the lowest building first, so harvesters
 * of a kind rise together.
 *
 * A player fills out what their Town Hall allows before upgrading it. The
 * Town Hall upgrade is offered only once every building the hall allows
 * stands (walls and traps to their fill), and the yard's "readiness" (levels
 * reached against what the hall allows, walls and traps aside) passes a
 * threshold drawn per hall level from the seed ({@link READINESS}), or when
 * nothing else is left to do.
 *
 * ## Walls and traps (issues #250, #252)
 *
 * Each seed draws, per hall level, the share of the wall and trap allowances
 * it means to stand ({@link WALL_FILL}, {@link TRAP_FILL}) and the average wall
 * level it means to reach ({@link WALL_TIER}): mostly wood at Town Hall 3,
 * stone by Town Hall 4 or 5, the higher tiers from Town Hall 6 on. A bot that
 * walls only its core (`yardStyle.ts`) never stands more than its rings take.
 * The upgrade taken is always the lowest wall, oldest first, so the core goes
 * to stone before the rest. The layout reads the same draws
 * ({@link wallTargets}) to know how many walls each Town Hall's yard will
 * stand. Each upgrade is a real one: the server's gate (`planOneUpgrade`, the
 * Town Hall its `re` list asks for), its points and its base value.
 */

/** A bot's play style, kept in `bot.persona` (§5). */
export type Persona = "economy" | "towers" | "army";

export const PERSONAS: readonly Persona[] = ["economy", "towers", "army"];

/** The groups an action is picked from. */
export type Category = "hall" | "economy" | "defence" | "army" | "utility" | "walls" | "traps";

/** Map Room type id (`client/scripts/YARD_PROPS.as:1122`). */
export const MAP_ROOM_TYPE = 11;

/** The category of every type the progression builds. */
const CATEGORY_OF: Readonly<Record<number, Category>> = {
  [TOWN_HALL_TYPE]: "hall",
  // Harvesters and the Storage Silo.
  1: "economy",
  2: "economy",
  3: "economy",
  4: "economy",
  6: "economy",
  // Towers.
  20: "defence",
  21: "defence",
  23: "defence",
  25: "defence",
  115: "defence",
  118: "defence",
  // Monster buildings.
  8: "army",
  9: "army",
  13: "army",
  15: "army",
  16: "army",
  22: "army",
  26: "army",
  114: "army",
  116: "army",
  119: "army",
  // Everything else on the build menu.
  5: "utility",
  10: "utility",
  11: "utility",
  12: "utility",
  19: "utility",
  51: "utility",
  // Walls and traps.
  17: "walls",
  24: "traps",
  117: "traps",
};

/**
 * A stage of a hall's build plan (see the file comment):
 *
 * - `mainHarvesters`: building Twig Snappers and Pebble Shiners;
 * - `economy`: building Putty Squishers, Goo Factories and silos;
 * - `towers`: building towers;
 * - `buildings`: building everything else but walls and traps;
 * - `mainUpgrades`: upgrading Twig Snappers, Pebble Shiners and silos;
 * - `sideUpgrades`: upgrading Putty Squishers and Goo Factories;
 * - `walls`: walls and traps up to their fill, walls up to their tier;
 * - `upgrades`: every other upgrade.
 */
export type Stage =
  | "mainHarvesters"
  | "economy"
  | "towers"
  | "buildings"
  | "mainUpgrades"
  | "sideUpgrades"
  | "walls"
  | "upgrades";

/**
 * The order each persona runs a hall's stages in `[PLACEHOLDER]`. Harvesters
 * first for every bot (the owner: as many resource buildings as allowed,
 * before walls; Twigs and Pebbles before Putty and Goo); an economy bot then
 * levels its harvesters before its towers, a tower bot builds and walls its
 * defences sooner, an army bot its monster buildings.
 */
export const PLAN_ORDER: Readonly<Record<Persona, readonly Stage[]>> = {
  economy: ["mainHarvesters", "economy", "mainUpgrades", "towers", "buildings", "sideUpgrades", "walls", "upgrades"],
  towers: ["mainHarvesters", "economy", "towers", "mainUpgrades", "walls", "buildings", "sideUpgrades", "upgrades"],
  army: ["mainHarvesters", "economy", "towers", "buildings", "mainUpgrades", "sideUpgrades", "walls", "upgrades"],
};

/** The chance an action comes from the stage after the earliest one with work left `[PLACEHOLDER]`. */
export const STAGE_SLIP = 0.15;

/**
 * How much each persona favours each category inside the `buildings` and
 * `upgrades` stages `[PLACEHOLDER]`: an army bot's monster buildings run
 * ahead, a tower bot's tower upgrades do.
 */
export const PERSONA_WEIGHTS: Readonly<Record<Persona, Readonly<Record<Exclude<Category, "hall">, number>>>> = {
  economy: { economy: 4, defence: 2, army: 1.5, utility: 1, walls: 1, traps: 1 },
  towers: { economy: 2, defence: 4, army: 1.5, utility: 1, walls: 1.5, traps: 1 },
  army: { economy: 2, defence: 2, army: 4, utility: 1.5, walls: 1, traps: 1 },
};

/** Harvesters and silos by stage (see {@link Stage}). */
const MAIN_HARVESTERS: ReadonlySet<number> = new Set([1, 2]);
const SIDE_HARVESTERS: ReadonlySet<number> = new Set([3, 4]);
const SILO = 6;

/** Weights inside the `economy` stage: Putty before Goo, silos alongside `[PLACEHOLDER]`. */
const ECONOMY_WEIGHTS: Readonly<Record<number, number>> = { 3: 2, 4: 1, [SILO]: 2 };

/**
 * The share of the wall allowance a seed means to stand at each hall level,
 * drawn in `[min, max)` `[PLACEHOLDER]`: a Town Hall 2 yard has just started,
 * from Town Hall 3 a player walls most of what they may, at least enough to
 * close the core (`layout.ts`). A beginner (`yardStyle.ts`) walls less while
 * it is one.
 */
export const WALL_FILL = {
  early: { min: 0.4, max: 0.9 },
  beginner: { min: 0, max: 0.5 },
  later: { min: 0.9, max: 1 },
} as const;

/** The same for traps `[PLACEHOLDER]`. */
export const TRAP_FILL = { early: { min: 0.5, max: 0.9 }, later: { min: 0.7, max: 1 } } as const;

/**
 * The share of every resource an action costs that its player earned in
 * points banking it first (`yard/bank.ts`: half of what is banked after the
 * tutorial).
 */
export const BANK_SHARE = 0.5;

/** The salt of the fill draws' stream. */
const FILL_SALT = 0x2545f491;

/**
 * The average wall level a seed means to reach at each Town Hall level,
 * drawn in `[min, max)` `[PLACEHOLDER]`, never past what the hall allows (a
 * level N wall needs Town Hall N + 1). Town Halls 1 and 2 build wood only.
 */
export const WALL_TIER: Readonly<Record<number, { min: number; max: number }>> = {
  3: { min: 1.1, max: 1.5 },
  4: { min: 1.6, max: 2.2 },
  5: { min: 2.0, max: 2.8 },
  6: { min: 2.6, max: 3.4 },
  7: { min: 3.0, max: 3.8 },
  8: { min: 3.4, max: 4.2 },
  9: { min: 3.8, max: 4.6 },
  10: { min: 4.2, max: 4.9 },
};

/** The salt of the tier draws' stream. */
const TIER_SALT = 0x68e31da4;

/** The Wall Block (`buildingCosts.ts`, type 17). */
const WALL_TYPE = 17;

/** The chance the Town Hall upgrade is taken once it is offered: soon, not at once `[PLACEHOLDER]`. */
const HALL_TAKE = 0.6;

/** A new building against an upgrade inside one stage. */
const BUILD_WEIGHT = 3;
const UPGRADE_WEIGHT = 1;

/**
 * The readiness each hall level waits for, drawn per hall in `[min, max)`
 * `[PLACEHOLDER]`: a player hurries through the cheap first Town Halls, and
 * fills out the dear later ones further before moving on. Index is the hall
 * level; the last entry stands in for any hall past the end.
 */
export const READINESS: readonly { min: number; max: number }[] = [
  { min: 0, max: 0 },
  { min: 0.3, max: 0.5 },
  { min: 0.45, max: 0.65 },
  { min: 0.6, max: 0.8 },
  { min: 0.65, max: 0.85 },
  { min: 0.7, max: 0.9 },
  { min: 0.9, max: 1 },
];

/** The highest Town Hall level. */
const TOP_HALL = 10;

/** Kinds that add nothing to base value (`BASE_VALUE_EXCLUDED`, `economy/resourceBudget.ts`). */
const VALUE_EXCLUDED_KINDS: ReadonlySet<string> = new Set(["decoration", "enemy", "immovable", "trap"]);

/** Every type the progression may build: the build menu (`BUILDABLE_TYPES`). */
const PROGRESSION_TYPES: readonly number[] = [...BUILDABLE_TYPES].sort((a, b) => a - b);

/** A pool deep enough that the upgrade gate never reports a shortfall. */
const BOTTOMLESS = { r1: 1e15, r2: 1e15, r3: 1e15, r4: 1e15 };

/** One building of a bot's yard: no position yet (placement is WP5). */
export interface ProgressionBuilding {
  id: number;
  t: number;
  l: number;
}

/** One action of the run. */
export interface ProgressionAction {
  kind: "build" | "upgrade";
  /** The building built or upgraded. */
  id: number;
  t: number;
  /** Its level after the action. */
  to: number;
  /** Empire points earned. */
  points: number;
  /** The base value's raw sum (time plus resources) gained, before the tenth. */
  raw: number;
  /** Points plus base value after the action. */
  total: number;
}

/** The empire level of a points-plus-base-value total (`calculateBaseLevel`). */
export const levelOfTotal = (total: number): number => {
  let level = 1;
  for (let i = 0; i < experiencePoints.length; i++) {
    if (total >= experiencePoints[i]!) level = i + 1;
    else break;
  }
  return level;
};

/** Base value from its raw sum: a tenth, rounded up (`baseValueOf`). */
const valueOfRaw = (raw: number): number => Math.ceil(0.1 * raw);

const stepSum = (step: CostStep): number => step[0] + step[1] + step[2] + step[3] + step[4];

/** The points a player earned banking what a step costs (see the file comment). */
export const bankPoints = (step: CostStep): number => Math.floor(BANK_SHARE * (step[0] + step[1] + step[2] + step[3]));

/** A bot's points for a build: the finished job's (`pointsForBuild`) and the banking before it. */
export const botPointsForBuild = (step: CostStep): number => pointsForBuild(step) + bankPoints(step);

/** A bot's points for an upgrade: the finished job's (`pointsForUpgrade`) and the banking before it. */
export const botPointsForUpgrade = (step: CostStep): number => pointsForUpgrade(step) + bankPoints(step);

/** Whether a type's steps count towards base value. */
const counted = (type: number): boolean => {
  const kind = costOf(type)?.kind;
  return kind !== undefined && !VALUE_EXCLUDED_KINDS.has(kind);
};

/** `quantity[hall]`, the last entry standing in for any hall past the end (as `build.ts`). */
const allowedAt = (type: number, hall: number): number => {
  const quantity = costOf(type)?.quantity ?? [];
  if (quantity.length === 0) return 0;
  return quantity[Math.min(Math.max(hall, 0), quantity.length - 1)] ?? 0;
};

/**
 * The highest level a type reaches with a Town Hall at `hall`, counting only
 * the Town Hall entries of each step's `re`: the readiness measure's yardstick.
 */
export const capAtHall = (() => {
  const cache = new Map<string, number>();
  return (type: number, hall: number): number => {
    if (type === MAP_ROOM_TYPE) return 1;
    const key = `${type}:${hall}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const costs = costOf(type)?.costs ?? [];
    let level = 0;
    for (const step of costs) {
      const needs = step[5].filter(([t]) => t === TOWN_HALL_TYPE).every(([, , l]) => l <= hall);
      if (!needs) break;
      level++;
    }
    cache.set(key, level);
    return level;
  };
})();

/** Draws one item by weight; null when there is nothing to draw. */
const pick = <T>(rng: Rng, items: readonly { item: T; weight: number }[]): T | null => {
  let sum = 0;
  for (const entry of items) sum += entry.weight;
  if (items.length === 0 || sum <= 0) return null;
  let roll = rng.float() * sum;
  for (const entry of items) {
    roll -= entry.weight;
    if (roll < 0) return entry.item;
  }
  return items[items.length - 1]!.item;
};

/** The share of the wall and trap allowances a seed means to stand, per hall level (see the file comment). */
const fillsFor = (seed: number): { wall: number[]; trap: number[] } => {
  const fills = mulberry32((Math.floor(seed) ^ FILL_SALT) >>> 0);
  const { beginner } = yardStyleOf(seed);
  const wall: number[] = [];
  const trap: number[] = [];
  for (let hall = 0; hall <= TOP_HALL; hall++) {
    const early = hall <= BEGINNER_TOP_HALL;
    const walls = early ? (beginner ? WALL_FILL.beginner : WALL_FILL.early) : WALL_FILL.later;
    const traps = early ? TRAP_FILL.early : TRAP_FILL.later;
    wall.push(walls.min + (walls.max - walls.min) * fills.float());
    trap.push(traps.min + (traps.max - traps.min) * fills.float());
  }
  return { wall, trap };
};

/**
 * How many walls a seed's yard stands once it has caught up at each Town Hall
 * level, indexed by hall level (0 to 10): its fill of the allowance, never
 * more than a `core` bot's rings take (`yardStyle.ts`), never fewer than at
 * the hall before. The progression builds exactly this many; the layout plans
 * its walls by it (`layout.ts`).
 */
export const wallTargets = (seed: number): number[] => {
  const { walls } = yardStyleOf(seed);
  let most = 0;
  return fillsFor(seed).wall.map((fill, hall) => {
    const wanted = Math.round(allowedAt(WALL_TYPE, hall) * fill);
    most = Math.max(most, walls === "core" ? coreStyleWalls(wanted) : wanted);
    return most;
  });
};

/** A candidate action before it is taken. */
interface Candidate {
  kind: "build" | "upgrade";
  t: number;
  /** The building upgraded; for a build, the id it will get. */
  id: number;
  from: number;
  points: number;
  raw: number;
}

/**
 * The run itself: a yard that grows one action at a time.
 *
 * {@link next} picks the next action and holds it until {@link apply} takes
 * it, so a caller may look at an action and decline it without changing what
 * the run does afterwards.
 */
export class Progression {
  readonly persona: Persona;
  private readonly rng: Rng;
  /** The yard as `buildingdata`, for the server's gates. */
  private readonly buildingdata: BuildingDataMap = {};
  /** Every building, by type, in the order built. */
  private readonly byType = new Map<number, ProgressionBuilding[]>();
  private readonly thresholds: number[] = [];
  /** The walls to stand and the share of the trap allowance to stand, per hall level. */
  private readonly wallTarget: number[];
  private readonly trapFill: number[];
  /** The average wall level to reach, per hall level (see the file comment). */
  private readonly wallTier: number[] = [];
  private nextId = 1;
  private pending: Candidate | null | undefined;
  private hall = 0;
  points = 0;
  raw = 0;
  /** Actions taken. */
  steps = 0;

  constructor(seed: number, persona: Persona) {
    this.persona = persona;
    this.rng = mulberry32(seed);
    for (let hall = 0; hall <= TOP_HALL; hall++) {
      const band = READINESS[Math.min(hall, READINESS.length - 1)]!;
      this.thresholds.push(band.min + (band.max - band.min) * this.rng.float());
    }
    this.wallTarget = wallTargets(seed);
    this.trapFill = fillsFor(seed).trap;
    const tiers = mulberry32((Math.floor(seed) ^ TIER_SALT) >>> 0);
    for (let hall = 0; hall <= TOP_HALL; hall++) {
      const band = WALL_TIER[hall] ?? { min: 1, max: 1 };
      this.wallTier.push(Math.min(band.min + (band.max - band.min) * tiers.float(), capAtHall(WALL_TYPE, hall)));
    }
    for (const starter of STARTER_BUILDINGS) {
      const id = this.nextId++;
      this.add({ id, t: starter.t, l: 1 });
      if (counted(starter.t)) this.raw += stepSum(costOf(starter.t)!.costs[0]!);
    }
  }

  /** Base value now. */
  get basevalue(): number {
    return valueOfRaw(this.raw);
  }

  /** Points plus base value now. */
  get total(): number {
    return this.points + this.basevalue;
  }

  /** The empire level now. */
  get level(): number {
    return levelOfTotal(this.total);
  }

  /** The Town Hall level now. */
  get townHall(): number {
    return this.hall;
  }

  /** Every building, in id order, copied. */
  buildings(): ProgressionBuilding[] {
    return Object.values(this.buildingdata)
      .map((building) => ({ id: building.id, t: building.t, l: Number(building.l) }))
      .sort((a, b) => a.id - b.id);
  }

  /** The next action, or null once the yard can do nothing more. Stable until {@link apply}. */
  next(): ProgressionAction | null {
    if (this.pending === undefined) this.pending = this.choose();
    const candidate = this.pending;
    if (!candidate) return null;
    const raw = this.raw + candidate.raw;
    return {
      kind: candidate.kind,
      id: candidate.id,
      t: candidate.t,
      to: candidate.from + 1,
      points: candidate.points,
      raw: candidate.raw,
      total: this.points + candidate.points + valueOfRaw(raw),
    };
  }

  /** Takes the action {@link next} returned. */
  apply(): void {
    if (this.pending === undefined) this.pending = this.choose();
    const candidate = this.pending;
    if (!candidate) throw new Error("The bot progression has nothing left to do.");
    this.verify(candidate);
    if (candidate.kind === "build") {
      this.nextId++;
      this.add({ id: candidate.id, t: candidate.t, l: 1 });
    } else {
      const building = this.find(candidate.t, candidate.id);
      building.l = candidate.from + 1;
      this.buildingdata[String(candidate.id)]!.l = building.l;
      if (candidate.t === TOWN_HALL_TYPE) this.hall = building.l;
    }
    this.points += candidate.points;
    this.raw += candidate.raw;
    this.steps++;
    this.pending = undefined;
  }

  private add(building: ProgressionBuilding): void {
    const list = this.byType.get(building.t) ?? [];
    list.push(building);
    this.byType.set(building.t, list);
    this.buildingdata[String(building.id)] = { id: building.id, t: building.t, l: building.l } as BuildingData;
    if (building.t === TOWN_HALL_TYPE) this.hall = Math.max(this.hall, building.l);
  }

  private find(type: number, id: number): ProgressionBuilding {
    const building = this.byType.get(type)?.find((one) => one.id === id);
    if (!building) throw new Error(`Bot progression lost building ${id}.`);
    return building;
  }

  /** How many buildings of `type` stand at `level` or above. */
  private countAtLeast(type: number, level: number): number {
    let have = 0;
    for (const building of this.byType.get(type) ?? []) if (building.l >= level) have++;
    return have;
  }

  /** The `re` check on the index (`requirementsMet`, `yardplanner/costs.ts`). */
  private meets(step: CostStep): boolean {
    return step[5].every(([type, count, level]) => this.countAtLeast(type, level) >= count);
  }

  /** The screen for a build: the build menu, `quantity[hall]`, `re`. */
  private buildCandidate(type: number): Candidate | null {
    const step = costOf(type)?.costs[0];
    if (!step) return null;
    const have = this.byType.get(type)?.length ?? 0;
    if (have >= allowedAt(type, this.hall)) return null;
    if (!this.meets(step)) return null;
    return {
      kind: "build",
      t: type,
      id: this.nextId,
      from: 0,
      points: botPointsForBuild(step),
      raw: counted(type) ? stepSum(step) : 0,
    };
  }

  /** The screen for an upgrade of the lowest building of `type`: maximum level, `re`. */
  private upgradeCandidate(type: number): Candidate | null {
    if (type === MAP_ROOM_TYPE) return null;
    const list = this.byType.get(type);
    if (!list || list.length === 0) return null;
    let lowest = list[0]!;
    for (const building of list) if (building.l < lowest.l) lowest = building;
    const costs = costOf(type)?.costs ?? [];
    const step = costs[lowest.l];
    if (!step || !this.meets(step)) return null;
    return {
      kind: "upgrade",
      t: type,
      id: lowest.id,
      from: lowest.l,
      points: botPointsForUpgrade(step),
      raw: counted(type) ? stepSum(step) - stepSum(costs[lowest.l - 1]!) : 0,
    };
  }

  /**
   * How far the yard has filled what its hall allows: slots built and levels
   * reached, walls, traps and the hall itself aside. 1 when there is nothing
   * to measure.
   */
  private readiness(): number {
    let have = 0;
    let want = 0;
    for (const type of PROGRESSION_TYPES) {
      const category = CATEGORY_OF[type];
      if (!category || category === "walls" || category === "traps" || category === "hall") continue;
      const allowed = allowedAt(type, this.hall);
      if (allowed <= 0) continue;
      const cap = capAtHall(type, this.hall);
      if (cap <= 0) continue;
      const list = this.byType.get(type) ?? [];
      want += allowed * cap;
      let built = 0;
      for (const building of list) {
        if (built >= allowed) break;
        have += Math.min(building.l, cap);
        built++;
      }
    }
    return want === 0 ? 1 : have / want;
  }

  /** Whether the yard stands fewer walls or traps of `type` than its fill at this hall (see the file comment). */
  private shortOfFill(type: number): boolean {
    const have = this.byType.get(type)?.length ?? 0;
    if (type === WALL_TYPE) return have < (this.wallTarget[this.hall] ?? 0);
    return have < Math.round(allowedAt(type, this.hall) * (this.trapFill[this.hall] ?? 0));
  }

  /** Whether the yard's walls average a lower level than its tier at this hall (see the file comment). */
  private shortOfTier(): boolean {
    const walls = this.byType.get(WALL_TYPE) ?? [];
    let levels = 0;
    for (const wall of walls) levels += wall.l;
    return levels < (this.wallTier[this.hall] ?? 1) * walls.length;
  }

  /** Every action the screens allow now, grouped by category. */
  private candidates(): Map<Category, Candidate[]> {
    const groups = new Map<Category, Candidate[]>();
    const push = (candidate: Candidate | null) => {
      if (!candidate) return;
      const category = CATEGORY_OF[candidate.t];
      if (!category) return;
      const list = groups.get(category) ?? [];
      list.push(candidate);
      groups.set(category, list);
    };
    for (const type of PROGRESSION_TYPES) {
      push(this.buildCandidate(type));
      push(this.upgradeCandidate(type));
    }
    push(this.upgradeCandidate(TOWN_HALL_TYPE));
    return groups;
  }

  /** The stage of the plan an action belongs to, or null when the plan leaves it out at this hall (see {@link Stage}). */
  private stageOf(candidate: Candidate): Stage | null {
    const category = CATEGORY_OF[candidate.t];
    if (candidate.kind === "build") {
      // Walls and traps past their fill wait for a bigger hall's fill.
      if (category === "walls" || category === "traps") return this.shortOfFill(candidate.t) ? "walls" : null;
      if (MAIN_HARVESTERS.has(candidate.t)) return "mainHarvesters";
      if (category === "economy") return "economy";
      if (category === "defence") return "towers";
      return "buildings";
    }
    if (candidate.t === WALL_TYPE) return this.shortOfTier() ? "walls" : "upgrades";
    if (MAIN_HARVESTERS.has(candidate.t) || candidate.t === SILO) return "mainUpgrades";
    if (SIDE_HARVESTERS.has(candidate.t)) return "sideUpgrades";
    return "upgrades";
  }

  /**
   * Draws an action inside one stage: a new building over an upgrade, and
   * among upgrades the lowest building first, each level up halving the
   * weight, so a stage's buildings rise together.
   */
  private pickIn(stage: Stage, list: readonly Candidate[]): Candidate | null {
    const weights = PERSONA_WEIGHTS[this.persona];
    let lowest = Number.POSITIVE_INFINITY;
    for (const candidate of list) if (candidate.kind === "upgrade") lowest = Math.min(lowest, candidate.from);
    return pick(
      this.rng,
      list.map((candidate) => {
        let weight = candidate.kind === "build" ? BUILD_WEIGHT : UPGRADE_WEIGHT * 0.5 ** (candidate.from - lowest);
        if (stage === "economy") weight *= ECONOMY_WEIGHTS[candidate.t] ?? 1;
        if (stage === "buildings" || stage === "upgrades") {
          weight *= weights[CATEGORY_OF[candidate.t] as keyof typeof weights] ?? 1;
        }
        return { item: candidate, weight };
      })
    );
  }

  /** Picks the next action (see the file comment), or null when none is left. */
  private choose(): Candidate | null {
    const groups = this.candidates();
    const hallUpgrade = groups.get("hall") ?? [];
    groups.delete("hall");

    const level = this.level;
    // Points plus base value at which the yard would stand two levels up.
    const ceiling = experiencePoints[level + 1] ?? Number.POSITIVE_INFINITY;
    const totalAfter = (candidate: Candidate) =>
      this.points + candidate.points + valueOfRaw(this.raw + candidate.raw);
    const inBand = (candidate: Candidate) => totalAfter(candidate) < ceiling;

    const staged = new Map<Stage, Candidate[]>();
    for (const candidate of [...groups.values()].flat()) {
      const stage = this.stageOf(candidate);
      if (!stage) continue;
      const list = staged.get(stage) ?? [];
      list.push(candidate);
      staged.set(stage, list);
    }
    // Ready once every building the hall allows stands, walls and traps to their fill, and the levels are far
    // enough on; or once the plan has nothing else to do.
    const buildsLeft = [...staged.values()].some((list) => list.some((candidate) => candidate.kind === "build"));
    const hallReady = staged.size === 0 || (!buildsLeft && this.readiness() >= (this.thresholds[this.hall] ?? 1));

    const open = PLAN_ORDER[this.persona].filter((stage) => staged.get(stage)?.some(inBand));
    const hall = hallReady ? hallUpgrade.filter(inBand) : [];
    if (hall.length > 0 && (open.length === 0 || this.rng.float() < HALL_TAKE)) return hall[0]!;
    if (open.length > 0) {
      const stage = open.length > 1 && this.rng.float() < STAGE_SLIP ? open[1]! : open[0]!;
      return this.pickIn(stage, staged.get(stage)!.filter(inBand));
    }

    // Everything left would jump a whole level band: take the smallest step.
    const all = [...[...staged.values()].flat(), ...(hallReady ? hallUpgrade : [])];
    if (all.length === 0) return null;
    return all.reduce((best, candidate) => (totalAfter(candidate) < totalAfter(best) ? candidate : best));
  }

  /** The server's own gate for the action picked; a refusal means the screen is wrong. */
  private verify(candidate: Candidate): void {
    const save = { type: BaseType.MAIN, buildingdata: this.buildingdata, resources: BOTTOMLESS, storedata: {} };
    if (candidate.kind === "build") {
      buildGates(save, { type: candidate.t, x: 0, y: 0 });
      return;
    }
    const step = planOneUpgrade(save, candidate.id, 0);
    if (!step.ok) {
      throw new Error(`Bot progression picked an upgrade the server refuses: ${JSON.stringify(step)}`);
    }
  }
}

/** A bot's yard at a target points value, before placement. */
export interface ProgressionYard {
  buildings: ProgressionBuilding[];
  points: number;
  basevalue: number;
  /** `calculateBaseLevel` of the two. */
  level: number;
  townHall: number;
  /** Actions taken from the starter base. */
  steps: number;
  /**
   * The empire level the yard stood at when each building was placed, by id:
   * 1 for the starter base. The layout (`layout.ts`) places each building on
   * the plot its owner had then, so growth never moves one.
   */
  builtAtLevel: Record<number, number>;
  /** The Town Hall level the yard had when each building was placed, by id: 1 for the starter base. */
  builtAtHall: Record<number, number>;
}

/**
 * The yard the run reaches for `target` empire points (points plus base
 * value): actions while the total is under the target, stopping short of any
 * action that would carry it past the target's level (see the file comment).
 */
export const yardAtPoints = (seed: number, persona: Persona, target: number): ProgressionYard => {
  const run = new Progression(seed, persona);
  const targetLevel = levelOfTotal(target);
  const builtAtLevel: Record<number, number> = {};
  const builtAtHall: Record<number, number> = {};
  for (const building of run.buildings()) {
    builtAtLevel[building.id] = 1;
    builtAtHall[building.id] = 1;
  }
  while (run.total < target) {
    const action = run.next();
    if (!action || levelOfTotal(action.total) > targetLevel) break;
    if (action.kind === "build") {
      builtAtLevel[action.id] = run.level;
      builtAtHall[action.id] = run.townHall;
    }
    run.apply();
  }
  return {
    buildings: run.buildings(),
    points: run.points,
    basevalue: run.basevalue,
    level: run.level,
    townHall: run.townHall,
    steps: run.steps,
    builtAtLevel,
    builtAtHall,
  };
};

/** The empire-points band of a level: `[experiencePoints[L-1], experiencePoints[L])`. */
export const levelBand = (level: number): { min: number; max: number } => ({
  min: experiencePoints[level - 1] ?? 0,
  max: experiencePoints[level] ?? Number.POSITIVE_INFINITY,
});

/**
 * A target drawn uniformly inside a level's band (§4.2), so two bots of one
 * level are not the same size. `fraction` is the draw, in `[0, 1)`.
 */
export const targetInBand = (level: number, fraction: number): number => {
  const { min, max } = levelBand(level);
  return Math.floor(min + (max - min) * Math.min(Math.max(fraction, 0), 0.999999));
};
