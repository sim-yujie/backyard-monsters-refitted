import type { BaseLoadResponse, BuildingData, ResourceCaps, Resources } from "@/api/types";
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

/** One harvester's level, health, rates and whether it runs, which its buffer and its rate both read. */
interface HarvesterSetup {
  readonly type: number;
  readonly level: number;
  readonly max: number | undefined;
  readonly health: number | undefined;
  readonly rates: Rates;
  /** It produces now: built, no countdown running, at half health or more. */
  readonly runs: boolean;
}

const setupOf = (
  building: BuildingData,
  save: Pick<BaseLoadResponse, "buildinghealthdata">,
): HarvesterSetup | null => {
  const type = Number(building.t);
  if (!isHarvester(type)) return null;
  const stats = rowOf(type)?.[6];
  if (!stats) return null;

  const level = levelOf(building);
  const max = maxHealth(type, Math.max(1, level)) ?? undefined;
  const health =
    finite(save.buildinghealthdata?.[String(building.id)]) ?? finite(building.hp) ?? undefined;
  const baseCycle = Math.max(1, at(stats.cycleTime, level));
  const ratio = health === undefined || !max ? 1 : Math.min(Math.max(health, 0), max) / max;
  const rates: Rates = {
    produce: at(stats.produce, level),
    cycle: baseCycle + Math.ceil(baseCycle * (4 - 4 * ratio)),
    capacity: at(stats.capacity, level),
  };
  const runs =
    level > 0 &&
    !counting(building) &&
    (health === undefined || (health > 0 && (!max || health >= max * 0.5)));
  return { type, level, max, health, rates, runs };
};

/** When the Production Overdrive ends, if the save holds one. */
const overdriveEnd = (save: Pick<BaseLoadResponse, "storedata">): number | undefined =>
  finite(save.storedata?.[OVERDRIVE_ITEM]?.e);

/**
 * What one harvester makes in an hour (#280), or null for anything that is
 * not one: `produce` every cycle, the cycle stretched by damage, by the rules
 * {@link harvesterNow} fills its buffer with. Zero while it does not run
 * (being built, upgraded or fortified, or under half health); doubled while
 * the Production Overdrive runs at `now`. A full buffer does not zero it: it
 * is what the harvester makes as long as it is banked.
 */
export const harvesterPerHour = (
  building: BuildingData,
  save: Pick<BaseLoadResponse, "buildinghealthdata" | "storedata">,
  now: number,
): { readonly resource: HarvestKey; readonly perHour: number } | null => {
  const setup = setupOf(building, save);
  if (!setup) return null;
  const resource = `r${setup.type}` as HarvestKey;
  if (!setup.runs) return { resource, perHour: 0 };
  const podEnd = overdriveEnd(save);
  const power = podEnd !== undefined && now < podEnd ? OVERDRIVE_POWER : 1;
  return { resource, perHour: (setup.rates.produce * power * 3600) / setup.rates.cycle };
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
  const setup = setupOf(building, save);
  if (!setup) return null;
  const { type, level, max, health, rates, runs } = setup;
  const capacity = rates.capacity;

  const producing = finite(building.pr) !== 0;
  const countdown = finite(building.cP);
  let buffer: Buffer = {
    stored: Math.max(0, finite(building.st) ?? 0),
    countdown: producing && countdown !== undefined && countdown > 0 ? countdown : null,
  };

  if (runs) {
    const from = savedAtOf(save);
    const elapsed = Math.max(0, now - from);
    const podEnd = overdriveEnd(save);
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

/** Per harvester id: its resource and an amount, the shape of a bank report's `byBuilding`. */
export type BankedByBuilding = Record<string, { resource: HarvestKey; amount: number }>;

/**
 * What a bank will credit, per harvester, before the server says (#208): the
 * balls leave on the press rather than on the answer. `ids` are the
 * harvesters a tap names, or "all" for Collect all's. Each offers what
 * {@link harvesterNow} says it holds, and the pool takes it up to the
 * storage cap in id order, as the server's `bank` hands it out
 * (`server/src/services/yard/bank.ts`, `credit.ts` `fitCredit`). The
 * server's answer corrects whatever this gets wrong.
 */
export const predictBank = (
  save: Pick<
    BaseLoadResponse,
    "savetime" | "currenttime" | "buildingdata" | "buildinghealthdata" | "storedata"
  >,
  now: number,
  ids: readonly number[] | "all",
  resources?: Partial<Resources>,
  caps?: ResourceCaps | null,
): BankedByBuilding => {
  const chosen: HarvesterNow[] = [];
  const named = ids === "all" ? null : new Set(ids);
  for (const building of Object.values(save.buildingdata ?? {})) {
    const one = building && harvesterNow(building, save, now);
    if (!one || one.offer <= 0) continue;
    if (named ? named.has(one.id) && one.bankable : one.collectable) chosen.push(one);
  }
  chosen.sort((a, b) => a.id - b.id);

  const room: Partial<Record<HarvestKey, number>> = {};
  const banked: BankedByBuilding = {};
  for (const one of chosen) {
    const cap = caps?.[one.resource];
    const held = Math.floor(Number(resources?.[one.resource]) || 0);
    const left = room[one.resource] ?? (cap !== undefined && cap > 0 ? Math.max(0, cap - held) : Infinity);
    const amount = Math.min(one.offer, left);
    room[one.resource] = left - amount;
    if (amount > 0) banked[String(one.id)] = { resource: one.resource, amount };
  }
  return banked;
};
