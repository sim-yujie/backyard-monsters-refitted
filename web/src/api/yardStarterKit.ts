import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * Outpost Starter Kits (outposts WP9, issue #188; wire contract in
 * `server/src/services/yard/starterKit.ts`):
 *
 *   POST /api/:apiVersion/bm/yard/starterkit   kit (1-3), pay, topUp?, baseid
 *
 * The call holds no state; {@link starterKitActions} runs it through the
 * `YardStore`'s queue, which merges the answer: the new buildings, the main
 * pool and the Shiny balance.
 */

export type KitPayment = "resources" | "shiny";

/** `report` of `starterkit`. */
export interface StarterKitReport {
  kit: number;
  pay: KitPayment;
  /** Buildings the kit placed, the core not counted. */
  placed: number;
  /** Buildings it took away, the core not counted. */
  removed: number;
  /** Resources charged. */
  cost: UpgradeCost;
  /** Shiny charged: the kit's price, or the top-up. */
  shiny: number;
  /** Unix seconds when the last building is done; now when paid with Shiny. */
  doneBy: number;
  /** The "New to Map Room 2" free Regular kit: nothing was charged. */
  free?: true;
}

/**
 * Replaces the outpost's buildings with kit `kit`. Refusals: 400
 * `badRequest`; 409 `notOutpost`, `monsters` (move them out first),
 * `shortfall { shortfall, topUp }` (resources short and no matching `topUp`),
 * `shinyLocked`, `credits`.
 */
export const buyStarterKit = (
  kit: number,
  pay: KitPayment,
  topUp?: number,
  baseid?: string,
): Promise<YardResponse<StarterKitReport>> =>
  post<YardResponse<StarterKitReport>>(
    "/api/:apiVersion/bm/yard/starterkit",
    yardBody({ kit, pay, ...(topUp !== undefined && topUp > 0 ? { topUp } : {}) }, baseid),
  );

/**
 * The "New to Map Room 2" free Regular kit: nothing charged, built as the
 * resource path builds. Refused 409 `welcomeUsed` if it is no longer free,
 * rather than charged.
 */
export const buyFreeStarterKit = (kit: number, baseid?: string): Promise<YardResponse<StarterKitReport>> =>
  post<YardResponse<StarterKitReport>>(
    "/api/:apiVersion/bm/yard/starterkit",
    yardBody({ kit, pay: "resources", free: true }, baseid),
  );

/** The queue key, for `store.isRunning`. */
export const STARTER_KIT_KEY = actionKey("starterkit", "buy");

const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

export interface StarterKitActions {
  /**
   * Buys kit `kit`; `topUp` is the Shiny the player agreed to for a short pool.
   * `free`: the "New to Map Room 2" free Regular kit (pay and topUp unused).
   */
  buy(kit: number, pay: KitPayment, topUp?: number, free?: boolean): Promise<YardActionResult<StarterKitReport>>;
}

export const starterKitActions = (
  store: YardStore,
  send: typeof buyStarterKit = buyStarterKit,
  sendFree: typeof buyFreeStarterKit = buyFreeStarterKit,
): StarterKitActions => ({
  buy: (kit, pay, topUp, free) =>
    store.run({
      key: STARTER_KIT_KEY,
      check: (reader) =>
        reader.kind === "outpost" ? null : refuse("notOutpost", "Starter Kits are for outposts."),
      send: (_api, ...yard) => (free ? sendFree(kit, ...yard) : send(kit, pay, topUp, ...yard)),
    }),
});
