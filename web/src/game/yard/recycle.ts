import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources, UpgradeCost } from "@/api/types";
import { BUNKER_TYPE, bunkerContents } from "@/game/monsters/bunker";
import { academyLevel, housingCapacity, HOUSING_TYPE } from "@/game/monsters/housing";
import { housingSpace } from "@/game/monsters/monsterCatalogue";
import { kindOf, rowOf, sumCosts, upgradeSteps } from "./buildingCosts";

/**
 * Recycling on the client (`docs/design/yard-buildings.md` §5.4): whether a
 * building may be recycled now, what would come back, and the monsters it
 * takes with it (the cull recycling a Housing building would run, or a Monster
 * Bunker's contents), for the one confirmation the panel shows.
 *
 * The server's rules, for display (`server/src/services/yard/recycle.ts`):
 * half of every level's cost paid, floored per resource, under the storage cap
 * the yard has without the building; a decoration into storage, a taunt sign
 * for nothing; refused for the Town Hall, the Map Room, a building on a job, a
 * Champion Cage with its champion, a Chamber with frozen champions, a Lab
 * researching, an Academy training, a Hatchery with production or a queue (or
 * an HCC with a queue), and the Locker while an unlock runs. The route decides
 * with its own figures; its report says what actually came back.
 */

/** Why a building cannot be recycled now: the server's `reason` and its sentence. */
export interface RecycleBlock {
  readonly reason: string;
  readonly message: string;
}

/** What recycling a building would do. */
export interface RecycleOffer {
  /** Null when it can be recycled now. */
  readonly blocked: RecycleBlock | null;
  /** A decoration: it goes into storage, nothing comes back. */
  readonly toStorage: boolean;
  /** What would come back, after the storage cap. */
  readonly refund: UpgradeCost;
  /** What the storage cap would turn away. */
  readonly lost: UpgradeCost;
  /** Monsters the Housing cull would remove, per type; empty when none. */
  readonly culled: Readonly<Record<string, number>>;
  /**
   * A Monster Bunker's contents, per type: they go with the bunker, as in the
   * original (`client/scripts/BUILDING22.as:547-551`; the server deletes the
   * entry and its `m`). Empty for anything else, or an empty bunker.
   */
  readonly bunkered: Readonly<Record<string, number>>;
}

const TOWN_HALL_TYPE = 14;
const MAP_ROOM_TYPE = 11;
const LOCKER_TYPE = 8;
const HATCHERY_TYPE = 13;
const HCC_TYPE = 16;
const ACADEMY_TYPE = 26;
const LAB_TYPE = 116;
const CHAMPION_CAGE_TYPE = 114;
const CHAMPION_CHAMBER_TYPE = 119;
const SILO_TYPE = 6;
/** The legacy Stone Block prices as a level 2 or higher wall (`pricingLevel`, server). */
const LEGACY_WALL_TYPE = 18;
const WALL_TYPE = 17;
/** The pool before silos (`client/scripts/BASE.as:4720-4723`). */
const BASE_STORAGE = 10_000;

const KEYS = ["r1", "r2", "r3", "r4"] as const;
const ZERO: UpgradeCost = { r1: 0, r2: 0, r3: 0, r4: 0 };

const levelOf = (building: BuildingData): number => {
  if (typeof building.cB === "number" && building.cB > 0) return 0;
  const level = Number(building.l);
  return Number.isFinite(level) && level > 0 ? level : 1;
};

/** Half of every level paid, floored; all of `costs[0]` for a building still at level 0. */
export const recycleRefund = (building: BuildingData): UpgradeCost => {
  const legacy = building.t === LEGACY_WALL_TYPE;
  const type = legacy ? WALL_TYPE : building.t;
  const kind = kindOf(type);
  if (kind === "decoration" || kind === "taunt" || kind === "gift") return { ...ZERO };
  const raw = levelOf(building);
  if (raw <= 0) {
    const first = sumCosts(upgradeSteps(type, 0, 1));
    return { r1: first.r1, r2: first.r2, r3: first.r3, r4: first.r4 };
  }
  const level = legacy ? Math.max(raw, 2) : raw;
  const paid = sumCosts(upgradeSteps(type, 0, level));
  return {
    r1: Math.floor(paid.r1 * 0.5),
    r2: Math.floor(paid.r2 * 0.5),
    r3: Math.floor(paid.r3 * 0.5),
    r4: Math.floor(paid.r4 * 0.5),
  };
};

/** The cap once this building is gone: smaller only for a Storage Silo. */
const capWithout = (
  save: Pick<BaseLoadResponse, "buildingdata" | "storedata">,
  cap: number,
  building: BuildingData,
): number => {
  if (building.t !== SILO_TYPE) return cap;
  const capacity = rowOf(SILO_TYPE)?.[6]?.capacity ?? [];
  const siloAt = (one: BuildingData): number => {
    const level = levelOf(one);
    return level > 0 ? (capacity[level - 1] ?? 0) : 0;
  };
  let pool = BASE_STORAGE;
  for (const one of Object.values(save.buildingdata ?? {})) {
    if (one?.t === SILO_TYPE) pool += siloAt(one);
  }
  const bought = Math.max(0, Number(save.storedata?.["BIP"]?.q) || 0);
  const packing = Math.trunc((1 + 0.1 * bought) * 100) / 100;
  return cap - (Math.floor(pool * packing) - Math.floor((pool - siloAt(building)) * packing));
};

/** The champion roster as an array, whatever shape the save holds. */
const championsOf = (raw: unknown): Record<string, unknown>[] => {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value.filter((one) => one && typeof one === "object") : [];
};

/** A hatchery's `h` entry, and whether anything is in production or queued in it. */
const hatcheryBusy = (save: BaseLoadResponse, id: number): boolean => {
  const hid = save.monsters?.hid ?? [];
  const index = hid.findIndex((one) => Number(one) === id);
  if (index < 0) return false;
  const entry = save.monsters?.h?.[index];
  if (!Array.isArray(entry)) return false;
  const monster = entry[0];
  const queue = entry[2];
  return (
    (typeof monster === "string" && monster !== "") ||
    (Array.isArray(queue) && queue.some((stack) => Array.isArray(stack) && Number(stack[1]) > 0))
  );
};

/** The first rule that stops this building being recycled now, or null. */
export const recycleBlock = (
  building: BuildingData,
  save: BaseLoadResponse,
  now: number,
): RecycleBlock | null => {
  const type = building.t;
  const id = building.id;
  if (type === TOWN_HALL_TYPE) return { reason: "isTownHall", message: "The Town Hall cannot be recycled." };
  if (type === MAP_ROOM_TYPE) {
    return { reason: "mapRoom", message: "The Map Room cannot be recycled: its level is your map." };
  }
  if (building.cB || building.cU || building.cF) {
    return { reason: "busy", message: "Finish or cancel this building's job first." };
  }
  const champions = championsOf(save.champion);
  if (type === CHAMPION_CAGE_TYPE && champions.some((one) => Number(one["status"] ?? 0) === 0)) {
    return { reason: "championInCage", message: "Your champion lives in this cage." };
  }
  if (
    type === CHAMPION_CHAMBER_TYPE &&
    (championsOf(building["fz"]).length > 0 || champions.some((one) => Number(one["status"]) === 1))
  ) {
    return { reason: "championsFrozen", message: "Thaw the champions in this chamber first." };
  }
  if (type === LAB_TYPE && (building["upg"] || Number(building["upt"]) > now)) {
    return { reason: "researching", message: "The Lab is researching. Cancel the research first." };
  }
  if (type === ACADEMY_TYPE) {
    const academies = Object.values(save.buildingdata ?? {}).filter((one) => one?.t === ACADEMY_TYPE);
    const training =
      academies.length === 1 &&
      Object.values(save.academy ?? {}).some((entry) => Number(entry?.time) > now);
    if (building["upg"] || training) {
      return { reason: "training", message: "The Academy is training. Cancel the training first." };
    }
  }
  if (type === HATCHERY_TYPE && hatcheryBusy(save, id)) {
    return { reason: "hatcheryBusy", message: "Take the monsters out of this hatchery first." };
  }
  if (type === HCC_TYPE) {
    const queue = save.monsters?.hcc ?? [];
    if (Array.isArray(queue) && queue.some((stack) => Array.isArray(stack) && Number(stack[1]) > 0)) {
      return { reason: "hatcheryBusy", message: "Take the monsters out of the queue first." };
    }
  }
  if (
    type === LOCKER_TYPE &&
    Object.entries(save.lockerdata ?? {}).some(
      ([monster, entry]) => monster.startsWith("C") && Number(entry?.t) === 1,
    )
  ) {
    return { reason: "unlocking", message: "Cancel the unlock first." };
  }
  return null;
};

/**
 * The cull removing Housing building `id` would run (`HOUSING.Cull()`,
 * `client/scripts/HOUSING.as:161-199`): while the army takes more room than
 * there is, one of every type still housed goes.
 */
export const housingCullPreview = (
  save: BaseLoadResponse,
  id: number,
  now: number,
): Record<string, number> => {
  const { [String(id)]: _gone, ...rest } = save.buildingdata ?? {};
  const capacity = housingCapacity({ ...save, buildingdata: rest }, now);
  const kept: Record<string, number> = {};
  for (const [monster, raw] of Object.entries(save.monsters?.housed ?? {})) {
    const count = Math.floor(Number(raw));
    if (Number.isFinite(count) && count > 0) kept[monster] = count;
  }
  const space = (monster: string): number => housingSpace(monster, academyLevel(save.academy, monster)) ?? 0;
  const used = (): number =>
    Object.entries(kept).reduce((total, [monster, count]) => total + space(monster) * count, 0);

  const culled: Record<string, number> = {};
  while (used() > capacity) {
    const left = Object.keys(kept).filter((monster) => (kept[monster] ?? 0) > 0);
    if (left.length === 0) break;
    for (const monster of left) {
      kept[monster] = (kept[monster] ?? 0) - 1;
      culled[monster] = (culled[monster] ?? 0) + 1;
      if (kept[monster] === 0) delete kept[monster];
    }
  }
  return culled;
};

/** Everything the panel's Recycle control needs for one building. */
export const recycleOffer = (
  building: BuildingData,
  save: BaseLoadResponse,
  resources: Resources,
  caps: ResourceCaps | null,
  now: number,
): RecycleOffer => {
  const blocked = recycleBlock(building, save, now);
  const owed = recycleRefund(building);
  const refund = { ...ZERO };
  const lost = { ...ZERO };
  for (const key of KEYS) {
    const have = Number(resources[key]) || 0;
    const cap = caps?.[key];
    const room = typeof cap === "number" ? capWithout(save, cap, building) : undefined;
    const credited =
      room === undefined ? owed[key] : Math.max(have, Math.min(have + owed[key], room)) - have;
    refund[key] = credited;
    lost[key] = owed[key] - credited;
  }
  return {
    blocked,
    toStorage: kindOf(building.t) === "decoration",
    refund,
    lost,
    culled: building.t === HOUSING_TYPE && !blocked ? housingCullPreview(save, building.id, now) : {},
    bunkered: building.t === BUNKER_TYPE && !blocked ? bunkerContents(building) : {},
  };
};
