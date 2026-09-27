import type { BaseLoadResponse, ResourceCaps, Resources, SpeedupItem, UpgradeCost } from "@/api/types";
import type { CostRequirement } from "@/game/yard/buildingCostData";
import {
  costOf,
  FREE_FINISH_SECONDS,
  kindOf,
  TRAP_TYPES,
  timeCost,
  townHallLevel,
  WALL_TYPES,
} from "@/game/yard/buildingCosts";
import { YARD_PLANNER_TYPE } from "@/game/yard/planner/access";
import type { PlanNode } from "@/game/yard/planner/placement";
import { countdownProgress } from "@/game/yard/jobs";
import { ladderFor } from "@/game/yard/planner/upgrades";
import { freeWorkers, holdsWorker, sharperToolsMultiplier } from "@/game/yard/workers";
import type { Yard, YardBuilding, YardWorkers } from "@/game/yard/yardModel";
import { monstersTabFor, type MonstersTabId } from "@/ui/monsters/monstersTab";

/**
 * What the building panel offers for one building, as data
 * (`docs/design/yard-buildings.md` §3.1 "Building panel").
 *
 * The panel draws; this decides. Which blocks a building gets — Upgrade with
 * its cost and one reason it cannot, the running job with its speed-ups and
 * Cancel, an Open button — and every price on them come from here, so the
 * rules can be tested without a DOM and the panel holds none of its own.
 *
 * ## The gate order
 *
 * When Upgrade cannot be pressed the panel gives one reason, and it is the
 * reason the server would give: `planUpgradeAction` and `planOneUpgrade`
 * check busy, damaged, no Town Hall, top of the ladder, the step's
 * prerequisites (Town Hall first), the resources, then a free worker — for
 * every step, however short (#137)
 * (`server/src/services/yard/upgrade.ts`,
 * `server/src/services/yardplanner/startUpgrades.ts`). The first that fails is
 * the one shown. A shortfall on a resource whose cost is over the storage cap
 * says "build more silos" instead, because no amount of waiting fixes it (BB §4
 * "What happens when full").
 *
 * ## Prices
 *
 * Every Shiny price is the server's formula, recomputed here for the label
 * only (`web/src/game/yard/buildingCosts.ts` mirrors
 * `server/src/services/yard/shiny.ts`); the route charges its own figure.
 * Finish now is `timeCost(remaining)`, which only falls as the job runs, so
 * the price the server charges is never above the one on the button.
 */

/** The props kinds with no upgrade ladder the panel could offer. */
const NO_LADDER_KINDS: ReadonlySet<string> = new Set(["decoration", "mushroom", "taunt", ""]);

/** The Map Room: its level is the map version, so it is never upgraded here (D16). */
export const MAP_ROOM_TYPE = 11;

/** The world map needs a level 6 Town Hall until Map Room 1 exists (D16, §10). */
export const MAP_TOWN_HALL = 6;

/** SP2 and SP3: an hour or two off for a fixed price (`server/src/game-data/store/storeItems.ts`). */
export const SPEEDUP_PRICE: Readonly<Record<"SP2" | "SP3", number>> = { SP2: 20, SP3: 40 };
const SPEEDUP_SECONDS: Readonly<Record<"SP2" | "SP3", number>> = { SP2: 3_600, SP3: 7_200 };

/** What the panel reads: the store, or anything shaped like its read side. */
export interface PanelContext {
  readonly yard: Yard;
  readonly save: BaseLoadResponse;
  readonly resources: Resources;
  readonly credits: number;
  readonly caps: ResourceCaps | null;
  readonly workers: YardWorkers;
  now(): number;
}

/** Why Upgrade (or Instant) cannot be pressed, in the server's terms. */
export type UpgradeGate =
  | { readonly reason: "busy" }
  | { readonly reason: "damaged" }
  | { readonly reason: "townHall"; readonly have: number; readonly need: number }
  | { readonly reason: "maxLevel"; readonly level: number }
  | { readonly reason: "requirements"; readonly requirements: readonly CostRequirement[] }
  | {
      readonly reason: "shortfall";
      readonly shortfall: UpgradeCost;
      /** Some resource costs more than its storage cap: more silos, not more waiting. */
      readonly overCap: boolean;
    }
  | { readonly reason: "workers"; readonly total: number; readonly busy: number }
  | { readonly reason: "credits"; readonly need: number };

export type UpgradeGateReason = UpgradeGate["reason"];

/** The next level, what it costs, and what stops it. */
export interface UpgradeOffer {
  readonly from: number;
  readonly to: number;
  readonly cost: UpgradeCost;
  /** The countdown the server would write: table time × Sharper Tools, however short (#137). */
  readonly seconds: number;
  /** Shiny to buy the level outright. */
  readonly instantPrice: number;
  /** Why Upgrade is disabled; null when it can be pressed. */
  readonly gate: UpgradeGate | null;
  /** Why Instant is disabled: the same gates minus resources and workers, plus Shiny. */
  readonly instantGate: UpgradeGate | null;
}

/** One Shiny speed-up on a running job. */
export interface SpeedupOffer {
  readonly item: SpeedupItem;
  /** Shiny; 0 for SP1. */
  readonly price: number;
  /** Null when it can be pressed, else why not. */
  readonly blocked: "paused" | "tooShort" | "credits" | null;
}

/** A running build or upgrade countdown and what can be done about it. */
export interface JobOffer {
  readonly kind: "build" | "upgrade" | "fortify" | "rebuild";
  /** The level the job reaches. */
  readonly to: number;
  /** Unix seconds, server clock. */
  readonly endsAt: number;
  readonly remaining: number;
  /** Seconds the job runs in all, for the progress bar; at least `remaining`. */
  readonly total: number;
  /** Damaged or repairing: the countdown is frozen until the building is whole. */
  readonly paused: boolean;
  /** Finish now: SP1 (free) at 300 s or less, SP4 above. Null for a fortify or rebuild. */
  readonly finish: SpeedupOffer | null;
  /** −1 h and −2 h; null for a fortify or rebuild. */
  readonly minusOne: SpeedupOffer | null;
  readonly minusTwo: SpeedupOffer | null;
  /** Upgrades only: the refund Cancel would give, capped as the server caps it. */
  readonly cancel: CancelOffer | null;
}

export interface CancelOffer {
  /** What comes back: the step's full cost, less what the storage cap turns away. */
  readonly refund: UpgradeCost;
  /** What the cap turns away; all zero when everything fits. */
  readonly lost: UpgradeCost;
}

/** Which door a building opens: the world map, the layout planner, or the Monsters screen. */
export type OpenTarget = "map" | "planner" | "monsters";

/** Everything the panel shows for a building on the player's own yard. */
export interface PanelModel {
  /** Null when the building has no upgrade here: busy, a wall, a trap, the Map Room, a decoration. */
  readonly upgrade: UpgradeOffer | null;
  /** The building is at the top of its ladder. */
  readonly maxed: boolean;
  readonly job: JobOffer | null;
  readonly open: OpenTarget | null;
  /**
   * With `open: "monsters"`, the tab the building opens (§4.1, D4): Monster
   * Locker → Unlock, Hatchery and HCC → Hatch, Housing → Housing, Academy →
   * Train, Lab → Lab. Null otherwise.
   */
  readonly monstersTab: MonstersTabId | null;
  /** Why an Open button cannot be pressed (the Map Room below Town Hall 6). */
  readonly openBlocked: string | null;
  /** A walls-and-traps pointer to where they are upgraded instead. */
  readonly batch: boolean;
}

const ZERO: UpgradeCost = { r1: 0, r2: 0, r3: 0, r4: 0 };
const KEYS = ["r1", "r2", "r3", "r4"] as const;

const held = (resources: Resources, key: (typeof KEYS)[number]): number => {
  const value = Number(resources[key]);
  return Number.isFinite(value) ? value : 0;
};

/**
 * Whether the save counts this building as damaged: any health reading, the
 * repair flag, or a `buildinghealthdata` entry — the server's `isDamaged`,
 * not the art's half-health line.
 */
export const isDamaged = (building: YardBuilding, save: BaseLoadResponse): boolean =>
  building.hp !== null ||
  building.raw.rE === 1 ||
  (save.buildinghealthdata != null && String(building.id) in save.buildinghealthdata);

/** Walls and traps upgrade through the planner's batch routes. */
export const isBatchType = (type: number): boolean =>
  WALL_TYPES.includes(type) || TRAP_TYPES.includes(type);

/** Whether a type has a ladder the panel could climb at all. */
const hasLadder = (type: number): boolean =>
  !NO_LADDER_KINDS.has(kindOf(type)) && costOf(type, 0) !== null;

/** The node `ladderFor` reads: it looks at the type, the level, busy and damaged. */
const nodeOf = (building: YardBuilding, damaged: boolean): PlanNode => {
  const [width, height] = building.footprint;
  return {
    id: building.id,
    type: building.type,
    x: building.x,
    y: building.y,
    width,
    height,
    level: building.level,
    fort: building.fortification,
    decoration: false,
    fixed: false,
    stored: false,
    plan: null,
    busy: holdsWorker(building),
    damaged,
  };
};

/**
 * The next upgrade step and its gates, or null when the panel offers no
 * Upgrade for this building at all.
 */
export const upgradeOffer = (
  building: YardBuilding,
  context: PanelContext,
): UpgradeOffer | null => {
  const { type } = building;
  if (isBatchType(type) || type === MAP_ROOM_TYPE || !hasLadder(type)) return null;
  // A building on a job shows the job instead.
  if (building.countdown) return null;

  const damaged = isDamaged(building, context.save);
  const ladder = ladderFor(nodeOf(building, damaged), context.yard);
  const step = ladder.steps[0];
  const from = Math.max(building.level, 1);

  if (!step) {
    return {
      from,
      to: from,
      cost: ZERO,
      seconds: 0,
      instantPrice: 0,
      gate: { reason: "maxLevel", level: from },
      instantGate: { reason: "maxLevel", level: from },
    };
  }

  const seconds = Math.floor(
    step.cost.time * sharperToolsMultiplier(context.save.storedata, context.now()),
  );
  const cost: UpgradeCost = { r1: step.cost.r1, r2: step.cost.r2, r3: step.cost.r3, r4: step.cost.r4 };

  // The gates both buttons share, in the server's order.
  const hall = townHallLevel(context.yard);
  let common: UpgradeGate | null = null;
  if (damaged) common = { reason: "damaged" };
  else if (hall <= 0) common = { reason: "townHall", have: 0, need: 1 };
  else if (step.firstStepGated && step.gate) {
    common = step.gate.townHall
      ? { reason: "townHall", have: step.gate.townHall.have, need: step.gate.townHall.need }
      : { reason: "requirements", requirements: step.gate.requirements ?? [] };
  }

  let gate: UpgradeGate | null = common;
  if (!gate) {
    const shortfall = { ...ZERO };
    let short = false;
    let overCap = false;
    for (const key of KEYS) {
      const missing = cost[key] - held(context.resources, key);
      if (missing > 0) {
        shortfall[key] = missing;
        short = true;
        const cap = context.caps?.[key];
        if (typeof cap === "number" && cost[key] > cap) overCap = true;
      }
    }
    if (short) gate = { reason: "shortfall", shortfall, overCap };
    else if (freeWorkers(context) === 0) {
      gate = { reason: "workers", total: context.workers.total, busy: context.workers.busy };
    }
  }

  const instantGate: UpgradeGate | null =
    common ??
    (context.credits < step.shiny
      ? { reason: "credits", need: step.shiny - context.credits }
      : null);

  return {
    from,
    to: from + 1,
    cost,
    seconds,
    instantPrice: step.shiny,
    gate,
    instantGate,
  };
};

/** One speed-up's price and whether it can be pressed now. */
const speedup = (
  item: SpeedupItem,
  remaining: number,
  paused: boolean,
  credits: number,
): SpeedupOffer => {
  const seconds = Math.trunc(remaining);
  const price =
    item === "SP4" ? timeCost(seconds) : item === "SP1" ? 0 : SPEEDUP_PRICE[item];
  const allowed =
    item === "SP1"
      ? seconds > 0 && seconds <= FREE_FINISH_SECONDS
      : item === "SP4"
        ? seconds > FREE_FINISH_SECONDS
        : seconds >= SPEEDUP_SECONDS[item];
  const blocked = paused
    ? "paused"
    : !allowed
      ? "tooShort"
      : credits < price
        ? "credits"
        : null;
  return { item, price, blocked };
};

/**
 * What Cancel would give back: the full cost of the step that leaves the
 * building's level, clamped per resource to the storage cap exactly as the
 * server clamps it (`creditedOf`, `server/src/services/yard/upgrade.ts`). A
 * pool already over its cap takes nothing and loses nothing.
 */
export const cancelOffer = (building: YardBuilding, context: PanelContext): CancelOffer => {
  const step = costOf(building.type, building.level);
  const cost: UpgradeCost = step
    ? { r1: step[0], r2: step[1], r3: step[2], r4: step[3] }
    : { ...ZERO };
  const refund = { ...ZERO };
  const lost = { ...ZERO };
  for (const key of KEYS) {
    const have = held(context.resources, key);
    const cap = context.caps?.[key];
    const credited =
      typeof cap === "number" ? Math.max(have, Math.min(have + cost[key], cap)) - have : cost[key];
    refund[key] = credited;
    lost[key] = cost[key] - credited;
  }
  return { refund, lost };
};

/** The running countdown on a building, with its speed-ups and Cancel. */
export const jobOffer = (building: YardBuilding, context: PanelContext): JobOffer | null => {
  const countdown = building.countdown;
  if (!countdown) return null;

  const now = context.now();
  // The same reading as the bar over the building in the yard (#136, #139).
  const progress = countdownProgress(building, now);
  if (!progress) return null;
  const { remaining, total } = progress;
  const endsAt = countdown.paused ? now + remaining : countdown.endsAt;
  const speedable = countdown.kind === "build" || countdown.kind === "upgrade";
  const { credits } = context;
  const finishItem: SpeedupItem = Math.trunc(remaining) <= FREE_FINISH_SECONDS ? "SP1" : "SP4";

  return {
    kind: countdown.kind,
    to: countdown.kind === "build" ? 1 : building.level + 1,
    endsAt,
    remaining,
    total,
    paused: countdown.paused,
    finish: speedable ? speedup(finishItem, remaining, countdown.paused, credits) : null,
    minusOne: speedable ? speedup("SP2", remaining, countdown.paused, credits) : null,
    minusTwo: speedable ? speedup("SP3", remaining, countdown.paused, credits) : null,
    cancel: countdown.kind === "upgrade" ? cancelOffer(building, context) : null,
  };
};

/** Everything the own-yard panel shows for a building. */
export const panelModel = (building: YardBuilding, context: PanelContext): PanelModel => {
  const upgrade = upgradeOffer(building, context);
  const monstersTab = monstersTabFor(building.type);
  const open: OpenTarget | null =
    building.type === MAP_ROOM_TYPE
      ? "map"
      : building.type === YARD_PLANNER_TYPE
        ? "planner"
        : monstersTab
          ? "monsters"
          : null;
  const hall = townHallLevel(context.yard);
  return {
    upgrade: upgrade && upgrade.gate?.reason !== "maxLevel" ? upgrade : null,
    maxed: upgrade?.gate?.reason === "maxLevel",
    job: jobOffer(building, context),
    open,
    monstersTab,
    openBlocked:
      open === "map" && hall < MAP_TOWN_HALL
        ? `The world map opens at Town Hall ${MAP_TOWN_HALL}.`
        : null,
    batch: isBatchType(building.type),
  };
};
