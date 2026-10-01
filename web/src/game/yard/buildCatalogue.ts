import { guidePays } from "@/game/guide/steps";
import type { BaseLoadResponse, ResourceCaps, Resources, UpgradeCost } from "@/api/types";
import type { CostRequirement } from "./buildingCostData";
import {
  HALL_TYPES,
  instantCost,
  kindOf,
  requirementsMet,
  rowOf,
  townHallLevel,
  type YardKind,
} from "./buildingCosts";
import { storedCount, storedDecorations } from "./decorStorage";
import { isDecoration } from "./planner/placement";
import { overCap } from "./storage";
import { freeWorkers, sharperToolsMultiplier } from "./workers";
import type { Yard, YardWorkers } from "./yardModel";

/**
 * What the build menu offers and why a tile cannot be built, as data
 * (`docs/design/yard-buildings.md` §5.3, decisions D13 and D19).
 *
 * The menu draws; this decides. Every rule is the server's
 * (`server/src/services/yard/build.ts`), checked in the server's order, so the
 * one reason a tile shows is the one the build route would refuse with:
 *
 * 1. the Town Hall allows none of this type yet (`quantity[hall]` is 0);
 * 2. the yard already holds as many as the hall allows (`limit`);
 * 3. the build step's prerequisites, the Town Hall first;
 * 4. the resources — "Need more silos" when a cost is over its storage cap;
 * 5. a free worker, except for walls and traps, which finish at once (D13).
 *
 * Where the building goes is the last gate on the server, and it is the
 * placement's business (`BuildPlacement.ts`), not a tile's.
 *
 * The list is {@link BUILD_CATALOGUE}: the original build menu's types
 * (`client/scripts/BUILDINGSPOPUP.as:124`, props `group` 1 to 3 without
 * `block`) less the Radio (D15), the Inferno types (D19) and the Map Room 3
 * structures, in the original's `order` within each tab. The server's
 * `BUILDABLE_TYPES` is the same set; a test on each side pins it.
 *
 * An outpost's menu is {@link OUTPOST_BUILD_CATALOGUE}: the same tabs and order,
 * read against the outpost props table (`client/scripts/OUTPOST_YARD_PROPS.as`),
 * where the core (112) is the hall. Pass the yard's kind in the context.
 */

/**
 * The menu's tabs: the original's four (`BUILDINGSPOPUP.as:28-35`), with the
 * monster buildings under Buildings, where the props table's `group` files
 * them (#157). The Champion Cage and Chamber are `group` 3, Defensive, in the
 * props table; the owner moved them to Buildings, beside the monster
 * buildings (#159).
 */
export const BuildCategory = {
  RESOURCES: "resources",
  BUILDINGS: "buildings",
  DEFENSIVE: "defensive",
  DECORATIONS: "decorations",
} as const;
export type BuildCategory = (typeof BuildCategory)[keyof typeof BuildCategory];

export interface BuildCategoryDefinition {
  readonly id: BuildCategory;
  readonly label: string;
  /** Type ids, in the props table's `order` within the tab. */
  readonly types: readonly number[];
}

/**
 * Every tab and what it lists. Decorations are never built for resources:
 * the Decorations tab lists what is in storage instead (§8.3, #128;
 * {@link buildOffers}).
 */
export const BUILD_CATALOGUE: readonly BuildCategoryDefinition[] = [
  { id: BuildCategory.RESOURCES, label: "Resources", types: [1, 2, 3, 4, 6] },
  {
    id: BuildCategory.BUILDINGS,
    label: "Buildings",
    types: [12, 8, 26, 15, 13, 16, 114, 119, 5, 51, 11, 19, 116, 10, 9],
  },
  {
    id: BuildCategory.DEFENSIVE,
    label: "Defensive",
    types: [21, 20, 25, 23, 22, 115, 118, 24, 17, 117],
  },
  { id: BuildCategory.DECORATIONS, label: "Decorations", types: [] },
];

/** Every type the menu offers. */
export const BUILDABLE_TYPES: ReadonlySet<number> = new Set(
  BUILD_CATALOGUE.flatMap((category) => category.types),
);

/**
 * The outpost build menu: every type the outpost props table offers, which is
 * each entry in a menu tab, not `block`ed and allowed at core level 1
 * (`quantity[1]`, `client/scripts/OUTPOST_YARD_PROPS.as`; research §1.2).
 * The props `order` within each tab is the main table's, so the lists are the
 * main menu's with everything an outpost cannot hold taken out: the silo,
 * General Store, locker, academy, cage, chamber, catapult, Map Room, baiter and
 * lab, and every decoration.
 */
export const OUTPOST_BUILD_CATALOGUE: readonly BuildCategoryDefinition[] = [
  { id: BuildCategory.RESOURCES, label: "Resources", types: [1, 2, 3, 4] },
  // No Yard Planner (10): outposts get no Blueprint view, its one use now
  // that layout mode needs no building (owner decision 2026-09-30).
  { id: BuildCategory.BUILDINGS, label: "Buildings", types: [15, 13, 16, 5, 9] },
  {
    id: BuildCategory.DEFENSIVE,
    label: "Defensive",
    types: [21, 20, 25, 23, 22, 115, 118, 24, 17, 117],
  },
  { id: BuildCategory.DECORATIONS, label: "Decorations", types: [] },
];

/** Every type an outpost's menu offers. */
export const OUTPOST_BUILDABLE_TYPES: ReadonlySet<number> = new Set(
  OUTPOST_BUILD_CATALOGUE.flatMap((category) => category.types),
);

/** The menu of a yard of `kind`. */
export const catalogueFor = (kind: YardKind = "main"): readonly BuildCategoryDefinition[] =>
  kind === "outpost" ? OUTPOST_BUILD_CATALOGUE : BUILD_CATALOGUE;

/** Every type the menu of a yard of `kind` offers. */
export const buildableTypesFor = (kind: YardKind = "main"): ReadonlySet<number> =>
  kind === "outpost" ? OUTPOST_BUILDABLE_TYPES : BUILDABLE_TYPES;

/** Walls and traps are written finished and hold no worker (D13). */
export const buildsAtOnce = (type: number, kind: YardKind = "main"): boolean => {
  const props = kindOf(type, kind);
  return props === "wall" || props === "trap";
};

/** What a tile reads: the store, or anything shaped like its read side. */
export interface BuildContext {
  readonly yard: Yard;
  /** Which props table the yard builds from; the yard's own kind when absent. */
  readonly kind?: YardKind;
  readonly save: BaseLoadResponse;
  readonly resources: Resources;
  readonly credits: number;
  readonly caps: ResourceCaps | null;
  readonly workers: YardWorkers;
  now(): number;
}

/** Why a tile cannot be built (or bought outright), in the server's terms. */
export type BuildGate =
  | { readonly reason: "townHall"; readonly have: number; readonly need: number }
  | {
      readonly reason: "limit";
      readonly have: number;
      readonly allowed: number;
      /** The hall level that allows more, or null when none does. */
      readonly next: number | null;
    }
  | { readonly reason: "requirements"; readonly requirements: readonly CostRequirement[] }
  | {
      readonly reason: "shortfall";
      readonly shortfall: UpgradeCost;
      /** Some resource costs more than its storage cap: more silos, not more waiting. */
      readonly overCap: boolean;
    }
  | { readonly reason: "workers"; readonly total: number; readonly busy: number }
  | { readonly reason: "credits"; readonly need: number };

/**
 * Where a tile stands, which is also how the tab sorts (`SortBuildings`,
 * `BUILDINGSPOPUP.as:170-217`): what can be built first, then what is not
 * unlocked yet, then what the yard has all of for now, then what it has all
 * of for good.
 */
export type BuildStatus = "ready" | "locked" | "limit" | "maxed";

const STATUS_ORDER: Readonly<Record<BuildStatus, number>> = {
  ready: 0,
  locked: 1,
  limit: 2,
  maxed: 3,
};

/**
 * One line of the info panel's "Needs" list, ticked when the yard has it: the
 * Town Hall level the next one of this type needs, then the build step's
 * other prerequisites (`BUILDINGOPTIONSPOPUP.as:97-161`).
 */
export type BuildNeed =
  | { readonly kind: "townHall"; readonly level: number; readonly met: boolean }
  | {
      readonly kind: "building";
      readonly type: number;
      readonly count: number;
      readonly level: number;
      readonly met: boolean;
    };

/** One tile. */
export interface BuildOffer {
  readonly type: number;
  readonly category: BuildCategory;
  readonly cost: UpgradeCost;
  /** The countdown the server would write (table time × Sharper Tools); 0 for a wall or trap. */
  readonly seconds: number;
  /** Written finished, with no worker (a wall or trap). */
  readonly atOnce: boolean;
  /** How many the yard holds, those still being built included. */
  readonly owned: number;
  /** How many the Town Hall allows now. */
  readonly allowed: number;
  /** The most any Town Hall allows; owning this many earns the tick. */
  readonly most: number;
  readonly status: BuildStatus;
  readonly needs: readonly BuildNeed[];
  /** Shiny to have it finished the moment it is placed. */
  readonly instantPrice: number;
  /** Why Build is disabled; null when it can be placed. */
  readonly gate: BuildGate | null;
  /** Why Instant is disabled: the same gates minus resources and workers, plus Shiny. */
  readonly instantGate: BuildGate | null;
  /**
   * A decoration placed from storage (§8.3, #128): how many are stored. It is
   * free, finished at once and needs no worker; there is no instant, and
   * `owned`, `allowed` and `most` count nothing. Null for anything built.
   */
  readonly stored: number | null;
}

/**
 * The tile of a decoration in storage, or null when none is stored or the
 * yard is an outpost (storage is the main yard's, owner decision 2026-09-29).
 */
export const storageOffer = (type: number, context: BuildContext): BuildOffer | null => {
  if ((context.kind ?? context.yard.kind) === "outpost") return null;
  const stored = storedCount(context.save.researchdata, type);
  if (stored === 0) return null;
  return {
    type,
    category: BuildCategory.DECORATIONS,
    cost: { r1: 0, r2: 0, r3: 0, r4: 0 },
    seconds: 0,
    atOnce: true,
    owned: 0,
    allowed: 0,
    most: 0,
    status: "ready",
    needs: [],
    instantPrice: 0,
    gate: null,
    instantGate: null,
    stored,
  };
};

const KEYS = ["r1", "r2", "r3", "r4"] as const;

const held = (resources: Resources, key: (typeof KEYS)[number]): number => {
  const value = Number(resources[key]);
  return Number.isFinite(value) ? value : 0;
};

/** `quantity[hall]`, the last entry standing in for any hall past the end (`BASE.as:3717`). */
export const allowedAt = (quantity: readonly number[], hall: number): number => {
  if (quantity.length === 0) return 0;
  return quantity[Math.min(Math.max(hall, 0), quantity.length - 1)] ?? 0;
};

/** The first hall level above `hall` that allows more than `allowed`, or null. */
export const nextHallAllowing = (
  quantity: readonly number[],
  hall: number,
  allowed: number,
): number | null => {
  for (let level = hall + 1; level < quantity.length; level++) {
    if ((quantity[level] ?? 0) > allowed) return level;
  }
  return null;
};

/** The category a type is listed under, or null for a type the menu does not offer. */
export const categoryOf = (type: number, kind: YardKind = "main"): BuildCategory | null =>
  catalogueFor(kind).find((category) => category.types.includes(type))?.id ?? null;

/**
 * The tile for one type, or null for a type the menu does not offer or the
 * cost table cannot price.
 */
export const buildOffer = (type: number, context: BuildContext): BuildOffer | null => {
  if (isDecoration(type)) return storageOffer(type, context);
  const kind = context.kind ?? context.yard.kind;
  const category = categoryOf(type, kind);
  const row = rowOf(type, kind);
  const step = row?.[4][0];
  if (!category || !row || !step) return null;

  const quantity = row[5];
  const { yard } = context;
  const hall = townHallLevel(yard);
  const owned = yard.buildings.reduce((count, one) => count + (one.type === type ? 1 : 0), 0);
  const allowed = hall > 0 ? allowedAt(quantity, hall) : 0;
  const atOnce = buildsAtOnce(type, kind);
  const cost: UpgradeCost = { r1: step[0], r2: step[1], r3: step[2], r4: step[3] };

  // The gates Build and Instant share, in the server's order.
  let common: BuildGate | null = null;
  if (allowed <= 0) {
    common = {
      reason: "townHall",
      have: hall,
      need: hall <= 0 ? 1 : (nextHallAllowing(quantity, hall, 0) ?? hall + 1),
    };
  } else if (owned >= allowed) {
    common = { reason: "limit", have: owned, allowed, next: nextHallAllowing(quantity, hall, allowed) };
  } else if (!requirementsMet(step[5], yard)) {
    const unmet = step[5].filter((entry) => !requirementsMet([entry], yard));
    const townHall = unmet.find(([required]) => HALL_TYPES.includes(required));
    common = townHall
      ? { reason: "townHall", have: hall, need: townHall[2] }
      : { reason: "requirements", requirements: unmet };
  }

  // The guided start pays for its building at that building's build step: the
  // server tops the build up and checks the same rule (issue #227, §2.4).
  const guidePaid = guidePays(type, context.save.onboarding, kind);

  let gate: BuildGate | null = common;
  if (!gate) {
    const shortfall: UpgradeCost = { r1: 0, r2: 0, r3: 0, r4: 0 };
    let short = false;
    let over = false;
    for (const key of KEYS) {
      const missing = guidePaid ? 0 : cost[key] - held(context.resources, key);
      if (missing > 0) {
        shortfall[key] = missing;
        short = true;
        if (overCap(cost[key], context.caps?.[key])) over = true;
      }
    }
    if (short) gate = { reason: "shortfall", shortfall, overCap: over };
    else if (!atOnce && freeWorkers(context) === 0) {
      gate = { reason: "workers", total: context.workers.total, busy: context.workers.busy };
    }
  }

  const most = quantity.reduce((top, one) => Math.max(top, one), 0);
  // The hall the next one needs: the first that allows more than the yard
  // holds, or the build step's own hall requirement if that is higher.
  const stepHall = step[5].find(([required]) => HALL_TYPES.includes(required))?.[2] ?? 1;
  const hallNeed = Math.max(stepHall, nextHallAllowing(quantity, 0, owned) ?? stepHall);
  const needs: BuildNeed[] = [
    { kind: "townHall", level: hallNeed, met: hall >= hallNeed },
    ...step[5]
      .filter(([required]) => !HALL_TYPES.includes(required))
      .map(([required, count, level]): BuildNeed => ({
        kind: "building",
        type: required,
        count,
        level,
        met: requirementsMet([[required, count, level]], yard),
      })),
  ];

  let status: BuildStatus = "ready";
  if (most > 0 && owned >= most) status = "maxed";
  else if (owned > 0 && owned >= allowed) status = "limit";
  else if (owned === 0 && (common?.reason === "townHall" || common?.reason === "requirements")) {
    status = "locked";
  }

  const instantPrice = instantCost(step);
  const instantGate: BuildGate | null =
    common ??
    (context.credits < instantPrice ? { reason: "credits", need: instantPrice - context.credits } : null);

  return {
    type,
    category,
    cost,
    seconds: atOnce
      ? 0
      : Math.floor(step[4] * sharperToolsMultiplier(context.save.storedata, context.now())),
    atOnce,
    owned,
    allowed,
    most,
    status,
    needs,
    instantPrice,
    gate,
    instantGate,
    stored: null,
  };
};

/** Every tile of a tab, in the tab's order. */
export const buildOffers = (category: BuildCategory, context: BuildContext): BuildOffer[] => {
  if (category === BuildCategory.DECORATIONS) {
    return storedDecorations(context.save.researchdata)
      .map((one) => storageOffer(one.type, context))
      .filter((offer): offer is BuildOffer => offer !== null);
  }
  const tab = catalogueFor(context.kind ?? context.yard.kind).find((entry) => entry.id === category);
  return (tab?.types ?? [])
    .map((type) => buildOffer(type, context))
    .filter((offer): offer is BuildOffer => offer !== null);
};

/** Tiles by {@link BuildStatus}, the tab's order within each (the sort is stable). */
export const sortOffers = (offers: readonly BuildOffer[]): BuildOffer[] =>
  [...offers].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

/** Tiles on a page: the original's 5 across by 2 down (`BUILDINGSPOPUP.as:133-167`). */
export const BUILD_PAGE_SIZE = 10;

/** How many pages a tab of `count` tiles takes; an empty tab is still one page. */
export const pageCount = (count: number): number =>
  Math.max(1, Math.ceil(count / BUILD_PAGE_SIZE));

/** The tiles on page `page` (from 0), the page clamped into range. */
export const pageOf = <T>(items: readonly T[], page: number): T[] => {
  const last = pageCount(items.length) - 1;
  const index = Math.min(Math.max(page, 0), last);
  return items.slice(index * BUILD_PAGE_SIZE, (index + 1) * BUILD_PAGE_SIZE);
};
