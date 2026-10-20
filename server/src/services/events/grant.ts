import { footprintOf } from "../../game-data/buildingFootprints.js";
import {
  FREE_SPEEDUP_ITEMS,
  FREE_SPEEDUP_KEYS,
  TIMED_REWARD_ITEMS,
  type EventReward,
} from "../../game-data/events/eventRewards.js";
import { storeItems } from "../../game-data/store/storeItems.js";
import type { JsonObject } from "../../types/JsonObject.js";
import { addAmounts, noAmounts, RESOURCE_KEYS } from "../base/economy/resourceBudget.js";
import { fitCredit, type CreditSave } from "../yard/credit.js";
import type { ResourceAmounts } from "../yardplanner/costs.js";

/**
 * Paying event rewards (`game-data/events/eventRewards.ts`) into the player's
 * main yard: the calendar, the ladder, and whatever an event adds later.
 *
 * {@link planGrant} is pure. It works out a yard action's outcome
 * (`controllers/yard/yardAction.ts`): resources as `credit`, which the
 * wrapper clamps to the storage cap as every credit is; Shiny as
 * `grantShiny`; store buffs and free speed-ups as a new `storedata`;
 * decorations as a new `researchdata`. So a grant always runs inside a yard
 * action, under the main yard's row lock, and lands or rolls back with the
 * claim that paid it (`controllers/yard/events.ts`).
 */

/** The slice of a save a grant reads. */
export interface GrantSave extends CreditSave {
  storedata?: JsonObject | null;
  researchdata?: JsonObject | null;
}

/** What one reward came to, for the answer. */
export type GrantedReward =
  | { kind: "resources"; amounts: ResourceAmounts; credited: ResourceAmounts; overflow: ResourceAmounts }
  | { kind: "shiny"; amount: number }
  | { kind: "shopItem"; item: string; endsAt: number }
  | { kind: "speedup"; item: string; count: number; held: number }
  | { kind: "decoration"; type: number; count: number; stored: number };

/** What a yard action returns for a grant: spread into its outcome. */
export interface GrantPlan {
  credit: ResourceAmounts;
  grantShiny: number;
  slices: { storedata?: JsonObject; researchdata?: JsonObject };
  granted: GrantedReward[];
}

/** A whole amount of at least 0. */
const whole = (raw: unknown): number => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
};

/**
 * Why `reward` cannot be paid, or null when it can. The event config is
 * checked against this by its tests, and {@link planGrant} throws on it.
 */
export const rewardProblem = (reward: EventReward): string | null => {
  switch (reward.kind) {
    case "resources": {
      const keys = Object.keys(reward.amounts);
      if (keys.some((key) => !(RESOURCE_KEYS as readonly string[]).includes(key))) return "unknown resource";
      return keys.some((key) => whole(reward.amounts[key as keyof ResourceAmounts]) > 0) ? null : "no amount";
    }
    case "shiny":
      return whole(reward.amount) > 0 ? null : "no amount";
    case "shopItem":
      return (TIMED_REWARD_ITEMS as readonly string[]).includes(reward.item) && (storeItems[reward.item]?.du ?? 0) > 0
        ? null
        : "not a timed store item";
    case "speedup":
      if (!(FREE_SPEEDUP_ITEMS as readonly string[]).includes(reward.item)) return "not a keepable speed-up";
      return whole(reward.count) > 0 ? null : "no count";
    case "decoration":
      if (footprintOf(reward.type).decoration !== true) return "not a placeable decoration";
      return whole(reward.count) > 0 ? null : "no count";
    default:
      return "unknown kind";
  }
};

/**
 * The outcome of paying `rewards` into `save` at `now`.
 *
 * - Resources add up across rewards; `granted` says what fits under the cap
 *   now (`fitCredit`), which is what the wrapper's credit will land.
 * - A timed store buff starts now, or, already running, runs its full
 *   duration longer (`e`), so a reward is never lost to one bought earlier.
 * - Free speed-ups add to `storedata[FREE_SPEEDUP_KEYS[item]].q`.
 * - Decorations add to `researchdata["b<type>"]`, the storage the
 *   decorations drawer places from.
 *
 * @throws Error on a reward {@link rewardProblem} refuses: a config mistake.
 */
export const planGrant = (save: GrantSave, rewards: readonly EventReward[], now: number): GrantPlan => {
  const credit = noAmounts();
  let grantShiny = 0;
  let storedata: JsonObject | undefined;
  let researchdata: JsonObject | undefined;
  const granted: GrantedReward[] = [];
  const resourceRows: Extract<GrantedReward, { kind: "resources" }>[] = [];

  for (const reward of rewards) {
    const problem = rewardProblem(reward);
    if (problem) throw new Error(`Event reward ${JSON.stringify(reward)}: ${problem}`);

    switch (reward.kind) {
      case "resources": {
        const amounts = noAmounts();
        for (const key of RESOURCE_KEYS) amounts[key] = whole(reward.amounts[key]);
        addAmounts(credit, amounts);
        const row = { kind: "resources" as const, amounts, credited: noAmounts(), overflow: noAmounts() };
        resourceRows.push(row);
        granted.push(row);
        break;
      }
      case "shiny": {
        const amount = whole(reward.amount);
        grantShiny += amount;
        granted.push({ kind: "shiny", amount });
        break;
      }
      case "shopItem": {
        storedata ??= { ...(save.storedata ?? {}) };
        const entry = (storedata[reward.item] ?? {}) as JsonObject;
        const running = whole(entry.e) > now;
        const endsAt = (running ? whole(entry.e) : now) + storeItems[reward.item]!.du;
        storedata[reward.item] = running
          ? { ...entry, q: whole(entry.q) + 1, e: endsAt }
          : { q: 1, s: now, e: endsAt };
        granted.push({ kind: "shopItem", item: reward.item, endsAt });
        break;
      }
      case "speedup": {
        storedata ??= { ...(save.storedata ?? {}) };
        const key = FREE_SPEEDUP_KEYS[reward.item];
        const entry = (storedata[key] ?? {}) as JsonObject;
        const count = whole(reward.count);
        const held = whole(entry.q) + count;
        storedata[key] = { ...entry, q: held };
        granted.push({ kind: "speedup", item: reward.item, count, held });
        break;
      }
      case "decoration": {
        researchdata ??= { ...(save.researchdata ?? {}) };
        const count = whole(reward.count);
        const stored = whole(researchdata[`b${reward.type}`]) + count;
        researchdata[`b${reward.type}`] = stored;
        granted.push({ kind: "decoration", type: reward.type, count, stored });
        break;
      }
    }
  }

  // What the wrapper's one credit will land, shared out over the resource
  // rewards in order (a calendar day has one; this keeps several honest).
  const { credited } = fitCredit(save, credit);
  const left = { ...credited };
  for (const row of resourceRows) {
    for (const key of RESOURCE_KEYS) {
      row.credited[key] = Math.min(row.amounts[key], left[key]);
      row.overflow[key] = row.amounts[key] - row.credited[key];
      left[key] -= row.credited[key];
    }
  }

  return {
    credit,
    grantShiny,
    slices: {
      ...(storedata && { storedata }),
      ...(researchdata && { researchdata }),
    },
    granted,
  };
};
