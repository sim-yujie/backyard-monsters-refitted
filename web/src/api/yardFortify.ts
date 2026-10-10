import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * Fortifying an outpost's core and towers, or a home yard's silo, Town Hall and towers (#191; server routes from outposts
 * WP3, `server/src/services/yard/fortify.ts`):
 *
 *   POST /api/:apiVersion/bm/yard/fortify          id, baseid
 *   POST /api/:apiVersion/bm/yard/fortify/cancel   id, baseid
 *
 * A fortification is a countdown holding a worker
 * (`BFOUNDATION.FortifyB`, `client/scripts/BFOUNDATION.as:2175-2216`), paid
 * from the main pool. Stopping it gives the step's whole price back, clamped
 * to the storage cap (`FortifyCancelC`, `:2227-2246`). The calls hold no
 * state; {@link fortifyActions} runs them through the `YardStore`'s queue.
 */

const FORTIFY_PATH = "/api/:apiVersion/bm/yard/fortify";

/** `report` of `fortify`. */
export interface FortifyReport {
  id: number;
  /** Fortification before and after the step. */
  from: number;
  to: number;
  /** The countdown written, after Sharper Tools. */
  seconds: number;
  cost: UpgradeCost;
}

/** `report` of `fortify/cancel`. */
export interface CancelFortifyReport {
  id: number;
  /** What came back, after the storage cap. */
  refund: UpgradeCost;
}

/**
 * Starts the next fortification. Refusals: 400 `notFortifiable`; 409 `busy`,
 * `damaged`, `townHall`, `maxFortify`, `requirements`, `shortfall`, `workers`.
 */
export const startFortify = (id: number, baseid?: string): Promise<YardResponse<FortifyReport>> =>
  post<YardResponse<FortifyReport>>(FORTIFY_PATH, yardBody({ id }, baseid));

/** Stops a running fortification, for its price back. Refusal: `notFortifying`. */
export const cancelFortify = (
  id: number,
  baseid?: string,
): Promise<YardResponse<CancelFortifyReport>> =>
  post<YardResponse<CancelFortifyReport>>(`${FORTIFY_PATH}/cancel`, yardBody({ id }, baseid));

export interface FortifyApi {
  start: typeof startFortify;
  cancel: typeof cancelFortify;
}

export const fortifyApi: FortifyApi = { start: startFortify, cancel: cancelFortify };

/** The queue keys, for `store.isRunning`. */
export const FortifyKey = {
  start: (id: number): string => actionKey("fortify", id),
  cancel: (id: number): string => actionKey("cancel", id),
} as const;

const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

export interface FortifyActions {
  start(id: number): Promise<YardActionResult<FortifyReport>>;
  cancel(id: number): Promise<YardActionResult<CancelFortifyReport>>;
}

/**
 * The fortify routes through `store.run`, each re-checked against the state
 * the answer ahead of it left (T4): the building must still be idle to start,
 * and still fortifying to stop.
 */
export const fortifyActions = (store: YardStore, api: FortifyApi = fortifyApi): FortifyActions => ({
  start: (id) =>
    store.run({
      key: FortifyKey.start(id),
      check: (reader) => {
        const building = reader.building(id);
        if (!building) return refuse("badRequest", "That building is not in your yard.");
        return building.countdown
          ? refuse("busy", "That building is already busy. Wait for its job to finish.")
          : null;
      },
      send: (_api, ...yard) => api.start(id, ...yard),
    }),
  cancel: (id) =>
    store.run({
      key: FortifyKey.cancel(id),
      check: (reader) =>
        reader.building(id)?.countdown?.kind === "fortify"
          ? null
          : refuse("notFortifying", "That building is not being fortified."),
      send: (_api, ...yard) => api.cancel(id, ...yard),
    }),
});
