import { harvesterNow, harvestWaiting, type HarvestKey } from "@/game/yard/harvest";
import { actionKey, type YardActionResult, type YardStore } from "@/game/yard/YardStore";
import { post } from "./http";
import type { UpgradeCost, YardResponse } from "./types";
import type { YardRefusal } from "./yard";

/**
 * Banking harvesters (`docs/design/yard-buildings.md` §5.1, decision D12; wire
 * contract in `docs/server-api.md` "Yard actions"):
 *
 *   POST /api/:apiVersion/bm/yard/bank   ids (JSON array) | all=1
 *
 * A tap on a harvester banks that one; the HUD's Collect all banks every
 * eligible one in one request. What does not fit under the storage cap stays
 * in the buffers (§10 Q3). The call holds no state; {@link bankActions} runs
 * it through the `YardStore`'s one-at-a-time queue, which merges the answer.
 */

const BANK_PATH = "/api/:apiVersion/bm/yard/bank";

/** `report` of `bank`. */
export interface BankReport {
  /** Credited to the pool, per resource. */
  banked: UpgradeCost;
  /** Per harvester that banked something: its resource and the amount. */
  byBuilding: Record<string, { resource: HarvestKey; amount: number }>;
  /** What stayed in the banked harvesters' buffers because the pool was full. */
  leftInBuffers: UpgradeCost;
  /** Named harvesters that banked nothing: a countdown running (`busy`) or nothing held (`empty`). */
  skipped: { id: number; reason: "busy" | "empty" }[];
  /** Empire points awarded. */
  points: number;
}

/** Banks the named harvesters. Refusal: 400 `badRequest` for an id that is not a harvester. */
export const bankHarvesters = (ids: readonly number[]): Promise<YardResponse<BankReport>> =>
  post<YardResponse<BankReport>>(BANK_PATH, { ids: JSON.stringify(ids) });

/** Banks every harvester that is built, idle, at full health and holding something. */
export const bankAll = (): Promise<YardResponse<BankReport>> =>
  post<YardResponse<BankReport>>(BANK_PATH, { all: 1 });

/** Both calls, so the actions can be handed a stand-in under test. */
export interface BankApi {
  ids: typeof bankHarvesters;
  all: typeof bankAll;
}

export const bankApi: BankApi = { ids: bankHarvesters, all: bankAll };

/** The queue keys, for `store.isRunning`. */
export const BankKey = {
  ALL: actionKey("bank", "all"),
  one: (id: number): string => actionKey("bank", id),
} as const;

/** A local refusal, in the server's shape. */
const refuse = (reason: string, message: string): YardRefusal => ({
  reason,
  message,
  detail: {},
  local: true,
});

export interface BankActions {
  /** Banks one harvester (a tap). Refused locally when it holds nothing it can bank. */
  one(id: number): Promise<YardActionResult<BankReport>>;
  /** Collect all. Refused locally when nothing is waiting. */
  all(): Promise<YardActionResult<BankReport>>;
}

/**
 * The bank route through `store.run`, so it queues behind any request in
 * flight and re-checks, against the state the answer ahead of it left, that
 * something is still waiting (T4).
 */
export const bankActions = (store: YardStore, api: BankApi = bankApi): BankActions => ({
  one: (id) =>
    store.run({
      key: BankKey.one(id),
      check: (reader) => {
        const building = reader.building(id)?.raw;
        const now = building ? harvesterNow(building, reader.save, reader.now()) : null;
        if (!now) return refuse("badRequest", "That is not a harvester in your yard.");
        if (!now.bankable) return refuse("busy", "That harvester is busy.");
        return now.offer > 0 ? null : refuse("empty", "That harvester has nothing to collect.");
      },
      send: () => api.ids([id]),
    }),
  all: () =>
    store.run({
      key: BankKey.ALL,
      check: (reader) =>
        harvestWaiting(reader.save, reader.now()).total > 0
          ? null
          : refuse("empty", "Your harvesters have nothing to collect."),
      send: () => api.all(),
    }),
});
