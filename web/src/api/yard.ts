import { ApiError, NetworkError, post, type FormBody } from "./http";
import type {
  MushroomPickReport,
  ShopBuyReport,
  SpeedupItem,
  SpeedupReport,
  UpgradeCancelReport,
  UpgradeInstantReport,
  UpgradeStartReport,
  YardResponse,
} from "./types";

/**
 * The server-authoritative yard routes (`docs/design/yard-buildings.md` §2.1
 * and §3.2; wire contract in `docs/server-api.md` "Yard actions").
 *
 *   POST /api/:apiVersion/bm/yard/state
 *   POST /api/:apiVersion/bm/yard/upgrade           id
 *   POST /api/:apiVersion/bm/yard/upgrade/cancel    id
 *   POST /api/:apiVersion/bm/yard/upgrade/instant   id
 *   POST /api/:apiVersion/bm/yard/speedup           id, item
 *   POST /api/:apiVersion/bm/yard/shop/buy          item
 *   POST /api/:apiVersion/bm/yard/mushroom/pick     id, x, y
 *
 * The client names an action and the server does the rest: it loads the
 * save under a row lock, finishes whatever timers ended, checks the rules,
 * charges, writes once and answers with the whole yard state, what it
 * finished (`completed`) and the route's own `report`. Nothing here holds
 * state; `YardStore` runs these one at a time and merges every answer.
 *
 * A refusal throws the usual `ApiError` with the real status (400 malformed,
 * 409 refused right now) and a flat body `{ error, reason, ...detail }`;
 * {@link yardRefusal} reads it.
 *
 * Every call here, and in the other `yard*.ts` files, takes the yard it acts
 * on last: `baseid` for one of the player's outposts, nothing for the main
 * yard (outposts WP3; {@link yardBody}).
 */

const YARD_PATH = "/api/:apiVersion/bm/yard";

/**
 * A yard route's body for the yard it acts on: with `baseid` for one of the
 * player's outposts, and as it always was for the main yard, which the server
 * reads a missing `baseid` as (`YardTargetSchema`). Sending it on every call,
 * the refused ones included, means a control the outpost screen forgot to
 * hide is refused `notInOutpost` rather than run against the main yard.
 */
export const yardBody = (body: FormBody = {}, baseid?: string): FormBody =>
  baseid === undefined ? body : { ...body, baseid };

/** Catches the yard up on the server, writes it and answers with it. */
export const yardState = (baseid?: string): Promise<YardResponse<null>> =>
  post<YardResponse<null>>(`${YARD_PATH}/state`, yardBody({}, baseid));

/**
 * Starts an upgrade: a countdown holding a worker, however short the step
 * (#137); with 300 s or less left, `speedup` `SP1` finishes it free.
 * Refusals, in the server's order:
 * 400 `badRequest`, 400 `useBatchRoute` (walls and traps), `mapRoom`,
 * `busy`, `damaged`, `townHall`, `maxLevel`, `requirements`, `shortfall`,
 * `workers` (`docs/server-api.md` "Yard actions").
 */
export const startUpgrade = (
  id: number,
  baseid?: string,
): Promise<YardResponse<UpgradeStartReport>> =>
  post<YardResponse<UpgradeStartReport>>(`${YARD_PATH}/upgrade`, yardBody({ id }, baseid));

/** Cancels a running upgrade for its full cost back, clamped to the cap. Refusal: `notUpgrading`. */
export const cancelUpgrade = (
  id: number,
  baseid?: string,
): Promise<YardResponse<UpgradeCancelReport>> =>
  post<YardResponse<UpgradeCancelReport>>(
    `${YARD_PATH}/upgrade/cancel`,
    yardBody({ id }, baseid),
  );

/**
 * Buys the next level outright for Shiny. Refusals: the upgrade gates short of
 * `shortfall` and `workers`, then `shinyLocked`, `credits`.
 */
export const instantUpgrade = (
  id: number,
  baseid?: string,
): Promise<YardResponse<UpgradeInstantReport>> =>
  post<YardResponse<UpgradeInstantReport>>(
    `${YARD_PATH}/upgrade/instant`,
    yardBody({ id }, baseid),
  );

/**
 * Speeds up a running build or upgrade. Refusals: `notRunning`, `damaged`
 * (the countdown is paused), `mapRoom`, `itemRefused` (the item does not fit
 * the time left), `shinyLocked`, `credits`.
 */
export const speedUp = (
  id: number,
  item: SpeedupItem,
  baseid?: string,
): Promise<YardResponse<SpeedupReport>> =>
  post<YardResponse<SpeedupReport>>(`${YARD_PATH}/speedup`, yardBody({ id, item }, baseid));

/**
 * Buys a store item for Shiny (`BST`, `BEW` in Phase 1). Refusals: 400
 * `notForSale`, `alreadyActive`, `soldOut`, `shinyLocked`, `credits`.
 */
export const shopBuy = (item: string, baseid?: string): Promise<YardResponse<ShopBuyReport>> =>
  post<YardResponse<ShopBuyReport>>(`${YARD_PATH}/shop/buy`, yardBody({ item }, baseid));

/**
 * Picks a mushroom with a free worker: `id` is its place in `mushrooms.l`,
 * `x`/`y` where the client saw it, so a stale list is refused rather than a
 * different mushroom picked. The server rolls the reward (golden one in four:
 * 3 or 8 Shiny). Refusals: 400 `badRequest`, `moved`, `workers`.
 */
export const pickMushroom = (
  id: number,
  x: number,
  y: number,
  baseid?: string,
): Promise<YardResponse<MushroomPickReport>> =>
  post<YardResponse<MushroomPickReport>>(
    `${YARD_PATH}/mushroom/pick`,
    yardBody({ id, x, y }, baseid),
  );

/** Every call above, so the store can be handed a stand-in under test. */
export interface YardApi {
  state: typeof yardState;
  upgrade: typeof startUpgrade;
  cancelUpgrade: typeof cancelUpgrade;
  instantUpgrade: typeof instantUpgrade;
  speedUp: typeof speedUp;
  shopBuy: typeof shopBuy;
  pickMushroom: typeof pickMushroom;
}

export const yardApi: YardApi = {
  state: yardState,
  upgrade: startUpgrade,
  cancelUpgrade,
  instantUpgrade,
  speedUp,
  shopBuy,
  pickMushroom,
};

/**
 * Why a yard action did not happen, in one shape for every cause.
 *
 * `reason` is the server's key (`busy`, `shortfall`, `workers`, …) for a
 * refusal it sent, and one of the client's own otherwise: `network` (the
 * server could not be reached), `auth` (the session is gone) and `error`
 * (anything else, a 500 included). A refusal the store's own re-check made
 * before sending uses the server's key for the same rule and sets `local`.
 * `detail` is the rest of the refusal body: `shortfall: { r1..r4 }`,
 * `workers: { total, busy }`, ….
 */
export interface YardRefusal {
  readonly reason: string;
  /** A sentence for the player: the server's own, or the client's. */
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
  /** HTTP status the server answered with; absent when nothing was answered. */
  readonly status?: number;
  /**
   * True when the client refused on its own before sending, because the state
   * it holds already says no (`YardStore`'s re-check). `reason` then uses the
   * server's key for the same rule.
   */
  readonly local?: boolean;
}

/**
 * Reads whatever a yard call threw into a {@link YardRefusal}.
 *
 * The yard routes' flat body puts `reason` beside `error`; anything without
 * one (a 500 from the global interceptor, a network failure) still comes
 * back as a refusal so the caller never has to handle two shapes.
 */
export const yardRefusal = (caught: unknown): YardRefusal => {
  if (caught instanceof NetworkError) {
    return { reason: "network", message: "Could not reach the server.", detail: {} };
  }
  if (caught instanceof ApiError) {
    if (caught.isAuthFailure) {
      return { reason: "auth", message: caught.message, detail: {}, status: caught.status };
    }
    const body =
      typeof caught.body === "object" && caught.body !== null
        ? (caught.body as Record<string, unknown>)
        : {};
    const { error: _message, reason, ...detail } = body;
    return {
      reason: typeof reason === "string" ? reason : "error",
      message: caught.message,
      detail,
      status: caught.status,
    };
  }
  return {
    reason: "error",
    message: caught instanceof Error ? caught.message : "Something went wrong.",
    detail: {},
  };
};
