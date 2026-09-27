import { buildOffer, type BuildGate } from "@/game/yard/buildCatalogue";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * Building from the build menu (`docs/design/yard-buildings.md` §5.3; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/build           type, x, y
 *   POST /api/:apiVersion/bm/yard/build/cancel    id
 *   POST /api/:apiVersion/bm/yard/build/instant   type, x, y
 *
 * The calls hold no state; {@link buildActions} runs them through the
 * `YardStore`'s one-at-a-time queue, which merges each answer, so a line of
 * walls clicked quickly goes out one block at a time, each re-checked against
 * the yard the answer before it left.
 */

const BUILD_PATH = "/api/:apiVersion/bm/yard/build";

/** `report` of `build`. */
export interface BuildReport {
  /** The new building's id. */
  id: number;
  t: number;
  x: number;
  y: number;
  /** The countdown written, after Sharper Tools; 0 for a wall or trap. */
  seconds: number;
  /** Written finished at level 1 (a wall or trap, D13). */
  finished: boolean;
  cost: UpgradeCost;
  /** Points awarded now: a finished wall or trap's. */
  points: number;
}

/** `report` of `build/instant`. */
export interface InstantBuildReport {
  id: number;
  t: number;
  x: number;
  y: number;
  /** Shiny charged. */
  credits: number;
  points: number;
}

/** `report` of `build/cancel`. */
export interface CancelBuildReport {
  id: number;
  t: number;
  /** What came back, after the storage cap. */
  refund: UpgradeCost;
}

/**
 * Places a new building. Refusals, in the server's order: 400 `notBuildable`,
 * `townHall`, `limit`, `requirements`, `shortfall`, `placement`, `workers`.
 */
export const buildAt = (type: number, x: number, y: number): Promise<YardResponse<BuildReport>> =>
  post<YardResponse<BuildReport>>(BUILD_PATH, { type, x, y });

/** Places a new building finished, for Shiny. Refusals: `build`'s short of `shortfall` and `workers`, then `shinyLocked`, `credits`. */
export const instantBuildAt = (
  type: number,
  x: number,
  y: number,
): Promise<YardResponse<InstantBuildReport>> =>
  post<YardResponse<InstantBuildReport>>(`${BUILD_PATH}/instant`, { type, x, y });

/** Takes down a building still under construction for its full price back. Refusal: `notBuilding`. */
export const cancelBuild = (id: number): Promise<YardResponse<CancelBuildReport>> =>
  post<YardResponse<CancelBuildReport>>(`${BUILD_PATH}/cancel`, { id });

/** The three calls, so the actions can be handed a stand-in under test. */
export interface BuildApi {
  build: typeof buildAt;
  instant: typeof instantBuildAt;
  cancel: typeof cancelBuild;
}

export const buildApi: BuildApi = { build: buildAt, instant: instantBuildAt, cancel: cancelBuild };

/** The queue keys, for `store.isRunning`. */
export const BuildKey = {
  place: (type: number): string => actionKey("build", type),
  cancel: (id: number): string => actionKey("cancel", id),
} as const;

/** A local refusal, in the server's shape. */
const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

/** A gate as the sentence a local refusal carries. */
const gateMessage = (gate: BuildGate): string => {
  switch (gate.reason) {
    case "townHall":
      return gate.have <= 0 ? "Build a Town Hall first." : `That needs a level ${gate.need} Town Hall.`;
    case "limit":
      return gate.next === null
        ? `You already have ${gate.have}, the most a yard can hold.`
        : `You already have ${gate.have}. Upgrade your Town Hall to level ${gate.next} to build more.`;
    case "requirements":
      return "That needs other buildings first.";
    case "shortfall":
      return "You do not have enough resources for that.";
    case "workers":
      return "All your workers are busy.";
    case "credits":
      return "You do not have enough Shiny for that.";
  }
};

export interface BuildActions {
  /** Places a building of `type` with its footprint at `(x, y)`. */
  build(type: number, x: number, y: number): Promise<YardActionResult<BuildReport>>;
  /** The same, finished at once for Shiny. */
  instant(type: number, x: number, y: number): Promise<YardActionResult<InstantBuildReport>>;
  /** Cancels a building under construction. */
  cancel(id: number): Promise<YardActionResult<CancelBuildReport>>;
}

/**
 * The build routes through `store.run`, each re-checking its gate against the
 * state the answer ahead of it left (T4). Placement is not re-checked here:
 * the placement already held the spot, and the server measures it again.
 */
export const buildActions = (store: YardStore, api: BuildApi = buildApi): BuildActions => ({
  build: (type, x, y) =>
    store.run({
      key: BuildKey.place(type),
      check: (reader) => {
        const offer = buildOffer(type, reader);
        if (!offer) return refuse("notBuildable", "That cannot be built here.");
        return offer.gate ? refuse(offer.gate.reason, gateMessage(offer.gate)) : null;
      },
      send: () => api.build(type, x, y),
    }),
  instant: (type, x, y) =>
    store.run({
      key: BuildKey.place(type),
      check: (reader) => {
        const offer = buildOffer(type, reader);
        if (!offer) return refuse("notBuildable", "That cannot be built here.");
        return offer.instantGate
          ? refuse(offer.instantGate.reason, gateMessage(offer.instantGate))
          : null;
      },
      send: () => api.instant(type, x, y),
    }),
  cancel: (id) =>
    store.run({
      key: BuildKey.cancel(id),
      check: (reader) => {
        const building = reader.building(id);
        if (!building) return refuse("badRequest", "That building is not in your yard.");
        return building.countdown?.kind === "build"
          ? null
          : refuse("notBuilding", "That building is not under construction.");
      },
      send: () => api.cancel(id),
    }),
});
