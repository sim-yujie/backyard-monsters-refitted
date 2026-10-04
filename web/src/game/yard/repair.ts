import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHp } from "@/game/combat/rules";
import { FREE_FINISH_SECONDS, timeCost } from "./buildingCosts";
import { REPAIR_CAP_SECONDS, repairTimeOf } from "./repairTimeData";

/**
 * Repairs on the client (`docs/design/yard-buildings.md` §5.5): which buildings
 * are damaged, how fast a repair heals, where a running repair stands now, and
 * the Shiny price of Repair now (`FIX`).
 *
 * The server's arithmetic, for display (`server/src/services/yard/repair.ts`,
 * `catchUpRepairs.ts`): a repairing building heals
 * `ceil(max / min(3600, repairTime[l − 1]))` health a second from `savetime`
 * (`client/scripts/BFOUNDATION.as:1367-1370`), so no repair takes more than an
 * hour; `FIX` costs `timeCost(sum of repair seconds over 300) + 10 × how many`
 * over every damaged building (`client/scripts/STORE.as:381-395`). Health is
 * read the way the server reads it: `buildinghealthdata[id]` first, then the
 * building's own `hp`, and the maximum from the combat table the server uses.
 * The route always prices and heals by its own figures.
 */

/** One damaged building, as the save stands at `savetime`. */
export interface Damage {
  readonly id: number;
  readonly type: number;
  /** Health at `savetime`, below {@link max}. */
  readonly health: number;
  readonly max: number;
  /** Health a second while repairing. */
  readonly rate: number;
  /** `rE` is set: it heals from `savetime`. */
  readonly repairing: boolean;
}

/** A damaged building at one moment. */
export interface RepairNow extends Damage {
  /** Health now: {@link Damage.health} plus what a running repair has healed since `savetime`. */
  readonly now: number;
  /** Seconds until full health were it repairing from now. */
  readonly secondsLeft: number;
  /** Unix seconds a running repair reaches full health; null while not repairing. */
  readonly endsAt: number | null;
}

const finite = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/** Absent `l` is 1; a running build is 0 (the server's `levelOf`). */
const levelOf = (building: BuildingData): number => {
  if (typeof building.cB === "number" && building.cB > 0) return 0;
  const level = Number(building.l);
  return Number.isFinite(level) && level > 0 ? level : 1;
};

/** `ceil(max / min(3600, repairTime[l − 1]))`, at least 1. */
export const repairRate = (type: number, level: number, max: number): number =>
  Math.max(1, Math.ceil(max / Math.max(1, Math.min(REPAIR_CAP_SECONDS, repairTimeOf(type, level)))));

/** The save's clock for relative timers: `savetime`, or the server's time for a yard never saved. */
const savedAtOf = (save: Pick<BaseLoadResponse, "savetime" | "currenttime">): number =>
  typeof save.savetime === "number" && save.savetime > 0 ? save.savetime : save.currenttime;

/** A building's damage as saved, or null at full health. */
export const damageOf = (
  building: BuildingData,
  save: Pick<BaseLoadResponse, "buildinghealthdata">,
  key: string = String(building.id),
): Damage | null => {
  const id = typeof building.id === "number" ? building.id : Number(key);
  const health = finite(save.buildinghealthdata?.[String(id)]) ?? finite(building.hp);
  if (health === undefined) return null;
  const level = levelOf(building);
  const max = maxHp(building.t, level);
  if (!(max > 0) || health >= max) return null;
  return {
    id,
    type: building.t,
    health: Math.max(0, Math.floor(health)),
    max,
    rate: repairRate(building.t, level, max),
    repairing: Boolean(building.rE),
  };
};

/** A damage record carried to `now`. */
export const repairAt = (
  damage: Damage,
  save: Pick<BaseLoadResponse, "savetime" | "currenttime">,
  now: number,
): RepairNow => {
  const savedAt = savedAtOf(save);
  const healed = damage.repairing ? damage.rate * Math.max(0, Math.floor(now - savedAt)) : 0;
  const health = Math.min(damage.max, damage.health + healed);
  return {
    ...damage,
    now: health,
    secondsLeft: Math.ceil((damage.max - health) / damage.rate),
    endsAt: damage.repairing
      ? savedAt + Math.ceil((damage.max - damage.health) / damage.rate)
      : null,
  };
};

/** Every damaged building at `now`, in id order; a repair already done by then is left out. */
export const damagedAt = (
  save: Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "savetime" | "currenttime">,
  now: number,
): RepairNow[] =>
  Object.entries(save.buildingdata ?? {})
    .flatMap(([key, building]) => {
      if (!building || typeof building.t !== "number") return [];
      const damage = damageOf(building, save, key);
      if (!damage) return [];
      const at = repairAt(damage, save, now);
      return at.now < at.max ? [at] : [];
    })
    .sort((a, b) => a.id - b.id);

/** How many buildings are damaged and not being repaired: what the post-attack banner counts. */
export const unrepairedCount = (
  save: Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "savetime" | "currenttime">,
  now: number,
): number => damagedAt(save, now).filter((damage) => !damage.repairing).length;

/**
 * Repair now's price: `timeCost(sum of the repair seconds over 300) + 10 × how
 * many of those`, each building's seconds `int((max − health) / rate)`
 * (`server/src/services/yard/shiny.ts` `repairAllPrice`).
 */
export const repairNowPrice = (damaged: readonly RepairNow[]): number => {
  const long = damaged
    .map((damage) => Math.trunc((damage.max - damage.now) / damage.rate))
    .filter((seconds) => seconds > FREE_FINISH_SECONDS);
  return timeCost(long.reduce((sum, seconds) => sum + seconds, 0)) + 10 * long.length;
};

/**
 * Whether a repair can be finished free now (#279): it is running and has
 * {@link FREE_FINISH_SECONDS} or less left. The server counts the seconds as
 * `int((max − health) / rate)`, never more than {@link RepairNow.secondsLeft},
 * so a repair this lets through is one the server takes too.
 */
export const canFinishFree = (damage: RepairNow): boolean =>
  damage.repairing && damage.secondsLeft <= FREE_FINISH_SECONDS;

/** What the building panel offers for one damaged building. */
export interface RepairOffer {
  /** This building's damage, now. */
  readonly damage: RepairNow;
  /** Finish free is on offer: see {@link canFinishFree}. */
  readonly finishFree: boolean;
  /** Repair now's price: every damaged building in the yard, not just this one. */
  readonly nowPrice: number;
  /** How many buildings Repair now heals. */
  readonly nowCount: number;
  /** Why Repair now cannot be pressed. */
  readonly nowBlocked: "credits" | null;
}

/** The repair block for a building, or null when it is not damaged. */
export const repairOffer = (
  id: number,
  save: Pick<BaseLoadResponse, "buildingdata" | "buildinghealthdata" | "savetime" | "currenttime">,
  credits: number,
  now: number,
): RepairOffer | null => {
  const damaged = damagedAt(save, now);
  const damage = damaged.find((one) => one.id === id);
  if (!damage) return null;
  const nowPrice = repairNowPrice(damaged);
  return {
    damage,
    finishFree: canFinishFree(damage),
    nowPrice,
    nowCount: damaged.length,
    nowBlocked: credits < nowPrice ? "credits" : null,
  };
};
