import type { BaseLoadResponse, BuildingResources, Resources } from "@/api/types";
import { noAmounts, RESOURCE_KEYS, type ResourceAmounts } from "@/game/combat/rules";

/**
 * The player's Map Room 2 outpost income, predicted between server answers
 * (issue #207).
 *
 * The server pays it into the main pool whenever a request touches the yard:
 * the own-yard `/base/load` and every `/bm/yard/*` answer
 * (`server/src/services/maproom/v2/autobank.ts`). Flash paid it every 10 s
 * while the player was home (`client/scripts/BASE.as:2539-2543` calls
 * `AutoBankManager.autobank()`), so its resource bar climbed on its own; this
 * runs the server's arithmetic forward so the HUD does the same without a
 * request every 10 s. It mirrors `autobankTicks` and the credit clamp rule for
 * rule:
 *
 * - `buildingresources` holds `t`, the moment income is paid up to, and one
 *   `b<baseid>: {r1..r4}` rate per outpost: what it adds per 10 s tick;
 * - whole ticks only, counted from `t`, so the display moves on the same
 *   moments the server pays; at most two days of them
 *   (`AutoBankManager.as:75-77`);
 * - each tick up to the Production Overdrive's end (`storedata.POD.e`) counts
 *   twice (`AutoBankManager.as:258-263`);
 * - every credit fills up to the storage cap and no further, and a pool
 *   already over the cap keeps what it has (`BASE.Fund`, `credit.ts`).
 *
 * The rates are the ones the load carried; the server works them out afresh
 * at each payout, so an outpost harvester upgraded or wrecked since shows
 * from the next answer on, which replaces the prediction.
 */

/** One autobank tick, in seconds (`client/scripts/BASE.as:2539-2543`). */
export const AUTOBANK_TICK = 10;

/** At most two days of income are paid (`AutoBankManager.as:75-77`). */
export const OUTPOST_INCOME_WINDOW = 60 * 60 * 24 * 2;

/** The Production Overdrive's store code and power (`client/scripts/STORE.as:2413-2418`). */
const OVERDRIVE_ITEM = "POD";
const OVERDRIVE_POWER = 2;

/** The outpost rate keys the server writes: `b` and a `baseid`. */
const RATE_KEY = /^b\d+$/;

/** What the prediction runs from. */
export interface OutpostIncome {
  /** Per tick, all outposts together. */
  readonly rate: ResourceAmounts;
  /** Unix seconds income is paid up to. */
  readonly t: number;
}

const finite = (raw: unknown): number | undefined => {
  const value = Number(raw);
  return raw !== null && raw !== undefined && raw !== "" && Number.isFinite(value) ? value : undefined;
};

/**
 * The income a save's `buildingresources` describes, or null when there is
 * none to predict: no outposts earning, or no `t` yet (the server stamps one
 * at its first payout and pays nothing before it).
 */
export const outpostIncomeOf = (
  buildingresources: BuildingResources | null | undefined,
): OutpostIncome | null => {
  const t = finite(buildingresources?.t);
  if (!buildingresources || t === undefined || t <= 0) return null;

  const rate = noAmounts();
  for (const [key, entry] of Object.entries(buildingresources)) {
    if (!RATE_KEY.test(key) || !entry || typeof entry !== "object") continue;
    for (const resource of RESOURCE_KEYS) {
      rate[resource] += Math.max(0, Math.trunc(finite((entry as Resources)[resource]) ?? 0));
    }
  }
  return RESOURCE_KEYS.some((key) => rate[key] > 0) ? { rate, t } : null;
};

/** When the Production Overdrive ends, if the save holds one. */
export const overdriveEndOf = (save: Pick<BaseLoadResponse, "storedata">): number | undefined =>
  finite(save.storedata?.[OVERDRIVE_ITEM]?.e);

/** What {@link incomeTicks} works out. */
export interface IncomeTicks {
  /** Per resource, before the storage cap. */
  readonly owed: ResourceAmounts;
  /** Whole ticks since `t`. */
  readonly ticks: number;
  /** Where `t` stands once they are paid: the end of the last whole tick. */
  readonly t: number;
}

/**
 * The whole ticks owed between `income.t` and `now`, and what they come to:
 * the server's `autobankTicks`.
 *
 * @param now - Unix seconds, on the server's clock.
 * @param overdriveUntil - When Production Overdrive ends, if it runs.
 */
export const incomeTicks = (
  income: OutpostIncome,
  now: number,
  overdriveUntil?: number,
): IncomeTicks => {
  const from = Math.max(Math.min(income.t, now), now - OUTPOST_INCOME_WINDOW);
  const ticks = Math.floor((now - from) / AUTOBANK_TICK);
  const overdriven =
    overdriveUntil === undefined
      ? 0
      : Math.min(ticks, Math.max(0, Math.floor((overdriveUntil - from) / AUTOBANK_TICK)));
  const paid = ticks + overdriven * (OVERDRIVE_POWER - 1);

  const owed = noAmounts();
  for (const key of RESOURCE_KEYS) owed[key] = income.rate[key] * paid;
  return { owed, ticks, t: from + ticks * AUTOBANK_TICK };
};

/**
 * `resources` with `owed` credited, each up to `cap` and no further; a
 * resource already over the cap keeps what it holds (`fitCredit`). The other
 * keys (`r1max` and the like) come through as they are.
 */
export const creditUpTo = (
  resources: Resources,
  owed: Readonly<ResourceAmounts>,
  cap: number,
): Resources => {
  const out: Resources = { ...resources };
  for (const key of RESOURCE_KEYS) {
    if (!(owed[key] > 0)) continue;
    const held = finite(resources[key]) ?? 0;
    out[key] = Math.max(held, Math.min(held + owed[key], cap));
  }
  return out;
};

/**
 * The running prediction one screen keeps: the pool last reported, the
 * income it is predicted from, and how many ticks the shown pool includes.
 *
 * - {@link settle}: a server answer that paid the income up to its `now`
 *   (the own-yard load, every `/bm/yard/*` answer);
 * - {@link rebase}: a pool reported by a route that pays none (the Yard
 *   Planner's writes, the map's resource sync), so the ticks since `t` go
 *   back on top of it;
 * - {@link next}: once a second, the pool to show when another tick passed.
 */
export class IncomePrediction {
  private income: OutpostIncome | null;
  private base: Resources;
  private shown = Number.NaN;

  constructor(buildingresources: BuildingResources | null | undefined, resources: Resources | undefined) {
    this.income = outpostIncomeOf(buildingresources);
    this.base = resources ?? {};
  }

  /** Whether there is any income to predict. */
  get active(): boolean {
    return this.income !== null;
  }

  /**
   * The server paid the income up to its last whole tick before `serverNow`
   * and `resources` holds it: predict from there.
   */
  settle(resources: Resources | undefined, serverNow: number | undefined): void {
    this.base = resources ?? {};
    this.shown = 0;
    if (!this.income || typeof serverNow !== "number" || !Number.isFinite(serverNow)) return;
    this.income = { ...this.income, t: incomeTicks(this.income, serverNow).t };
  }

  /** A pool from a route that pays no income; the next {@link next} adds the ticks since `t` to it. */
  rebase(resources: Resources): void {
    this.base = resources;
    this.shown = Number.NaN;
  }

  /**
   * The pool to show at `now`: the last reported one plus every whole tick
   * since `t`, up to `cap`; null when the tick count has not moved since the
   * last call, or there is nothing to predict.
   *
   * @param now - Unix seconds, on the server's clock.
   * @param cap - The storage cap, one figure for all four.
   * @param overdriveUntil - When Production Overdrive ends, if it runs.
   */
  next(now: number, cap: number, overdriveUntil?: number): Resources | null {
    if (!this.income) return null;
    const { owed, ticks } = incomeTicks(this.income, now, overdriveUntil);
    if (ticks === this.shown) return null;
    this.shown = ticks;
    return creditUpTo(this.base, owed, cap);
  }
}
