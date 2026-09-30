import type { BaseLoadResponse, BuildingResources, Resources } from "@/api/types";
import { noAmounts, RESOURCE_KEYS, type ResourceAmounts } from "@/game/combat/rules";
import { autobankTicks, fillToCap } from "@/game/maproom/rules/autobank";

/**
 * The player's Map Room 2 outpost income, predicted between server answers
 * (issue #207).
 *
 * The server pays it into the main pool whenever a request touches the yard:
 * the own-yard `/base/load` and every `/bm/yard/*` answer
 * (`server/src/services/maproom/v2/autobank.ts`). Flash paid it every 10 s
 * while the player was home (`client/scripts/BASE.as:2539-2543` calls
 * `AutoBankManager.autobank()`), so its resource bar climbed on its own; this
 * runs the server's payout forward so the HUD does the same without a
 * request every 10 s.
 *
 * `buildingresources` holds `t`, the moment income is paid up to, and one
 * `b<baseid>: {r1..r4}` rate per outpost: what it adds per 10 s tick. The
 * ticks, the two-day window, the Production Overdrive and the cap clamp are
 * the shared rule the server pays with (`game/maproom/rules/autobank.ts`), so
 * the display moves on the same moments, by the same amounts.
 *
 * The rates are the ones the load carried; the server works them out afresh
 * at each payout, so an outpost harvester upgraded or wrecked since shows
 * from the next answer on, which replaces the prediction.
 */

/** The Production Overdrive's store code (`client/scripts/STORE.as:2413-2418`). */
const OVERDRIVE_ITEM = "POD";

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

/**
 * `resources` with `owed` credited, each through the shared cap clamp
 * (`fillToCap`). The other keys (`r1max` and the like) come through as they are.
 */
export const creditUpTo = (
  resources: Resources,
  owed: Readonly<ResourceAmounts>,
  cap: number,
): Resources => {
  const out: Resources = { ...resources };
  for (const key of RESOURCE_KEYS) {
    if (!(owed[key] > 0)) continue;
    out[key] = fillToCap(finite(resources[key]) ?? 0, owed[key], cap);
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
    this.income = { ...this.income, t: autobankTicks(this.income.rate, this.income.t, serverNow).t };
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
    const { owed, ticks } = autobankTicks(this.income.rate, this.income.t, now, overdriveUntil);
    if (ticks === this.shown) return null;
    this.shown = ticks;
    return creditUpTo(this.base, owed, cap);
  }
}
