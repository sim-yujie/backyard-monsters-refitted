import { costOf, type CostStep } from "../../game-data/buildingCosts.js";
import { experiencePoints } from "../../game-data/stats/experiencePoints.js";
import { mulberry32, type Rng } from "../../game-rules/combat/rng.js";
import type { BuildingData, BuildingDataMap } from "../../types/BuildingData.js";
import { BaseType } from "../../enums/Base.js";
import { BUILDABLE_TYPES, buildGates } from "../yard/build.js";
import { STARTER_BUILDINGS } from "../yard/starterBase.js";
import { planOneUpgrade } from "../yardplanner/startUpgrades.js";
import { pointsForBuild, pointsForUpgrade, TOWN_HALL_TYPE } from "../yardplanner/costs.js";

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
 * ## The pacing
 *
 * A player fills out what their Town Hall allows before upgrading it. The
 * Town Hall upgrade is offered only once the yard's "readiness" at its hall
 * (slots filled and levels reached, walls and traps aside) passes a threshold
 * drawn per hall level from the seed, or when nothing else is left to do.
 * Every other action is picked in two draws: a category by the persona's
 * weights (`[PLACEHOLDER]`, {@link PERSONA_WEIGHTS}), then an action inside it,
 * a new building weighing more than an upgrade.
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
 * How much each persona favours each category `[PLACEHOLDER]`. Not tuned by
 * play: chosen so an economy bot's harvesters run ahead, a tower bot's
 * defences and walls do, an army bot's monster buildings do, and every bot
 * still builds a bit of everything.
 */
export const PERSONA_WEIGHTS: Readonly<Record<Persona, Readonly<Record<Exclude<Category, "hall">, number>>>> = {
  economy: { economy: 4, defence: 2, army: 1.5, utility: 1, walls: 1.5, traps: 0.5 },
  towers: { economy: 2, defence: 4, army: 1.5, utility: 1, walls: 2.5, traps: 1 },
  army: { economy: 2, defence: 2, army: 4, utility: 1.5, walls: 1.5, traps: 0.5 },
};

/** The Town Hall upgrade's weight once it is offered: strong, so it comes soon after readiness. */
const HALL_WEIGHT = 6;

/** A new building against an upgrade inside one category. */
const BUILD_WEIGHT = 3;
const UPGRADE_WEIGHT = 1;

/** The readiness a hall level waits for: drawn per hall in this range `[PLACEHOLDER]`. */
const READINESS_MIN = 0.55;
const READINESS_SPREAD = 0.3;

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
const capAtHall = (() => {
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
      this.thresholds.push(READINESS_MIN + READINESS_SPREAD * this.rng.float());
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
      points: pointsForBuild(step),
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
      points: pointsForUpgrade(step),
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

  /** Picks the next action (see the file comment), or null when none is left. */
  private choose(): Candidate | null {
    const groups = this.candidates();
    if (groups.size === 0) return null;

    const level = this.level;
    // Points plus base value at which the yard would stand two levels up.
    const ceiling = experiencePoints[level + 1] ?? Number.POSITIVE_INFINITY;
    const totalAfter = (candidate: Candidate) =>
      this.points + candidate.points + valueOfRaw(this.raw + candidate.raw);

    const hallUpgrade = groups.get("hall") ?? [];
    groups.delete("hall");
    const others = [...groups.values()].flat();
    const nothingElse = others.every((candidate) => {
      const category = CATEGORY_OF[candidate.t];
      return category === "walls" || category === "traps";
    });
    const hallReady = this.readiness() >= (this.thresholds[this.hall] ?? 1) || nothingElse;

    const weights = PERSONA_WEIGHTS[this.persona];
    const options: { item: Candidate[]; weight: number }[] = [];
    for (const [category, list] of groups) {
      const inBand = list.filter((candidate) => totalAfter(candidate) < ceiling);
      if (inBand.length > 0) options.push({ item: inBand, weight: weights[category as keyof typeof weights] });
    }
    if (hallReady) {
      const inBand = hallUpgrade.filter((candidate) => totalAfter(candidate) < ceiling);
      if (inBand.length > 0) options.push({ item: inBand, weight: HALL_WEIGHT });
    }

    const group = pick(this.rng, options);
    if (group) {
      return pick(
        this.rng,
        group.map((candidate) => ({
          item: candidate,
          weight: candidate.kind === "build" ? BUILD_WEIGHT : UPGRADE_WEIGHT,
        }))
      );
    }

    // Everything left would jump a whole level band: take the smallest step.
    const all = [...others, ...(hallReady ? hallUpgrade : [])];
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
  for (const building of run.buildings()) builtAtLevel[building.id] = 1;
  while (run.total < target) {
    const action = run.next();
    if (!action || levelOfTotal(action.total) > targetLevel) break;
    if (action.kind === "build") builtAtLevel[action.id] = run.level;
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
