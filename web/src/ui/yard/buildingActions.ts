import type { BaseLoadResponse, ResourceCaps, Resources, SpeedupItem, UpgradeCost } from "@/api/types";
import type { CostRequirement } from "@/game/yard/buildingCostData";
import {
  costOf,
  fortifyStepsOf,
  FREE_FINISH_SECONDS,
  HALL_TYPES,
  kindOf,
  requirementsMet,
  TRAP_TYPES,
  timeCost,
  townHallLevel,
  WALL_TYPES,
} from "@/game/yard/buildingCosts";
import { YARD_PLANNER_TYPE } from "@/game/yard/planner/access";
import type { PlanNode } from "@/game/yard/planner/placement";
import { ACADEMY_TYPE, LAB_TYPE, countdownProgress } from "@/game/yard/jobs";
import { recycleOffer, type RecycleOffer } from "@/game/yard/recycle";
import { ladderFor } from "@/game/yard/planner/upgrades";
import { overCap as overCapOf } from "@/game/yard/storage";
import { freeWorkers, holdsWorker, sharperToolsMultiplier } from "@/game/yard/workers";
import type { Yard, YardBuilding, YardWorkers } from "@/game/yard/yardModel";
import { BUNKER_TYPE } from "@/game/monsters/bunker";
import { researchOn } from "@/game/monsters/lab";
import { CHAMPION_CAGE_TYPE, CHAMPION_CHAMBER_TYPE } from "@/game/yard/championModel";
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
 *
 * ## Outposts
 *
 * On an outpost (`yard.kind`) prices and level caps are the outpost table's,
 * and Flash's two refusals are left out rather than offered and refused: no
 * Recycle, and no Cancel on a building still under construction
 * (`client/scripts/BFOUNDATION.as:2511-2540`; the server's `notInOutpost`).
 * Cancelling an upgrade stays, as it did in Flash.
 */

/** The props kinds with no upgrade ladder the panel could offer. */
const NO_LADDER_KINDS: ReadonlySet<string> = new Set(["decoration", "mushroom", "taunt", ""]);

/**
 * The Map Room. Its level is the map version, capped at 2 (D16): its one step
 * here, L1 to L2, is the move to Map Room 2, which the server finishes by
 * putting the yard in a world (`server/src/services/yard/mapRoom.ts`). No
 * Shiny rushes it: no Instant, no speed-ups (the routes refuse `mapRoom`).
 */
export const MAP_ROOM_TYPE = 11;

/** The Map Room level that is Map Room 2. */
export const MAP_ROOM_2_LEVEL = 2;

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
  /** An Academy training a monster (`acad_err_cantupgrade`, #145). */
  | { readonly reason: "training" }
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
  /** Whether Instant is offered at all: not on the Map Room. */
  readonly instant: boolean;
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

/**
 * The next fortification of an outpost's core or tower (#191): `F{from}` to
 * `F{to}` of `max`, its price and countdown, and the one reason it cannot
 * start, in the server's order (`server/src/services/yard/fortify.ts`:
 * damaged, no core, requirements, resources, the worker). `maxed` when the
 * building is fully fortified (`bdg_fullyfortified`).
 */
export interface FortifyOffer {
  readonly from: number;
  readonly to: number;
  readonly max: number;
  readonly cost: UpgradeCost;
  /** The countdown the server would write: the step's time × Sharper Tools. */
  readonly seconds: number;
  readonly gate: UpgradeGate | null;
  readonly maxed: boolean;
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
  /**
   * Upgrades and builds: the refund Cancel would give, capped as the server
   * caps it. Null on an outpost's build, which cannot be stopped.
   */
  readonly cancel: CancelOffer | null;
}

export interface CancelOffer {
  /** What comes back: the step's full cost, less what the storage cap turns away. */
  readonly refund: UpgradeCost;
  /** What the cap turns away; all zero when everything fits. */
  readonly lost: UpgradeCost;
}

/**
 * Which door a building opens: the world map, the layout planner, the
 * Monsters screen, a bunker's controls, or the Champion Cage's or Chamber's.
 */
export type OpenTarget = "map" | "planner" | "monsters" | "bunker" | "cage" | "chamber";

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
  /**
   * Recycle, with what it gives back and why it cannot run; null for the Town
   * Hall (§5.4) and on an outpost, where nothing is recycled.
   */
  readonly recycle: RecycleOffer | null;
  /** Fortify, on an outpost's core and towers only; null elsewhere and while a job runs. */
  readonly fortify: FortifyOffer | null;
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
  if (isBatchType(type) || !hasLadder(type)) return null;
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
      instant: type !== MAP_ROOM_TYPE,
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
  // The Lab is not upgraded while it researches (`MONSTERLAB.as:241-247`; the server's `isBusy`).
  if (building.type === LAB_TYPE && researchOn(building)) common = { reason: "busy" };
  // Nor the Academy while it trains (`BUILDING26.as:85-91`; the server's `409 training`, #145).
  else if (building.type === ACADEMY_TYPE && building.raw["upg"]) common = { reason: "training" };
  else if (damaged) common = { reason: "damaged" };
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
        if (overCapOf(cost[key], context.caps?.[key])) overCap = true;
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
    instant: type !== MAP_ROOM_TYPE,
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
  // A fortification gives back the step that leaves its tier (`FortifyCancelC`,
  // `client/scripts/BFOUNDATION.as:2227-2246`); a build or upgrade its level's.
  const step =
    building.countdown?.kind === "fortify"
      ? fortifyStepsOf(building.type, context.yard.kind)[building.fortification]
      : costOf(building.type, building.level, context.yard.kind);
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
  const progress = countdownProgress(building, now, context.yard.kind);
  if (!progress) return null;
  const { remaining, total } = progress;
  const endsAt = countdown.paused ? now + remaining : countdown.endsAt;
  // An outpost's fortification speeds up as a build does (`ui_fortifying`,
  // "Speed up to finish"; the server's `speedup` takes a `cF` on an outpost).
  const speedable =
    (countdown.kind === "build" ||
      countdown.kind === "upgrade" ||
      (countdown.kind === "fortify" && context.yard.kind === "outpost")) &&
    building.type !== MAP_ROOM_TYPE;
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
    // A build still running is at level 0, so this is `costs[0]`: the build's
    // full price, which `build/cancel` gives back (§5.3).
    cancel:
      countdown.kind === "upgrade" ||
      (countdown.kind === "fortify" && context.yard.kind === "outpost") ||
      (countdown.kind === "build" && context.yard.kind !== "outpost")
        ? cancelOffer(building, context)
        : null,
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
          : building.type === BUNKER_TYPE && building.level > 0
            ? "bunker"
            : building.type === CHAMPION_CAGE_TYPE && building.level > 0
              ? "cage"
              : building.type === CHAMPION_CHAMBER_TYPE && building.level > 0
                ? "chamber"
                : null;
  return {
    upgrade: upgrade && upgrade.gate?.reason !== "maxLevel" ? upgrade : null,
    maxed: upgrade?.gate?.reason === "maxLevel",
    job: jobOffer(building, context),
    open,
    monstersTab,
    openBlocked: open === "map" ? mapBlocked(building, context) : null,
    batch: isBatchType(building.type),
    recycle:
      building.type === TOWN_HALL_TYPE || context.yard.kind === "outpost"
        ? null
        : recycleOfferFor(building, context),
    fortify: fortifyOffer(building, context),
  };
};

/**
 * The Fortify offer for a building (see {@link FortifyOffer}), or null: not an
 * outpost, no fortify ladder for the type (`can_fortify`, `FortifyCost`,
 * `client/scripts/BFOUNDATION.as:2702-2708`), or a job already running,
 * which its own block shows.
 */
export const fortifyOffer = (building: YardBuilding, context: PanelContext): FortifyOffer | null => {
  if (context.yard.kind !== "outpost" || building.countdown) return null;
  const ladder = fortifyStepsOf(building.type, "outpost");
  if (ladder.length === 0) return null;

  const from = building.fortification;
  const step = ladder[from];
  if (!step) {
    return { from, to: from, max: ladder.length, cost: ZERO, seconds: 0, gate: null, maxed: true };
  }

  const cost: UpgradeCost = { r1: step[0], r2: step[1], r3: step[2], r4: step[3] };
  const seconds = Math.floor(step[4] * sharperToolsMultiplier(context.save.storedata, context.now()));
  const hall = townHallLevel(context.yard);

  let gate: UpgradeGate | null = null;
  if (isDamaged(building, context.save)) gate = { reason: "damaged" };
  else if (hall <= 0) gate = { reason: "townHall", have: 0, need: 1 };
  else if (!requirementsMet(step[5], context.yard)) {
    const unmet = step[5].filter((entry) => !requirementsMet([entry], context.yard));
    const core = unmet.find(([type]) => HALL_TYPES.includes(type));
    gate = core
      ? { reason: "townHall", have: hall, need: core[2] }
      : { reason: "requirements", requirements: unmet };
  } else {
    const shortfall = { ...ZERO };
    let short = false;
    let overCap = false;
    for (const key of KEYS) {
      const missing = cost[key] - held(context.resources, key);
      if (missing > 0) {
        shortfall[key] = missing;
        short = true;
        if (overCapOf(cost[key], context.caps?.[key])) overCap = true;
      }
    }
    if (short) gate = { reason: "shortfall", shortfall, overCap };
    else if (freeWorkers(context) === 0) {
      gate = { reason: "workers", total: context.workers.total, busy: context.workers.busy };
    }
  }

  return { from, to: from + 1, max: ladder.length, cost, seconds, gate, maxed: false };
};

/**
 * Whether the player is on Map Room 2: the server's `mr2upgraded` flag (a
 * player who moved before the Map Room carried the map version), or a level 2
 * Map Room standing in the yard, which the server turns into the same thing
 * when it finishes (D16, §5.7).
 */
export const hasMapRoom2 = (context: Pick<PanelContext, "yard" | "save">): boolean =>
  Boolean(Number(context.save.flags?.["mr2upgraded"])) ||
  context.yard.buildings.some((one) => one.type === MAP_ROOM_TYPE && one.level >= MAP_ROOM_2_LEVEL);

/**
 * Why Open map cannot be pressed, or null. A built Map Room opens its map:
 * Map Room 2 once the player has moved, Map Room 1 before (issue #162). Only
 * a Map Room still on its first build has no map yet.
 */
const mapBlocked = (building: YardBuilding, context: PanelContext): string | null => {
  if (hasMapRoom2(context) || building.level >= 1) return null;
  return "The map opens when the Map Room is built.";
};

/** The Town Hall is never recycled, so the panel does not offer it. */
const TOWN_HALL_TYPE = 14;

const recycleOfferFor = (building: YardBuilding, context: PanelContext): RecycleOffer =>
  recycleOffer(
    { ...building.raw, id: building.id },
    context.save,
    context.resources,
    context.caps,
    context.now(),
  );
