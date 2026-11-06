import { decorationPrice } from "@/game/yard/decorShop";
import { storedCount } from "@/game/yard/decorStorage";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { YardResponse } from "./types";
import { yardBody, type YardRefusal } from "./yard";

/**
 * Decoration storage (`docs/design/yard-buildings.md` §8.3, #128):
 *
 *   POST /api/:apiVersion/bm/yard/decor/place   type, x, y
 *   POST /api/:apiVersion/bm/yard/decor/buy     type, x, y
 *
 * `place` takes one decoration out of storage and puts it down finished: free,
 * no worker, inside the plot. Refusals: `notDecoration`, `notInStorage`,
 * `placement`, and `notInOutpost` (storage is the main yard's).
 *
 * `buy` (owner decision 2026-11-04) buys one Flash sold for Shiny at the
 * server's price and puts it down the same way; the Shiny is taken only when
 * the spot is good. Refusals: `notForSale`, `credits`, `shinyLocked`, and
 * `place`'s. One already in storage is placed from there for free.
 */

const DECOR_PATH = "/api/:apiVersion/bm/yard/decor";

/** `report` of `decor/place`. */
export interface PlaceDecorationReport {
  id: number;
  t: number;
  x: number;
  y: number;
  /** A totem's stored level, else 1. */
  level: number;
  /** How many of the type are left in storage. */
  left: number;
  /** `buy` only: the Shiny charged (0 when one came out of storage). */
  credits?: number;
}

/** Puts a stored decoration of `type` with its footprint at `(x, y)`. */
export const placeDecoration = (
  type: number,
  x: number,
  y: number,
): Promise<YardResponse<PlaceDecorationReport>> =>
  post<YardResponse<PlaceDecorationReport>>(`${DECOR_PATH}/place`, yardBody({ type, x, y }));

/** Buys a decoration of `type` for Shiny and puts it with its footprint at `(x, y)`. */
export const buyDecoration = (
  type: number,
  x: number,
  y: number,
): Promise<YardResponse<PlaceDecorationReport>> =>
  post<YardResponse<PlaceDecorationReport>>(`${DECOR_PATH}/buy`, yardBody({ type, x, y }));

export interface DecorApi {
  place: typeof placeDecoration;
  buy: typeof buyDecoration;
}

export const decorApi: DecorApi = { place: placeDecoration, buy: buyDecoration };

/** The queue key, for `store.isRunning`. */
export const DecorKey = {
  place: (type: number): string => actionKey("decor", type),
} as const;

const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

export interface DecorActions {
  /** Places a decoration from storage. Refused locally when none is stored or in an outpost. */
  place(type: number, x: number, y: number): Promise<YardActionResult<PlaceDecorationReport>>;
  /** Buys one for Shiny and places it. Refused locally when not sold, short of Shiny or in an outpost. */
  buy(type: number, x: number, y: number): Promise<YardActionResult<PlaceDecorationReport>>;
}

/** The route through `store.run`, re-checked against the state the answer ahead of it left (T4). */
export const decorActions = (store: YardStore, api: DecorApi = decorApi): DecorActions => ({
  place: (type, x, y) =>
    store.run({
      key: DecorKey.place(type),
      check: (reader) => {
        if (reader.kind === "outpost") return refuse("notInOutpost", "Decorations go in your main yard.");
        return storedCount(reader.save.researchdata, type) > 0
          ? null
          : refuse("notInStorage", "You have none of those in storage.");
      },
      send: () => api.place(type, x, y),
    }),
  buy: (type, x, y) =>
    store.run({
      key: DecorKey.place(type),
      check: (reader) => {
        if (reader.kind === "outpost") return refuse("notInOutpost", "Decorations go in your main yard.");
        const price = decorationPrice(type);
        if (price === null) return refuse("notForSale", "That decoration is not for sale.");
        return reader.credits < price ? refuse("credits", "You do not have enough Shiny for that.") : null;
      },
      send: () => api.buy(type, x, y),
    }),
});
