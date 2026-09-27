import type { BaseLoadResponse, BuildingData } from "@/api/types";
import { maxHealth } from "./buildingArt";
import { rowOf } from "./buildingCosts";
import { savedAtOf } from "./jobs";

/**
 * What the player's harvesters hold right now, predicted between server answers
 * (`docs/design/yard-buildings.md` §5.1).
 *
 * The server fills every buffer in its catch-up and is the only one that banks
 * (`server/src/services/yard/catchUpHarvesters.ts`, `bank.ts`); this is the
 * same arithmetic run forward from `savetime` so the HUD's Collect all total
 * and a tap on a harvester can say what is waiting without asking. It mirrors
 * `server/src/services/base/economy/production.ts` rule for rule:
 *
 * - a cycle adds `produce[l−1]` after `cycleTime + ceil(cycleTime × (4 − 4 ×
 *   health / max))` seconds, up to `capacity[l−1]`, and stops when full
 *   (`client/scripts/BRESOURCE.as:305-333`, `:384-386`);
 * - `cP` is what is left of the running cycle; an idle harvester with room
 *   starts a fresh one at `savetime`;
 * - nothing while a build, upgrade or fortify runs, nothing below half health
 *   (`:301-302`);
 * - the Production Overdrive (`storedata.POD`) doubles `produce` until its `e`.
 *
 * Collect all takes what the original's Bank all took
 * (`client/scripts/BUILDINGINFO.as:458-466`): built, no countdown, full
 * health, something held. A tap banks any harvester with no countdown.
 */

/** Twig Snapper to Goo Factory; type id = resource index. */
export const HARVESTER_TYPES: ReadonlySet<number> = new Set([1, 2, 3, 4]);

export const isHarvester = (type: number): boolean => HARVESTER_TYPES.has(type);

/** The resource a harvester fills: type 1 fills `r1`, and so on. */
export type HarvestKey = "r1" | "r2" | "r3" | "r4";

/** The Production Overdrive's store code and power (`client/scripts/STORE.as:2413-2418`). */
const OVERDRIVE_ITEM = "POD";
const OVERDRIVE_POWER = 2;

/** One harvester as it stands now. */
export interface HarvesterNow {
  readonly id: number;
  readonly resource: HarvestKey;
  /** What the buffer holds now, whole units. */
  readonly stored: number;
  readonly capacity: number;
  /** What a bank would offer: `min(stored, capacity)`. */
  readonly offer: number;
  /** A tap may bank it: built, no countdown running. */
  readonly bankable: boolean;
  /** Collect all takes it: bankable, at full health and holding something. */
  readonly collectable: boolean;
}

/** Everything waiting in the yard's harvesters. */
export interface HarvestWaiting {
  /** What Collect all would offer, per resource. */
  readonly amounts: Readonly<Record<HarvestKey, number>>;
  readonly total: number;
  /** The harvesters Collect all would bank, in id order. */
  readonly ids: readonly number[];
}

interface Buffer {
  stored: number;
  countdown: number | null;
}

interface Rates {
  produce: number;
  cycle: number;
  capacity: number;
}

const finite = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

const at = (ladder: readonly number[] | undefined, level: number): number => {
  if (!ladder || ladder.length === 0) return 0;
  return ladder[Math.min(Math.max(Math.trunc(level), 1), ladder.length) - 1] ?? 0;
};

/** One run of whole cycles, as `runHarvester` on the server. */
export const runBuffer = (buffer: Buffer, rates: Rates, elapsed: number, power = 1): Buffer => {
  const stored = Math.max(0, buffer.stored);
  if (stored >= rates.capacity) return { stored: rates.capacity, countdown: null };
  const cycle = Math.max(1, rates.cycle);
  const first = buffer.countdown !== null && buffer.countdown > 0 ? buffer.countdown : cycle;
  const time = Math.max(0, elapsed);
  if (time < first) return { stored, countdown: first - time };
  const cycles = 1 + Math.floor((time - first) / cycle);
  const after = Math.min(rates.capacity, stored + cycles * rates.produce * power);
  if (after >= rates.capacity) return { stored: after, countdown: null };
  return { stored: after, countdown: cycle - ((time - first) % cycle) };
};

const counting = (building: BuildingData): boolean =>
  Boolean(building.cB) || Boolean(building.cU) || Boolean(building.cF);

const levelOf = (building: BuildingData): number => {
  if (finite(building.cB)) return 0;
  const level = finite(building.l);
  return level !== undefined && level > 0 ? level : 1;
};

/**
 * One harvester now, or null for anything that is not one.
 *
 * @param save - The merged save (`YardStore.save`): `savetime`, the health
 *   list and `storedata` are read from it.
 * @param now - The server's clock, unix seconds (`YardStore.now()`).
 */
export const harvesterNow = (
  building: BuildingData,
  save: Pick<BaseLoadResponse, "savetime" | "currenttime" | "buildinghealthdata" | "storedata">,
  now: number,
): HarvesterNow | null => {
  const type = Number(building.t);
  if (!isHarvester(type)) return null;
  const stats = rowOf(type)?.[6];
  if (!stats) return null;

  const level = levelOf(building);
  const max = maxHealth(type, Math.max(1, level)) ?? undefined;
  const health =
    finite(save.buildinghealthdata?.[String(building.id)]) ?? finite(building.hp) ?? undefined;
  const capacity = at(stats.capacity, level);
  const baseCycle = Math.max(1, at(stats.cycleTime, level));
  const ratio = health === undefined || !max ? 1 : Math.min(Math.max(health, 0), max) / max;
  const rates: Rates = {
    produce: at(stats.produce, level),
    cycle: baseCycle + Math.ceil(baseCycle * (4 - 4 * ratio)),
    capacity,
  };

  const producing = finite(building.pr) !== 0;
  const countdown = finite(building.cP);
  let buffer: Buffer = {
    stored: Math.max(0, finite(building.st) ?? 0),
    countdown: producing && countdown !== undefined && countdown > 0 ? countdown : null,
  };

  const runs =
    level > 0 &&
    !counting(building) &&
    (health === undefined || (health > 0 && (!max || health >= max * 0.5)));
  if (runs) {
    const from = savedAtOf(save);
    const elapsed = Math.max(0, now - from);
    const podEnd = finite(save.storedata?.[OVERDRIVE_ITEM]?.e);
    const overdriven = podEnd === undefined ? 0 : Math.min(elapsed, Math.max(0, podEnd - from));
    if (overdriven > 0) buffer = runBuffer(buffer, rates, overdriven, OVERDRIVE_POWER);
    buffer = runBuffer(buffer, rates, elapsed - overdriven);
  }

  const stored = Math.floor(buffer.stored);
  const offer = Math.min(stored, capacity);
  const bankable = level > 0 && !counting(building);
  const fullHealth = health === undefined || (max !== undefined && health >= max);
  return {
    id: Number(building.id),
    resource: `r${type}` as HarvestKey,
    stored,
    capacity,
    offer,
    bankable,
    collectable: bankable && fullHealth && offer > 0,
  };
};

/** What Collect all would bank now. */
export const harvestWaiting = (
  save: Pick<
    BaseLoadResponse,
    "savetime" | "currenttime" | "buildingdata" | "buildinghealthdata" | "storedata"
  >,
  now: number,
): HarvestWaiting => {
  const amounts: Record<HarvestKey, number> = { r1: 0, r2: 0, r3: 0, r4: 0 };
  const ids: number[] = [];
  for (const building of Object.values(save.buildingdata ?? {})) {
    const one = building && harvesterNow(building, save, now);
    if (!one?.collectable) continue;
    amounts[one.resource] += one.offer;
    ids.push(one.id);
  }
  ids.sort((a, b) => a - b);
  return { amounts, total: amounts.r1 + amounts.r2 + amounts.r3 + amounts.r4, ids };
};
